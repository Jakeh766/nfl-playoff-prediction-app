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

    const visitorId = getOrCreateId(localStorage, "rtb_visitor_id");
    const sessionId = getOrCreateId(sessionStorage, "rtb_session_id");

    function track(event) {
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
    }

    window.siteAnalytics = { track };
    track("page_view");
  } catch (_error) {
    // Storage and privacy restrictions should disable analytics silently.
  }
})();
