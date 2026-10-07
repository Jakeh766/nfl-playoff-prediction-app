function buildConferenceGames(seeds, picksByConference, conference) {
  const picks = picksByConference?.[conference] || {};
  const seed = (number) => {
    const name = seeds?.[conference]?.[number - 1];
    return name ? { name, seed: number } : null;
  };
  if (typeof IS_NBA !== "undefined" && IS_NBA) {
    const wildCard = [[1, 8], [4, 5], [2, 7], [3, 6]].map(([a, b]) => ({
      id: `r1-${a}-${b}`, title: `First Round · ${a} vs ${b}`, teams: [seed(a), seed(b)],
    }));
    const winner = game => game.teams.every(Boolean)
      ? game.teams.find(team => team.name === picks[game.id]) || null : null;
    const divisional = [0, 2].map((offset, index) => ({
      id: `div-${index + 1}`, title: "Conference Semifinal",
      teams: [winner(wildCard[offset]), winner(wildCard[offset + 1])],
    }));
    return { wildCard, divisional, championship: [{
      id: "conf", title: `${conference} Finals`, teams: divisional.map(winner),
    }] };
  }
  const wildCard = [
    { id: "wc-2-7", title: "Wild Card · 2 vs 7", teams: [seed(2), seed(7)] },
    { id: "wc-3-6", title: "Wild Card · 3 vs 6", teams: [seed(3), seed(6)] },
    { id: "wc-4-5", title: "Wild Card · 4 vs 5", teams: [seed(4), seed(5)] },
  ];
  const wildCardWinners = wildCard.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const remaining = [seed(1), ...wildCardWinners]
    .filter(Boolean)
    .sort((a, b) => a.seed - b.seed);
  const divisional = remaining.length === 4
    ? [
        {
          id: "div-1",
          title: "Divisional · High vs Low",
          teams: [remaining[0], remaining[3]],
        },
        {
          id: "div-2",
          title: "Divisional",
          teams: [remaining[1], remaining[2]],
        },
      ]
    : [
        { id: "div-1", title: "Divisional · High vs Low", teams: [seed(1), null] },
        { id: "div-2", title: "Divisional", teams: [null, null] },
      ];
  const divisionalWinners = divisional.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const championship = [
    {
      id: "conf",
      title: `${conference} Championship`,
      teams: divisionalWinners,
    },
  ];
  return { wildCard, divisional, championship };
}

function teamsInBracketDisplayOrder(teams) {
  if (typeof IS_NBA === "undefined" || !IS_NBA) return teams;
  return [...teams].sort((first, second) =>
    (first?.seed ?? Infinity) - (second?.seed ?? Infinity),
  );
}

function createPublicTeamPick(team, selected) {
  const row = document.createElement("div");
  row.className = "public-team-pick";
  row.classList.toggle("selected", Boolean(team && team.name === selected));

  const seed = document.createElement("span");
  seed.className = "team-seed";
  seed.textContent = team?.seed || "—";

  const logo = team
    ? createTeamLogo(team.name, "bracket-team-logo")
    : document.createElement("span");
  if (!team) logo.className = "bracket-logo-placeholder";

  const name = document.createElement("strong");
  name.className = "team-name";
  name.textContent = team?.name || "TBD";

  const check = document.createElement("span");
  check.className = "pick-check";
  check.textContent = team?.name === selected ? "✓" : "";
  row.append(seed, logo, name, check);
  return row;
}

function createPublicGameCard(conference, game, bracket) {
  const card = document.createElement("article");
  card.className = "game-card public-game-card";
  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = game.title;
  card.appendChild(title);
  const selected = bracket.picks?.[conference]?.[game.id] || "";
  teamsInBracketDisplayOrder(game.teams).forEach((team) => {
    card.appendChild(createPublicTeamPick(team, selected));
  });
  return card;
}

function createPublicConferenceBracket(conference, bracket) {
  const section = document.createElement("section");
  section.className = "public-bracket-conference";

  const heading = document.createElement("div");
  heading.className = `bracket-conference-label ${conference.toLowerCase()}-label`;
  const logo = document.createElement("img");
  logo.className = "bracket-conference-logo";
  logo.src = IS_NBA
    ? NBA_CONFERENCE_LOGOS[conference]
    : `https://a.espncdn.com/i/teamlogos/nfl/500/${conference.toLowerCase()}.png`;
  logo.alt = `${conference} logo`;
  logo.width = 64;
  logo.height = 64;
  logo.decoding = "async";
  const label = document.createElement("span");
  label.textContent = conference;
  heading.append(logo, label);

  const rounds = document.createElement("div");
  rounds.className = "public-bracket-rounds";
  const games = buildConferenceGames(bracket.seeds, bracket.picks, conference);
  [
    { key: "wildCard", label: IS_NBA ? "First Round" : "Wild Card" },
    { key: "divisional", label: IS_NBA ? "Conference Semifinals" : "Divisional" },
    { key: "championship", label: `${conference} Champion` },
  ].forEach(({ key, label: roundLabel }) => {
    const round = document.createElement("div");
    round.className = "public-bracket-round";
    const title = document.createElement("div");
    title.className = "round-label";
    title.textContent = roundLabel;
    round.appendChild(title);
    games[key].forEach((game) => {
      round.appendChild(createPublicGameCard(conference, game, bracket));
    });
    rounds.appendChild(round);
  });

  section.append(heading, rounds);
  return section;
}

function renderPublicBracket(bracket, scoringMode = "classic") {
  elements.publicBracketContent.innerHTML = "";
  const score = scoringMode === "vegas" ? bracket.vegasScore || {} : bracket.score || {};
  const scoreLabel = scoringMode === "vegas" ? "Upset Edge" : "Classic";
  const savedAt = bracket.savedAt
    ? ` · Saved ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(bracket.savedAt))}`
    : "";
  elements.publicBracketStatus.textContent = scoringMode === "vegas"
    ? `${scoreLabel}: ${formatLeaderboardScore(score.total, 2)} points${savedAt}`
    : `${scoreLabel}: ${formatLeaderboardScore(score.total)} / ${CLASSIC_MAXIMUM}${savedAt}`;

  const conferences = document.createElement("div");
  conferences.className = "public-bracket-grid";
  conferences.append(
    createPublicConferenceBracket(CONFERENCES[0], bracket),
    createPublicConferenceBracket(CONFERENCES[1], bracket),
  );

  const champion = document.createElement("section");
  champion.className = "public-champion";
  const kicker = document.createElement("p");
  kicker.className = "card-kicker";
  kicker.textContent = `${FINAL_NAME.toUpperCase()} CHAMPION`;
  const championName = bracket.picks?.superBowl || "No champion selected";
  champion.appendChild(kicker);
  if (bracket.picks?.superBowl) {
    champion.appendChild(createTeamLogo(championName, "champion-logo"));
  }
  const name = document.createElement("strong");
  name.textContent = championName;
  champion.appendChild(name);
  elements.publicBracketContent.append(conferences, champion);
}

async function openPublicBracket(entry) {
  const requestId = ++publicBracketRequest;
  const scoringMode = entry.scoringMode || state.leaderboardScoringMode || "classic";
  elements.publicBracketTitle.textContent = `${entry.leaderboardName}'s bracket.`;
  elements.publicBracketStatus.textContent = "Loading saved bracket…";
  elements.publicBracketContent.innerHTML = "";
  elements.publicBracketDialog.showModal();

  try {
    const bracket = entry.bracket || await apiRequest(
      `/api/leaderboard/${encodeURIComponent(entry.leaderboardName)}/bracket`,
    );
    if (
      !elements.publicBracketDialog.open ||
      requestId !== publicBracketRequest
    ) {
      return;
    }
    renderPublicBracket(bracket, scoringMode);
  } catch (error) {
    if (requestId !== publicBracketRequest) return;
    elements.publicBracketStatus.textContent =
      "This bracket could not be loaded. Please try again.";
    elements.publicBracketStatus.title = error.message;
  }
}

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

function renderLeaderboard() {
  const leaderboard = state.leaderboard;
  const mode = state.leaderboardScoringMode || "classic";
  const entries = rankLeaderboardEntries(leaderboard?.entries || [], mode);
  elements.leaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  updateLeaderboardScoreHeading(elements.leaderboardBody, mode);
  renderLeaderboardRows(elements.leaderboardBody, entries, mode);

  if (leaderboard) elements.leaderboardStatus.textContent = leaderboard.status;
}

const LOCAL_PREVIEW_LEADERBOARD_NAMES = [
  "Gridiron Jake",
  "Sunday Sam",
  "Fourth Down Alex",
  "Pocket Pass Pat",
  "Red Zone Riley",
  "Play Action Avery",
  "Goal Line Jordan",
  "Two Minute Taylor",
  "Blitz Pickup Blake",
  "Hail Mary Harper",
  "Sideline Casey",
  "Audible Morgan",
  "First Down Finley",
  "Wild Card Quinn",
  "Overtime Parker",
  "End Zone Emery",
];

function createPreviewPublicBracket(leaderboardName, variant = 0) {
  const rotate = (teams, amount) => {
    const shift = amount % teams.length;
    return [...teams.slice(shift), ...teams.slice(0, shift)];
  };
  const afc = rotate([
    "Kansas City Chiefs",
    "Buffalo Bills",
    "Baltimore Ravens",
    "Houston Texans",
    "Los Angeles Chargers",
    "Cincinnati Bengals",
    "Miami Dolphins",
  ], variant);
  const nfc = rotate([
    "Philadelphia Eagles",
    "Detroit Lions",
    "Los Angeles Rams",
    "Tampa Bay Buccaneers",
    "Green Bay Packers",
    "Minnesota Vikings",
    "Seattle Seahawks",
  ], variant * 2);
  const conferencePicks = (seeds) => ({
    "wc-2-7": seeds[1],
    "wc-3-6": seeds[2],
    "wc-4-5": seeds[3],
    "div-1": seeds[0],
    "div-2": seeds[1],
    conf: seeds[0],
  });
  return {
    leaderboardName,
    savedAt: Date.UTC(2026, 7, 28, 12) - variant * 60_000,
    seeds: { AFC: afc, NFC: nfc },
    picks: {
      AFC: conferencePicks(afc),
      NFC: conferencePicks(nfc),
      superBowl: variant % 2 ? nfc[0] : afc[0],
    },
    bracketBuilt: true,
    score: {
      status: "Preseason — scoring has not started",
      regularSeason: 0,
      playoffs: 0,
      total: 0,
      possible: 0,
      maximum: 300,
    },
  };
}

async function loadLeaderboard() {
  try {
    state.leaderboard = await apiRequest("/api/leaderboard");
  } catch (error) {
    if (LOCAL_PREVIEW && !IS_NBA) {
      state.leaderboard = {
        status: "Preseason — scoring has not started",
        entries: LOCAL_PREVIEW_LEADERBOARD_NAMES.map((leaderboardName) => ({
          rank: 1,
          leaderboardName,
          regularSeason: 0,
          playoffs: 0,
          total: 0,
        })),
      };
      state.leaderboard.entries.forEach((entry, index) => {
        entry.bracket = createPreviewPublicBracket(entry.leaderboardName, index);
        entry.scores = { classic: { regularSeason: 0, playoffs: 0, total: 0 },
          vegas: { regularSeason: 0, playoffs: 0, total: 0 } };
        entry.bracket.vegasScore = { total: 0 };
      });
    } else {
      state.leaderboard = null;
      elements.leaderboardStatus.textContent =
        "The leaderboard could not be loaded. Please refresh and try again.";
      elements.emptyLeaderboard.classList.add("hidden");
      elements.leaderboardTableShell.classList.add("hidden");
      elements.leaderboardStatus.title = error.message;
      return;
    }
  }
  renderLeaderboard();
}
