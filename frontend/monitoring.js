(function initializeSiteAnalytics() {
  try {
    const config = window.AUTH_CONFIG || {};
    if (
      !["dev", "prod"].includes(config.environment) ||
      navigator.doNotTrack === "1" ||
      navigator.globalPrivacyControl
    ) {
      return;
    }

    function getOrCreateId(storage, key) {
      try {
        const existing = storage.getItem(key);
        if (existing) return existing;
        const value = crypto.randomUUID();
        storage.setItem(key, value);
        return value;
      } catch (_error) {
        return crypto.randomUUID();
      }
    }

    let visitorId;
    let sessionId;
    const firstPartyEvents = new Set([
      "page_view", "account_created", "sign_in", "prediction_saved",
      "group_created", "group_joined", "group_invite_joined",
      "bracket_started", "bracket_completed", "leaderboard_viewed",
    ]);
    const page = window.location.pathname === "/index.html" ? "/" :
      window.location.pathname.replace(/\.html$/, "");
    if (!["/", "/nba", "/leaderboard", "/picks", "/scoring", "/privacy"].includes(page)) return;

    function track(event) {
      try {
        window.productAnalytics?.track(event);
        if (window.productAnalytics && !window.productAnalytics.aggregateAllowed()) return;
        if (!firstPartyEvents.has(event)) return;
        const payload = { event, page };
        if (window.productAnalytics?.allowed() && window.crypto?.randomUUID) {
          visitorId ||= getOrCreateId(localStorage, "rtb_visitor_id");
          sessionId ||= getOrCreateId(sessionStorage, "rtb_session_id");
          Object.assign(payload, { sessionId, visitorId });
        } else {
          visitorId = sessionId = undefined;
        }
        fetch("/api/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "omit",
          referrerPolicy: "no-referrer",
          keepalive: true,
        }).catch(() => {
          // Monitoring must never interrupt the application experience.
        });
      } catch (_error) {
        // Tracking must also survive synchronous storage or network failures.
      }
    }

    window.siteAnalytics = { track };
    track("page_view");
    if (document.body.dataset.page === "leaderboard") track("leaderboard_viewed");
    window.addEventListener("analytics-consent-declined", () => { visitorId = sessionId = undefined; });
    window.addEventListener("analytics-consent-granted", () => {
      // This visit was already counted by first-party analytics before consent.
      window.productAnalytics?.track("page_view");
      if (document.body.dataset.page === "leaderboard") window.productAnalytics?.track("leaderboard_viewed");
    });
  } catch (_error) {
    // Storage and privacy restrictions should disable analytics silently.
  }
})();
