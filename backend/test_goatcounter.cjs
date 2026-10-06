const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const loader = fs.readFileSync(path.join(root, "frontend/goatcounter.js"), "utf8");
// ISC-licensed snapshot of https://gc.zgo.at/count.js retrieved October 5, 2026.
// Run the actual provider code: a path-only mock would miss its separate q field.
const provider = fs.readFileSync(path.join(__dirname, "fixtures/goatcounter-count.js"), "utf8");

function boot(options = {}) {
  const scripts = [];
  const requests = [];
  const beacons = [];
  const images = [];
  const storageReads = [];
  const listeners = new Map();
  const url = new URL(options.url || "https://dev.example.com/picks?invite=secret#token=private");
  const context = {
    URL, Set, console: { warn() {}, error() {} },
    location: url,
    AUTH_CONFIG: Object.hasOwn(options, "config") ? options.config : { environment: "dev" },
    navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc,
      sendBeacon: value => { beacons.push(value); return true; } },
    screen: { width: 1440 },
    localStorage: {
      getItem(key) {
        storageReads.push(key);
        return null;
      },
      setItem() { assert.fail("GoatCounter must not create browser identifiers"); },
    },
    fetch(value, request) {
      requests.push({ url: value, request });
      return options.networkFailure ? Promise.reject(new Error("blocked")) : Promise.resolve();
    },
    document: {
      title: "Private person's bracket: secret invite",
      referrer: Object.hasOwn(options, "referrer") ? options.referrer :
        "https://dev.example.com/leaderboard?invite=secret&email=private@example.com#token=private",
      visibilityState: options.visibility || "visible",
      head: { appendChild(script) { scripts.push(script); } },
      body: { appendChild(image) { images.push(image); } },
      createElement() { return { dataset: {}, style: {}, setAttribute() {}, addEventListener() {} }; },
      querySelector(selector) {
        return selector === "script[data-goatcounter]" ? scripts[0] : null;
      },
      querySelectorAll() { assert.fail("Automatic click events must stay disabled"); },
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); },
    },
  };
  context.window = context;
  context.parent = context;
  vm.createContext(context);
  vm.runInContext(loader, context);
  const load = (source = provider) => {
    vm.runInContext(source, context);
    assert.equal(requests.length, 0, "Provider must not count before sanitization");
    assert.equal(beacons.length, 0, "Provider must not send an automatic beacon");
    scripts[0].onload();
  };
  return { context, scripts, requests, beacons, images, storageReads, listeners, load };
}

function assertSafeRequest(app, expectedPath) {
  assert.equal(app.requests.length, 1);
  const { url, request } = app.requests[0];
  const counted = new URL(url);
  assert.equal(counted.origin + counted.pathname, "https://predictplayoffs.goatcounter.com/count");
  assert.equal(counted.searchParams.get("p"), expectedPath);
  assert.equal(counted.searchParams.get("q"), null);
  assert.equal(counted.hash, "");
  assert.ok([...counted.searchParams.keys()].every(key => ["p", "r", "t", "s", "b", "rnd"].includes(key)));
  assert.doesNotMatch(decodeURIComponent(url), /secret|private|invite|token|email/);
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.credentials, "omit");
  assert.equal(request.method, "POST");
  assert.equal(request.mode, "no-cors");
  assert.equal(request.keepalive, true);
  assert.equal(request.body, undefined);
  assert.equal(app.beacons.length, 0);
  assert.equal(app.images.length, 0);
}

test("GoatCounter starts without browser storage", () => {
  for (const environment of ["dev"]) {
    const app = boot({ environment });
    assert.equal(app.scripts.length, 1);
    assert.equal(app.scripts[0].dataset.goatcounter, "https://predictplayoffs.goatcounter.com/count");
    assert.equal(app.scripts[0].src, "//gc.zgo.at/count.js");
    assert.equal(app.scripts[0].async, true);
    assert.equal(app.scripts[0].referrerPolicy, "no-referrer");
    assert.equal(app.context.goatcounter.no_onload, true);
    assert.equal(app.context.goatcounter.no_events, true);
    assert.deepEqual(app.storageReads, []);
    app.load();
    assertSafeRequest(app, "/picks");
    assert.equal(new URL(app.requests[0].url).searchParams.get("r"), "https://dev.example.com");
    assert.deepEqual(app.storageReads, []);
  }
});

test("all public routes discard invite codes, queries, fragments, and private document titles", () => {
  for (const route of ["/", "/index.html", "/nba", "/nba.html", "/picks", "/picks.html",
    "/leaderboard", "/leaderboard.html", "/scoring", "/scoring.html", "/privacy", "/privacy.html"]) {
    const app = boot({ url: `https://dev.example.com${route}?invite=secret&sport=nba#private` });
    app.load();
    assertSafeRequest(app, route);
  }
});

test("referrers are restricted to HTTP(S) origins, without credentials, paths, queries, or fragments", () => {
  for (const [referrer, expected] of [
    ["https://private:secret@example.org/private?invite=secret#private", "https://example.org"],
    ["http://example.org:8080/private?token=secret#private", "http://example.org:8080"],
    ["", null], ["not a URL?invite=secret", null], ["javascript:private", null],
    ["data:text/plain,private", null],
  ]) {
    const app = boot({ referrer });
    app.load();
    assertSafeRequest(app, "/picks");
    assert.equal(new URL(app.requests[0].url).searchParams.get("r"), expected);
  }
});

test("production, absent/unknown configuration, private paths, GPC, and DNT never load GoatCounter", () => {
  for (const options of [
    { config: { environment: "prod" } }, { config: { environment: "preview" } },
    { config: {} }, { config: null }, { config: undefined },
    { url: "https://dev.example.com/private/person" },
    { url: "https://dev.example.com/picks/secret" },
    { url: "https://dev.example.com/picks%3Finvite=secret" },
    { gpc: true }, { dnt: "1" },
  ]) {
    const app = boot(options);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.requests.length, 0);
    assert.equal(app.context.goatcounter, undefined);
  }
});

test("privacy signals arriving while the asynchronous script loads prevent any pageview", () => {
  for (const signal of [{ globalPrivacyControl: true }, { doNotTrack: "1" }]) {
    const app = boot();
    Object.assign(app.context.navigator, signal);
    app.load();
    assert.equal(app.requests.length, 0);
  }
});

test("manual provider calls and new provider fields cannot bypass URL sanitization", () => {
  const app = boot();
  app.load(provider.replace("q: location.search,", "q: location.search, future: location.href,"));
  assertSafeRequest(app, "/picks");
  const overrides = { path: "/private?invite=secret#private", title: "private@example.org",
    referrer: "https://example.org/private?token=secret#private", event: true };
  assert.doesNotMatch(decodeURIComponent(app.context.goatcounter.url(overrides)), /secret|private|invite|token/);
  app.context.goatcounter.count(overrides);
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].url.split("&rnd=")[0], app.requests[0].url.split("&rnd=")[0]);
  app.context.navigator.globalPrivacyControl = true;
  app.context.goatcounter.count();
  assert.equal(app.requests.length, 2);
});

test("hidden pages wait for visibility and count once with sanitized URLs", () => {
  const app = boot({ visibility: "hidden" });
  app.load();
  assert.equal(app.requests.length, 0);
  const onVisibility = app.listeners.get("visibilitychange");
  onVisibility();
  assert.equal(app.requests.length, 0);
  app.context.document.visibilityState = "visible";
  onVisibility();
  assertSafeRequest(app, "/picks");
  assert.equal(app.listeners.has("visibilitychange"), false);
});

test("provider failures and blocked network requests do not interrupt the app", async () => {
  const missingProvider = boot();
  assert.doesNotThrow(() => missingProvider.scripts[0].onload());
  assert.equal(missingProvider.requests.length, 0);
  const app = boot({ networkFailure: true });
  assert.doesNotThrow(() => app.load());
  await new Promise(resolve => setImmediate(resolve));
  assertSafeRequest(app, "/picks");
});

test("every public HTML page loads the guarded integration after its environment configuration", () => {
  for (const name of fs.readdirSync(path.join(root, "frontend")).filter(name => name.endsWith(".html") && name !== "admin-analytics.html")) {
    const head = fs.readFileSync(path.join(root, "frontend", name), "utf8").split("</head>")[0];
    assert.match(head, /<script src="\/goatcounter\.js\?v=\d+" defer><\/script>/, name);
    assert.ok(head.indexOf("/auth-config.js") < head.indexOf("/goatcounter.js"), name);
    assert.doesNotMatch(head, /gc\.zgo\.at\/count\.js|data-goatcounter=/, "No unguarded tracking snippet");
  }
});

test("provider storage-toggle URLs never load the remote script", () => {
  const app = boot({ url: "https://dev.example.com/#toggle-goatcounter" });
  assert.equal(app.scripts.length, 0);
  assert.deepEqual(app.storageReads, []);
});
