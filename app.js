const TEAMS = {
  AFC: [
    "Baltimore Ravens",
    "Buffalo Bills",
    "Cincinnati Bengals",
    "Cleveland Browns",
    "Denver Broncos",
    "Houston Texans",
    "Indianapolis Colts",
    "Jacksonville Jaguars",
    "Kansas City Chiefs",
    "Las Vegas Raiders",
    "Los Angeles Chargers",
    "Miami Dolphins",
    "New England Patriots",
    "New York Jets",
    "Pittsburgh Steelers",
    "Tennessee Titans",
  ],
  NFC: [
    "Arizona Cardinals",
    "Atlanta Falcons",
    "Carolina Panthers",
    "Chicago Bears",
    "Dallas Cowboys",
    "Detroit Lions",
    "Green Bay Packers",
    "Los Angeles Rams",
    "Minnesota Vikings",
    "New Orleans Saints",
    "New York Giants",
    "Philadelphia Eagles",
    "San Francisco 49ers",
    "Seattle Seahawks",
    "Tampa Bay Buccaneers",
    "Washington Commanders",
  ],
};

const TEAM_DIVISIONS = {
  "Baltimore Ravens": "AFC North",
  "Buffalo Bills": "AFC East",
  "Cincinnati Bengals": "AFC North",
  "Cleveland Browns": "AFC North",
  "Denver Broncos": "AFC West",
  "Houston Texans": "AFC South",
  "Indianapolis Colts": "AFC South",
  "Jacksonville Jaguars": "AFC South",
  "Kansas City Chiefs": "AFC West",
  "Las Vegas Raiders": "AFC West",
  "Los Angeles Chargers": "AFC West",
  "Miami Dolphins": "AFC East",
  "New England Patriots": "AFC East",
  "New York Jets": "AFC East",
  "Pittsburgh Steelers": "AFC North",
  "Tennessee Titans": "AFC South",
  "Arizona Cardinals": "NFC West",
  "Atlanta Falcons": "NFC South",
  "Carolina Panthers": "NFC South",
  "Chicago Bears": "NFC North",
  "Dallas Cowboys": "NFC East",
  "Detroit Lions": "NFC North",
  "Green Bay Packers": "NFC North",
  "Los Angeles Rams": "NFC West",
  "Minnesota Vikings": "NFC North",
  "New Orleans Saints": "NFC South",
  "New York Giants": "NFC East",
  "Philadelphia Eagles": "NFC East",
  "San Francisco 49ers": "NFC West",
  "Seattle Seahawks": "NFC West",
  "Tampa Bay Buccaneers": "NFC South",
  "Washington Commanders": "NFC East",
};

const DIVISION_ORDER = ["North", "South", "East", "West"];

const DIVISION_TEAMS = {
  AFC: {
    North: ["Baltimore Ravens", "Cincinnati Bengals", "Cleveland Browns", "Pittsburgh Steelers"],
    South: ["Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Tennessee Titans"],
    East: ["Buffalo Bills", "Miami Dolphins", "New England Patriots", "New York Jets"],
    West: ["Kansas City Chiefs", "Los Angeles Chargers", "Denver Broncos", "Las Vegas Raiders"],
  },
  NFC: {
    North: ["Minnesota Vikings", "Green Bay Packers", "Chicago Bears", "Detroit Lions"],
    South: ["Tampa Bay Buccaneers", "Atlanta Falcons", "New Orleans Saints", "Carolina Panthers"],
    East: ["Philadelphia Eagles", "Dallas Cowboys", "Washington Commanders", "New York Giants"],
    West: ["San Francisco 49ers", "Los Angeles Rams", "Seattle Seahawks", "Arizona Cardinals"],
  },
};

const TEAM_LOGO_CODES = {
  "Arizona Cardinals": "ari",
  "Atlanta Falcons": "atl",
  "Baltimore Ravens": "bal",
  "Buffalo Bills": "buf",
  "Carolina Panthers": "car",
  "Chicago Bears": "chi",
  "Cincinnati Bengals": "cin",
  "Cleveland Browns": "cle",
  "Dallas Cowboys": "dal",
  "Denver Broncos": "den",
  "Detroit Lions": "det",
  "Green Bay Packers": "gb",
  "Houston Texans": "hou",
  "Indianapolis Colts": "ind",
  "Jacksonville Jaguars": "jax",
  "Kansas City Chiefs": "kc",
  "Las Vegas Raiders": "lv",
  "Los Angeles Chargers": "lac",
  "Los Angeles Rams": "lar",
  "Miami Dolphins": "mia",
  "Minnesota Vikings": "min",
  "New England Patriots": "ne",
  "New Orleans Saints": "no",
  "New York Giants": "nyg",
  "New York Jets": "nyj",
  "Philadelphia Eagles": "phi",
  "Pittsburgh Steelers": "pit",
  "San Francisco 49ers": "sf",
  "Seattle Seahawks": "sea",
  "Tampa Bay Buccaneers": "tb",
  "Tennessee Titans": "ten",
  "Washington Commanders": "wsh",
};

const FALLBACK_WIN_TOTALS = {
  "Arizona Cardinals": 4.5,
  "Atlanta Falcons": 7.5,
  "Baltimore Ravens": 11.5,
  "Buffalo Bills": 10.5,
  "Carolina Panthers": 7.5,
  "Chicago Bears": 9.5,
  "Cincinnati Bengals": 8.5,
  "Cleveland Browns": 6.5,
  "Dallas Cowboys": 8.5,
  "Denver Broncos": 9.5,
  "Detroit Lions": 10.5,
  "Green Bay Packers": 10.5,
  "Houston Texans": 9.5,
  "Indianapolis Colts": 7.5,
  "Jacksonville Jaguars": 8.5,
  "Kansas City Chiefs": 10.5,
  "Las Vegas Raiders": 6.5,
  "Los Angeles Chargers": 10.5,
  "Los Angeles Rams": 11.5,
  "Miami Dolphins": 4.5,
  "Minnesota Vikings": 7.5,
  "New England Patriots": 9.5,
  "New Orleans Saints": 6.5,
  "New York Giants": 7.5,
  "New York Jets": 5.5,
  "Philadelphia Eagles": 10.5,
  "Pittsburgh Steelers": 8.5,
  "San Francisco 49ers": 10.5,
  "Seattle Seahawks": 11.5,
  "Tampa Bay Buccaneers": 8.5,
  "Tennessee Titans": 6.5,
  "Washington Commanders": 7.5,
};

const STORAGE_KEY = "road-to-bowl-predictions-v1";

function createEmptyDivisionWinners() {
  return {
    AFC: { North: "", South: "", East: "", West: "" },
    NFC: { North: "", South: "", East: "", West: "" },
  };
}

const state = {
  profileKey: "",
  displayName: "",
  winTotals: { ...FALLBACK_WIN_TOTALS },
  oddsSource: "2026 sportsbook snapshot",
  divisionWinners: createEmptyDivisionWinners(),
  seeds: { AFC: Array(7).fill(""), NFC: Array(7).fill("") },
  picks: { AFC: {}, NFC: {}, superBowl: "" },
  bracketBuilt: false,
  savedAt: null,
};

const elements = {
  form: document.querySelector("#profile-form"),
  playerName: document.querySelector("#player-name"),
  namePreview: document.querySelector("#name-preview strong"),
  predictor: document.querySelector("#predictor"),
  welcomeName: document.querySelector("#welcome-name"),
  profileNameDisplay: document.querySelector("#profile-name-display"),
  oddsStatus: document.querySelector("#odds-status"),
  afcSeeds: document.querySelector("#afc-seeds"),
  nfcSeeds: document.querySelector("#nfc-seeds"),
  seedingMessage: document.querySelector("#seeding-message"),
  buildBracket: document.querySelector("#build-bracket"),
  bracketSection: document.querySelector("#bracket-section"),
  afcBracket: document.querySelector("#afc-bracket"),
  nfcBracket: document.querySelector("#nfc-bracket"),
  superBowlStatus: document.querySelector("#super-bowl-status"),
  superBowlGame: document.querySelector("#super-bowl-game"),
  championDisplay: document.querySelector("#champion-display"),
  savePrediction: document.querySelector("#save-prediction"),
  resetPicks: document.querySelector("#reset-picks"),
  switchProfile: document.querySelector("#switch-profile"),
  saveState: document.querySelector("#save-state"),
  savedGrid: document.querySelector("#saved-grid"),
  emptyLocker: document.querySelector("#empty-locker"),
  toast: document.querySelector("#toast"),
};

function getStoredPredictions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function createEmptyPicks() {
  return { AFC: {}, NFC: {}, superBowl: "" };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTeamNickname(teamName) {
  return teamName.split(" ").at(-1);
}

function teamLogoUrl(teamName) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${TEAM_LOGO_CODES[teamName]}.png`;
}

function createTeamLogo(teamName, className = "team-logo") {
  const logo = document.createElement("img");
  logo.className = className;
  logo.src = teamLogoUrl(teamName);
  logo.alt = `${teamName} logo`;
  logo.loading = "lazy";
  logo.addEventListener("error", () => logo.classList.add("logo-error"));
  return logo;
}

function seedTeam(conference, seed) {
  const name = state.seeds[conference][seed - 1];
  return name ? { name, seed } : null;
}

function projectedWins(team) {
  return Number(state.winTotals[team] ?? 0);
}

function sortTeamsByProjection(teams) {
  return [...teams].sort(
    (a, b) => projectedWins(b) - projectedWins(a) || a.localeCompare(b),
  );
}

function appendDivisionGroupedOptions(select, conference, teams, selectedTeam) {
  const teamSet = new Set(teams);

  DIVISION_ORDER.forEach((division) => {
    const divisionTeams = sortTeamsByProjection(
      DIVISION_TEAMS[conference][division].filter((team) => teamSet.has(team)),
    );
    if (!divisionTeams.length) return;

    const group = document.createElement("optgroup");
    group.label = `${conference} ${division}`;

    divisionTeams.forEach((team) => {
      const option = document.createElement("option");
      option.value = team;
      option.textContent =
        selectedTeam === team
          ? team
          : `${team} (${projectedWins(team).toFixed(1)} proj)`;
      option.selected = selectedTeam === team;
      group.appendChild(option);
    });

    select.appendChild(group);
  });
}

function appendProjectedOptions(select, teams, selectedTeam) {
  sortTeamsByProjection(teams).forEach((team) => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent =
      selectedTeam === team
        ? team
        : `${team} (${projectedWins(team).toFixed(1)} proj)`;
    option.selected = selectedTeam === team;
    select.appendChild(option);
  });
}

async function loadWinTotals() {
  elements.oddsStatus.textContent =
    "Using the bundled 2026 sportsbook snapshot while live odds load…";

  try {
    const response = await fetch("/api/win-totals", { cache: "no-store" });
    if (!response.ok) throw new Error("Odds endpoint unavailable");

    const data = await response.json();
    if (data.apiVersion !== 2) {
      throw new Error("The odds server is outdated. Restart server.py.");
    }
    if (!data.totals || Object.keys(data.totals).length < 32) {
      throw new Error("Incomplete odds response");
    }

    state.winTotals = { ...FALLBACK_WIN_TOTALS, ...data.totals };
    state.oddsSource = data.source;
    const sourceLabel =
      data.status === "live"
        ? "Live"
        : data.status === "cached"
          ? "Cached"
          : "Fallback";
    elements.oddsStatus.textContent = `${sourceLabel} projected wins from ${data.source}. Teams are ranked within each division.`;
    elements.oddsStatus.title = data.message || "";
  } catch (error) {
    const isStaleServer = error.message.includes("outdated");
    elements.oddsStatus.textContent = isStaleServer
      ? "Odds server is outdated. Stop it, restart server.py, then refresh this page."
      : "Projected wins use the bundled 2026 sportsbook snapshot. Run through server.py for live refreshes.";
    elements.oddsStatus.title = error.message;
  }

  if (!elements.predictor.classList.contains("hidden")) {
    renderSeedSelectors();
  }
}

function renderSeedSelectors() {
  renderConferenceSeeds("AFC", elements.afcSeeds);
  renderConferenceSeeds("NFC", elements.nfcSeeds);
}

function renderConferenceSeeds(conference, container) {
  container.innerHTML = "";

  const divisionHeading = document.createElement("div");
  divisionHeading.className = "seed-group-heading";
  divisionHeading.innerHTML =
    "<strong>1. Pick Division Winners</strong><span>Choose one team from each division</span>";
  container.appendChild(divisionHeading);

  const divisionGrid = document.createElement("div");
  divisionGrid.className = "division-winner-grid";
  DIVISION_ORDER.forEach((division) => {
    const field = document.createElement("label");
    field.className = "division-winner-field";

    const label = document.createElement("span");
    label.textContent = `${conference} ${division}`;

    const select = document.createElement("select");
    select.dataset.conference = conference;
    select.dataset.division = division;
    select.setAttribute("aria-label", `${conference} ${division} winner`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = `Select ${division} winner`;
    select.appendChild(placeholder);

    appendDivisionGroupedOptions(
      select,
      conference,
      DIVISION_TEAMS[conference][division],
      state.divisionWinners[conference][division],
    );

    select.addEventListener("change", handleDivisionWinnerChange);
    const control = document.createElement("div");
    control.className = "logo-select-control";
    const selectedTeam = state.divisionWinners[conference][division];
    if (selectedTeam) {
      control.appendChild(createTeamLogo(selectedTeam, "select-team-logo"));
    } else {
      const placeholderLogo = document.createElement("span");
      placeholderLogo.className = "select-logo-placeholder";
      placeholderLogo.textContent = "—";
      control.appendChild(placeholderLogo);
    }
    control.appendChild(select);
    field.append(label, control);
    divisionGrid.appendChild(field);
  });
  container.appendChild(divisionGrid);

  const seedingHeading = document.createElement("div");
  seedingHeading.className = "seed-group-heading seed-order-group";
  seedingHeading.innerHTML =
    "<strong>2. Rank Division Winners</strong><span>Choices sorted by projected wins</span>";
  container.appendChild(seedingHeading);

  for (let index = 0; index < 7; index += 1) {
    if (index === 4) {
      const group = document.createElement("div");
      group.className = "seed-group-heading wild-card-group";
      group.innerHTML =
        "<strong>3. Pick Wild Cards</strong><span>Seeds 5–7 · unlock after division picks</span>";
      container.appendChild(group);
    }

    const row = document.createElement("div");
    row.className = "seed-row";
    if (index >= 4) row.classList.add("wild-card-seed");

    const number = document.createElement("span");
    number.className = "seed-number";
    number.textContent = index + 1;

    const logoSlot = document.createElement("span");
    logoSlot.className = "seed-logo-slot";
    const selectedSeedTeam = state.seeds[conference][index];
    if (selectedSeedTeam) {
      logoSlot.appendChild(createTeamLogo(selectedSeedTeam, "seed-team-logo"));
    }

    const select = document.createElement("select");
    select.dataset.conference = conference;
    select.dataset.seedIndex = index;
    select.setAttribute("aria-label", `${conference} seed ${index + 1}`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      "Pick division winners first";
    select.appendChild(placeholder);

    const availableTeams =
      index < 4
        ? Object.values(state.divisionWinners[conference]).filter(Boolean)
        : TEAMS[conference];
    if (index < 4) {
      appendProjectedOptions(
        select,
        availableTeams,
        state.seeds[conference][index],
      );
    } else {
      appendDivisionGroupedOptions(
        select,
        conference,
        availableTeams,
        state.seeds[conference][index],
      );
    }

    select.addEventListener("change", handleSeedChange);

    const note = document.createElement("span");
    note.className = "seed-note";
    note.textContent =
      index === 0 ? "Division winner · bye" : index < 4 ? "Division winner" : "Wild card";

    row.append(number, logoSlot, select, note);
    container.appendChild(row);
  }

  updateDisabledTeamOptions(conference);
}

function handleSeedChange(event) {
  const { conference, seedIndex } = event.target.dataset;
  const index = Number(seedIndex);
  state.seeds[conference][index] = event.target.value;

  state.bracketBuilt = false;
  state.picks = createEmptyPicks();
  state.savedAt = null;
  elements.bracketSection.classList.add("hidden");
  elements.seedingMessage.textContent = "";
  updateSaveState(false);
  renderConferenceSeeds(
    conference,
    conference === "AFC" ? elements.afcSeeds : elements.nfcSeeds,
  );
}

function handleDivisionWinnerChange(event) {
  const { conference, division } = event.target.dataset;
  state.divisionWinners[conference][division] = event.target.value;

  const selectedWinners = new Set(
    Object.values(state.divisionWinners[conference]).filter(Boolean),
  );
  state.seeds[conference] = state.seeds[conference].map((team, index) => {
    if (index < 4 && !selectedWinners.has(team)) return "";
    if (index >= 4 && selectedWinners.has(team)) return "";
    return team;
  });

  if (!divisionWinnersComplete(conference)) {
    state.seeds[conference].fill("", 4);
  }

  state.bracketBuilt = false;
  state.picks = createEmptyPicks();
  state.savedAt = null;
  elements.bracketSection.classList.add("hidden");
  elements.seedingMessage.textContent = "";
  updateSaveState(false);
  renderConferenceSeeds(
    conference,
    conference === "AFC" ? elements.afcSeeds : elements.nfcSeeds,
  );
}

function divisionWinnersComplete(conference) {
  return Object.values(state.divisionWinners[conference]).every(Boolean);
}

function divisionSeedingComplete(conference) {
  const winners = Object.values(state.divisionWinners[conference]);
  const seeded = state.seeds[conference].slice(0, 4);
  return (
    divisionWinnersComplete(conference) &&
    seeded.every(Boolean) &&
    new Set(seeded).size === 4 &&
    seeded.every((team) => winners.includes(team))
  );
}

function updateDisabledTeamOptions(conference) {
  const selectedTeams = new Set(state.seeds[conference].filter(Boolean));
  document
    .querySelectorAll(
      `select[data-conference="${conference}"][data-seed-index]`,
    )
    .forEach((select) => {
      const ownValue = select.value;
      const seedIndex = Number(select.dataset.seedIndex);
      const isDivisionWinner = seedIndex < 4;
      const divisionPicksComplete = divisionWinnersComplete(conference);
      const wildCardsUnlocked = divisionPicksComplete;
      const divisionWinnerTeams = new Set(
        Object.values(state.divisionWinners[conference]).filter(Boolean),
      );

      select.disabled = isDivisionWinner ? !divisionPicksComplete : !wildCardsUnlocked;
      select.closest(".seed-row").classList.toggle("locked", select.disabled);
      select.options[0].textContent = select.disabled
        ? "Pick all division winners first"
        : isDivisionWinner
          ? `Select seed ${seedIndex + 1}`
          : "Select a wild-card team";

      Array.from(select.options).forEach((option) => {
        if (!option.value) return;
        const duplicateTeam = option.value !== ownValue && selectedTeams.has(option.value);
        const selectedDivisionWinner =
          !isDivisionWinner && divisionWinnerTeams.has(option.value);
        option.disabled = duplicateTeam || selectedDivisionWinner;
      });
    });
}

function validateSeeding() {
  for (const conference of ["AFC", "NFC"]) {
    const selections = state.seeds[conference];
    if (!divisionWinnersComplete(conference)) {
      return `Choose the ${conference} North, South, East, and West winners first.`;
    }
    if (!divisionSeedingComplete(conference)) {
      return `Rank all four ${conference} division winners as seeds 1–4.`;
    }
    if (selections.some((team) => !team)) {
      return `Choose all seven ${conference} playoff teams first.`;
    }
    if (new Set(selections).size !== selections.length) {
      return `Each ${conference} team can only be seeded once.`;
    }
  }
  return "";
}

function buildBracket() {
  const error = validateSeeding();
  elements.seedingMessage.textContent = error;
  if (error) return;

  if (!state.bracketBuilt) {
    state.picks = createEmptyPicks();
  }
  state.bracketBuilt = true;
  state.savedAt = null;
  renderBracket();
  elements.bracketSection.classList.remove("hidden");
  updateSaveState(false);
  requestAnimationFrame(() => {
    elements.bracketSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function getConferenceGames(conference) {
  const picks = state.picks[conference];
  const wildCard = [
    { id: "wc-2-7", title: "Wild Card · 2 vs 7", teams: [seedTeam(conference, 2), seedTeam(conference, 7)] },
    { id: "wc-3-6", title: "Wild Card · 3 vs 6", teams: [seedTeam(conference, 3), seedTeam(conference, 6)] },
    { id: "wc-4-5", title: "Wild Card · 4 vs 5", teams: [seedTeam(conference, 4), seedTeam(conference, 5)] },
  ];

  const wildCardWinners = wildCard.map((game) => {
    const selected = picks[game.id];
    return game.teams.find((team) => team?.name === selected) || null;
  });
  const remaining = [seedTeam(conference, 1), ...wildCardWinners].filter(Boolean);
  const sorted = [...remaining].sort((a, b) => a.seed - b.seed);

  const divisional =
    sorted.length === 4
      ? [
          {
            id: "div-1",
            title: "Divisional · High vs Low",
            teams: [sorted[0], sorted[3]],
          },
          {
            id: "div-2",
            title: "Divisional",
            teams: [sorted[1], sorted[2]],
          },
        ]
      : [
          { id: "div-1", title: "Divisional · High vs Low", teams: [seedTeam(conference, 1), null] },
          { id: "div-2", title: "Divisional", teams: [null, null] },
        ];

  const divisionalWinners = divisional.map((game) => {
    const selected = picks[game.id];
    return game.teams.find((team) => team?.name === selected) || null;
  });

  const championship = [
    {
      id: "conf",
      title: `${conference} Championship`,
      teams: divisionalWinners,
    },
  ];

  return { wildCard, divisional, championship };
}

function clearInvalidDownstreamPicks(conference, games) {
  const picks = state.picks[conference];
  const orderedGames = [...games.wildCard, ...games.divisional, ...games.championship];
  orderedGames.forEach((game) => {
    if (picks[game.id] && !game.teams.some((team) => team?.name === picks[game.id])) {
      delete picks[game.id];
    }
  });

  const conferenceWinner = getConferenceWinner(conference, games);
  if (
    state.picks.superBowl &&
    !["AFC", "NFC"].some((side) => {
      const winner = side === conference ? conferenceWinner : getConferenceWinner(side);
      return winner?.name === state.picks.superBowl;
    })
  ) {
    state.picks.superBowl = "";
  }
}

function getConferenceWinner(conference, precomputedGames) {
  const games = precomputedGames || getConferenceGames(conference);
  const final = games.championship[0];
  return final.teams.find((team) => team?.name === state.picks[conference].conf) || null;
}

function renderBracket() {
  const afcGames = getConferenceGames("AFC");
  const nfcGames = getConferenceGames("NFC");
  clearInvalidDownstreamPicks("AFC", afcGames);
  clearInvalidDownstreamPicks("NFC", nfcGames);

  renderConferenceBracket("AFC", elements.afcBracket, getConferenceGames("AFC"));
  renderConferenceBracket("NFC", elements.nfcBracket, getConferenceGames("NFC"));
  renderSuperBowl();
}

function renderConferenceBracket(conference, container, games) {
  container.innerHTML = "";
  const rounds = [
    { key: "wildCard", label: "Wild Card" },
    { key: "divisional", label: "Divisional" },
    { key: "championship", label: `Pick ${conference} Champion` },
  ];
  if (conference === "NFC") rounds.reverse();

  rounds.forEach(({ key, label }) => {
    const round = document.createElement("div");
    round.className = `round ${key === "wildCard" ? "wild-card" : key}`;

    const heading = document.createElement("div");
    heading.className = "round-label";
    heading.textContent = label;
    round.appendChild(heading);

    games[key].forEach((game) => {
      round.appendChild(createGameCard(conference, game));
    });
    container.appendChild(round);
  });
}

function createGameCard(conference, game, isSuperBowl = false) {
  const card = document.createElement("div");
  card.className = "game-card";

  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = game.title;
  card.appendChild(title);

  const selectedTeam = isSuperBowl
    ? state.picks.superBowl
    : state.picks[conference][game.id];

  game.teams.forEach((team, index) => {
    const button = document.createElement("button");
    button.className = "team-pick";
    button.type = "button";
    button.disabled = !team;

    if (team) {
      const isSelected = team.name === selectedTeam;
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute(
        "aria-label",
        isSuperBowl
          ? `Choose ${team.name} as Super Bowl champion`
          : `Choose ${team.name} to win ${game.title}`,
      );
      if (isSelected) button.classList.add("selected");
    }

    const seed = document.createElement("span");
    seed.className = "team-seed";
    seed.textContent = team?.seed || "–";

    const name = document.createElement("span");
    name.className = "team-name";
    name.textContent = team
      ? getTeamNickname(team.name)
      : index === 0
        ? "Awaiting winner"
        : "Pick prior games";
    if (team) button.title = team.name;

    const check = document.createElement("span");
    check.className = "pick-check";
    check.textContent = team && team.name === selectedTeam ? "✓" : "";

    if (team) {
      button.append(
        seed,
        createTeamLogo(team.name, "bracket-team-logo"),
        name,
        check,
      );
    } else {
      const emptyLogo = document.createElement("span");
      emptyLogo.className = "bracket-logo-placeholder";
      button.append(seed, emptyLogo, name, check);
    }
    if (team) {
      button.addEventListener("click", () => handleGamePick(conference, game.id, team.name, isSuperBowl));
    }
    card.appendChild(button);
  });

  return card;
}

function handleGamePick(conference, gameId, teamName, isSuperBowl) {
  const hadBothFinalists = Boolean(
    getConferenceWinner("AFC") && getConferenceWinner("NFC"),
  );

  if (isSuperBowl) {
    state.picks.superBowl = teamName;
  } else {
    state.picks[conference][gameId] = teamName;
  }
  state.savedAt = null;
  updateSaveState(false);
  renderBracket();

  const hasBothFinalists = Boolean(
    getConferenceWinner("AFC") && getConferenceWinner("NFC"),
  );
  if (!isSuperBowl && gameId === "conf" && !hadBothFinalists && hasBothFinalists) {
    requestAnimationFrame(() => {
      elements.superBowlGame.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function renderSuperBowl() {
  const afcWinner = getConferenceWinner("AFC");
  const nfcWinner = getConferenceWinner("NFC");
  const missingFinalists = [
    !afcWinner ? "AFC champion" : "",
    !nfcWinner ? "NFC champion" : "",
  ].filter(Boolean);

  elements.superBowlStatus.textContent = missingFinalists.length
    ? `Choose the ${missingFinalists.join(" and ")} to unlock the final.`
    : "Both finalists are set. Click a team below to crown your champion.";

  const game = {
    id: "super-bowl",
    title: afcWinner && nfcWinner ? "Pick the Super Bowl champion" : "Super Bowl",
    teams: [afcWinner, nfcWinner],
  };
  elements.superBowlGame.innerHTML = "";
  elements.superBowlGame.appendChild(createGameCard("", game, true));

  const champion = state.picks.superBowl;
  const championName = elements.championDisplay.querySelector("strong");
  const existingLogo = elements.championDisplay.querySelector(".champion-logo");
  if (existingLogo) existingLogo.remove();
  if (champion) {
    const championLogo = createTeamLogo(champion, "champion-logo");
    elements.championDisplay.insertBefore(
      championLogo,
      elements.championDisplay.querySelector("p"),
    );
  }
  championName.textContent = champion || "Make your final pick";
  elements.championDisplay.classList.toggle("empty", !champion);
}

function allGamesPicked() {
  for (const conference of ["AFC", "NFC"]) {
    const picks = state.picks[conference];
    const required = ["wc-2-7", "wc-3-6", "wc-4-5", "div-1", "div-2", "conf"];
    if (required.some((id) => !picks[id])) return false;
  }
  return Boolean(state.picks.superBowl);
}

function savePrediction() {
  if (!state.bracketBuilt) {
    showToast("Build your bracket before saving.");
    return;
  }
  if (!allGamesPicked()) {
    showToast("Pick a winner in every playoff game first.");
    return;
  }

  const predictions = getStoredPredictions();
  const now = new Date().toISOString();
  predictions[state.profileKey] = {
    displayName: state.displayName,
    divisionWinners: clone(state.divisionWinners),
    seeds: clone(state.seeds),
    picks: clone(state.picks),
    bracketBuilt: true,
    savedAt: now,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(predictions));
  state.savedAt = now;
  updateSaveState(true);
  renderSavedPredictions();
  showToast(`Prediction saved for ${state.displayName}.`);
}

function updateSaveState(saved) {
  elements.saveState.classList.toggle("saved", saved);
  elements.saveState.querySelector("span:last-child").textContent = saved
    ? "Saved to this device"
    : "Unsaved changes";
}

function loadProfile(name) {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const key = normalizeName(cleanName);
  const stored = getStoredPredictions()[key];

  state.profileKey = key;
  state.displayName = stored?.displayName || cleanName;
  state.seeds = stored?.seeds
    ? clone(stored.seeds)
    : { AFC: Array(7).fill(""), NFC: Array(7).fill("") };
  state.divisionWinners = stored?.divisionWinners
    ? clone(stored.divisionWinners)
    : createEmptyDivisionWinners();

  if (stored?.seeds && !stored?.divisionWinners) {
    for (const conference of ["AFC", "NFC"]) {
      stored.seeds[conference].slice(0, 4).forEach((team) => {
        const division = TEAM_DIVISIONS[team]?.split(" ")[1];
        if (division) state.divisionWinners[conference][division] = team;
      });
    }
  }

  state.picks = stored?.picks ? clone(stored.picks) : createEmptyPicks();
  state.bracketBuilt = Boolean(stored?.bracketBuilt);
  state.savedAt = stored?.savedAt || null;

  elements.welcomeName.textContent = state.displayName;
  elements.profileNameDisplay.textContent = state.displayName;
  elements.predictor.classList.remove("hidden");
  renderSeedSelectors();

  if (state.bracketBuilt && !validateSeeding()) {
    renderBracket();
    elements.bracketSection.classList.remove("hidden");
    updateSaveState(Boolean(state.savedAt));
    showToast(`Loaded ${state.displayName}’s saved prediction.`);
  } else {
    elements.bracketSection.classList.add("hidden");
    showToast(`Ready for your picks, ${state.displayName}.`);
  }

  requestAnimationFrame(() => {
    elements.predictor.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function switchProfile() {
  elements.predictor.classList.add("hidden");
  elements.playerName.value = "";
  elements.namePreview.textContent = "your name";
  elements.playerName.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetGamePicks() {
  state.picks = createEmptyPicks();
  state.savedAt = null;
  renderBracket();
  updateSaveState(false);
  showToast("Game picks reset. Your seeding is unchanged.");
}

function renderSavedPredictions() {
  const predictions = Object.entries(getStoredPredictions()).sort(
    ([, a], [, b]) => new Date(b.savedAt) - new Date(a.savedAt),
  );

  elements.savedGrid.innerHTML = "";
  elements.emptyLocker.classList.toggle("hidden", predictions.length > 0);

  predictions.forEach(([key, prediction]) => {
    const card = document.createElement("article");
    card.className = "saved-card";

    const top = document.createElement("div");
    top.className = "saved-card-top";

    const identity = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = prediction.displayName;
    const time = document.createElement("time");
    time.dateTime = prediction.savedAt;
    time.textContent = `Saved ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(prediction.savedAt))}`;
    identity.append(name, time);
    top.appendChild(identity);

    const champion = document.createElement("div");
    champion.className = "champion-chip";
    champion.textContent = `★ Champion: ${prediction.picks.superBowl}`;

    const actions = document.createElement("div");
    actions.className = "saved-card-actions";

    const load = document.createElement("button");
    load.type = "button";
    load.className = "button button-secondary";
    load.textContent = "Open bracket";
    load.addEventListener("click", () => loadProfile(prediction.displayName));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${prediction.displayName}'s prediction`);
    remove.addEventListener("click", () => deletePrediction(key, prediction.displayName));

    actions.append(load, remove);
    card.append(top, champion, actions);
    elements.savedGrid.appendChild(card);
  });
}

function deletePrediction(key, displayName) {
  const predictions = getStoredPredictions();
  delete predictions[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(predictions));
  renderSavedPredictions();
  if (state.profileKey === key) {
    state.savedAt = null;
    updateSaveState(false);
  }
  showToast(`Deleted ${displayName}’s saved prediction.`);
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!elements.playerName.value.trim()) return;
  loadProfile(elements.playerName.value);
});
elements.playerName.addEventListener("input", () => {
  const cleanName = elements.playerName.value.trim().replace(/\s+/g, " ");
  elements.namePreview.textContent = cleanName || "your name";
});

document.querySelectorAll(".conference-logo").forEach((logo) => {
  logo.addEventListener("error", () => logo.classList.add("logo-error"));
});
elements.buildBracket.addEventListener("click", buildBracket);
elements.savePrediction.addEventListener("click", savePrediction);
elements.resetPicks.addEventListener("click", resetGamePicks);
elements.switchProfile.addEventListener("click", switchProfile);

renderSavedPredictions();
loadWinTotals();
