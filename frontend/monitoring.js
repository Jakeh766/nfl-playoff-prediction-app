(function initializeSiteAnalytics() {
  try {
    const config = window.AUTH_CONFIG || {};
    const page = window.location.pathname === "/index.html" ? "/" :
      window.location.pathname.replace(/\.html$/, "");
    const pages = new Set(["/", "/nba", "/leaderboard", "/picks", "/scoring", "/privacy"]);
    const permitted = () => ["dev", "prod"].includes(config.environment) && pages.has(page) &&
      navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;
    const events = new Set(["account_created", "account_deleted", "sign_in", "prediction_saved",
      "group_created", "group_joined", "group_invite_joined", "bracket_created", "bracket_completed"]);
    const bracketEvents = new Set(["bracket_created", "bracket_completed", "prediction_saved"]);
    function track(event, details = {}) {
      try {
        if (!permitted() || !events.has(event)) return;
        const payload = { event, page };
        if (bracketEvents.has(event)) {
          if (!["nfl", "nba"].includes(details.bracketType)) return;
          payload.bracketType = details.bracketType;
        }
        fetch("/api/analytics", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
        }).catch(() => {});
      } catch (_error) { /* Analytics must never interrupt the application. */ }
    }
    window.siteAnalytics = { track };
  } catch (_error) { /* Fail closed without touching authentication storage. */ }
})();
