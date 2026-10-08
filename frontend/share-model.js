// Only public, explicitly selected fields may cross into the image/share payload.
export function publicPlayerName(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 24 ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._'’\-]*[A-Za-z0-9]$/.test(value)) {
    throw new Error("A public leaderboard name is required to share picks.");
  }
  return value;
}

export function publicPredictionUrl({ origin, player, sport, local = false }) {
  const url = new URL(local ? "/leaderboard.html" : "/leaderboard", origin);
  // Rebuild from the origin: never carry invite codes, group IDs, or auth parameters.
  url.searchParams.set("player", publicPlayerName(player));
  if (sport === "nba") url.searchParams.set("sport", "nba");
  return url.href;
}

export function hasScoring(score) {
  return Number.isFinite(score?.possible) && score.possible > 0;
}

export function createShareModel({ bracket, sport, season, kind = "picks", mode = "classic", rank = null, origin, local }) {
  const player = publicPlayerName(bracket.leaderboardName);
  const nba = sport === "nba";
  const conferences = nba ? ["West", "East"] : ["AFC", "NFC"];
  const team = value => typeof value === "string" ? value.slice(0, 64) : "";
  const score = mode === "vegas" ? bracket.vegasScore : bracket.score;
  const results = kind === "results" && hasScoring(score);
  const status = ["alive", "eliminated", "won"].includes(bracket.championStatus) ? bracket.championStatus : null;
  return Object.freeze({
    player, sport: nba ? "NBA" : "NFL", season: String(season || "").slice(0, 16),
    kind: results ? "results" : "picks", mode: mode === "vegas" ? "Upset Edge" : "Classic",
    champion: team(bracket.picks?.superBowl), final: nba ? "NBA Finals" : "Super Bowl",
    matchup: conferences.map(c => team(bracket.picks?.[c]?.conf)),
    seeds: conferences.map(c => ({ conference: c, team: team(bracket.seeds?.[c]?.[0]) })),
    total: results && Number.isFinite(score.total) ? score.total : null,
    rank: results && Number.isInteger(rank) && rank > 0 ? rank : null,
    championStatus: results ? status : null,
    // `maximum` is the system ceiling, NOT the player's remaining potential.
    url: publicPredictionUrl({ origin, player, sport, local }),
  });
}

export function nativeSharePayload(model, file, navigator) {
  if (!navigator.share) return null;
  const base = { title: `${model.player}'s Predict Playoffs ${model.kind === "results" ? "results" : "picks"}`, url: model.url };
  try {
    if (file && navigator.canShare?.({ files: [file] })) return { ...base, files: [file] };
  } catch (_error) { /* File sharing can be disabled by browser policy. */ }
  return base;
}
