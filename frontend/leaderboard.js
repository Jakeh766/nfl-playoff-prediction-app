function buildConferenceGames(seeds, picksByConference, conference) {
  const picks = picksByConference?.[conference] || {};
  const seed = (number) => {
    const name = seeds?.[conference]?.[number - 1];
    return name ? { name, seed: number } : null;
  };
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
  game.teams.forEach((team) => {
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
  logo.src = `https://a.espncdn.com/i/teamlogos/nfl/500/${conference.toLowerCase()}.png`;
  logo.alt = `${conference} logo`;
  const label = document.createElement("span");
  label.textContent = conference;
  heading.append(logo, label);

  const rounds = document.createElement("div");
  rounds.className = "public-bracket-rounds";
  const games = buildConferenceGames(bracket.seeds, bracket.picks, conference);
  [
    { key: "wildCard", label: "Wild Card" },
    { key: "divisional", label: "Divisional" },
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

function renderPublicBracket(bracket) {
  elements.publicBracketContent.innerHTML = "";
  const score = bracket.score || {};
  const savedAt = bracket.savedAt
    ? ` · Saved ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(bracket.savedAt))}`
    : "";
  elements.publicBracketStatus.textContent =
    `Classic: ${score.total ?? 0} / 300 + ${bracket.vegasScore?.upsetBonus?.toFixed(2) ?? "—"} upset bonus = ${bracket.vegasScore?.total?.toFixed(2) ?? "—"} Upset Edge points${savedAt}`;

  const conferences = document.createElement("div");
  conferences.className = "public-bracket-grid";
  conferences.append(
    createPublicConferenceBracket("AFC", bracket),
    createPublicConferenceBracket("NFC", bracket),
  );

  const champion = document.createElement("section");
  champion.className = "public-champion";
  const kicker = document.createElement("p");
  kicker.className = "card-kicker";
  kicker.textContent = "SUPER BOWL CHAMPION";
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
    renderPublicBracket(bracket);
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
  classic: { label: "Classic points", numeric: true },
  bonus: { label: "Upset Bonus", numeric: true },
  upsetTotal: { label: "Upset Edge total", numeric: true },
};
const DEFAULT_LEADERBOARD_SORT = { key: "rank", direction: "ascending" };
const leaderboardSortStateByBody = new WeakMap();
const leaderboardEntriesByBody = new WeakMap();

function getLeaderboardSortState(body) {
  if (!leaderboardSortStateByBody.has(body)) {
    leaderboardSortStateByBody.set(body, { ...DEFAULT_LEADERBOARD_SORT });
  }
  return leaderboardSortStateByBody.get(body);
}

function numericLeaderboardValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function leaderboardScoreValue(entry, mode, key) {
  const score = entry.scores?.[mode];
  if (score?.[key] != null) return score[key];
  if (!entry.scores || entry.scoringOption === mode || (mode === "classic" && !entry.scoringOption)) {
    return entry[key] ?? null;
  }
  return null;
}

function leaderboardSortValue(entry, key) {
  switch (key) {
    case "player":
      return String(entry.leaderboardName || "");
    case "rank":
      return numericLeaderboardValue(entry.rank);
    case "field":
      return numericLeaderboardValue(entry.regularSeason);
    case "playoffs":
      return numericLeaderboardValue(entry.playoffs);
    case "classic":
      return numericLeaderboardValue(leaderboardScoreValue(entry, "classic", "total"));
    case "bonus":
      return numericLeaderboardValue(leaderboardScoreValue(entry, "vegas", "upsetBonus"));
    case "upsetTotal":
      return numericLeaderboardValue(leaderboardScoreValue(entry, "vegas", "total"));
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

function sortLeaderboardEntries(entries, sortState = DEFAULT_LEADERBOARD_SORT) {
  const meta = LEADERBOARD_SORT_META[sortState.key] || LEADERBOARD_SORT_META.rank;
  const direction = sortState.direction === "descending" ? -1 : 1;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((first, second) => {
      const comparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, sortState.key),
        leaderboardSortValue(second.entry, sortState.key),
        meta.numeric,
        direction,
      );
      if (comparison) return comparison;

      const rankComparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, "rank"),
        leaderboardSortValue(second.entry, "rank"),
        true,
        1,
      );
      if (rankComparison) return rankComparison;

      const playerComparison = compareLeaderboardValues(
        leaderboardSortValue(first.entry, "player"),
        leaderboardSortValue(second.entry, "player"),
        false,
        1,
      );
      return playerComparison || first.index - second.index;
    })
    .map(({ entry }) => entry);
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
      renderLeaderboardRows(body, leaderboardEntriesByBody.get(body) || []);
    });
  });
}

function formatLeaderboardScore(value, decimals = 0) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return decimals ? number.toFixed(decimals) : String(value);
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
    cell.setAttribute("aria-label", "No Super Bowl pick");
    return cell;
  }

  const pick = document.createElement("div");
  pick.className = "leaderboard-champion-pick";
  const logo = createTeamLogo(champion, "leaderboard-champion-logo");
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  pick.appendChild(logo);
  cell.appendChild(pick);
  cell.setAttribute("aria-label", `Super Bowl pick: ${champion}`);
  return cell;
}

function renderLeaderboardRows(body, entries) {
  leaderboardEntriesByBody.set(body, entries);
  bindLeaderboardSortControls(body);
  const sortState = getLeaderboardSortState(body);
  updateLeaderboardSortIndicators(body, sortState);
  body.innerHTML = "";
  const limit = Number(body.dataset.limit || 0);
  const sortedEntries = sortLeaderboardEntries(entries, sortState);
  const visibleEntries = limit > 0 ? sortedEntries.slice(0, limit) : sortedEntries;
  visibleEntries.forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "leaderboard-row";
    row.addEventListener("click", () => openPublicBracket(entry));
    const rank = document.createElement("td");
    rank.className = "leaderboard-rank";
    rank.textContent = entry.rank >= 1 && entry.rank <= 3
      ? ["🥇", "🥈", "🥉"][entry.rank - 1]
      : String(entry.rank ?? "—");
    rank.setAttribute("aria-label", `Rank ${entry.rank ?? "unavailable"}`);

    const player = document.createElement("th");
    player.scope = "row";
    const playerButton = document.createElement("button");
    playerButton.className = "leaderboard-player-button";
    playerButton.type = "button";
    const playerName = document.createElement("strong");
    playerName.textContent = entry.leaderboardName;
    const viewLabel = document.createElement("span");
    viewLabel.textContent = "View bracket";
    playerButton.append(playerName, viewLabel);
    player.appendChild(playerButton);

    const champion = createLeaderboardChampionCell(entry);
    const regularSeason = document.createElement("td");
    regularSeason.textContent = formatLeaderboardScore(entry.regularSeason);
    const playoffs = document.createElement("td");
    playoffs.textContent = formatLeaderboardScore(entry.playoffs);
    const total = document.createElement("td");
    total.className = "leaderboard-total";
    total.textContent = formatLeaderboardScore(
      leaderboardScoreValue(entry, "classic", "total"),
    );

    const bonus = document.createElement("td");
    const upsetBonus = leaderboardScoreValue(entry, "vegas", "upsetBonus");
    bonus.textContent = upsetBonus == null
      ? "—"
      : `+${formatLeaderboardScore(upsetBonus, 2)}`;
    const upsetTotal = document.createElement("td");
    upsetTotal.className = "leaderboard-total";
    upsetTotal.textContent = formatLeaderboardScore(
      leaderboardScoreValue(entry, "vegas", "total"),
      2,
    );
    row.append(rank, player, champion, regularSeason, playoffs, total, bonus, upsetTotal);
    body.appendChild(row);
  });
}

function renderLeaderboard() {
  const leaderboard = state.leaderboard;
  const entries = [...(leaderboard?.entries || [])].map((entry, index) => ({
    ...entry,
    rank: entry.rank ?? index + 1,
  }));
  elements.leaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  renderLeaderboardRows(elements.leaderboardBody, entries);

  if (leaderboard) elements.leaderboardStatus.textContent = leaderboard.status;
}

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
    if (LOCAL_PREVIEW) {
      state.leaderboard = {
        status: "Preseason — scoring has not started",
        entries: [
          { rank: 1, leaderboardName: "Gridiron Jake", regularSeason: 0, playoffs: 0, total: 0 },
          { rank: 1, leaderboardName: "Sunday Sam", regularSeason: 0, playoffs: 0, total: 0 },
          { rank: 1, leaderboardName: "Fourth Down Alex", regularSeason: 0, playoffs: 0, total: 0 },
        ],
      };
      state.leaderboard.entries.forEach((entry, index) => {
        entry.bracket = createPreviewPublicBracket(entry.leaderboardName, index);
        entry.scores = { classic: { regularSeason: 0, playoffs: 0, total: 0 },
          vegas: { regularSeason: 0, playoffs: 0, total: 0, upsetBonus: 0 } };
        entry.bracket.vegasScore = { total: 0, upsetBonus: 0 };
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

function renderGroups() {
  if (!elements.groupTabs) return;
  const activeGroup = state.groups.find(
    (group) => group.groupId === state.activeGroupId,
  );
  elements.groupTabs.innerHTML = "";
  elements.emptyGroups.classList.toggle("hidden", Boolean(state.groups.length));
  elements.groupLeaderboard.classList.toggle("hidden", !activeGroup);

  state.groups.forEach((group) => {
    const button = document.createElement("button");
    button.className = "group-tab";
    button.type = "button";
    button.textContent = group.groupName;
    button.classList.toggle("active", group.groupId === state.activeGroupId);
    button.setAttribute(
      "aria-pressed",
      String(group.groupId === state.activeGroupId),
    );
    button.addEventListener("click", () => {
      if (state.activeGroupId === group.groupId) return;
      state.activeGroupId = group.groupId;
      state.groupLeaderboard = null;
      renderGroups();
      loadGroupLeaderboard(group.groupId);
    });
    elements.groupTabs.appendChild(button);
  });

  if (activeGroup) elements.activeGroupName.textContent = activeGroup.groupName;
}

function renderGroupLeaderboard() {
  const leaderboard = state.groupLeaderboard;
  const entries = leaderboard?.entries || [];
  elements.groupLeaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyGroupLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  renderLeaderboardRows(elements.groupLeaderboardBody, entries);
  if (leaderboard) {
    elements.activeGroupName.textContent = leaderboard.groupName;
    elements.groupLeaderboardStatus.textContent = `${leaderboard.scoringOption === "vegas" ? "Upset Edge" : "Classic"} ranking · ${leaderboard.status}`;
    elements.groupLeaderboardStatus.title = "";
  }
}

async function loadGroupLeaderboard(groupId = state.activeGroupId) {
  if (!groupId) return;
  elements.groupLeaderboardStatus.textContent = "Loading group leaderboard…";
  try {
    const leaderboard = await apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}/leaderboard`,
    );
    if (state.activeGroupId !== groupId) return;
    state.groupLeaderboard = leaderboard;
    renderGroupLeaderboard();
  } catch (error) {
    if (state.activeGroupId !== groupId) return;
    state.groupLeaderboard = null;
    elements.groupLeaderboardBody.innerHTML = "";
    elements.groupLeaderboardTableShell.classList.add("hidden");
    elements.emptyGroupLeaderboard.classList.add("hidden");
    elements.groupLeaderboardStatus.textContent =
      "The group leaderboard could not be loaded.";
    elements.groupLeaderboardStatus.title = error.message;
  }
}

async function refreshGroups(preferredGroupId = state.activeGroupId) {
  try {
    const payload = await apiRequest("/api/groups");
    state.groups = payload.groups || [];
    state.activeGroupId = state.groups.some(
      (group) => group.groupId === preferredGroupId,
    )
      ? preferredGroupId
      : state.groups[0]?.groupId || "";
    state.groupLeaderboard = null;
    if (!elements.groupTabs) return;
    elements.emptyGroups.textContent =
      "You have not joined a group yet. Create one for friends or join one with its name and password.";
    elements.emptyGroups.title = "";
    renderGroups();
    if (state.activeGroupId) await loadGroupLeaderboard(state.activeGroupId);
  } catch (error) {
    state.groups = [];
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    if (!elements.groupTabs) throw error;
    renderGroups();
    elements.emptyGroups.textContent =
      "Your groups could not be loaded. Please refresh and try again.";
    elements.emptyGroups.title = error.message;
  }
}

function openGroupDialog(mode) {
  groupDialogMode = mode;
  const creating = mode === "create";
  elements.groupForm.reset();
  document.querySelector("#group-scoring-field").classList.toggle("hidden", !creating);
  elements.groupDialogKicker.textContent = creating ? "NEW PRIVATE GROUP" : "JOIN PRIVATE GROUP";
  elements.groupDialogTitle.textContent = creating ? "Create a group." : "Join a group.";
  elements.groupDialogDescription.textContent = creating
    ? "Pick a unique group name. You can invite people with a private link or the group password."
    : "Enter the exact group name and the password shared by its creator.";
  elements.submitGroup.textContent = creating ? "Create group" : "Join group";
  elements.groupDialogMessage.textContent = "";
  elements.groupDialog.showModal();
  elements.groupName.focus();
}

async function submitGroup(event) {
  event.preventDefault();
  const creating = groupDialogMode === "create";
  elements.submitGroup.disabled = true;
  elements.submitGroup.setAttribute("aria-busy", "true");
  elements.submitGroup.textContent = creating ? "Creating…" : "Joining…";
  elements.groupDialogMessage.textContent = creating
    ? "Creating your private group…"
    : "Checking the group password…";

  try {
    const group = await apiRequest(creating ? "/api/groups" : "/api/groups/join", {
      method: "POST",
      body: JSON.stringify({
        groupName: elements.groupName.value,
        password: elements.groupPassword.value,
        ...(creating ? { scoringOption: document.querySelector("#group-scoring").value } : {}),
      }),
    });
    elements.groupDialog.close();
    state.groups = [
      ...state.groups.filter((existing) => existing.groupId !== group.groupId),
      group,
    ];
    window.siteAnalytics?.track(creating ? "group_created" : "group_joined");
    if (PAGE === "leaderboard") await refreshGroups(group.groupId);
    if (elements.homeGroupStatus) {
      elements.homeGroupStatus.textContent = creating
        ? `${group.groupName} is ready. Copy the invite link to bring people in.`
        : `You joined ${group.groupName}. Open My Groups to view its standings.`;
    }
    showToast(creating ? `Created ${group.groupName}.` : `Joined ${group.groupName}.`);
    if (creating) await openGroupInviteDialog(group);
  } catch (error) {
    elements.groupDialogMessage.textContent = error.message;
    elements.groupPassword.value = "";
    elements.groupPassword.focus();
  } finally {
    elements.submitGroup.disabled = false;
    elements.submitGroup.removeAttribute("aria-busy");
    elements.submitGroup.textContent = creating ? "Create group" : "Join group";
  }
}

function renderHomeGroupInvite() {
  if (!elements.homeInviteCallout) return;
  const hasInviteParameter = new URLSearchParams(window.location.search).has("invite");
  elements.homeInviteCallout.classList.toggle("hidden", !pendingGroupInvite);
  if (hasInviteParameter && !pendingGroupInvite) {
    elements.homeGroupStatus.textContent =
      "This group invite link is invalid. Ask the sender for a new link.";
  }
}

function openGroupAction(mode) {
  if (state.signedIn) {
    openGroupDialog(mode);
    return;
  }
  pendingGroupAction = mode;
  showAuthPanel(
    "signIn",
    mode === "create"
      ? "Sign in to create a private group."
      : "Sign in to join a private group.",
  );
  elements.accountDialog.showModal();
  elements.loginEmail.focus();
}

async function acceptPendingGroupInvite() {
  if (!pendingGroupInvite) return;
  if (!state.signedIn) {
    pendingGroupAction = "accept-invite";
    showAuthPanel("signIn", "Sign in to accept this private group invite.");
    elements.accountDialog.showModal();
    elements.loginEmail.focus();
    return;
  }

  elements.homeAcceptInvite.disabled = true;
  elements.homeAcceptInvite.setAttribute("aria-busy", "true");
  elements.homeAcceptInvite.textContent = "Joining…";
  try {
    const group = await apiRequest("/api/groups/join-invite", {
      method: "POST",
      body: JSON.stringify(pendingGroupInvite),
    });
    pendingGroupInvite = null;
    window.siteAnalytics?.track("group_invite_joined");
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    renderHomeGroupInvite();
    elements.homeGroupStatus.textContent =
      `You joined ${group.groupName}. Open My Groups to view its standings.`;
    showToast(`Joined ${group.groupName}.`);
  } catch (error) {
    elements.homeGroupStatus.textContent = error.message;
  } finally {
    elements.homeAcceptInvite.disabled = false;
    elements.homeAcceptInvite.removeAttribute("aria-busy");
    elements.homeAcceptInvite.textContent = "Accept group invite";
  }
}

async function resumePendingGroupAction() {
  if (!pendingGroupAction) return;
  const action = pendingGroupAction;
  pendingGroupAction = "";
  if (elements.accountDialog.open) elements.accountDialog.close();
  if (action === "accept-invite") {
    await acceptPendingGroupInvite();
  } else {
    openGroupDialog(action);
  }
}

function groupInviteUrl(groupId, inviteCode) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("invite", `${groupId}.${inviteCode}`);
  return url.toString();
}

async function openGroupInviteDialog(group) {
  elements.groupInviteName.textContent = group.groupName;
  elements.groupInviteLink.value = "";
  elements.groupInviteMessage.textContent = "Creating a private invite link…";
  elements.copyGroupInvite.disabled = true;
  elements.shareGroupInviteNative.classList.toggle("hidden", !navigator.share);
  elements.groupInviteDialog.showModal();

  try {
    const invite = await apiRequest(
      `/api/groups/${encodeURIComponent(group.groupId)}/invite`,
    );
    elements.groupInviteName.textContent = invite.groupName;
    elements.groupInviteLink.value = groupInviteUrl(
      invite.groupId,
      invite.inviteCode,
    );
    elements.groupInviteMessage.textContent =
      "Only share this link with people you want in the group.";
    elements.copyGroupInvite.disabled = false;
  } catch (error) {
    elements.groupInviteMessage.textContent = error.message;
  }
}

async function shareActiveGroupInvite() {
  const group = state.groups.find(
    (candidate) => candidate.groupId === state.activeGroupId,
  );
  if (group) await openGroupInviteDialog(group);
}

async function copyGroupInviteLink() {
  const link = elements.groupInviteLink.value;
  if (!link) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      elements.groupInviteLink.select();
      document.execCommand("copy");
    }
    elements.groupInviteMessage.textContent = "Invite link copied.";
    elements.copyGroupInvite.textContent = "Copied";
    setTimeout(() => {
      elements.copyGroupInvite.textContent = "Copy invite link";
    }, 1800);
  } catch (error) {
    elements.groupInviteMessage.textContent =
      "Copy failed. Select the link and copy it manually.";
    elements.groupInviteLink.select();
  }
}

async function shareGroupInviteNatively() {
  const link = elements.groupInviteLink.value;
  if (!link || !navigator.share) return;
  try {
    await navigator.share({
      title: `Join ${elements.groupInviteName.textContent}`,
      text: "Join my Predict Playoffs private leaderboard.",
      url: link,
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      elements.groupInviteMessage.textContent = "The invite link could not be shared.";
    }
  }
}
