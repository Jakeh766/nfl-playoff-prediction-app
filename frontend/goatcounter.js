(function initializeGoatCounter() {
  try {
    const pages = new Set(["/", "/index.html", "/nba", "/nba.html", "/picks", "/picks.html",
      "/leaderboard", "/leaderboard.html", "/scoring", "/scoring.html", "/privacy", "/privacy.html"]);
    const permitted = () => window.AUTH_CONFIG?.environment === "dev" &&
      navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl &&
      pages.has(window.location.pathname) && window.location.hash !== "#toggle-goatcounter";
    if (!permitted()) return;

    const page = window.location.pathname;
    const title = `Predict Playoffs — ${page === "/" ? "home" : page.slice(1).replace(/\.html$/, "")}`;
    let referrer = "";
    try {
      const url = new URL(document.referrer);
      if (["https:", "http:"].includes(url.protocol)) referrer = url.origin;
    } catch (_error) { /* Empty or invalid referrers stay empty. */ }

    // count.js sends location.search as a separate q field even with a custom path.
    // Disable automatic pageviews/events until the outgoing data is allowlisted.
    window.goatcounter = { no_onload: true, no_events: true, path: page, title, referrer };
    const script = document.createElement("script");
    script.dataset.goatcounter = "https://predictplayoffs.goatcounter.com/count";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = "//gc.zgo.at/count.js";
    script.onload = () => {
      try {
        const counter = window.goatcounter;
        const getData = counter.get_data;
        // Retain local/frame/prerender protection without reading a storage toggle.
        counter.filter = () => {
          if (document.visibilityState === "prerender") return true;
          if (window.location !== window.parent.location) return true;
          return window.location.protocol === "file:" ||
            /(localhost$|^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^192\.168\.|^0\.0\.0\.0$)/.test(window.location.hostname);
        };
        counter.get_data = () => {
          const data = getData();
          // Ignore caller overrides, query strings, and any new provider fields.
          return { p: page, t: title, r: referrer,
            s: Number.isFinite(data.s) ? data.s : 0,
            b: Number.isFinite(data.b) ? data.b : 0 };
        };
        counter.count = () => {
          try {
            if (!permitted() || counter.filter()) return;
            // sendBeacon has no referrer-policy option. Use an explicit policy for
            // the count request as well as the script; never send cookies or auth.
            fetch(counter.url(), { method: "POST", mode: "no-cors", keepalive: true,
              credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
          } catch (_error) { /* Analytics must not interrupt the app. */ }
        };
        function countVisiblePage() {
          if (document.visibilityState && document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", countVisiblePage);
          counter.count();
        }
        document.addEventListener("visibilitychange", countVisiblePage);
        countVisiblePage();
      } catch (_error) { /* Provider errors fail closed. */ }
    };
    document.head.appendChild(script);
  } catch (_error) { /* Analytics failures must never affect account or bracket functionality. */ }
})();
