const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../frontend/engagement.js"), "utf8");

class Target {
  constructor() { this.listeners = new Map(); this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, handler, options) {
    if (key !== "click") assert.equal(options.passive, true);
    const handlers = this.listeners.get(key) || new Set(); handlers.add(handler); this.listeners.set(key, handlers);
  }
  removeEventListener(key, handler) { this.listeners.get(key)?.delete(handler); }
  fire(key, event = {}) { for (const handler of [...(this.listeners.get(key) || [])]) handler({ isTrusted: true, ...event }); }
}
function boot(options = {}) {
  let time = 0, nextTick = 5000, timer;
  const requests = [], footer = new Target(), document = new Target(), window = new Target();
  document.visibilityState = "visible"; document.focused = true;
  document.hasFocus = () => document.focused;
  document.getElementById = () => options.noFooter ? null : footer;
  document.createElement = () => new Target();
  Object.defineProperty(document, "cookie", { get() { assert.fail("No cookie access"); }, set() { assert.fail("No cookies"); } });
  const storage = new Proxy({}, { get() { assert.fail("No analytics or auth storage access"); } });
  const url = new URL(options.path || "/leaderboard?sport=nba&invite=PRIVATE#secret", "https://dev.example");
  const navigator = { doNotTrack: options.dnt || "0", globalPrivacyControl: options.gpc || false };
  Object.assign(window, { location: url, AUTH_CONFIG: { environment: options.environment || "dev" } });
  const context = { window, document, navigator, URL, performance: { now: () => time },
    localStorage: storage, sessionStorage: storage,
    setInterval(callback, interval) { assert.equal(interval, 5000); timer = callback; nextTick = time + interval; return 1; },
    clearInterval() { timer = null; },
    fetch(url, request) { requests.push({ url, request, body: JSON.parse(request.body) }); return options.failFetch ? Promise.reject(new Error("offline")) : Promise.resolve({ status: 202 }); },
  };
  vm.runInNewContext(script, context);
  const panel = footer.children[0], button = panel?.children[1], status = panel?.children[2];
  return { requests, document, window, navigator, button, status, panel,
    total: () => requests.reduce((sum, request) => sum + request.body.milliseconds, 0),
    allow() { button.fire("click"); },
    advance(ms) {
      const end = time + ms;
      while (timer && nextTick <= end) { time = nextTick; nextTick += 5000; timer(); }
      time = end;
    },
  };
}

test("off by default, dev/public pages only, with no storage, background collection or timers before opt-in", () => {
  const app = boot(); app.advance(120_000);
  assert.equal(app.requests.length, 0);
  assert.equal(app.document.listeners.size, 0);
  assert.match(app.status.textContent, /^Off/);
  for (const options of [{ environment: "prod" }, { path: "/admin/analytics" }, { path: "/account" }, { noFooter: true }]) {
    const excluded = boot(options); excluded.advance(120_000);
    assert.equal(excluded.panel, undefined); assert.equal(excluded.requests.length, 0);
  }
});

test("explicit opt-in sends only time and fixed page/sport labels, without credentials or query secrets", () => {
  const app = boot(); app.allow(); app.advance(30_000);
  assert.equal(app.requests.length, 1);
  const { url, request, body } = app.requests[0];
  assert.equal(url, "/api/analytics"); assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer"); assert.equal(request.keepalive, true);
  assert.deepEqual(body, { event: "active_time", page: "/leaderboard", sport: "nba", milliseconds: 30_000, consent: "active-time-v1" });
  assert.match(app.status.textContent, /^On/);
  for (const [path, sport] of [["/", "nfl"], ["/nba", "nba"], ["/picks?sport=nfl", "nfl"], ["/privacy.html", "shared"]]) {
    const sample = boot({ path }); sample.allow(); sample.advance(30_000);
    assert.equal(sample.requests[0].body.sport, sport);
  }
});

test("idle time stops at exactly one minute, ignores synthetic interaction, and resumes without counting the idle gap", () => {
  const app = boot(); app.allow(); app.advance(120_000);
  assert.equal(app.total(), 60_000);
  app.document.fire("keydown", { isTrusted: false }); app.advance(30_000);
  assert.equal(app.total(), 60_000);
  app.document.fire("keydown", { key: "PRIVATE TYPED TEXT" }); app.advance(30_000);
  app.window.fire("pagehide");
  assert.equal(app.total(), 90_000);
  assert.doesNotMatch(JSON.stringify(app.requests), /PRIVATE/);
});

test("hidden tabs and blurred windows pause immediately, foreground interaction resumes, and pagehide ends permission", () => {
  const app = boot(); app.allow(); app.advance(12_000);
  app.document.visibilityState = "hidden"; app.document.fire("visibilitychange");
  assert.equal(app.total(), 12_000); app.advance(120_000); assert.equal(app.total(), 12_000);
  app.document.visibilityState = "visible"; app.document.fire("visibilitychange");
  app.document.fire("pointerdown"); app.advance(10_000);
  app.document.focused = false; app.window.fire("blur");
  assert.equal(app.total(), 22_000); app.advance(120_000); assert.equal(app.total(), 22_000);
  app.document.focused = true; app.window.fire("focus"); app.advance(7_000);
  app.window.fire("pagehide"); assert.equal(app.total(), 29_000);
  app.window.fire("pageshow", { persisted: true }); app.advance(60_000);
  assert.equal(app.total(), 29_000); assert.match(app.status.textContent, /^Off/);
});

test("withdrawal discards pending time and removes all sampling listeners", () => {
  const app = boot(); app.allow(); app.advance(10_000); app.button.fire("click");
  app.document.fire("scroll"); app.window.fire("pagehide"); app.advance(90_000);
  assert.equal(app.total(), 0); assert.match(app.status.textContent, /^Off/);
  assert.ok([...app.document.listeners.values(), ...app.window.listeners.values()].every(set => set.size === 0));
});

test("initial and newly enabled GPC/DNT block collection even after permission", () => {
  for (const options of [{ gpc: true }, { dnt: "1" }]) {
    const app = boot(options); app.allow(); app.advance(60_000);
    assert.equal(app.button.disabled, true); assert.equal(app.total(), 0);
  }
  for (const key of ["globalPrivacyControl", "doNotTrack"]) {
    const app = boot(); app.allow(); app.advance(10_000);
    app.navigator[key] = key === "doNotTrack" ? "1" : true; app.advance(60_000);
    assert.equal(app.total(), 0); assert.equal(app.button.disabled, true);
    assert.match(app.status.textContent, /privacy signal/);
  }
});

test("network failures do not retry, persist data, or interrupt the page", async () => {
  const app = boot({ failFetch: true }); app.allow(); app.advance(60_000); app.advance(120_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 2); assert.equal(app.total(), 60_000);
});
