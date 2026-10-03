(function initializeProductAnalytics() {
  try {
    const config = window.AUTH_CONFIG || {};
    if (!["dev", "prod"].includes(config.environment)) return;
    const settings = config.analytics || {};
    const ga = /^G-[A-Z0-9]+$/.test(settings.ga4MeasurementId || "") ? settings.ga4MeasurementId : "";
    const clarity = /^[a-z0-9]+$/.test(settings.clarityProjectId || "") ? settings.clarityProjectId : "";
    // Initialization errors must fail closed for first-party tracking as well.
    window.productAnalytics = { track() {}, allowed: () => false, aggregateAllowed: () => false };
    const pages = new Set(["/", "/index.html", "/nba", "/nba.html", "/picks", "/picks.html",
      "/leaderboard", "/leaderboard.html", "/scoring", "/scoring.html", "/privacy", "/privacy.html"]);
    const page = window.location.pathname;
    const privacySignal = navigator.doNotTrack === "1" || !!navigator.globalPrivacyControl;
    const consentKey = "pp_analytics_consent_v1";
    let choice = "";
    try { choice = localStorage.getItem(consentKey) || ""; } catch (_error) { /* Default off. */ }
    let started = false;
    const aggregateAllowed = () => !privacySignal && pages.has(page);
    const allowed = () => aggregateAllowed() && choice === "granted";
    const events = {
      page_view: "page_view", account_created: "sign_up", sign_in: "login",
      prediction_saved: "bracket_saved", bracket_started: "bracket_started",
      bracket_completed: "bracket_completed", leaderboard_viewed: "leaderboard_viewed",
      group_created: "group_created", group_joined: "group_joined", group_invite_joined: "group_joined",
    };
    function safeReferrer() {
      try {
        const url = new URL(document.referrer);
        return ["https:", "http:"].includes(url.protocol) ? url.origin : "";
      } catch (_error) { return ""; }
    }
    function safeForRecording(value) {
      if (!value) return true;
      try {
        const url = new URL(value);
        return !url.hash && [...url.searchParams].every(([key, value]) =>
          key === "sport" && ["nfl", "nba"].includes(value));
      } catch (_error) { return false; }
    }
    function track(event) {
      if (!allowed() || !started || !Object.hasOwn(events, event) || !ga) return;
      window.gtag("event", events[event], {
        send_to: ga,
        page_location: window.location.origin + page,
        page_referrer: safeReferrer(),
        page_title: `Predict Playoffs — ${document.body.dataset.page || "home"}`,
        sport: typeof SPORT === "string" && SPORT === "nba" ? "nba" : "nfl",
        environment: config.environment,
      });
    }
    window.productAnalytics = { track, allowed, aggregateAllowed };
    function loadScript(src) {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      script.referrerPolicy = "no-referrer";
      document.head.appendChild(script);
    }
    function start() {
      if (started || !allowed()) return;
      started = true;
      if (ga) {
        window[`ga-disable-${ga}`] = false;
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag("consent", "default", {
          analytics_storage: "granted", ad_storage: "denied",
          ad_user_data: "denied", ad_personalization: "denied",
        });
        window.gtag("js", new Date());
        window.gtag("config", ga, {
          send_page_view: false, page_location: window.location.origin + page,
          page_referrer: safeReferrer(), allow_google_signals: false,
          allow_ad_personalization_signals: false,
        });
        loadScript(`https://www.googletagmanager.com/gtag/js?id=${ga}`);
      }
      // Clarity reads the actual URL and referrer. Skip token-bearing URLs.
      if (clarity && safeForRecording(window.location.href) && safeForRecording(document.referrer)) {
        document.body.setAttribute("data-clarity-mask", "true");
        window.clarity = window.clarity || function () {
          (window.clarity.q = window.clarity.q || []).push(arguments);
        };
        window.clarity("consentv2", { analytics_Storage: "granted", ad_Storage: "denied" });
        loadScript(`https://www.clarity.ms/tag/${clarity}`);
      }
    }
    function clearAnalyticsStorage() {
      const providerKey = /^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_clck$|_clsk$|_cltk$)/;
      for (const storageName of ["localStorage", "sessionStorage"]) {
        try {
          const storage = window[storageName];
          const keys = ["rtb_visitor_id", "rtb_session_id"];
          for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index);
            if (providerKey.test(key)) keys.push(key);
          }
          keys.forEach(key => storage.removeItem(key));
        } catch (_error) { /* Clear each store independently when available. */ }
      }
      const host = window.location.hostname;
      const domains = ["", host, ...host.split(".").map((_, index, parts) =>
        "." + parts.slice(index).join(".")).filter(domain => domain.split(".").length > 2)];
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (!providerKey.test(name)) continue;
        for (const domain of domains) {
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
        }
      }
    }
    function changeConsent(nextChoice) {
      choice = nextChoice;
      updatePreferenceStatus();
      panel.hidden = true;
      if (dialog.open) dialog.close();
      if (choice === "granted" && !privacySignal) {
        const wasStarted = started;
        start();
        if (!wasStarted) window.dispatchEvent(new Event("analytics-consent-granted"));
      } else {
        if (ga) window[`ga-disable-${ga}`] = true;
        try { window.clarity?.("stop"); } catch (_error) { /* Still clear our storage. */ }
        clearAnalyticsStorage();
        window.dispatchEvent(new Event("analytics-consent-declined"));
        // Unload already running providers; the next page keeps aggregate tracking.
        if (started) window.location.reload();
      }
    }
    if (!allowed()) clearAnalyticsStorage();
    const panel = document.createElement("section");
    panel.className = "analytics-consent";
    panel.setAttribute("aria-labelledby", "analytics-consent-title");
    panel.setAttribute("data-no-sport-copy", "");
    const cookieMessage = `We use essential browser storage to keep you signed in and remember your preferences. With your permission, we also use optional analytics cookies and similar technologies to understand how people use Predict Playoffs and improve the site. If you decline, optional analytics stay off. <a href="${page.endsWith(".html") ? "/privacy.html" : "/privacy"}">Privacy Policy</a>`;
    const consentActions = `<div class="analytics-consent-actions"><button class="button button-ghost" type="button" data-analytics-choice="denied">Decline analytics</button><button class="button button-ghost" type="button" data-analytics-choice="granted">Allow analytics</button></div>`;
    panel.innerHTML = `<div><h2 id="analytics-consent-title" tabindex="-1">Cookie preferences</h2><p>${cookieMessage}</p></div>${consentActions}`;
    panel.hidden = privacySignal || ["granted", "denied"].includes(choice);
    const header = document.getElementById("site-header");
    if (header) header.after(panel);
    else document.body.appendChild(panel);

    const dialog = document.createElement("dialog");
    dialog.id = "cookie-preferences-dialog";
    dialog.className = "account-dialog cookie-preferences-dialog";
    dialog.setAttribute("aria-labelledby", "cookie-preferences-title");
    dialog.setAttribute("data-no-sport-copy", "");
    dialog.innerHTML = `<div class="cookie-preferences-content"><div class="dialog-heading"><h2 id="cookie-preferences-title" tabindex="-1">Cookie preferences</h2><button class="dialog-close cookie-preferences-close" type="button" data-cookie-close aria-label="Close cookie preferences"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><p>${cookieMessage}</p><p class="cookie-preferences-status" role="status"><strong>Current preference</strong><span data-cookie-status></span></p>${consentActions}</div>`;
    function updatePreferenceStatus() {
      const status = privacySignal ? "Optional analytics: Off — browser privacy signal" :
        allowed() ? "Optional analytics: Allowed" :
        choice === "denied" ? "Optional analytics: Declined" :
        choice === "granted" ? "Optional analytics: Off on this page" :
        "Optional analytics: Off — no preference chosen";
      dialog.querySelector("[data-cookie-status]").textContent = status;
    }
    updatePreferenceStatus();
    document.body.appendChild(dialog);
    for (const surface of [panel, dialog]) {
      surface.querySelectorAll("[data-analytics-choice]").forEach(button => {
        button.disabled = privacySignal;
        button.addEventListener("click", () => {
          const nextChoice = button.dataset.analyticsChoice;
          try { localStorage.setItem(consentKey, nextChoice); } catch (_error) { /* This page only. */ }
          changeConsent(nextChoice);
        });
      });
      if (privacySignal) {
        surface.querySelector("p").prepend("Your browser’s privacy signal is enabled, so optional cookies and site usage measurements are disabled. ");
      }
    }
    const preferences = document.querySelector(".cookie-preferences");
    dialog.querySelector("[data-cookie-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("cookie-preferences-open");
      preferences?.focus({ preventScroll: true });
    });
    if (preferences) {
      preferences.setAttribute("aria-haspopup", "dialog");
      preferences.setAttribute("aria-controls", dialog.id);
      preferences.addEventListener("click", () => {
        if (dialog.open) return;
        updatePreferenceStatus();
        dialog.showModal();
        document.body.classList.add("cookie-preferences-open");
        dialog.querySelector("h2").focus({ preventScroll: true });
      });
    }
    window.addEventListener("storage", event => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key === consentKey || event.key === null) changeConsent(event.newValue || "");
    });
    start();
  } catch (_error) {
    // Analytics failures must never interrupt account or bracket functionality.
  }
})();
