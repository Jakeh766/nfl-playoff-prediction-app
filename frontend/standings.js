const LEADERBOARD_SORT_META = {
  rank: { label: "Rank", numeric: true },
  player: { label: "Player", numeric: false },
  field: { label: "Field and seeding", numeric: true },
  playoffs: { label: "Playoffs", numeric: true },
  total: { label: "Total", numeric: true },
};
const DEFAULT_LEADERBOARD_SORT = { key: "rank", direction: "ascending" };
const leaderboardSortStateByBody = new WeakMap();
const leaderboardEntriesByBody = new WeakMap();
const leaderboardModeByBody = new WeakMap();

function getLeaderboardSortState(body) {
  if (!leaderboardSortStateByBody.has(body)) {
    leaderboardSortStateByBody.set(body, { ...DEFAULT_LEADERBOARD_SORT });
  }
  return leaderboardSortStateByBody.get(body);
}

function numericLeaderboardValue(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function leaderboardScore(entry, mode) {
  const score = entry.scores?.[mode];
  if (score) return score;
  if (!entry.scores || entry.scoringOption === mode || (mode === "classic" && !entry.scoringOption)) {
    return entry;
  }
  return {};
}

function leaderboardSortValue(entry, key, mode = "classic") {
  const score = leaderboardScore(entry, mode);
  switch (key) {
    case "player":
      return String(entry.leaderboardName || "");
    case "rank":
      return numericLeaderboardValue(entry.rank);
    case "field":
      return numericLeaderboardValue(score.regularSeason);
    case "playoffs":
      return numericLeaderboardValue(score.playoffs);
    case "total":
      return numericLeaderboardValue(score.total);
    default:
      return null;
  }
}

function compareLeaderboardValues(first, second, numeric, direction) {
  const firstMissing = first == null;
  const secondMissing = second == null;
  if (firstMissing || secondMissing) {
    if (firstMissing && secondMissing) return 0;
    return firstMissing ? 1 : -1;
  }
  const comparison = numeric
    ? first - second
    : String(first).localeCompare(String(second), undefined, { sensitivity: "base" });
  return comparison * direction;
}

function sortLeaderboardEntries(entries, sortState = DEFAULT_LEADERBOARD_SORT, mode = "classic") {
  const meta = LEADERBOARD_SORT_META[sortState.key] || LEADERBOARD_SORT_META.rank;
  const direction = sortState.direction === "descending" ? -1 : 1;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((first, second) => {
      const comparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, sortState.key, mode),
        leaderboardSortValue(second.entry, sortState.key, mode),
        meta.numeric,
        direction,
      );
      if (comparison) return comparison;

      const rankComparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, "rank", mode),
        leaderboardSortValue(second.entry, "rank", mode),
        true,
        1,
      );
      if (rankComparison) return rankComparison;

      const playerComparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, "player", mode),
        leaderboardSortValue(second.entry, "player", mode),
        false,
        1,
      );
      return playerComparison || first.index - second.index;
    })
    .map(({ entry }) => entry);
}

function rankLeaderboardEntries(entries, mode = "classic") {
  const ordered = [...entries].sort((first, second) => {
    for (const key of ["total", "field", "playoffs"]) {
      const comparison = compareLeaderboardValues(
        leaderboardSortValue(first, key, mode),
        leaderboardSortValue(second, key, mode),
        true,
        -1,
      );
      if (comparison) return comparison;
    }
    return compareLeaderboardValues(
      leaderboardSortValue(first, "player", mode),
      leaderboardSortValue(second, "player", mode),
      false,
      1,
    );
  });
  let previous = "", rank = null;
  return ordered.map((entry, index) => {
    const total = leaderboardSortValue(entry, "total", mode);
    const result = JSON.stringify(["total", "field", "playoffs"].map(key => leaderboardSortValue(entry, key, mode)));
    if (result !== previous) rank = index + 1;
    previous = result;
    return {
      ...entry,
      rank: total != null && total > 0 ? rank : null,
      scoringMode: mode,
    };
  });
}

function formatLeaderboardScore(value, decimals = 0) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number === 0) return "0";
  return decimals ? number.toFixed(decimals) : String(value);
}

function formatLeaderboardRank(rank) {
  if (!Number.isInteger(rank) || rank < 1) return "—";
  if (rank <= 3) return ["🥇", "🥈", "🥉"][rank - 1];
  return String(rank);
}

function leaderboardChampion(entry) {
  return entry.superBowl || entry.bracket?.picks?.superBowl || "";
}

function createLeaderboardChampionCell(entry) {
  const cell = document.createElement("td");
  cell.className = "leaderboard-champion";
  const champion = leaderboardChampion(entry);
  if (!champion) {
    cell.textContent = "—";
    cell.setAttribute("aria-label", `No ${FINAL_NAME} pick`);
    return cell;
  }

  const pick = document.createElement("div");
  pick.className = "leaderboard-champion-pick";
  const logo = createTeamLogo(champion, "leaderboard-champion-logo");
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  pick.appendChild(logo);
  cell.appendChild(pick);
  cell.setAttribute("aria-label", `${FINAL_NAME} pick: ${champion}`);
  return cell;
}

function seasonStatusText(status, now = Date.now()) {
  if (!status?.startsWith("Preseason")) return status || "";
  // Keep the NFL fallback aligned with prediction_lock_at in terraform/envs/*/terraform.tfvars.
  const seasonStart = state.predictionWindow?.lockAt
    || (IS_NBA ? NBA_SEASON.lockAt : "2026-09-10T00:20:00Z");
  const serverNow = now + (state.predictionClockOffset || 0);
  return serverNow < Date.parse(seasonStart) ? status : "";
}
