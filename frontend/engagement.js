(function initializeEngagement() {
  try {
    const page = window.location.pathname === "/index.html" ? "/" : window.location.pathname.replace(/\.html$/, "");
    if (window.AUTH_CONFIG?.environment !== "dev" || !["/", "/nba", "/picks", "/leaderboard", "/scoring", "/privacy"].includes(page)) return;
    const permitted = () => navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;
    const sport = page === "/privacy" ? "shared" : page === "/nba" || new URL(window.location.href).searchParams.get("sport") === "nba" ? "nba" : "nfl";
    let enabled = false, running = false, pending = 0, lastTime = 0, lastActivity = 0, lastSent = 0, timer;
    const listeners = [];
    const now = () => performance.now();
    const foreground = () => document.visibilityState === "visible" && document.hasFocus();
    function stop() {
      enabled = running = false;
      pending = 0;
      clearInterval(timer);
      for (const [target, event, handler] of listeners.splice(0)) target.removeEventListener(event, handler);
    }
    function sample() {
      if (!enabled) return;
      if (!permitted()) { stop(); return; }
      const time = now();
      if (running) pending += Math.max(0, Math.min(time, lastActivity + 60_000) - lastTime);
      lastTime = time;
      running = foreground() && time < lastActivity + 60_000;
    }
    function flush() {
      if (!enabled || !permitted()) { stop(); return; }
      const milliseconds = Math.min(60_000, Math.floor(pending));
      if (!milliseconds) return;
      // One attempt: no IDs, retry queue, credentials, cookies or referrer data.
      pending = 0;
      lastSent = now();
      fetch("/api/analytics", { method: "POST", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "active_time", page, sport, milliseconds }) }).catch(() => {});
    }
    function listen(target, event, handler) {
      target.addEventListener(event, handler, { passive: true });
      listeners.push([target, event, handler]);
    }
    function interaction(event) {
      if (event.isTrusted === false) return;
      sample();
      if (!enabled) return;
      lastActivity = now();
      running = foreground();
    }
    function visibility() { sample(); if (!running && enabled) flush(); }
    function leave() { sample(); if (enabled) flush(); stop(); }
    function start() {
      if (enabled || !permitted()) return;
      enabled = true;
      lastTime = lastActivity = lastSent = now();
      running = foreground();
      for (const event of ["pointerdown", "keydown", "scroll", "touchstart"]) listen(document, event, interaction);
      listen(document, "visibilitychange", visibility);
      listen(window, "blur", visibility);
      listen(window, "focus", interaction);
      timer = setInterval(() => { sample(); if (enabled && now() - lastSent >= 30_000) flush(); }, 5_000);
    }
    window.addEventListener("pagehide", leave, { passive: true });
    window.addEventListener("pageshow", event => { if (event.persisted) start(); }, { passive: true });
    start();
  } catch (_error) { /* Measurement failures must never affect the app or sign-in. */ }
})();
