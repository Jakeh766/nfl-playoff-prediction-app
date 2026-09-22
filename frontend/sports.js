// League is explicit in shareable URLs; NFL remains the legacy default.
const SPORT = new URLSearchParams(window.location.search).get("sport") === "nba" ? "nba" : "nfl";
const IS_NBA = SPORT === "nba";
const CONFERENCES = IS_NBA ? ["East", "West"] : ["AFC", "NFC"];
const SEED_COUNT = IS_NBA ? 8 : 7;
const CLASSIC_MAXIMUM = IS_NBA ? 284 : 300;
const FINAL_NAME = IS_NBA ? "NBA Finals" : "Super Bowl";
const NBA_SEASON = {
  "season": 2027,
  "label": "2026–27",
  "lockAt": "2026-10-20T19:00:00Z",
  "scheduleSource": "https://www.nba.com/news/2026-27-nba-regular-season-schedule",
  "source": "BetMGM preseason snapshot, September 22, 2026",
  "sourceUrl": "https://sports.betmgm.com/en/blog/nba/nba-odds-predictions-season-win-totals-bm23/",
  "teams": {
    "East": [
      "Atlanta Hawks",
      "Boston Celtics",
      "Brooklyn Nets",
      "Charlotte Hornets",
      "Chicago Bulls",
      "Cleveland Cavaliers",
      "Detroit Pistons",
      "Indiana Pacers",
      "Miami Heat",
      "Milwaukee Bucks",
      "New York Knicks",
      "Orlando Magic",
      "Philadelphia 76ers",
      "Toronto Raptors",
      "Washington Wizards"
    ],
    "West": [
      "Dallas Mavericks",
      "Denver Nuggets",
      "Golden State Warriors",
      "Houston Rockets",
      "Los Angeles Clippers",
      "Los Angeles Lakers",
      "Memphis Grizzlies",
      "Minnesota Timberwolves",
      "New Orleans Pelicans",
      "Oklahoma City Thunder",
      "Phoenix Suns",
      "Portland Trail Blazers",
      "Sacramento Kings",
      "San Antonio Spurs",
      "Utah Jazz"
    ]
  },
  "totals": {
    "Atlanta Hawks": 43.5,
    "Boston Celtics": 51.5,
    "Brooklyn Nets": 24.5,
    "Charlotte Hornets": 37.5,
    "Chicago Bulls": 27.5,
    "Cleveland Cavaliers": 47.5,
    "Dallas Mavericks": 34.5,
    "Denver Nuggets": 49.5,
    "Detroit Pistons": 49.5,
    "Golden State Warriors": 40.5,
    "Houston Rockets": 47.5,
    "Indiana Pacers": 44.5,
    "Los Angeles Clippers": 30.5,
    "Los Angeles Lakers": 46.5,
    "Memphis Grizzlies": 28.5,
    "Miami Heat": 46.5,
    "Milwaukee Bucks": 25.5,
    "Minnesota Timberwolves": 48.5,
    "New Orleans Pelicans": 27.5,
    "New York Knicks": 52.5,
    "Oklahoma City Thunder": 62.5,
    "Orlando Magic": 43.5,
    "Philadelphia 76ers": 50.5,
    "Phoenix Suns": 38.5,
    "Portland Trail Blazers": 42.5,
    "San Antonio Spurs": 59.5,
    "Sacramento Kings": 21.5,
    "Toronto Raptors": 45.5,
    "Utah Jazz": 35.5,
    "Washington Wizards": 34.5
  }
};
const NBA_LOGOS = {
  "Atlanta Hawks": "atl",
  "Boston Celtics": "bos",
  "Brooklyn Nets": "bkn",
  "Charlotte Hornets": "cha",
  "Chicago Bulls": "chi",
  "Cleveland Cavaliers": "cle",
  "Detroit Pistons": "det",
  "Indiana Pacers": "ind",
  "Miami Heat": "mia",
  "Milwaukee Bucks": "mil",
  "New York Knicks": "ny",
  "Orlando Magic": "orl",
  "Philadelphia 76ers": "phi",
  "Toronto Raptors": "tor",
  "Washington Wizards": "wsh",
  "Dallas Mavericks": "dal",
  "Denver Nuggets": "den",
  "Golden State Warriors": "gs",
  "Houston Rockets": "hou",
  "Los Angeles Clippers": "lac",
  "Los Angeles Lakers": "lal",
  "Memphis Grizzlies": "mem",
  "Minnesota Timberwolves": "min",
  "New Orleans Pelicans": "no",
  "Oklahoma City Thunder": "okc",
  "Phoenix Suns": "phx",
  "Portland Trail Blazers": "por",
  "Sacramento Kings": "sac",
  "San Antonio Spurs": "sa",
  "Utah Jazz": "utah"
};
function sportUrl(path) {
  if (!IS_NBA) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("sport", SPORT);
  return url.pathname + url.search + url.hash;
}
function emptySeeds() {
  return Object.fromEntries(CONFERENCES.map(conference => [conference, Array(SEED_COUNT).fill("")]));
}
