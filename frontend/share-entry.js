// Small bridge from the established globals to lazy, native ES modules.
// Sharing always refetches PUBLIC data, even when invoked inside a private group.
let predictionSharePending = false;
async function sharePrediction(leaderboardName, kind = "picks", mode = "classic", canShare = () => true) {
  if (predictionSharePending || !canShare()) return;
  predictionSharePending = true;
  try {
    const [sharing, bracket, board] = await Promise.all([
      import("./sharing.js"),
      apiRequest(`/api/leaderboard/${encodeURIComponent(leaderboardName)}/bracket`),
      apiRequest("/api/leaderboard").catch(() => null),
    ]);
    if (!canShare()) return;
    const entry = rankLeaderboardEntries(board?.entries || [], mode)
      .find(candidate => candidate.leaderboardName === bracket.leaderboardName);
    const season = bracket.season || board?.season || state.predictionWindow?.season;
    const seasonLabel = IS_NBA && Number(season) === NBA_SEASON.season ? NBA_SEASON.label : season;
    await sharing.openShareCard({ bracket, kind, mode, rank: entry?.rank,
      buildGames: buildConferenceGames,
      logoUrl: teamLogoUrl,
      sport: SPORT, season: seasonLabel,
      track: (event, details) => window.siteAnalytics?.track(event, details) });
  } catch (_error) {
    showToast("Could not load your bracket image. Please try again.");
  } finally {
    predictionSharePending = false;
  }
}

function createPredictionShareButton(name, kind = "picks", mode = "classic", label = kind === "results" ? "Share my results" : "Share bracket", options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary prediction-share-button";
  button.setAttribute("aria-label", label);
  // Standard connected-node share icon, kept decorative beside visible text.
  button.innerHTML = '<svg class="prediction-share-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
  const text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  button.addEventListener("click", async () => {
    if (options.canShare && !options.canShare()) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try { await sharePrediction(typeof name === "function" ? name() : name, kind, mode, options.canShare); }
    finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      options.onSettled?.();
    }
  });
  return button;
}
