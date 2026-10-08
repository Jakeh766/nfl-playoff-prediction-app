// Small bridge from the established globals to lazy, native ES modules.
// Sharing always refetches PUBLIC data, even when invoked inside a private group.
let predictionSharePending = false;
async function sharePrediction(leaderboardName, kind = "picks", mode = "classic") {
  if (predictionSharePending) return;
  predictionSharePending = true;
  try {
    const [sharing, bracket, board] = await Promise.all([
      import("./sharing.js"),
      apiRequest(`/api/leaderboard/${encodeURIComponent(leaderboardName)}/bracket`),
      apiRequest("/api/leaderboard").catch(() => null),
    ]);
    const entry = rankLeaderboardEntries(board?.entries || [], mode)
      .find(candidate => candidate.leaderboardName === bracket.leaderboardName);
    const season = bracket.season || board?.season || state.predictionWindow?.season;
    const seasonLabel = IS_NBA && Number(season) === NBA_SEASON.season ? NBA_SEASON.label : season;
    await sharing.openShareCard({ bracket, kind, mode, rank: entry?.rank,
      buildGames: buildConferenceGames,
      sport: SPORT, season: seasonLabel, origin: window.location.origin, local: LOCAL_PREVIEW,
      track: (event, details) => window.siteAnalytics?.track(event, details) });
  } catch (_error) {
    showToast("Could not load the public prediction for sharing. Please try again.");
  } finally {
    predictionSharePending = false;
  }
}

function createPredictionShareButton(name, kind = "picks", mode = "classic") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = kind === "results" ? "Share my results" : "Share my picks";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try { await sharePrediction(typeof name === "function" ? name() : name, kind, mode); }
    finally { button.disabled = false; button.removeAttribute("aria-busy"); }
  });
  return button;
}
