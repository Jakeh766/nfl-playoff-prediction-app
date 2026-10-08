function renderLeaderboard() {
  const leaderboard = state.leaderboard;
  const mode = state.leaderboardScoringMode || "classic";
  const entries = rankLeaderboardEntries(leaderboard?.entries || [], mode);
  elements.leaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  updateLeaderboardScoreHeading(elements.leaderboardBody, mode);
  renderLeaderboardRows(elements.leaderboardBody, entries, mode);

  if (leaderboard) elements.leaderboardStatus.textContent = seasonStatusText(leaderboard.status);
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
