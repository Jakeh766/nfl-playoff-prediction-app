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
  const requests = [], document = new Target(), window = new Target();
  document.visibilityState = options.hidden ? "hidden" : "visible"; document.focused = !options.unfocused;
  document.hasFocus = () => document.focused;
  document.getElementById = () => assert.fail("No consent UI");
  document.createElement = () => assert.fail("No consent UI");
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
  return { requests, document, window, navigator,
    total: () => requests.reduce((sum, request) => sum + request.body.milliseconds, 0),
    advance(ms) {
      const end = time + ms;
      while (timer && nextTick <= end) { time = nextTick; nextTick += 5000; timer(); }
      time = end;
    },
  };
}

test("automatic collection on public dev pages only, with no consent UI or storage", () => {
  const app = boot(); app.advance(30_000);
  assert.equal(app.requests.length, 1);
  for (const options of [{ environment: "prod" }, { environment: "unknown" }, { path: "/admin/analytics" }, { path: "/account" }]) {
    const excluded = boot(options); excluded.advance(120_000);
    assert.equal(excluded.document.listeners.size, 0); assert.equal(excluded.requests.length, 0);
  }
});

test("automatic measurement sends only time and fixed page/sport labels, without credentials or query secrets", () => {
  const app = boot(); app.advance(30_000);
  assert.equal(app.requests.length, 1);
  const { url, request, body } = app.requests[0];
  assert.equal(url, "/api/analytics"); assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer"); assert.equal(request.keepalive, true);
  assert.deepEqual(body, { event: "active_time", page: "/leaderboard", sport: "nba", milliseconds: 30_000 });
  for (const [path, sport] of [["/", "nfl"], ["/nba", "nba"], ["/picks?sport=nfl", "nfl"], ["/privacy.html", "shared"]]) {
    const sample = boot({ path }); sample.advance(30_000);
    assert.equal(sample.requests[0].body.sport, sport);
  }
});

test("idle time stops at exactly one minute, ignores synthetic interaction, and resumes without counting the idle gap", () => {
  const app = boot(); app.advance(120_000);
  assert.equal(app.total(), 60_000);
  app.document.fire("keydown", { isTrusted: false }); app.advance(30_000);
  assert.equal(app.total(), 60_000);
  app.document.fire("keydown", { key: "PRIVATE TYPED TEXT" }); app.advance(30_000);
  app.window.fire("pagehide");
  assert.equal(app.total(), 90_000);
  assert.doesNotMatch(JSON.stringify(app.requests), /PRIVATE/);
});

test("hidden tabs and blurred windows pause immediately, foreground interaction resumes, and browser-history restoration resumes automatically", () => {
  const app = boot(); app.advance(12_000);
  app.document.visibilityState = "hidden"; app.document.fire("visibilitychange");
  assert.equal(app.total(), 12_000); app.advance(120_000); assert.equal(app.total(), 12_000);
  app.document.visibilityState = "visible"; app.document.fire("visibilitychange");
  app.document.fire("pointerdown"); app.advance(10_000);
  app.document.focused = false; app.window.fire("blur");
  assert.equal(app.total(), 22_000); app.advance(120_000); assert.equal(app.total(), 22_000);
  app.document.focused = true; app.window.fire("focus"); app.advance(7_000);
  app.window.fire("pagehide"); assert.equal(app.total(), 29_000);
  app.advance(120_000); assert.equal(app.total(), 29_000);
  app.window.fire("pageshow", { persisted: true });
  app.window.fire("pageshow", { persisted: true }); app.advance(30_000);
  assert.equal(app.total(), 59_000);
});

test("initially hidden or unfocused pages collect nothing until foreground interaction", () => {
  for (const options of [{ hidden: true }, { unfocused: true }]) {
    const app = boot(options); app.advance(120_000); assert.equal(app.total(), 0);
    app.document.visibilityState = "visible"; app.document.focused = true;
    app.window.fire("focus"); app.advance(30_000); app.window.fire("pagehide");
    assert.equal(app.total(), 30_000);
  }
});

test("initial and newly enabled GPC/DNT block collection and discard unsent time", () => {
  for (const options of [{ gpc: true }, { dnt: "1" }]) {
    const app = boot(options); app.advance(60_000);
    assert.equal(app.total(), 0); assert.equal(app.document.listeners.size, 0);
  }
  for (const key of ["globalPrivacyControl", "doNotTrack"]) {
    const app = boot(); app.advance(10_000);
    app.navigator[key] = key === "doNotTrack" ? "1" : true; app.advance(60_000);
    assert.equal(app.total(), 0);
    assert.ok([...app.document.listeners.values()].every(set => set.size === 0));
    app.window.fire("pageshow", { persisted: true }); app.advance(60_000);
    assert.equal(app.total(), 0);
  }
});

test("network failures do not retry, persist data, or interrupt the page", async () => {
  const app = boot({ failFetch: true }); app.advance(60_000); app.advance(120_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 2); assert.equal(app.total(), 60_000);
});
