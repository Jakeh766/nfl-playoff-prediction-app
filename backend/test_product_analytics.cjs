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
  const storage = {
    getItem: key => { if (options.storageBlocked) throw new Error("blocked"); return store.get(key) || null; },
    setItem: (key, value) => { if (options.storageBlocked) throw new Error("blocked"); store.set(key, value); },
    removeItem: key => store.delete(key),
  };
  const choices = ["denied", "granted"].map(choice => ({
    dataset: { analyticsChoice: choice },
    addEventListener: (_name, callback) => { choices.find(button => button.dataset.analyticsChoice === choice).click = callback; },
  }));
  let headingFocused = false;
  let settingsButton;
  const heading = { focus() { headingFocused = true; } };
  const panel = {
    setAttribute() {}, scrollIntoView() {},
    querySelectorAll: () => choices, querySelector: () => heading,
  };
  const body = { dataset: { page: options.page || "picks" }, setAttribute() {}, appendChild() {} };
  let reloads = 0;
  const url = new URL(options.url || "https://dev.example.com/picks?sport=nba");
  const context = {
    URL, Event, Set,
    SPORT: "nba",
    navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc },
    localStorage: storage, sessionStorage: storage,
    crypto: { randomUUID: () => "random-first-party-id" },
    fetch: (url, request) => { requests.push({ url, request }); return Promise.resolve(); },
    document: {
      body, cookie: "_ga=old; _clck=old; auth=keep",
      referrer: options.referrer || "https://example.org/article?email=private@example.org",
      head: { appendChild: script => scripts.push(script) },
      createElement: tag => tag === "section" ? panel : {
        addEventListener(name, callback) { this[name] = callback; },
      },
      getElementById: () => ({ after() {} }),
      querySelector: () => ({ appendChild(button) { settingsButton = button; } }),
    },
    location: { origin: url.origin, pathname: url.pathname, hostname: url.hostname,
      href: url.href, reload: () => reloads++ },
    AUTH_CONFIG: { environment: options.environment || "dev", analytics: options.disabled ? {} : {
      ga4MeasurementId: "G-TEST123", clarityProjectId: "test123",
    } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    dispatchEvent: event => listeners.get(event.type)?.(),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  vm.runInContext(monitoring, context);
  return { context, scripts, requests, panel, store, choices, settingsButton,
    headingFocused: () => headingFocused, reloads: () => reloads,
    events: () => (context.dataLayer || []).map(args => Array.from(args)).filter(args => args[0] === "event") };
}

test("optional scripts, requests, and tracking IDs wait for consent", () => {
  const app = boot();
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 0);
  assert.equal(app.store.has("rtb_visitor_id"), false);
  app.choices[1].click();
  assert.equal(app.scripts.length, 1); // Sensitive referrer blocks Clarity.
  assert.equal(app.requests.length, 1);
  assert.equal(app.events().filter(args => args[1] === "page_view").length, 1);
});

test("simple consent copy supports declining and reopening Analytics settings", () => {
  const app = boot();
  assert.equal(app.panel.hidden, false);
  assert.match(app.panel.innerHTML, /Help improve Predict Playoffs/);
  assert.match(app.panel.innerHTML, /We use optional analytics to understand how people use Predict Playoffs and improve the site\./);
  assert.match(app.panel.innerHTML, /href="\/privacy">Privacy Policy<\/a>/);
  assert.match(app.panel.innerHTML, /data-analytics-choice="denied">Decline<\/button>/);
  assert.match(app.panel.innerHTML, /data-analytics-choice="granted">Allow analytics<\/button>/);
  assert.doesNotMatch(app.panel.innerHTML, /Google|Microsoft|Clarity/);
  app.choices[0].click();
  assert.equal(app.panel.hidden, true);
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 0);
  assert.equal(app.store.get("pp_analytics_consent_v1"), "denied");
  assert.equal(app.reloads(), 0);
  assert.equal(app.settingsButton.textContent, "Analytics settings");
  app.settingsButton.click();
  assert.equal(app.panel.hidden, false);
  assert.equal(app.headingFocused(), true);
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 0);
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

test("GPC, Do Not Track, denied consent, blocked storage, and unknown pages stay off", () => {
  for (const options of [{ gpc: true }, { dnt: "1" }, { consent: "denied" },
    { storageBlocked: true }, { url: "https://dev.example.com/private/person" }]) {
    const app = boot({ consent: "granted", ...options });
    assert.equal(app.scripts.length, 0);
    assert.equal(app.requests.length, 0);
  }
});

test("declining after consent stops tracking, clears IDs, and reloads", () => {
  const app = boot({ consent: "granted", referrer: "" });
  app.choices[0].click();
  assert.equal(app.context["ga-disable-G-TEST123"], true);
  assert.equal(app.store.get("pp_analytics_consent_v1"), "denied");
  assert.equal(app.store.has("rtb_visitor_id"), false);
  assert.equal(app.reloads(), 1);
  const count = app.requests.length;
  app.context.siteAnalytics.track("sign_in");
  assert.equal(app.requests.length, count);
});

test("unconfigured production preserves existing first-party analytics", () => {
  const app = boot({ environment: "prod", disabled: true });
  assert.equal(app.scripts.length, 0);
  assert.equal(app.requests.length, 1);
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
