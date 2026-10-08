const TEAMS = IS_NBA ? NBA_SEASON.teams : {
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

const LOCAL_PREVIEW =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const PAGE = document.body.dataset.page || "home";
const TEST_MODE =
  window.AUTH_CONFIG?.environment === "dev" || LOCAL_PREVIEW;
const LEADERBOARD_PROFILE_PREVIEW =
  LOCAL_PREVIEW &&
  new URLSearchParams(window.location.search).get("preview") ===
    "leaderboard-name";

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

const TEAM_LOGO_CODES = IS_NBA ? NBA_LOGOS : {
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

// Seed-row accents use recognizable team palette colors.
const TEAM_COLORS = IS_NBA ? {
  "Atlanta Hawks": "#c8102e",
  "Boston Celtics": "#007a33",
  "Brooklyn Nets": "#777777",
  "Charlotte Hornets": "#1d1160",
  "Chicago Bulls": "#ce1141",
  "Cleveland Cavaliers": "#860038",
  "Dallas Mavericks": "#00538c",
  "Denver Nuggets": "#0e2240",
  "Detroit Pistons": "#1d42ba",
  "Golden State Warriors": "#1d428a",
  "Houston Rockets": "#ce1141",
  "Indiana Pacers": "#002d62",
  "Los Angeles Clippers": "#c8102e",
  "Los Angeles Lakers": "#552583",
  "Memphis Grizzlies": "#5d76a9",
  "Miami Heat": "#98002e",
  "Milwaukee Bucks": "#00471b",
  "Minnesota Timberwolves": "#0c2340",
  "New Orleans Pelicans": "#0c2340",
  "New York Knicks": "#f58426",
  "Oklahoma City Thunder": "#007ac1",
  "Orlando Magic": "#0077c0",
  "Philadelphia 76ers": "#006bb6",
  "Phoenix Suns": "#fa4b0a",
  "Portland Trail Blazers": "#e03a3e",
  "Sacramento Kings": "#5a2d81",
  "San Antonio Spurs": "#c4ced4",
  "Toronto Raptors": "#ce1141",
  "Utah Jazz": "#5b2b82",
  "Washington Wizards": "#e31837",
} : {
  "Arizona Cardinals": "#97233f",
  "Atlanta Falcons": "#a71930",
  "Baltimore Ravens": "#241773",
  "Buffalo Bills": "#00338d",
  "Carolina Panthers": "#0085ca",
  "Chicago Bears": "#c83803",
  "Cincinnati Bengals": "#fb4f14",
  "Cleveland Browns": "#ff3c00",
  "Dallas Cowboys": "#003594",
  "Denver Broncos": "#fb4f14",
  "Detroit Lions": "#0076b6",
  "Green Bay Packers": "#203731",
  "Houston Texans": "#03202f",
  "Indianapolis Colts": "#002c5f",
  "Jacksonville Jaguars": "#006778",
  "Kansas City Chiefs": "#e31837",
  "Las Vegas Raiders": "#000000",
  "Los Angeles Chargers": "#0080c6",
  "Los Angeles Rams": "#003594",
  "Miami Dolphins": "#008e97",
  "Minnesota Vikings": "#4f2683",
  "New England Patriots": "#002244",
  "New Orleans Saints": "#b49f61",
  "New York Giants": "#0b2265",
  "New York Jets": "#125740",
  "Philadelphia Eagles": "#004c54",
  "Pittsburgh Steelers": "#ffb612",
  "San Francisco 49ers": "#aa0000",
  "Seattle Seahawks": "#002244",
  "Tampa Bay Buccaneers": "#d50a0a",
  "Tennessee Titans": "#4b92db",
  "Washington Commanders": "#5a1414",
};

const FALLBACK_WIN_TOTALS = IS_NBA ? NBA_SEASON.totals : {
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

function createEmptyDivisionWinners() {
  if (IS_NBA) return { East: {}, West: {} };
  return {
    AFC: { North: "", South: "", East: "", West: "" },
    NFC: { North: "", South: "", East: "", West: "" },
  };
}

function getTeamNickname(teamName) {
  return teamName.split(" ").at(-1);
}

function teamLogoUrl(teamName) {
  return `https://a.espncdn.com/i/teamlogos/${SPORT}/500/${TEAM_LOGO_CODES[teamName]}.png`;
}

function createTeamLogo(teamName, className = "team-logo") {
  const logo = document.createElement("img");
  logo.className = className;
  logo.src = teamLogoUrl(teamName);
  logo.alt = `${teamName} logo`;
  logo.width = 32;
  logo.height = 32;
  logo.decoding = "async";
  logo.loading = "lazy";
  logo.addEventListener("error", () => logo.classList.add("logo-error"));
  return logo;
}

function setTeamRowColor(row, teamName) {
  row.style.setProperty("--team-color", TEAM_COLORS[teamName] || "#1859a9");
}
