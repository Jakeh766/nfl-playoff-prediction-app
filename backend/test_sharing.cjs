const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const modelModule = import("../frontend/share-model.js");
function rules(sport) {
  const sandbox = vm.createContext({ IS_NBA: sport === "nba" });
  vm.runInContext(fs.readFileSync(`${__dirname}/../frontend/bracket.js`, "utf8"), sandbox);
  return sandbox.buildConferenceGames;
}

function context(sport = "nfl") {
  const conferences = sport === "nba" ? ["West", "East"] : ["AFC", "NFC"];
  return { sport, buildGames: rules(sport), season: sport === "nba" ? "2026–27" : 2026,
    origin: "https://dev.predictplayoffs.com/?invite=PRIVATE", rank: 3,
    bracket: { leaderboardName: "JakeH", season: 2026,
      picks: { [conferences[0]]: { conf: "Team One" }, [conferences[1]]: { conf: "Team Two" }, superBowl: "Team One" },
      seeds: { [conferences[0]]: ["Seed One"], [conferences[1]]: ["Seed Two"] },
      score: { possible: 200, total: 172, maximum: 300 }, vegasScore: { possible: 250, total: 181.25 },
      championStatus: "alive", email: "PRIVATE", ownerId: "PRIVATE", memberId: "PRIVATE",
      groupName: "PRIVATE", inviteCode: "PRIVATE", profileKey: "PRIVATE", password: "PRIVATE" } };
}

test("cards and URLs contain only public fields for both sports", async () => {
  const { createShareModel } = await modelModule;
  for (const sport of ["nfl", "nba"]) {
    const model = createShareModel(context(sport));
    assert.equal(model.kind, "picks");
    assert.equal(model.champion, "Team One");
    assert.deepEqual(model.matchup, ["Team One", "Team Two"]);
    assert.deepEqual(model.conferences.map(c => c.name), sport === "nba" ? ["West", "East"] : ["AFC", "NFC"]);
    assert.doesNotMatch(JSON.stringify(model), /PRIVATE|ownerId|memberId|email|invite|password|profileKey/);
    const url = new URL(model.url);
    assert.equal(url.origin, "https://dev.predictplayoffs.com");
    assert.equal(url.pathname, "/leaderboard");
    assert.deepEqual([...url.searchParams.keys()], sport === "nba" ? ["player", "sport"] : ["player"]);
  }
});

test("results use the selected public scoring mode without inventing remaining potential", async () => {
  const { createShareModel } = await modelModule;
  const input = { ...context(), kind: "results", mode: "vegas" };
  const model = createShareModel(input);
  assert.equal(model.total, 181.25);
  assert.equal(model.mode, "Upset Edge");
  assert.equal(model.rank, 3);
  assert.equal(model.championStatus, "alive");
  assert.equal("maximum" in model, false);
  assert.equal("maxPossible" in model, false);
  input.bracket.vegasScore.possible = 0;
  assert.equal(createShareModel(input).kind, "picks");
  input.bracket.vegasScore.possible = 250;
  input.rank = null;
  input.bracket.championStatus = "unverified";
  assert.equal(createShareModel(input).rank, null);
  assert.equal(createShareModel(input).championStatus, null);
});

test("public names reject emails, IDs, malformed links, and oversized values", async () => {
  const { publicPredictionUrl } = await modelModule;
  for (const player of ["private@example.com", "<script>", "a".repeat(36), "ab", "a/b", "a?token", null]) {
    assert.throws(() => publicPredictionUrl({ origin: "https://example.com", player, sport: "nfl" }));
  }
  const url = publicPredictionUrl({ origin: "http://localhost:8000/picks.html?group=PRIVATE#secret", player: "O'Brien Jr", sport: "nba", local: true });
  assert.equal(new URL(url).searchParams.get("player"), "O'Brien Jr");
  assert.equal(new URL(url).pathname, "/leaderboard.html");
  assert.doesNotMatch(url, /PRIVATE|secret/);
});

test("native sharing prefers the image and falls back to the public URL", async () => {
  const { nativeSharePayload, createShareModel } = await modelModule;
  const model = createShareModel(context());
  const file = { type: "image/png" };
  const navigator = { share() {}, canShare: payload => payload.files[0] === file };
  assert.deepEqual(nativeSharePayload(model, file, navigator).files, [file]);
  navigator.canShare = () => false;
  assert.equal("files" in nativeSharePayload(model, file, navigator), false);
  navigator.canShare = () => { throw new Error("policy"); };
  assert.equal(nativeSharePayload(model, file, navigator).url, model.url);
  assert.equal(nativeSharePayload(model, file, {}), null);
});

test("sharing inside a group refetches public data and never uses the group board", async () => {
  const source = fs.readFileSync(`${__dirname}/../frontend/share-entry.js`, "utf8");
  const requests = [], opened = [];
  const publicData = context().bracket;
  const sandbox = vm.createContext({
    loadSharing: async () => ({ openShareCard: async value => opened.push(value) }),
    apiRequest: async path => { requests.push(path); return path === "/api/leaderboard" ? { season: 2026, entries: [{ leaderboardName: "JakeH", rank: 3 }] } : publicData; },
    rankLeaderboardEntries: entries => entries, state: { groupLeaderboard: { entries: [{ memberId: "PRIVATE" }] } },
    SPORT: "nfl", IS_NBA: false, LOCAL_PREVIEW: false,
    buildConferenceGames: rules("nfl"),
    window: { location: { origin: "https://example.com" } }, showToast() {},
  });
  vm.runInContext(source.replace('import("./sharing.js")', "loadSharing()"), sandbox);
  await sandbox.sharePrediction("JakeH", "results", "vegas");
  assert.deepEqual(requests, ["/api/leaderboard/JakeH/bracket", "/api/leaderboard"]);
  assert.equal(opened[0].rank, 3);
  assert.equal(opened[0].mode, "vegas");
  assert.equal(opened[0].bracket, publicData);
  assert.equal(typeof opened[0].buildGames, "function");
  assert.equal("groupLeaderboard" in opened[0], false);
});

test("full NFL export follows reseeding, including the first seed bye and every picked winner", async () => {
  const { createShareModel } = await modelModule;
  const input = context();
  input.bracket.seeds = { AFC: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    NFC: ["N1", "N2", "N3", "N4", "N5", "N6", "N7"] };
  input.bracket.picks = { AFC: { "wc-2-7": "A7", "wc-3-6": "A3", "wc-4-5": "A5", "div-1": "A7", "div-2": "A3", conf: "A7" },
    NFC: { "wc-2-7": "N2", "wc-3-6": "N3", "wc-4-5": "N4", "div-1": "N1", "div-2": "N2", conf: "N1" }, superBowl: "A7",
    privateData: "PRIVATE" };
  const model = createShareModel(input);
  const [afc, nfc] = model.conferences;
  assert.deepEqual(afc.rounds.map(r => r.games.length), [3, 2, 1]);
  assert.deepEqual(afc.rounds[1].games.map(g => g.teams.map(t => t.name)), [["A1", "A7"], ["A3", "A5"]]);
  assert.equal(afc.seeds[0].name, "A1");
  assert.deepEqual(afc.rounds.flatMap(r => r.games.map(g => g.selected)), ["A7", "A3", "A5", "A7", "A3", "A7"]);
  assert.equal(nfc.seeds.length + afc.seeds.length, 14);
  assert.deepEqual(model.matchup, ["A7", "N1"]);
  assert.equal(model.champion, "A7");
  assert.doesNotMatch(JSON.stringify(model), /PRIVATE|privateData/);
});

test("full NBA export keeps fixed first-round slots and all sixteen seeded teams", async () => {
  const { createShareModel } = await modelModule;
  const input = context("nba");
  input.bracket.seeds = { West: Array.from({ length: 8 }, (_, i) => `W${i + 1}`), East: Array.from({ length: 8 }, (_, i) => `E${i + 1}`) };
  input.bracket.picks = { West: { "r1-1-8": "W8", "r1-4-5": "W4", "r1-2-7": "W2", "r1-3-6": "W3", "div-1": "W8", "div-2": "W2", conf: "W8" },
    East: { "r1-1-8": "E1", "r1-4-5": "E4", "r1-2-7": "E2", "r1-3-6": "E3", "div-1": "E1", "div-2": "E2", conf: "E1" }, superBowl: "W8" };
  const model = createShareModel(input);
  const west = model.conferences[0];
  assert.deepEqual(west.rounds.map(r => r.games.length), [4, 2, 1]);
  assert.deepEqual(west.rounds[0].games.map(g => g.teams.map(t => t.seed)), [[1, 8], [4, 5], [2, 7], [3, 6]]);
  assert.deepEqual(west.rounds[1].games.map(g => g.teams.map(t => t.name)), [["W4", "W8"], ["W2", "W3"]]);
  assert.equal(model.conferences.reduce((n, c) => n + c.seeds.length, 0), 16);
  assert.deepEqual(model.matchup, ["W8", "E1"]);
  // The model owns copies rather than exposing the source record or private properties.
  input.bracket.seeds.West[0] = "PRIVATE";
  input.bracket.picks.West.conf = "PRIVATE";
  assert.equal(west.seeds[0].name, "W1");
  assert.equal(west.rounds[2].games[0].selected, "W8");
});

test("share analytics ignore all supplied identifiers and respect privacy signals", () => {
  const source = fs.readFileSync(`${__dirname}/../frontend/monitoring.js`, "utf8");
  for (const blocked of [false, true]) {
    const payloads = [];
    const sandbox = { location: { pathname: "/groups", hostname: "example.com" },
      AUTH_CONFIG: { environment: "dev" }, navigator: { globalPrivacyControl: blocked },
      document: { cookie: "" }, fetch: async (_url, options) => payloads.push(JSON.parse(options.body)) };
    sandbox.window = sandbox;
    vm.runInNewContext(source, sandbox);
    for (const event of ["share_card_opened", "share_image_generated", "share_native_used", "share_image_downloaded", "share_link_copied"]) {
      sandbox.siteAnalytics.track(event, { player: "PRIVATE", groupId: "PRIVATE", url: "PRIVATE" });
      if (!blocked) assert.deepEqual(payloads.at(-1), { event, page: "/groups" });
    }
    assert.equal(payloads.length, blocked ? 0 : 5);
  }
});

test("page manifests keep unrelated implementations off home and picks", () => {
  const scripts = page => [...fs.readFileSync(`${__dirname}/../frontend/${page}.html`, "utf8").matchAll(/<script src="\/([^?\"]+)/g)].map(m => m[1]);
  for (const page of ["index", "nba"]) {
    assert.ok(scripts(page).includes("group-actions.js"));
    for (const file of ["groups.js", "picks.js", "sharing.js"]) assert.ok(!scripts(page).includes(file));
    assert.ok(scripts(page).includes("leaderboard-table.js")); // Home has a three-player standings preview.
  }
  assert.ok(scripts("picks").includes("bracket.js"));
  assert.ok(!scripts("picks").includes("leaderboard.js"));
  for (const page of ["groups", "leaderboard"]) {
    assert.ok(scripts(page).indexOf("bracket.js") < scripts(page).indexOf("public-bracket.js"));
    assert.ok(scripts(page).indexOf("standings.js") < scripts(page).indexOf("leaderboard-table.js"));
  }
});
