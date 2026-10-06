(function initializeEngagement() {
  try {
    const page = window.location.pathname === "/index.html" ? "/" : window.location.pathname.replace(/\.html$/, "");
    if (window.AUTH_CONFIG?.environment !== "dev" || !["/", "/nba", "/picks", "/leaderboard", "/scoring", "/privacy"].includes(page)) return;
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    const permitted = () => navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;
    const sport = page === "/privacy" ? "shared" : page === "/nba" || new URL(window.location.href).searchParams.get("sport") === "nba" ? "nba" : "nfl";
    const panel = document.createElement("div");
    panel.className = "engagement-choice";
    panel.setAttribute("data-no-sport-copy", "");
    const description = document.createElement("p");
    description.textContent = "Optional: share estimated active time on this page with Predict Playoffs to help improve it. We count visible, focused time and pause after 1 minute idle. No typed text, recordings, cookies or visitor IDs. Permission ends when you leave this page.";
    description.id = "engagement-description";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-ghost";
    button.setAttribute("aria-describedby", description.id);
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    panel.append(description, button, status);
    footer.append(panel);

    let enabled = false, running = false, pending = 0, lastTime = 0, lastActivity = 0, lastSent = 0, timer;
    const listeners = [];
    const now = () => performance.now();
    const foreground = () => document.visibilityState === "visible" && document.hasFocus();
    function paint() {
      button.textContent = enabled ? "Stop active-time measurement" : "Allow active-time measurement for this page";
      button.disabled = !permitted();
      status.textContent = !permitted() ? "Off — your privacy signal prevents collection." : enabled ? "On for this page only." : "Off. Nothing is collected until you allow it.";
    }
    function stop() {
      enabled = running = false;
      pending = 0;
      clearInterval(timer);
      for (const [target, event, handler] of listeners.splice(0)) target.removeEventListener(event, handler);
      paint();
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
        body: JSON.stringify({ event: "active_time", page, sport, milliseconds, consent: "active-time-v1" }) }).catch(() => {});
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
    button.addEventListener("click", () => {
      if (enabled) { stop(); return; }
      if (!permitted()) { paint(); return; }
      enabled = true;
      lastTime = lastActivity = lastSent = now();
      running = foreground();
      for (const event of ["pointerdown", "keydown", "scroll", "touchstart"]) listen(document, event, interaction);
      listen(document, "visibilitychange", visibility);
      listen(window, "blur", visibility);
      listen(window, "focus", interaction);
      listen(window, "pagehide", leave);
      timer = setInterval(() => { sample(); if (enabled && now() - lastSent >= 30_000) flush(); }, 5_000);
      paint();
    });
    paint();
  } catch (_error) { /* Measurement failures must never affect the app or sign-in. */ }
})();
