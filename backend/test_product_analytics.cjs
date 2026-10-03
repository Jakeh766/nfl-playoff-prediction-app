const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "frontend/analytics.js"), "utf8");
const monitoring = fs.readFileSync(path.join(root, "frontend/monitoring.js"), "utf8");

function boot(options = {}) {
  const scripts = [];
  const requests = [];
  const listeners = new Map();
  const store = new Map(options.consent ? [["pp_analytics_consent_v1", options.consent]] : []);
  const sessionStore = new Map();
  for (const [key, value] of Object.entries(options.local || {})) store.set(key, value);
  for (const [key, value] of Object.entries(options.session || {})) sessionStore.set(key, value);
  const storage = values => ({
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => { if (options.storageBlocked) throw new Error("blocked"); return values.get(key) || null; },
    setItem: (key, value) => { if (options.storageBlocked) throw new Error("blocked"); values.set(key, value); },
    removeItem: key => { if (options.cleanupBlocked) throw new Error("blocked"); values.delete(key); },
  });
  const cookies = new Map([["_ga", "old"], ["_clck", "old"], ["auth", "keep"]]);
  const cookieWrites = [];
  let idsCreated = 0;
  const makeChoices = () => ["denied", "granted"].map(choice => ({
    dataset: { analyticsChoice: choice },
    addEventListener(name, callback) { this[name] = callback; },
  }));
  const choices = makeChoices();
  const dialogChoices = makeChoices();
  let headingFocused = false;
  let footerFocused = false;
  let scrolls = 0;
  const attributes = {};
  const settingsButton = {
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, callback) { this[name] = callback; },
    focus() { footerFocused = true; },
  };
  const privacyMessage = { prepend(value) { this.text = value; } };
  const dialogPrivacyMessage = { prepend(value) { this.text = value; } };
  const closeButton = { addEventListener(name, callback) { this[name] = callback; } };
  const heading = { focus() { headingFocused = true; } };
  const panel = {
    setAttribute() {}, scrollIntoView() { scrolls++; },
    querySelectorAll: () => choices, querySelector: selector => selector === "p" ? privacyMessage : heading,
  };
  const dialogListeners = new Map();
  const dialog = {
    open: false, setAttribute() {},
    querySelectorAll: () => dialogChoices,
    querySelector: selector => selector === "p" ? dialogPrivacyMessage : selector === "h2" ? heading : closeButton,
    addEventListener(name, callback) { dialogListeners.set(name, callback); },
    showModal() { this.open = true; },
    close() { this.open = false; dialogListeners.get("close")?.(); },
  };
  const bodyClasses = new Set();
  const body = { dataset: { page: options.page || "picks" }, setAttribute() {}, appendChild() {},
    classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) } };
  let reloads = 0;
  const url = new URL(options.url || "https://dev.example.com/picks?sport=nba");
  const context = {
    URL, Event, Set,
    SPORT: "nba",
    navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc },
    localStorage: storage(store), sessionStorage: storage(sessionStore),
    crypto: options.noCrypto ? {} : { randomUUID: () => `random-first-party-id-${++idsCreated}` },
    fetch: (url, request) => { requests.push({ url, request }); return Promise.resolve(); },
    document: {
      body,
      get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); },
      set cookie(value) { cookieWrites.push(value); cookies.delete(value.split("=")[0]); },
      referrer: options.referrer || "https://example.org/article?email=private@example.org",
      head: { appendChild: script => scripts.push(script) },
      createElement: tag => tag === "section" ? panel : tag === "dialog" ? dialog : {
        addEventListener(name, callback) { this[name] = callback; },
      },
      getElementById: () => ({ after() {} }),
      querySelector: () => settingsButton,
    },
    location: { origin: url.origin, pathname: url.pathname, hostname: url.hostname,
      href: url.href, reload: () => reloads++ },
    AUTH_CONFIG: { environment: options.environment || "dev", analytics: options.disabled ? {} : {
      ga4MeasurementId: "G-TEST123", clarityProjectId: "test123",
    } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    dispatchEvent: event => listeners.get(event.type)?.(event),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  vm.runInContext(monitoring, context);
  return { context, scripts, requests, panel, dialog, dialogChoices, closeButton, dialogListeners, bodyClasses, attributes, store, sessionStore, choices, settingsButton, privacyMessage, dialogPrivacyMessage, cookieWrites,
    footerFocused: () => footerFocused, scrolls: () => scrolls,
    idsCreated: () => idsCreated,
    payloads: () => requests.map(({ request }) => JSON.parse(request.body)),
    headingFocused: () => headingFocused, reloads: () => reloads,
    events: () => (context.dataLayer || []).map(args => Array.from(args)).filter(args => args[0] === "event") };
}

test("aggregate events start without consent; optional scripts and IDs wait for acceptance", () => {
  const app = boot();
  assert.equal(app.scripts.length, 0);
  assert.deepEqual(app.payloads(), [{ event: "page_view", page: "/picks" }]);
  assert.equal(app.idsCreated(), 0);
  assert.equal(app.store.has("rtb_visitor_id"), false);
  app.choices[1].click();
  assert.equal(app.scripts.length, 1); // Sensitive referrer blocks Clarity.
  assert.equal(app.requests.length, 1);
  assert.equal(app.events().filter(args => args[1] === "page_view").length, 1);
  app.context.siteAnalytics.track("sign_in");
  assert.equal(app.payloads()[1].visitorId, app.store.get("rtb_visitor_id"));
  assert.equal(app.payloads()[1].sessionId, app.sessionStore.get("rtb_session_id"));
  assert.equal(app.idsCreated(), 2);
});

test("cookie preferences reopen in a modal without scrolling or revealing the banner", () => {
  const app = boot();
  assert.equal(app.panel.hidden, false);
  assert.match(app.panel.innerHTML, /Cookie preferences/);
  assert.match(app.panel.innerHTML, /If you decline, optional analytics stay off/);
  assert.match(app.panel.innerHTML, /With your permission, we also use optional analytics cookies and similar technologies/);
  assert.match(app.panel.innerHTML, /href="\/privacy">Privacy Policy<\/a>/);
  assert.match(app.panel.innerHTML, /data-analytics-choice="denied">Decline analytics<\/button>/);
  assert.match(app.panel.innerHTML, /data-analytics-choice="granted">Allow analytics<\/button>/);
  app.choices[0].click();
  assert.equal(app.panel.hidden, true);
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 1);
  app.context.siteAnalytics.track("prediction_saved");
  assert.deepEqual(app.payloads()[1], { event: "prediction_saved", page: "/picks" });
  assert.equal(app.store.get("pp_analytics_consent_v1"), "denied");
  assert.equal(app.reloads(), 0);
  app.settingsButton.click();
  assert.equal(app.panel.hidden, true);
  assert.equal(app.dialog.open, true);
  assert.equal(app.scrolls(), 0);
  assert.equal(app.headingFocused(), true);
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 2);
  assert.equal(app.idsCreated(), 0);
});

test("closing cookie preferences preserves consent, unlocks scrolling, and restores footer focus", () => {
  for (const dismiss of [app => app.closeButton.click(), app => app.dialog.close(),
    app => app.dialogListeners.get("click")({ target: app.dialog })]) {
    const app = boot({ consent: "denied" });
    app.settingsButton.click();
    assert.equal(app.dialog.open, true);
    assert.equal(app.attributes["aria-haspopup"], "dialog");
    assert.equal(app.attributes["aria-controls"], "cookie-preferences-dialog");
    assert.ok(app.bodyClasses.has("cookie-preferences-open"));
    dismiss(app);
    assert.equal(app.dialog.open, false);
    assert.equal(app.bodyClasses.has("cookie-preferences-open"), false);
    assert.equal(app.footerFocused(), true);
    assert.equal(app.store.get("pp_analytics_consent_v1"), "denied");
    assert.equal(app.panel.hidden, true);
    assert.equal(app.scrolls(), 0);
  }
});

test("dialog choices persist consent and close both consent surfaces", () => {
  for (const choice of ["granted", "denied"]) {
    const app = boot();
    app.settingsButton.click();
    assert.equal(app.panel.hidden, false); // Initial unanswered banner stays in place.
    app.dialogChoices.find(button => button.dataset.analyticsChoice === choice).click();
    assert.equal(app.store.get("pp_analytics_consent_v1"), choice);
    assert.equal(app.dialog.open, false);
    assert.equal(app.panel.hidden, true);
    assert.equal(app.bodyClasses.has("cookie-preferences-open"), false);
    assert.equal(app.context.productAnalytics.allowed(), choice === "granted");
    assert.equal(app.footerFocused(), true);
  }
});

test("GA events remove tokens and ignore arbitrary user data", () => {
  const app = boot({ consent: "granted", url: "https://dev.example.com/picks?invite=secret#email=private" });
  app.context.siteAnalytics.track("prediction_saved", { email: "private@example.org", picks: ["secret"] });
  app.context.siteAnalytics.track("private@example.org");
  const event = app.events().find(args => args[1] === "bracket_saved");
  assert.equal(event[2].page_location, "https://dev.example.com/picks");
  assert.equal(event[2].page_referrer, "https://example.org");
  assert.equal(event[2].sport, "nba");
  assert.equal(event[2].environment, "dev");
  assert.doesNotMatch(JSON.stringify(app.context.dataLayer), /private|secret|random-first-party-id/);
  assert.equal(app.scripts.length, 1);
  assert.equal(app.requests.length, 2);
});

test("safe consented visits load both providers in head and pass Clarity consent", () => {
  const app = boot({ consent: "granted", referrer: "https://dev.example.com/?sport=nba" });
  assert.equal(app.scripts.length, 2);
  assert.ok(app.scripts.every(script => script.async && script.referrerPolicy === "no-referrer"));
  assert.equal(app.context.clarity.q[0][0], "consentv2");
  assert.equal(app.context.clarity.q[0][1].ad_Storage, "denied");
  assert.equal(app.context.clarity.q[0][1].analytics_Storage, "granted");
});

test("GPC, Do Not Track, and unknown pages suppress all analytics even after acceptance", () => {
  for (const options of [{ gpc: true }, { dnt: "1" },
    { url: "https://dev.example.com/private/person" }]) {
    const app = boot({ consent: "granted", local: { rtb_visitor_id: "old" },
      session: { rtb_session_id: "old" }, ...options });
    assert.equal(app.scripts.length, 0);
    assert.equal(app.requests.length, 0);
    app.choices[1].click();
    app.context.siteAnalytics?.track("sign_in");
    assert.equal(app.requests.length, 0);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.idsCreated(), 0);
    assert.equal(app.store.has("rtb_visitor_id"), false);
    assert.equal(app.sessionStore.has("rtb_session_id"), false);
  }
});

test("cookie preferences explain browser privacy signals while keeping optional cookies disabled", () => {
  for (const options of [{ gpc: true }, { dnt: "1" }]) {
    const app = boot(options);
    assert.equal(app.panel.hidden, true);
    app.settingsButton.click();
    assert.equal(app.panel.hidden, true);
    assert.equal(app.dialog.open, true);
    assert.equal(app.headingFocused(), true);
    assert.match(app.privacyMessage.text, /privacy signal is enabled/);
    assert.ok([...app.choices, ...app.dialogChoices].every(button => button.disabled));
    assert.match(app.dialogPrivacyMessage.text, /privacy signal is enabled/);
    assert.equal(app.requests.length, 0);
    assert.equal(app.scripts.length, 0);
  }
});

test("declining after consent stops providers, clears analytics storage, and continues cookieless", () => {
  const app = boot({ consent: "granted", referrer: "https://dev.example.com/", local: {
    _ga_TEST: "provider-id", unrelated: "keep",
  }, session: { _cltk: "provider-id", auth: "keep" } });
  assert.equal(app.store.has("rtb_visitor_id"), true);
  app.choices[0].click();
  assert.equal(app.context["ga-disable-G-TEST123"], true);
  assert.equal(app.store.get("pp_analytics_consent_v1"), "denied");
  assert.equal(app.store.has("rtb_visitor_id"), false);
  assert.equal(app.sessionStore.has("rtb_session_id"), false);
  assert.equal(app.store.has("_ga_TEST"), false);
  assert.equal(app.sessionStore.has("_cltk"), false);
  assert.equal(app.store.get("unrelated"), "keep");
  assert.equal(app.sessionStore.get("auth"), "keep");
  assert.equal(app.context.document.cookie, "auth=keep");
  assert.ok(app.cookieWrites.some(value => value.includes("Domain=.example.com")));
  assert.equal(app.context.clarity.q.at(-1)[0], "stop");
  assert.equal(app.reloads(), 1);
  const count = app.requests.length;
  app.context.siteAnalytics.track("sign_in");
  assert.equal(app.requests.length, count + 1);
  assert.deepEqual(app.payloads().at(-1), { event: "sign_in", page: "/picks" });
  assert.equal(app.events().filter(args => args[1] === "login").length, 0);
  const reloaded = boot({ consent: "denied" });
  assert.equal(reloaded.scripts.length, 0);
  assert.deepEqual(reloaded.payloads(), [{ event: "page_view", page: "/picks" }]);
});

test("all required events are cookieless without consent, including disabled vendors or crypto", () => {
  for (const options of [{}, { consent: "denied" }, { storageBlocked: true }, { noCrypto: true },
    { environment: "prod", disabled: true }]) {
    const app = boot({ local: { rtb_visitor_id: "old" }, session: { rtb_session_id: "old" }, ...options });
    const events = ["bracket_started", "bracket_completed", "prediction_saved", "account_created",
      "sign_in", "leaderboard_viewed", "group_created", "group_joined", "group_invite_joined"];
    for (const event of events) app.context.siteAnalytics.track(event, { cognitoId: "private", email: "private" });
    app.context.siteAnalytics.track("unknown");
    assert.deepEqual(app.payloads(), ["page_view", ...events].map(event => ({ event, page: "/picks" })));
    assert.equal(app.idsCreated(), 0);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.store.has("rtb_visitor_id"), false);
    assert.equal(app.sessionStore.has("rtb_session_id"), false);
    assert.ok(app.requests.every(({ request }) => request.credentials === "omit" && request.referrerPolicy === "no-referrer"));
  }
});

test("leaderboard view is counted once for aggregate and consented provider analytics", () => {
  for (const consent of [undefined, "denied", "granted"]) {
    const app = boot({ page: "leaderboard", url: "https://dev.example.com/leaderboard.html", consent });
    assert.deepEqual(app.payloads().map(value => value.event), ["page_view", "leaderboard_viewed"]);
    assert.ok(app.payloads().every(value => value.page === "/leaderboard"));
    if (consent !== "granted") app.choices[1].click();
    assert.equal(app.requests.length, 2);
    assert.equal(app.events().filter(args => args[1] === "leaderboard_viewed").length, 1);
  }
});

test("consented event mappings and visitor/session reuse are preserved", () => {
  const app = boot({ consent: "granted", disabled: false });
  const mappings = { account_created: "sign_up", sign_in: "login", prediction_saved: "bracket_saved",
    bracket_started: "bracket_started", bracket_completed: "bracket_completed", leaderboard_viewed: "leaderboard_viewed",
    group_created: "group_created", group_joined: "group_joined", group_invite_joined: "group_joined" };
  for (const [event, gaEvent] of Object.entries(mappings)) {
    app.context.siteAnalytics.track(event);
    assert.equal(app.events().at(-1)[1], gaEvent);
    assert.equal(app.payloads().at(-1).visitorId, app.payloads()[0].visitorId);
    assert.equal(app.payloads().at(-1).sessionId, app.payloads()[0].sessionId);
  }
  assert.equal(app.idsCreated(), 2);
});

test("consent revoked in another tab clears cached IDs before more events", () => {
  const app = boot({ consent: "granted" });
  app.context.dispatchEvent({ type: "storage", key: "pp_analytics_consent_v1", newValue: "denied" });
  app.context.siteAnalytics.track("prediction_saved");
  assert.deepEqual(app.payloads().at(-1), { event: "prediction_saved", page: "/picks" });
  assert.equal(app.store.has("rtb_visitor_id"), false);
  assert.equal(app.reloads(), 1);
});

test("dashboard totals include cookieless events and identity metrics explicitly require IDs", () => {
  const terraform = fs.readFileSync(path.join(root, "terraform/modules/app/main.tf"), "utf8");
  const queries = [...terraform.matchAll(/query\s*= ("SOURCE .*?")\r?\n/g)].map(match => JSON.parse(match[1]));
  assert.ok(queries.length >= 10);
  for (const query of queries) {
    if (query.includes("count_distinct(visitorId)")) assert.match(query, /filter[^\n]*ispresent\(visitorId\)/);
    else if (query.includes("sessionId")) assert.match(query, /filter[^\n]*ispresent\(sessionId\)/);
    else assert.doesNotMatch(query, /ispresent/);
  }
  assert.ok(queries.some(query => query.includes("bracket_completed") && query.includes("count(*)")));
});

test("every public HTML page includes ordered head scripts and masking", () => {
  for (const name of fs.readdirSync(path.join(root, "frontend")).filter(name => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, "frontend", name), "utf8");
    const head = html.split("</head>")[0];
    assert.ok(head.indexOf('/auth-config.js') < head.indexOf('/analytics.js'), name);
    assert.ok(head.indexOf('/analytics.js') < head.indexOf('/monitoring.js'), name);
    assert.match(html, /<body data-clarity-mask="true"/, name);
    assert.match(html, /href="\/privacy"/, name);
  }
});
