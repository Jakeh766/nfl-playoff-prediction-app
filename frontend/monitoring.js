(function initializeSiteAnalytics() {
  try {
    const config = window.AUTH_CONFIG || {};
    const page = window.location.pathname === "/index.html" ? "/" :
      window.location.pathname.replace(/\.html$/, "");
    const pages = new Set(["/", "/nba", "/leaderboard", "/picks", "/scoring", "/privacy"]);
    const permitted = () => ["dev", "prod"].includes(config.environment) && pages.has(page) &&
      navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;
    if (["dev", "prod"].includes(config.environment) && pages.has(page)) {
      // One-way migration: remove only legacy analytics data, never auth/drafts.
      for (const store of ["localStorage", "sessionStorage"]) {
        try {
          for (const key of ["pp_analytics_consent_v1", "rtb_visitor_id", "rtb_session_id"]) {
            window[store].removeItem(key);
          }
        } catch (_error) { /* Each store is independent; restricted storage is safe. */ }
      }
      try {
        const host = window.location.hostname;
        const domains = ["", host, ...host.split(".").map((_, index, parts) =>
          "." + parts.slice(index).join(".")).filter(domain => domain.split(".").length > 2)];
        for (const cookie of document.cookie.split(";")) {
          const name = cookie.trim().split("=")[0];
          if (!/^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_clck$|_clsk$|_cltk$)/.test(name)) continue;
          for (const domain of domains) {
            document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
          }
        }
      } catch (_error) { /* Analytics cleanup must not interrupt authentication. */ }
    }
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
