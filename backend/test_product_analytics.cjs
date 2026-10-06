const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "frontend/monitoring.js"), "utf8");
function boot(options = {}) {
  const requests = [];
  const legacy = new Map([["road-to-bowl.auth.session", "AUTH"], ["draft", "DRAFT"],
    ["pp_analytics_consent_v1", "granted"], ["rtb_visitor_id", "old"], ["rtb_session_id", "old"]]);
  const storage = { getItem() { assert.fail("Analytics must not read browser storage"); },
    setItem() { assert.fail("Analytics must not write browser identifiers"); }, removeItem(key) { legacy.delete(key); } };
  const expiredCookies = [];
  const document = { get cookie() { return "_ga=old; _ga_OLD=old; _clck=old; essential=AUTH"; },
    set cookie(value) { expiredCookies.push(value); } };
  const navigator = { doNotTrack: options.dnt, globalPrivacyControl: options.gpc };
  const context = { AUTH_CONFIG: { environment: options.environment || "dev" }, navigator,
    location: { pathname: options.page || "/picks", hostname: "dev.example.com" }, document, localStorage: storage, sessionStorage: storage,
    fetch(url, request) { requests.push({ url, request }); return Promise.resolve(); } };
  context.window = context;
  vm.runInNewContext(script, context);
  return { context, navigator, requests, legacy, expiredCookies, payloads: () => requests.map(item => JSON.parse(item.request.body)) };
}
test("product events send only coarse fields, never identifiers or auth", () => {
  const app = boot();
  assert.equal(app.requests.length, 0);
  for (const event of ["sign_in", "account_created", "account_deleted", "group_created", "group_joined", "group_invite_joined"]) {
    app.context.siteAnalytics.track(event, { email: "private", token: "private" });
    assert.deepEqual(app.payloads().at(-1), { event, page: "/picks" });
  }
  for (const event of ["bracket_created", "bracket_completed", "prediction_saved"]) {
    for (const bracketType of ["nfl", "nba"]) {
      app.context.siteAnalytics.track(event, { bracketType, picks: "private" });
      assert.deepEqual(app.payloads().at(-1), { event, page: "/picks", bracketType });
    }
  }
  for (const { url, request } of app.requests) {
    assert.equal(url, "/api/analytics");
    assert.equal(request.credentials, "omit");
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.deepEqual(Object.keys(request.headers), ["Content-Type"]);
  }
});
test("privacy signals, unknown environments and private pages suppress tracking", () => {
  for (const options of [{ dnt: "1" }, { gpc: true }, { environment: "preview" }, { page: "/admin/analytics" }]) {
    const app = boot(options);
    app.context.siteAnalytics.track("sign_in");
    assert.equal(app.requests.length, 0);
  }
  const app = boot();
  app.navigator.globalPrivacyControl = true;
  app.context.siteAnalytics.track("account_deleted");
  assert.equal(app.requests.length, 0);
});
test("unknown events and missing/invalid bracket types fail closed", () => {
  const app = boot();
  for (const event of ["page_view", "leaderboard_viewed", "unknown"]) app.context.siteAnalytics.track(event);
  for (const bracketType of [undefined, "private", 1]) app.context.siteAnalytics.track("bracket_created", { bracketType });
  assert.equal(app.requests.length, 0);
});
test("public pages keep auth before monitoring and remove consent surfaces", () => {
  for (const name of ["index.html", "nba.html", "picks.html", "scoring.html", "leaderboard.html", "privacy.html"]) {
    const html = fs.readFileSync(path.join(root, "frontend", name), "utf8");
    assert.ok(html.indexOf("/auth-config.js") < html.indexOf("/monitoring.js"), name);
    assert.doesNotMatch(html, /src="\/analytics\.js|cookie-preferences|data-clarity-mask/);
    assert.match(html, /href="\/privacy"/);
  }
  const app = fs.readFileSync(path.join(root, "frontend/app.js"), "utf8");
  assert.match(app, /await requestCognito\("DeleteUser"[^;]+;\s*window.siteAnalytics\?\.track\("account_deleted"\)/);
  const picks = fs.readFileSync(path.join(root, "frontend/picks.js"), "utf8");
  for (const event of ["bracket_created", "bracket_completed", "prediction_saved"]) assert.ok(picks.includes(`track("${event}", { bracketType: SPORT })`));
});

test("migration removes only legacy analytics storage/cookies even with privacy signals", () => {
  for (const options of [{}, { gpc: true }, { dnt: "1" }]) {
    const app = boot(options);
    assert.deepEqual([...app.legacy], [["road-to-bowl.auth.session", "AUTH"], ["draft", "DRAFT"]]);
    assert.ok(app.expiredCookies.length > 0);
    assert.ok(app.expiredCookies.every(cookie => /^_(ga|clck)/.test(cookie) && cookie.includes("Max-Age=0")));
    assert.equal(app.requests.length, 0);
  }
});
