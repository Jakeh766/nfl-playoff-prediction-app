// Only public, explicitly selected fields may cross into the image/share payload.
export function publicPlayerName(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 24 ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._'’\-]*[A-Za-z0-9]$/.test(value)) {
    throw new Error("A public leaderboard name is required to share a bracket.");
  }
  return value;
}

export function hasScoring(score) {
  return Number.isFinite(score?.possible) && score.possible > 0;
}

export function createShareModel({ bracket, sport, season, kind = "picks", mode = "classic", rank = null, buildGames }) {
  const player = publicPlayerName(bracket.leaderboardName);
  const nba = sport === "nba";
  const conferences = nba ? ["West", "East"] : ["AFC", "NFC"];
  const team = value => typeof value === "string" ? value.slice(0, 64) : "";
  if (typeof buildGames !== "function") throw new Error("Bracket rules are unavailable. Please reload and try again.");
  const gameIds = nba ? ["r1-1-8", "r1-4-5", "r1-2-7", "r1-3-6", "div-1", "div-2", "conf"]
    : ["wc-2-7", "wc-3-6", "wc-4-5", "div-1", "div-2", "conf"];
  const seeds = Object.fromEntries(conferences.map(c => [c,
    Array.from({ length: nba ? 8 : 7 }, (_, index) => team(bracket.seeds?.[c]?.[index]))]));
  const picks = Object.fromEntries(conferences.map(c => [c,
    Object.fromEntries(gameIds.map(id => [id, team(bracket.picks?.[c]?.[id])]))]));
  const publicTeam = entry => entry?.name ? { name: team(entry.name),
    seed: Number.isInteger(entry.seed) && entry.seed >= 1 && entry.seed <= (nba ? 8 : 7) ? entry.seed : null } : null;
  const bracketConferences = conferences.map(c => {
    // Reuse the exact NFL reseeding / NBA fixed-bracket rules used on the page.
    const games = buildGames(seeds, picks, c);
    return {
      name: c,
      seeds: seeds[c].map((name, index) => name ? { name, seed: index + 1 } : null),
      rounds: ["wildCard", "divisional", "championship"].map(key => ({
        key,
        games: Array.from(games[key], game => {
          const teams = Array.from(game.teams.slice(0, 2), publicTeam);
          if (nba) teams.sort((a, b) => (a?.seed ?? Infinity) - (b?.seed ?? Infinity));
          return { id: game.id, teams,
            selected: teams.some(t => t?.name === picks[c][game.id]) ? picks[c][game.id] : "" };
        }),
      })),
    };
  });
  const score = mode === "vegas" ? bracket.vegasScore : bracket.score;
  const results = kind === "results" && hasScoring(score);
  const status = ["alive", "eliminated", "won"].includes(bracket.championStatus) ? bracket.championStatus : null;
  return Object.freeze({
    player, sport: nba ? "NBA" : "NFL", season: String(season || "").slice(0, 16),
    kind: results ? "results" : "picks", mode: mode === "vegas" ? "Upset Edge" : "Classic",
    champion: team(bracket.picks?.superBowl), final: nba ? "NBA Finals" : "Super Bowl",
    matchup: conferences.map(c => team(bracket.picks?.[c]?.conf)),
    conferences: bracketConferences,
    total: results && Number.isFinite(score.total) ? score.total : null,
    rank: results && Number.isInteger(rank) && rank > 0 ? rank : null,
    championStatus: results ? status : null,
    // `maximum` is the system ceiling, NOT the player's remaining potential.
  });
}

export function nativeSharePayload(model, file, navigator) {
  if (!file || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  try {
    if (navigator.canShare({ files: [file] })) return {
      title: `${model.player}'s Predict Playoffs bracket${model.kind === "results" ? " results" : ""}`,
      files: [file],
    };
  } catch (_error) { /* File sharing can be disabled by browser policy. */ }
  return null;
}
