(function initializeProductAnalytics() {
  try {
    const config = window.AUTH_CONFIG || {};
    if (!["dev", "prod"].includes(config.environment)) return;
    const settings = config.analytics || {};
    const ga = /^G-[A-Z0-9]+$/.test(settings.ga4MeasurementId || "") ? settings.ga4MeasurementId : "";
    const clarity = /^[a-z0-9]+$/.test(settings.clarityProjectId || "") ? settings.clarityProjectId : "";
    if (!ga && !clarity) return;
    // Initialization errors must fail closed for first-party tracking as well.
    window.productAnalytics = { track() {}, allowed: () => false };
    const pages = new Set(["/", "/index.html", "/nba", "/nba.html", "/picks", "/picks.html",
      "/leaderboard", "/leaderboard.html", "/scoring", "/scoring.html", "/privacy", "/privacy.html"]);
    const page = window.location.pathname;
    const privacySignal = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
    const consentKey = "pp_analytics_consent_v1";
    let choice = "";
    try { choice = localStorage.getItem(consentKey) || ""; } catch (_error) { /* Default off. */ }
    let started = false;
    const allowed = () => !privacySignal && choice === "granted" && pages.has(page);
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
    window.productAnalytics = { track, allowed };
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
      if (document.body.dataset.page === "leaderboard") track("leaderboard_viewed");
    }
    function clearAnalyticsStorage() {
      try {
        localStorage.removeItem("rtb_visitor_id");
        sessionStorage.removeItem("rtb_session_id");
      } catch (_error) { /* Storage may be blocked. */ }
      const host = window.location.hostname;
      const domains = ["", host, ...host.split(".").map((_, index, parts) =>
        "." + parts.slice(index).join(".")).filter(domain => domain.split(".").length > 2)];
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (!/^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_clck$|_clsk$)/.test(name)) continue;
        for (const domain of domains) {
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
        }
      }
    }
    const panel = document.createElement("section");
    panel.className = "analytics-consent";
    panel.setAttribute("aria-labelledby", "analytics-consent-title");
    panel.setAttribute("data-no-sport-copy", "");
    panel.innerHTML = `<div><h2 id="analytics-consent-title" tabindex="-1">Help improve Predict Playoffs</h2>
      <p>Allow Google Analytics and Microsoft Clarity to measure visits and record masked interactions? Your account and bracket work either way. <a href="${page.endsWith(".html") ? "/privacy.html" : "/privacy"}">Privacy policy</a></p></div>
      <div class="analytics-consent-actions"><button class="button button-ghost" type="button" data-analytics-choice="denied">Decline analytics</button><button class="button button-ghost" type="button" data-analytics-choice="granted">Allow analytics</button></div>`;
    panel.hidden = privacySignal || ["granted", "denied"].includes(choice);
    const header = document.getElementById("site-header");
    if (header) header.after(panel);
    else document.body.appendChild(panel);
    panel.querySelectorAll("[data-analytics-choice]").forEach(button => {
      button.addEventListener("click", () => {
        choice = button.dataset.analyticsChoice;
        try { localStorage.setItem(consentKey, choice); } catch (_error) { /* This page only. */ }
        panel.hidden = true;
        if (choice === "granted") {
          const wasStarted = started;
          start();
          if (!wasStarted) window.dispatchEvent(new Event("analytics-consent-granted"));
        } else {
          if (ga) window[`ga-disable-${ga}`] = true;
          window.clarity?.("stop");
          clearAnalyticsStorage();
          if (started) window.location.reload();
        }
      });
    });
    const footer = document.querySelector(".footer-links");
    if (footer && !privacySignal) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "analytics-settings";
      button.textContent = "Analytics settings";
      button.addEventListener("click", () => {
        panel.hidden = false;
        panel.scrollIntoView({ block: "center" });
        panel.querySelector("h2").focus({ preventScroll: true });
      });
      footer.appendChild(button);
    }
    start();
  } catch (_error) {
    // Analytics failures must never interrupt account or bracket functionality.
  }
})();
