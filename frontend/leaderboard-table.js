function updateLeaderboardSortIndicators(body, sortState) {
  const table = typeof body.closest === "function" ? body.closest("table") : null;
  if (!table) return;
  table.querySelectorAll("th[data-sort-key]").forEach((header) => {
    const key = header.dataset.sortKey;
    const active = key === sortState.key;
    const direction = active ? sortState.direction : "none";
    header.setAttribute("aria-sort", direction);
    const button = header.querySelector("button[data-sort-key]");
    if (!button) return;
    const label = button.dataset.sortLabel || button.textContent.trim();
    const nextDirection = active
      ? direction === "ascending" ? "descending" : "ascending"
      : LEADERBOARD_SORT_META[key]?.numeric ? "descending" : "ascending";
    button.setAttribute("aria-label", `Sort by ${label}, ${nextDirection}`);
    button.title = `Sort by ${label} (${nextDirection})`;
  });
}

function bindLeaderboardSortControls(body) {
  const table = typeof body.closest === "function" ? body.closest("table") : null;
  if (!table) return;
  table.querySelectorAll("button[data-sort-key]").forEach((button) => {
    if (button.dataset.sortBound === "true") return;
    button.dataset.sortBound = "true";
    button.addEventListener("click", () => {
      const key = button.dataset.sortKey;
      const current = getLeaderboardSortState(body);
      const direction = current.key === key
        ? current.direction === "ascending" ? "descending" : "ascending"
        : LEADERBOARD_SORT_META[key]?.numeric ? "descending" : "ascending";
      leaderboardSortStateByBody.set(body, { key, direction });
      renderLeaderboardRows(
        body,
        leaderboardEntriesByBody.get(body) || [],
        leaderboardModeByBody.get(body) || "classic",
      );
    });
  });
}

function renderLeaderboardRows(body, entries, mode = "classic") {
  leaderboardEntriesByBody.set(body, entries);
  leaderboardModeByBody.set(body, mode);
  bindLeaderboardSortControls(body);
  const sortState = getLeaderboardSortState(body);
  updateLeaderboardSortIndicators(body, sortState);
  body.innerHTML = "";
  const limit = Number(body.dataset.limit || 0);
  const sortedEntries = sortLeaderboardEntries(entries, sortState, mode);
  const visibleEntries = limit > 0 ? sortedEntries.slice(0, limit) : sortedEntries;
  visibleEntries.forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "leaderboard-row";
    const hasPrediction = entry.hasPrediction !== false;
    row.dataset.hasPrediction = String(hasPrediction);
    if (hasPrediction) row.addEventListener("click", () => openPublicBracket(entry));
    const rank = document.createElement("td");
    rank.className = "leaderboard-rank";
    rank.textContent = formatLeaderboardRank(entry.rank);
    rank.setAttribute(
      "aria-label",
      entry.rank == null ? "Not yet ranked" : `Rank ${entry.rank}`,
    );

    const player = document.createElement("th");
    player.scope = "row";
    const playerButton = document.createElement("button");
    playerButton.className = "leaderboard-player-button";
    playerButton.type = "button";
    const playerName = document.createElement("strong");
    playerName.textContent = entry.leaderboardName + (entry.isCommissioner ? " · Commissioner" : "");
    playerButton.disabled = !hasPrediction;
    playerButton.appendChild(playerName);
    if (hasPrediction) {
      playerButton.setAttribute("aria-label", `View bracket for ${entry.leaderboardName}`);
    } else {
      const status = document.createElement("span");
      status.textContent = "No prediction";
      playerButton.appendChild(status);
    }
    player.appendChild(playerButton);

    const champion = createLeaderboardChampionCell(entry);
    const score = leaderboardScore(entry, mode);
    const decimals = mode === "vegas" ? 2 : 0;
    const regularSeason = document.createElement("td");
    regularSeason.textContent = formatLeaderboardScore(score.regularSeason, decimals);
    const playoffs = document.createElement("td");
    playoffs.textContent = formatLeaderboardScore(score.playoffs, decimals);
    const total = document.createElement("td");
    total.className = "leaderboard-total";
    total.textContent = formatLeaderboardScore(score.total, decimals);
    row.append(rank, player, champion, regularSeason, playoffs, total);
    body.appendChild(row);
  });
}

function updateLeaderboardScoreHeading(body, mode) {
  const table = typeof body.closest === "function" ? body.closest("table") : null;
  const button = table?.querySelector('button[data-sort-key="total"]');
  if (!button) return;
  const label = mode === "vegas" ? "Upset Edge total" : "Classic total";
  const visibleLabel = button.querySelector("[data-score-label]");
  if (visibleLabel) visibleLabel.textContent = label;
  button.dataset.sortLabel = label;
}

function selectLeaderboardScoringMode(mode) {
  if (!(["classic", "vegas"].includes(mode))) return;
  state.leaderboardScoringMode = mode;
  for (const [button, buttonMode] of [
    [elements.classicLeaderboardMode, "classic"],
    [elements.upsetLeaderboardMode, "vegas"],
  ]) {
    if (!button) continue;
    const selected = mode === buttonMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  renderLeaderboard();
}
