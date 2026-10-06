const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../frontend/admin-analytics.js"), "utf8");

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ""; }
  set innerHTML(_value) { assert.fail("Provider data must never render as HTML"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, value) { this.listeners[key] = value; }
  get text() { return [this.textContent || "", ...this.children.map(child => child.text)].join(" "); }
}
function jwt(groups = ["admin"], exp = Date.now() / 1000 + 3600) {
  return `header.${Buffer.from(JSON.stringify({ "cognito:groups": groups, exp })).toString("base64url")}.signature`;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function boot(options = {}) {
  const elements = new Map(["analytics-main", "analytics-reports", "analytics-status", "analytics-access",
    "analytics-range", "analytics-start", "analytics-end", "analytics-preset", "analytics-apply", "admin-sign-out"]
    .map(id => [id, new Element()]));
  elements.get("analytics-main").hidden = true;
  const session = options.noSession ? null : { accessToken: jwt(options.groups, options.exp),
    refreshToken: options.noRefresh ? "" : "refresh-token", idToken: "id-token", expiresAt: Date.now() + 3600_000 };
  const store = new Map(session ? [["road-to-bowl.auth.session", JSON.stringify(session)]] : []);
  const sessionStore = new Map();
  const storage = data => ({ getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) });
  const requests = [];
  const redirects = [];
  const listeners = {};
  const context = {
    URLSearchParams, AbortSignal, Intl, Date, Object, atob: value => Buffer.from(value, "base64").toString("utf8"),
    AUTH_CONFIG: { environment: options.environment || "dev", clientId: "same-existing-client", region: "us-east-1" },
    localStorage: storage(store), sessionStorage: storage(sessionStore),
    document: { getElementById: id => elements.get(id), createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) },
    location: { replace: url => redirects.push(url) },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    fetch: async (url, request) => {
      requests.push({ url, request });
      if (url.startsWith("https://cognito-idp.")) {
        return { ok: !options.refreshFails, json: async () => ({ AuthenticationResult: {
          AccessToken: jwt(options.refreshedGroups), IdToken: "new-id-token", ExpiresIn: 3600 } }) };
      }
      const provider = url.split("?")[0].split("/").at(-1);
      const status = options.forbidden ? 403 : options.invalidRange && provider === "analytics" ? 400 : options.failedProvider === provider ? 503 : 200;
      return { status, ok: status === 200, json: async () => provider === "analytics" ?
        options.invalidRange ? { message: "Choose up to 93 days within the past year." } :
        { providers: ["custom", "goatcounter", "search-console"], environment: "dev" } :
        { provider, status: options.notConfigured === provider ? "not_configured" : "ok", metrics: [
          { label: provider === "custom" ? "<img onerror=secret>" : "Visits", value: 100, format: "number" },
          { label: "CTR", value: .025, format: "percent" }], tables: [{ title: "Top pages",
          columns: [{ key: "page", label: "Page", format: "text" }], rows: [{ page: "<script>alert('private')</script>" }] }],
          range: { start: "2026-09-01", end: "2026-09-28", timezone: "UTC" },
          message: "Connect this provider using the setup guide.", ...options.reports?.[provider] } };
    },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  await settle();
  return { elements, requests, redirects, store, listeners, context };
}

test("Today preset selects the current UTC day without changing completed-day presets", async () => {
  const app = await boot();
  const preset = app.elements.get("analytics-preset");
  preset.value = "today";
  preset.listeners.change();
  assert.equal(app.elements.get("analytics-start").value, new Date().toISOString().slice(0, 10));
  assert.equal(app.elements.get("analytics-end").value, app.elements.get("analytics-start").value);
  preset.value = "7";
  preset.listeners.change();
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  assert.equal(app.elements.get("analytics-end").value, yesterday.toISOString().slice(0, 10));
});

test("signed-out, non-admin, lookalike groups and production redirect without any analytics API request", async () => {
  for (const options of [{ noSession: true }, { groups: ["member"] }, { groups: ["administrator"] },
    { groups: "admin" }, { environment: "prod" }]) {
    const app = await boot(options);
    assert.deepEqual(app.redirects, ["/"]);
    assert.equal(app.requests.length, 0);
    assert.equal(app.elements.get("analytics-main").hidden, true);
  }
});

test("admins verify access server-side before revealing reports and send existing Cognito bearer token", async () => {
  const app = await boot();
  assert.equal(app.requests.length, 4);
  assert.match(app.requests[0].url, /^\/api\/admin\/analytics\?start=\d{4}-\d{2}-\d{2}&end=/);
  assert.ok(app.requests.every(({ url, request }) => url.startsWith("/api/admin/analytics") &&
    request.headers.Authorization.startsWith("Bearer ") && request.cache === "no-store" &&
    request.credentials === "omit" && request.referrerPolicy === "no-referrer"));
  assert.equal(app.elements.get("analytics-main").hidden, false);
  assert.match(app.elements.get("analytics-status").textContent, /3 of 3/);
  assert.equal(app.elements.get("analytics-reports").children.length, 3);
});

test("expired sessions refresh through the existing client and persist the compatible session format", async () => {
  const app = await boot({ exp: Date.now() / 1000 - 10 });
  const request = app.requests[0];
  assert.equal(request.url, "https://cognito-idp.us-east-1.amazonaws.com");
  assert.deepEqual(JSON.parse(request.request.body), { AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: "same-existing-client", AuthParameters: { REFRESH_TOKEN: "refresh-token" } });
  const saved = JSON.parse(app.store.get("road-to-bowl.auth.session"));
  assert.equal(saved.refreshToken, "refresh-token");
  assert.equal(saved.idToken, "new-id-token");
  assert.ok(saved.expiresAt > Date.now());
  assert.equal(app.redirects.length, 0);
  const removed = await boot({ exp: Date.now() / 1000 - 10, refreshedGroups: ["member"] });
  assert.deepEqual(removed.redirects, ["/"]);
  assert.equal(removed.requests.length, 1);
});

test("a server 403 clears all rendered data and redirects even for a locally forged admin token", async () => {
  const app = await boot({ forbidden: true });
  assert.deepEqual(app.redirects, ["/"]);
  assert.equal(app.elements.get("analytics-main").hidden, true);
  assert.equal(app.elements.get("analytics-reports").children.length, 0);
  assert.equal(app.requests.length, 1);
});

test("browser history restoration rechecks authorization and clears stale private reports", async () => {
  const app = await boot();
  app.store.clear();
  app.listeners.pageshow({ persisted: true });
  assert.equal(app.elements.get("analytics-main").hidden, true);
  assert.equal(app.elements.get("analytics-reports").children.length, 0);
  await settle();
  assert.deepEqual(app.redirects, ["/"]);
  assert.equal(app.requests.length, 4);
});

test("rejected date updates remove stale reports and show an actionable error", async () => {
  const options = {};
  const app = await boot(options);
  assert.equal(app.elements.get("analytics-reports").children.length, 3);
  options.invalidRange = true;
  await app.elements.get("analytics-range").listeners.submit({ preventDefault() {} });
  assert.equal(app.elements.get("analytics-reports").children.length, 0);
  assert.match(app.elements.get("analytics-status").textContent, /Choose up to 93 days/);
  assert.equal(app.elements.get("analytics-apply").disabled, false);
  assert.equal(app.redirects.length, 0);
});

test("one failing provider leaves other reports readable and setup states visible", async () => {
  const app = await boot({ failedProvider: "goatcounter", notConfigured: "search-console" });
  assert.equal(app.redirects.length, 0);
  assert.match(app.elements.get("analytics-status").textContent, /1 of 3/);
  const reports = app.elements.get("analytics-reports").children;
  assert.match(reports.find(section => section.dataset.provider === "goatcounter").text, /Unavailable/);
  assert.match(reports.find(section => section.dataset.provider === "search-console").text, /Set up this provider/);
  assert.match(reports.find(section => section.dataset.provider === "custom").text, /100/);
});

test("provider strings render only as text and percentages are formatted accurately", async () => {
  const app = await boot();
  const section = app.elements.get("analytics-reports").children.find(section => section.dataset.provider === "custom");
  assert.match(section.text, /<img onerror=secret>/);
  assert.match(section.text, /<script>alert/);
  assert.match(section.text, /2\.5%/);
});

test("range selection updates reports without calling any public analytics endpoint", async () => {
  const app = await boot();
  const preset = app.elements.get("analytics-preset");
  preset.value = "7";
  preset.listeners.change();
  const begin = app.elements.get("analytics-start").value;
  const finish = app.elements.get("analytics-end").value;
  assert.equal((new Date(finish) - new Date(begin)) / 86400000, 6);
  await app.elements.get("analytics-range").listeners.submit({ preventDefault() {} });
  assert.equal(app.requests.length, 8);
  assert.ok(app.requests.at(-1).url.includes(`start=${begin}&end=${finish}`));
  assert.ok(app.requests.every(request => !request.url.includes("/api/analytics?")));
});

test("sign-out and session removal in another tab clear private data", async () => {
  for (const anotherTab of [false, true]) {
    const app = await boot();
    if (anotherTab) {
      app.store.clear();
      await app.listeners.storage({ key: "road-to-bowl.auth.session" });
    } else app.elements.get("admin-sign-out").listeners.click();
    assert.deepEqual(app.redirects, ["/"]);
    assert.equal(app.elements.get("analytics-reports").children.length, 0);
  }
});

function nodes(node) { return [node, ...node.children.flatMap(nodes)]; }

test("ranked charts use returned counts, retain table data, and keep provider strings inert", async () => {
  const rows = [
    { page: "<img onerror=secret>", visits: 10 }, { page: "/picks", visits: 5 },
    { page: "/zero", visits: 0 }, { page: "/missing", visits: null },
    { page: "/negative", visits: -10 }, { page: "/invalid", visits: "url(secret)" },
  ];
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Top pages",
    columns: [{ key: "page", label: "Page", format: "text" }, { key: "visits", label: "Page visits", format: "number" }], rows }] } } });
  const section = app.elements.get("analytics-reports").children.find(section => section.dataset.provider === "goatcounter");
  const chart = nodes(section).find(node => node.className === "analytics-chart");
  assert.match(chart.text, /<img onerror=secret>.*10.*\/picks.*5.*\/zero.*0/);
  assert.deepEqual(nodes(chart).filter(node => node.className === "analytics-bar-fill").map(node => node.style.width), ["100%", "50%", "0%"]);
  assert.ok(nodes(chart).filter(node => node.className === "analytics-bar-track").every(node => node["aria-hidden"] === "true"));
  assert.equal(nodes(section).find(node => node.tag === "tbody").children.length, rows.length);
  assert.match(section.text, /View data · Top pages/);
});

test("empty provider tables show no invented chart or sample traffic", async () => {
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Top pages",
    columns: [{ key: "page", label: "Page", format: "text" }, { key: "visits", label: "Page visits", format: "number" }], rows: [] }] } } });
  const section = app.elements.get("analytics-reports").children.find(section => section.dataset.provider === "goatcounter");
  assert.equal(nodes(section).filter(node => node.className === "analytics-chart").length, 0);
  assert.match(section.text, /No data reported for this range/);
});

test("exactly three sections appear in task order with explicit source coverage", async () => {
  const app = await boot();
  const reports = app.elements.get("analytics-reports").children;
  assert.deepEqual(reports.map(node => node.dataset.provider), ["goatcounter", "custom", "search-console"]);
  assert.match(reports[0].text, /Traffic.*Dev traffic.*GoatCounter/);
  assert.match(reports[1].text, /PredictPlayoffs activity.*First-party AWS/);
  assert.match(reports[2].text, /Google Search.*Production domain/);
});
test("daily charts keep all 93 days, gaps, exact data and correct running totals", async () => {
  const rows = Array.from({ length: 93 }, (_, i) => ({ day: `day-${i}`, actions: i === 2 ? null : 1 }));
  const app = await boot({ reports: { custom: { tables: [{ title: "Daily activity", chart: "trend", series: ["actions"],
    columns: [{ key: "day", label: "Day", format: "text" }, { key: "actions", label: "Actions", format: "number" }], rows }] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "custom");
  const figures = nodes(section).filter(node => node.tag === "figure");
  assert.equal(figures.length, 2);
  assert.equal(nodes(figures[0]).filter(node => node.tag === "circle").length, 92);
  assert.equal(nodes(figures[0]).filter(node => node.tag === "polyline").length, 2);
  assert.match(figures[1].text, /day-92: 92/);
  assert.equal(nodes(section).find(node => node.tag === "tbody").children.length, 93);
});
test("daily metric controls change charts and never sum distinct sessions or rates", async () => {
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Daily traffic", chart: "trend", series: ["pageviews"],
    columns: [{ key: "day", label: "Day", format: "text" }, { key: "sessions", label: "Distinct sessions", format: "number" },
      { key: "pageviews", label: "Pageviews", format: "number" }],
    rows: [{ day: "2026-10-01", sessions: 2, pageviews: 3 }, { day: "2026-10-02", sessions: 2, pageviews: 4 }] }] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "goatcounter");
  const select = nodes(section).find(node => node.tag === "select");
  assert.equal(nodes(section).filter(node => node.tag === "figure").length, 2);
  select.value = "sessions"; select.listeners.change();
  assert.equal(nodes(section).filter(node => node.tag === "figure").length, 1);
  assert.match(section.text, /Daily distinct sessions/);
  assert.doesNotMatch(section.text, /Running distinct sessions/);
});
