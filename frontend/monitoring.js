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

    if (!crypto.randomUUID) return;

    let visitorId;
    let sessionId;
    const firstPartyEvents = new Set([
      "page_view", "account_created", "sign_in", "prediction_saved",
      "group_created", "group_joined", "group_invite_joined",
    ]);

    function track(event) {
      try {
        window.productAnalytics?.track(event);
        if (window.productAnalytics && !window.productAnalytics.allowed()) return;
        if (!firstPartyEvents.has(event)) return;
        visitorId ||= getOrCreateId(localStorage, "rtb_visitor_id");
        sessionId ||= getOrCreateId(sessionStorage, "rtb_session_id");
        fetch("/api/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event,
            page: window.location.pathname,
            sessionId,
            visitorId,
          }),
          credentials: "omit",
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
    window.addEventListener("analytics-consent-granted", () => track("page_view"));
  } catch (_error) {
    // Storage and privacy restrictions should disable analytics silently.
  }
})();
