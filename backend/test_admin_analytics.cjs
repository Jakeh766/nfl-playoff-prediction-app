const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../frontend/admin-analytics.js"), "utf8");

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ""; }
  set innerHTML(_value) { assert.fail("Provider data must never render as HTML"); }
  append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); } }
  prepend(...nodes) { this.append(...nodes); this.children = [...nodes, ...this.children.filter(node => !nodes.includes(node))]; }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this[key] = value; if (key === "class") this.className = value; }
  addEventListener(key, value) { this.listeners[key] = value; }
  querySelector(selector) { return nodes(this).find(node => selector.startsWith(".") && node.className?.split(" ").includes(selector.slice(1))); }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: this.className === "analytics-tooltip" ? 180 : 540, height: 244 }; }
  focus() { this.focused = true; this.listeners.focus?.(); }
  get text() { return [this.textContent || "", ...this.children.map(child => child.text)].join(" "); }
}
function jwt(groups = ["admin"], exp = Date.now() / 1000 + 3600) {
  return `header.${Buffer.from(JSON.stringify({ "cognito:groups": groups, exp })).toString("base64url")}.signature`;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function boot(options = {}) {
  const elements = new Map(["analytics-main", "analytics-reports", "analytics-status", "analytics-access",
    "analytics-range", "analytics-start", "analytics-end", "analytics-preset", "analytics-apply", "admin-sign-out",
    "analytics-tab-goatcounter", "analytics-tab-custom", "analytics-tab-search-console"]
    .map(id => [id, new Element()]));
  elements.get("analytics-main").hidden = true;
  for (const provider of ["goatcounter", "custom", "search-console"]) {
    const tab = elements.get(`analytics-tab-${provider}`);
    tab.dataset.provider = provider;
    const state = new Element("span"); state.className = "analytics-tab-state"; tab.append(state);
  }
  const session = options.noSession ? null : { accessToken: jwt(options.groups, options.exp),
    refreshToken: options.noRefresh ? "" : "refresh-token", idToken: "id-token", expiresAt: Date.now() + 3600_000 };
  const store = new Map(session ? [["road-to-bowl.auth.session", JSON.stringify(session)]] : []);
  const sessionStore = new Map();
  const storage = data => ({ getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) });
  const requests = [];
  const redirects = [];
  const listeners = {};
  const observers = [];
  const context = {
    URLSearchParams, AbortSignal, Intl, Date, Object, atob: value => Buffer.from(value, "base64").toString("utf8"),
    AUTH_CONFIG: { environment: options.environment || "dev", clientId: "same-existing-client", region: "us-east-1" },
    localStorage: storage(store), sessionStorage: storage(sessionStore),
    document: { getElementById: id => elements.get(id), createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) },
    location: { replace: url => redirects.push(url) },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(node) { this.node = node; }
      disconnect() { this.disconnected = true; }
    },
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
  return { elements, requests, redirects, store, listeners, context, observers };
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

test("pie charts use all valid returned counts, expose percentages and keep provider strings inert", async () => {
  const rows = [
    { page: "<img onerror=secret>", visits: 10 }, { page: "/picks", visits: 5 },
    { page: "/zero", visits: 0 }, { page: "/missing", visits: null },
    { page: "/negative", visits: -10 }, { page: "/invalid", visits: "url(secret)" },
  ];
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Top pages",
    columns: [{ key: "page", label: "Page", format: "text" }, { key: "visits", label: "Page visits", format: "number" }], rows }] } } });
  const section = app.elements.get("analytics-reports").children.find(section => section.dataset.provider === "goatcounter");
  const chart = nodes(section).find(node => node.className === "analytics-chart analytics-pie");
  const keys = nodes(chart).filter(node => node.className === "analytics-pie-key");
  assert.equal(keys.length, 3);
  assert.match(keys[0].text, /<img onerror=secret>.*10.*66.7%/);
  assert.match(keys[1].text, /\/picks.*5.*33.3%/);
  assert.match(keys[2].text, /\/zero.*0.*0%/);
  const slices = nodes(chart).filter(node => node.className === "analytics-pie-slice");
  assert.equal(slices.length, 2);
  assert.ok(slices.every(node => !node.d.includes("NaN")));
  assert.equal(nodes(section).filter(node => node.tag === "tbody").length, 0);
  assert.doesNotMatch(section.text, /View data/);
  const readout = nodes(chart).find(node => node.className === "analytics-pie-readout");
  slices[1].listeners.pointerenter();
  assert.equal(readout.textContent, "/picks (sport not recorded) · 5 page visits · 33.3%");
  assert.equal(slices[0].style.opacity, "0.45");
  slices[1].listeners.pointerleave();
  assert.equal(slices[0].style.opacity, "1");
  keys[0].focus();
  assert.match(readout.textContent, /<img onerror=secret> · 10 page visits · 66.7%/);
  keys[0].listeners.blur();
  keys[1].listeners.click();
  assert.match(readout.textContent, /\/picks \(sport not recorded\) · 5 page visits · 33.3%/);
});

test("empty provider tables show no invented chart or sample traffic", async () => {
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Top pages",
    columns: [{ key: "page", label: "Page", format: "text" }, { key: "visits", label: "Page visits", format: "number" }], rows: [] }] } } });
  const section = app.elements.get("analytics-reports").children.find(section => section.dataset.provider === "goatcounter");
  assert.equal(nodes(section).filter(node => node.className === "analytics-pie-slice").length, 0);
  assert.match(section.text, /No data reported for this range/);
});

test("exactly three sections appear in task order with explicit source coverage", async () => {
  const app = await boot();
  const reports = app.elements.get("analytics-reports").children;
  assert.deepEqual(reports.map(node => node.dataset.provider), ["goatcounter", "custom", "search-console"]);
  assert.match(reports[0].text, /Traffic.*Dev traffic.*GoatCounter/);
  assert.match(reports[1].text, /PredictPlayoffs activity.*First-party AWS/);
  assert.match(reports[2].text, /Google Search.*Production domain/);
  assert.equal(nodes(reports[0]).find(node => node.className === "analytics-provider-coverage").textContent, "GoatCounter");
});
test("daily charts keep all 93 days, gaps and exact daily values without cumulative controls", async () => {
  const rows = Array.from({ length: 93 }, (_, i) => ({ day: `day-${i}`, actions: i === 2 ? null : 1 }));
  const app = await boot({ reports: { custom: { tables: [{ title: "Daily activity", chart: "trend", series: ["actions"],
    columns: [{ key: "day", label: "Day", format: "text" }, { key: "actions", label: "Actions", format: "number" }], rows }] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "custom");
  const figures = nodes(section).filter(node => node.tag === "figure");
  assert.equal(figures.length, 1);
  assert.equal(nodes(figures[0]).filter(node => node.className === "analytics-point").length, 92);
  assert.equal(nodes(figures[0]).filter(node => node.tag === "polyline").length, 2);
  assert.equal(nodes(section).filter(node => node.tag === "select").length, 1);
  const plot = nodes(section).find(node => node.className === "analytics-plot");
  plot.listeners.keydown({ key: "End", preventDefault() {} });
  assert.match(nodes(section).find(node => node.className === "analytics-tooltip").text, /day-92.*1.*Daily actions/);
  assert.equal(nodes(section).filter(node => node.tag === "tbody").length, 0);
});
test("daily metric controls change charts and never sum distinct sessions or rates", async () => {
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Daily traffic", chart: "trend", series: ["pageviews"],
    columns: [{ key: "day", label: "Day", format: "text" }, { key: "sessions", label: "Distinct sessions", format: "number" },
      { key: "pageviews", label: "Pageviews", format: "number" }],
    rows: [{ day: "2026-10-01", sessions: 2, pageviews: 3 }, { day: "2026-10-02", sessions: 2, pageviews: 4 }] }] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "goatcounter");
  const select = nodes(section).find(node => node.tag === "select");
  assert.equal(nodes(section).filter(node => node.tag === "figure").length, 1);
  assert.equal(nodes(section).filter(node => node.tag === "select").length, 1);
  assert.match(section.text, /Daily pageviews/);
  select.value = "sessions"; select.listeners.change();
  assert.equal(nodes(section).filter(node => node.tag === "figure").length, 1);
  assert.match(section.text, /Daily distinct sessions/);
  assert.doesNotMatch(section.text, /Cumulative/);
});

test("pie charts handle a single page, zero traffic and more than five pages", async () => {
  for (const [rows, expected] of [[[{ page: "/", views: 5 }], 1], [[{ page: "/", views: 0 }], 0],
    [Array.from({ length: 12 }, (_, i) => ({ page: `/page-${i}`, views: i + 1 })), 12]]) {
    const app = await boot({ reports: { goatcounter: { tables: [{ title: "Pageviews by page",
      columns: [{ key: "page", label: "Page", format: "text" }, { key: "views", label: "Pageviews", format: "number" }], rows }] } } });
    const section = app.elements.get("analytics-reports").children[0];
    const slices = nodes(section).filter(node => node.className === "analytics-pie-slice");
    assert.equal(slices.length, expected);
    if (expected === 1) { assert.equal(slices[0].tag, "circle"); assert.match(section.text, /100%/); }
    if (!expected) assert.match(section.text, /No visits recorded/);
    if (expected === 12) assert.equal(nodes(section).filter(node => node.className === "analytics-pie-key").length, 12);
  }
});

test("page labels distinguish new sport counts from historical counts without assigning old views to a sport", async () => {
  const app = await boot({ reports: { goatcounter: { tables: [{ title: "Pageviews by page",
    columns: [{ key: "page", label: "Page", format: "text" }, { key: "views", label: "Pageviews", format: "number" }],
    rows: [{ page: "/leaderboard", views: 3 }, { page: "/nfl/leaderboard", views: 2 }, { page: "/nba/leaderboard", views: 1 }] }] } } });
  const keys = nodes(app.elements.get("analytics-reports").children[0]).filter(node => node.className === "analytics-pie-key");
  assert.deepEqual(keys.map(node => node["aria-label"]), ["/leaderboard (sport not recorded) · 3 pageviews · 50%",
    "NFL leaderboard · 2 pageviews · 33.3%", "NBA leaderboard · 1 pageviews · 16.7%"]);
});

test("durations show readable hours, minutes and seconds, keeping missing values distinct from zero", async () => {
  const cases = [[4604, "1 hr 16 min 44 sec"], [84.3, "1 min 24 sec"], [3600, "1 hr"], [60, "1 min"],
    [59.9, "1 min"], [12, "12 sec"], [0, "0 sec"], [null, "Unavailable"], [-1, "Unavailable"], ["bad", "Unavailable"]];
  const app = await boot({ reports: { goatcounter: { metrics: cases.map(([value]) => ({ label: "Duration", value, format: "seconds" })), tables: [] } } });
  const values = nodes(app.elements.get("analytics-reports").children[0]).filter(node => node.tag === "dd");
  assert.deepEqual(values.map(node => node.textContent), cases.map(([, expected]) => expected));
});

test("all providers omit View data disclosures and keep useful breakdown tables directly visible", async () => {
  const app = await boot({ reports: { custom: { note: "Collection coverage", tables: [{ title: "Brackets by type",
    columns: [{ key: "type", label: "Bracket type", format: "text" }], rows: [{ type: "NFL" }] }] } } });
  const reports = app.elements.get("analytics-reports");
  assert.doesNotMatch(reports.text, /View data/);
  assert.deepEqual(nodes(reports).filter(node => node.tag === "summary").map(node => node.textContent), ["Definitions and coverage"]);
  assert.ok(nodes(reports.children[1]).some(node => node.tag === "caption" && node.textContent === "Brackets by type"));
  assert.equal(nodes(reports.children[1]).filter(node => node.tag === "details").length, 1);
});

function dailyReport(rows, format = "number") {
  return { title: "Daily activity", chart: "trend", series: ["actions"],
    columns: [{ key: "day", label: "Day", format: "text" }, { key: "actions", label: "Actions", format }], rows };
}

test("active time has a readable total, daily hover values, compact axes and a visible sport table", async () => {
  const app = await boot({ reports: { custom: {
    engagement: { label: "Active engagement time", value: 4604, format: "seconds", note: "Total active time across public page visits" },
    tables: [{ title: "Daily activity", chart: "trend", series: ["active_time"],
      columns: [{ key: "day", label: "Day", format: "text" }, { key: "active_time", label: "Active engagement time", format: "seconds" }],
      rows: [{ day: "2026-10-01", active_time: null }, { day: "2026-10-02", active_time: 4604 }] },
      { title: "Active time by page", columns: [{ key: "page", label: "Page", format: "text" },
        { key: "sport", label: "Sport", format: "text" }, { key: "seconds", label: "Active time", format: "seconds" }],
        rows: [{ page: "Leaderboard", sport: "NBA", seconds: 4604 }] }] } } });
  const section = app.elements.get("analytics-reports").children[1];
  assert.match(section.text, /Active engagement time.*1 hr 16 min 44 sec.*Total active time across public/);
  assert.match(section.text, /Active time by page.*Leaderboard.*NBA.*1 hr 16 min 44 sec/);
  const axes = nodes(section).filter(node => node.className === "analytics-axis");
  assert.ok(axes.some(node => node.textContent === "1.3 hr"));
  const plot = nodes(section).find(node => node.className === "analytics-plot");
  plot.listeners.focus(); plot.listeners.keydown({ key: "End", preventDefault() {} });
  const tooltip = nodes(plot).find(node => node.className === "analytics-tooltip");
  assert.match(tooltip.text, /1 hr 16 min 44 sec/);
  plot.listeners.keydown({ key: "Home", preventDefault() {} });
  assert.match(tooltip.text, /Unavailable.*No data/);
  assert.equal(app.requests.length, 4);
});

test("section tabs support clicks and arrow navigation, preserve the chosen section on refresh, and do not fetch on navigation", async () => {
  const app = await boot();
  const custom = app.elements.get("analytics-tab-custom");
  const traffic = app.elements.get("analytics-tab-goatcounter");
  custom.listeners.click();
  assert.equal(custom["aria-selected"], "true");
  assert.equal(traffic["aria-selected"], "false");
  assert.equal(custom.tabIndex, 0);
  assert.equal(traffic.tabIndex, -1);
  assert.deepEqual(app.elements.get("analytics-reports").children.map(node => node.hidden), [true, false, true]);
  assert.equal(app.requests.length, 4);
  custom.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  const search = app.elements.get("analytics-tab-search-console");
  assert.equal(search.focused, true);
  assert.equal(search["aria-selected"], "true");
  await app.elements.get("analytics-range").listeners.submit({ preventDefault() {} });
  assert.deepEqual(app.elements.get("analytics-reports").children.map(node => node.hidden), [true, true, false]);
  assert.equal(search["aria-selected"], "true");
  search.listeners.keydown({ key: "Home", preventDefault() {} });
  assert.equal(traffic["aria-selected"], "true");
  assert.equal(traffic.focused, true);
});

test("chart pointer, keyboard and touch readouts distinguish missing days from zero and stay within chart edges", async () => {
  const app = await boot({ reports: { custom: { tables: [dailyReport([
    { day: "2026-10-01", actions: 0 }, { day: "2026-10-02", actions: null }, { day: "2026-10-03", actions: 12 },
  ])] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "custom");
  const plot = nodes(section).find(node => node.className === "analytics-plot");
  const tooltip = nodes(plot).find(node => node.className === "analytics-tooltip");
  const marker = nodes(plot).find(node => node.className === "analytics-selected");
  plot.listeners.pointermove({ clientX: 62 });
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.text, /Oct 1, 2026.*0.*Daily actions/);
  assert.equal(tooltip.style.left, "4px");
  plot.listeners.pointerleave();
  assert.equal(tooltip.hidden, true);
  plot.listeners.focus();
  plot.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  assert.match(tooltip.text, /Oct 2, 2026.*Unavailable.*No data for this day/);
  assert.equal(marker.visibility, "hidden");
  plot.listeners.keydown({ key: "End", preventDefault() {} });
  assert.match(tooltip.text, /Oct 3, 2026.*12/);
  assert.equal(tooltip.style.left, "356px");
  assert.equal(marker.visibility, "visible");
  assert.match(nodes(plot).find(node => node["aria-live"] === "polite").text, /2026-10-03.*12/);
  plot.listeners.keydown({ key: "Escape" });
  assert.equal(tooltip.hidden, true);
  plot.listeners.blur();
  plot.listeners.pointerdown({ clientX: 524, pointerType: "touch" });
  plot.listeners.pointerleave();
  assert.equal(tooltip.hidden, false);
  plot.listeners.blur();
  assert.equal(tooltip.hidden, true);
});

test("charts resize with their panel, release observers on redraw and logout, and format rates without a cumulative view", async () => {
  const app = await boot({ reports: { custom: { tables: [dailyReport([
    { day: "2026-10-01", actions: 0.125 }, { day: "2026-10-02", actions: 0.25 },
  ], "percent")] } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "custom");
  const observer = app.observers[0];
  observer.node.rect = { width: 320, left: 0 };
  observer.callback();
  assert.equal(nodes(section).find(node => node.tag === "svg").viewBox, "0 0 320 244");
  observer.node.listeners.keydown({ key: "End", preventDefault() {} });
  assert.match(nodes(section).find(node => node.className === "analytics-tooltip").text, /25%/);
  assert.ok(nodes(section).filter(node => node.className === "analytics-axis").some(node => node.textContent === "25%"));
  assert.ok(!nodes(section).filter(node => node.className === "analytics-axis").some(node => node.textContent === "100%"));
  assert.equal(nodes(section).filter(node => node["aria-label"]?.startsWith("Chart view")).length, 0);
  const select = nodes(section).find(node => node["aria-label"] === "Daily metric for PredictPlayoffs activity");
  select.listeners.change();
  assert.equal(observer.disconnected, true);
  assert.equal(app.observers.filter(item => !item.disconnected).length, 1);
  app.elements.get("admin-sign-out").listeners.click();
  assert.ok(app.observers.every(item => item.disconnected));
});

test("date refresh retains the daily metric choice in memory without writing analytics storage", async () => {
  const report = dailyReport([{ day: "2026-10-01", actions: 4, signins: 2 }, { day: "2026-10-02", actions: 8, signins: 3 }]);
  report.columns.push({ key: "signins", label: "Sign-ins", format: "number" });
  const app = await boot({ reports: { custom: { tables: [report] } } });
  const section = () => app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "custom");
  const select = nodes(section()).find(node => node["aria-label"] === "Daily metric for PredictPlayoffs activity");
  select.value = "signins"; select.listeners.change();
  await app.elements.get("analytics-range").listeners.submit({ preventDefault() {} });
  assert.equal(nodes(section()).find(node => node["aria-label"] === "Daily metric for PredictPlayoffs activity").value, "signins");
  assert.match(section().text, /Daily sign-ins/);
  assert.deepEqual([...app.store.keys()], ["road-to-bowl.auth.session"]);
});

test("search breakdown selector shows exactly one table and keeps all returned data without additional requests", async () => {
  const app = await boot({ reports: { "search-console": { tables: ["query", "page", "country", "device"].map(key => ({
    title: `Search by ${key}`, columns: [{ key, label: key, format: "text" }, { key: "clicks", label: "Clicks", format: "number" }],
    rows: [{ [key]: `<${key}>`, clicks: 7 }],
  })) } } });
  const section = app.elements.get("analytics-reports").children.find(node => node.dataset.provider === "search-console");
  const explorer = nodes(section).find(node => node.className === "analytics-search-explorer");
  const select = nodes(explorer).find(node => node.tag === "select");
  const breakdowns = explorer.children.filter(node => node.className === "analytics-breakdown");
  assert.equal(breakdowns.length, 4);
  assert.deepEqual(breakdowns.map(node => node.hidden), [false, true, true, true]);
  select.value = "3"; select.listeners.change();
  assert.deepEqual(breakdowns.map(node => node.hidden), [true, true, true, false]);
  assert.match(breakdowns[3].text, /<device>.*7/);
  assert.equal(nodes(section).filter(node => node.tag === "tbody").length, 4);
  assert.equal(app.requests.length, 4);
});
