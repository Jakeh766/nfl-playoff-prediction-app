async function refreshSavedPrediction() {
  try {
    state.savedPrediction = await apiRequest("/api/prediction");
  } catch (error) {
    if (error.status === 404) {
      state.savedPrediction = null;
    } else {
      elements.emptyLocker.classList.remove("hidden");
      elements.emptyLocker.textContent =
        "Your saved bracket could not be loaded. Please refresh and try again.";
      elements.emptyLocker.title = error.message;
    }
  }
  renderSavedPrediction();
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function randomTeam(teams) {
  const availableTeams = teams.filter(Boolean);
  return availableTeams[Math.floor(Math.random() * availableTeams.length)];
}

function projectedWins(team) {
  return Number(state.winTotals[team] ?? 0);
}

const PROJECTION_HELP_TEXT =
  "The number in parentheses is each team's projected regular-season win total.";

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
          : `${team} (${projectedWins(team).toFixed(1)})`;
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
        : `${team} (${projectedWins(team).toFixed(1)})`;
    option.selected = selectedTeam === team;
    select.appendChild(option);
  });
}

async function loadWinTotals() {
  elements.oddsStatus.textContent =
    `${PROJECTION_HELP_TEXT} Using the bundled 2026 sportsbook snapshot while live odds load…`;

  try {
    const response = await fetch("/api/win-totals", { cache: "no-store" });
    if (!response.ok) throw new Error("Odds endpoint unavailable");

    const data = await response.json();
    if (data.apiVersion !== 2) {
      throw new Error("The odds API version does not match this frontend.");
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
    elements.oddsStatus.textContent = `${PROJECTION_HELP_TEXT} ${sourceLabel} projections from ${data.source}. Teams are ranked within each division.`;
    elements.oddsStatus.title = data.message || "";
  } catch (error) {
    const isMismatchedApi = error.message.includes("does not match");
    elements.oddsStatus.textContent = isMismatchedApi
      ? `${PROJECTION_HELP_TEXT} The odds API and frontend versions do not match. Deploy the latest dev build.`
      : `${PROJECTION_HELP_TEXT} Live odds are unavailable; using the bundled 2026 sportsbook snapshot.`;
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
    select.disabled = state.predictionsLocked;
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

      select.disabled =
        state.predictionsLocked ||
        (isDivisionWinner ? !divisionPicksComplete : !wildCardsUnlocked);
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
  if (state.predictionsLocked) {
    showToast("Brackets are locked for the season.");
    return;
  }
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

function randomizeBracket() {
  if (!TEST_MODE || state.predictionsLocked) return;

  state.divisionWinners = createEmptyDivisionWinners();
  state.seeds = { AFC: Array(7).fill(""), NFC: Array(7).fill("") };
  state.picks = createEmptyPicks();

  for (const conference of ["AFC", "NFC"]) {
    for (const division of DIVISION_ORDER) {
      state.divisionWinners[conference][division] = randomTeam(
        DIVISION_TEAMS[conference][division],
      );
    }

    const divisionWinners = Object.values(state.divisionWinners[conference]);
    const wildCards = shuffled(
      TEAMS[conference].filter((team) => !divisionWinners.includes(team)),
    ).slice(0, 3);
    state.seeds[conference] = [...shuffled(divisionWinners), ...wildCards];
  }

  state.bracketBuilt = true;
  state.savedAt = null;

  for (const conference of ["AFC", "NFC"]) {
    let games = getConferenceGames(conference);
    games.wildCard.forEach((game) => {
      state.picks[conference][game.id] = randomTeam(game.teams).name;
    });

    games = getConferenceGames(conference);
    games.divisional.forEach((game) => {
      state.picks[conference][game.id] = randomTeam(game.teams).name;
    });

    games = getConferenceGames(conference);
    const championship = games.championship[0];
    state.picks[conference][championship.id] = randomTeam(
      championship.teams,
    ).name;
  }

  state.picks.superBowl = randomTeam([
    getConferenceWinner("AFC"),
    getConferenceWinner("NFC"),
  ]).name;

  elements.seedingMessage.textContent = "";
  renderSeedSelectors();
  renderBracket();
  elements.bracketSection.classList.remove("hidden");
  updateSaveState(false);
  showToast("Random seeds and game picks are ready.");

  requestAnimationFrame(() => {
    elements.bracketSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function getConferenceGames(conference) {
  return buildConferenceGames(state.seeds, state.picks, conference);
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
    button.disabled = !team || state.predictionsLocked;

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
  if (state.predictionsLocked) return;
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

async function savePrediction() {
  if (state.predictionsLocked) {
    showToast("Brackets are locked for the season.");
    return;
  }
  if (!state.signedIn) {
    showAuthPanel("signIn", "Sign in to save this prediction to your account.");
    elements.accountDialog.showModal();
    return;
  }
  if (!state.bracketBuilt) {
    showToast("Build your bracket before saving.");
    return;
  }
  if (!allGamesPicked()) {
    showToast("Pick a winner in every playoff game first.");
    return;
  }
  if (!state.leaderboardName) {
    openLeaderboardNameDialog(true);
    return;
  }

  const prediction = {
    divisionWinners: clone(state.divisionWinners),
    seeds: clone(state.seeds),
    picks: clone(state.picks),
    bracketBuilt: true,
  };

  elements.savePrediction.disabled = true;
  elements.savePrediction.textContent = "Saving…";
  try {
    const saved = await apiRequest("/api/prediction", {
      method: "PUT",
      body: JSON.stringify(prediction),
    });
    state.savedAt = saved.savedAt;
    state.savedPrediction = saved;
    window.siteAnalytics?.track("prediction_saved");
    updateSaveState(true);
    renderSavedPrediction();
    if (elements.leaderboardBody) await loadLeaderboard();
    if (PAGE === "leaderboard" && state.activeGroupId) await loadGroupLeaderboard();
    showToast("Prediction saved.");
  } catch (error) {
    updateSaveState(false);
    showToast(`Could not save: ${error.message}`);
  } finally {
    elements.savePrediction.disabled = state.predictionsLocked;
    elements.savePrediction.textContent = "Save prediction";
  }
}

function updateSaveState(saved) {
  elements.saveState.classList.toggle("saved", saved);
  elements.saveState.querySelector("span:last-child").textContent = saved
    ? "Saved online"
    : "Unsaved changes";
}

function openPrediction(scrollToPredictor = true) {
  if (PAGE !== "picks") {
    window.location.assign(LOCAL_PREVIEW ? "/picks.html" : "/picks");
    return;
  }
  if (elements.accountDialog.open) elements.accountDialog.close();
  const stored = state.savedPrediction;
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

  elements.predictor.classList.remove("hidden");
  renderSeedSelectors();

  if (state.bracketBuilt && !validateSeeding()) {
    renderBracket();
    elements.bracketSection.classList.remove("hidden");
    updateSaveState(Boolean(state.savedAt));
    showToast("Loaded your saved prediction.");
  } else {
    elements.bracketSection.classList.add("hidden");
    showToast("Ready for your picks.");
  }

  if (scrollToPredictor) {
    requestAnimationFrame(() => {
      elements.predictor.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function resetGamePicks() {
  if (state.predictionsLocked) return;
  state.picks = createEmptyPicks();
  state.savedAt = null;
  renderBracket();
  updateSaveState(false);
  showToast("Game picks reset. Your seeding is unchanged.");
}

function createScoreSummary(score) {
  const summary = document.createElement("section");
  summary.className = "score-summary";
  summary.setAttribute("aria-label", "Prediction score");

  const top = document.createElement("div");
  top.className = "score-summary-top";

  const label = document.createElement("p");
  label.className = "score-summary-label";
  label.textContent = score.possible
    ? `${score.total} OF ${score.possible} AVAILABLE`
    : "CURRENT SCORE";

  const total = document.createElement("strong");
  total.className = "score-summary-total";
  total.textContent = `${score.total} / ${score.maximum}`;
  top.append(label, total);

  const status = document.createElement("p");
  status.className = "score-summary-status";
  status.textContent = score.status;

  const splits = document.createElement("div");
  splits.className = "score-splits";
  const regularSeason = document.createElement("span");
  regularSeason.append("PLAYOFF FIELD + SEEDS", document.createElement("strong"));
  regularSeason.querySelector("strong").textContent = `${score.regularSeason} pts`;
  const playoffs = document.createElement("span");
  playoffs.append("PLAYOFF ROUNDS", document.createElement("strong"));
  playoffs.querySelector("strong").textContent = `${score.playoffs} pts`;
  splits.append(regularSeason, playoffs);

  summary.append(top, status, splits);
  return summary;
}

function renderSavedPrediction() {
  const prediction = state.savedPrediction;
  elements.savedGrid.innerHTML = "";
  elements.emptyLocker.classList.toggle("hidden", Boolean(prediction));
  if (!prediction) return;

  const card = document.createElement("article");
  card.className = "saved-card";

  const top = document.createElement("div");
  top.className = "saved-card-top";

  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = "Your saved bracket";
  const time = document.createElement("time");
  time.dateTime = new Date(prediction.savedAt).toISOString();
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

  const scoreSummary = prediction.score
    ? createScoreSummary(prediction.score)
    : null;

  const actions = document.createElement("div");
  actions.className = "saved-card-actions";

  const load = document.createElement("button");
  load.type = "button";
  load.className = "button button-secondary";
  load.textContent = "Open bracket";
  load.addEventListener("click", () => openPrediction());

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-button";
  remove.textContent = "Delete";
  remove.setAttribute("aria-label", "Delete your saved prediction");
  remove.addEventListener("click", deletePrediction);

  actions.append(load, remove);
  card.append(top, champion);
  if (scoreSummary) card.appendChild(scoreSummary);
  card.appendChild(actions);
  elements.savedGrid.appendChild(card);
}

async function deletePrediction() {
  try {
    await apiRequest("/api/prediction", {
      method: "DELETE",
    });
    state.savedPrediction = null;
    state.savedAt = null;
    renderSavedPrediction();
    updateSaveState(false);
    if (elements.leaderboardBody) await loadLeaderboard();
    if (PAGE === "leaderboard" && state.activeGroupId) await loadGroupLeaderboard();
    showToast("Deleted your saved prediction.");
  } catch (error) {
    showToast(`Could not delete: ${error.message}`);
  }
}
