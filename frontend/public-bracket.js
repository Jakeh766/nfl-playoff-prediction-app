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
  if (typeof createPredictionShareButton === "function") {
    const actions = document.createElement("div");
    actions.className = "saved-card-actions";
    const isOwn = state.signedIn && state.leaderboardName === bracket.leaderboardName;
    const picks = createPredictionShareButton(bracket.leaderboardName, "picks", scoringMode);
    actions.appendChild(picks);
    if (score.possible > 0) {
      const results = createPredictionShareButton(bracket.leaderboardName, "results", scoringMode,
        isOwn ? "Share my results" : "Share results");
      actions.appendChild(results);
    }
    elements.publicBracketContent.appendChild(actions);
  }
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

async function openPublicPredictionFromUrl() {
  if (PAGE !== "leaderboard") return;
  const player = new URLSearchParams(window.location.search).get("player");
  if (!player) return;
  if (player.length < 3 || player.length > 24 ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._'’\-]*[A-Za-z0-9]$/.test(player)) {
    showToast("This public bracket link is invalid.");
    return;
  }
  await openPublicBracket({ leaderboardName: player });
}
