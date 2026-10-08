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

test("bracket connectors use symmetric matchup centers regardless of the selected row", async () => {
  const { shareConnectorPoints } = await import("../frontend/share-card.js");
  const source = { x: 32, y: 188, width: 144, height: 72, selected: "Top team" };
  const target = { x: 196, y: 232, width: 144, height: 72 };
  const expected = [[176, 224], [186, 224], [186, 268], [196, 268]];
  assert.deepEqual(shareConnectorPoints(source, target, 0), expected);
  source.selected = "Bottom team";
  assert.deepEqual(shareConnectorPoints(source, target, 0), expected);
  const mirrored = shareConnectorPoints({ ...source, x: 1024 }, { ...target, x: 860 }, 1);
  assert.deepEqual(mirrored, expected.map(([x, y]) => [1200 - x, y]));
  assert.deepEqual(shareConnectorPoints({ x: 360, y: 320, width: 144, height: 72 },
    { x: 522, y: 320, width: 156, height: 72 }, 0), [[504, 356], [513, 356], [513, 356], [522, 356]]);
});

test("image models contain only public fields and never create bracket URLs", async () => {
  const { createShareModel } = await modelModule;
  for (const sport of ["nfl", "nba"]) {
    const model = createShareModel(context(sport));
    assert.equal(model.kind, "picks");
    assert.equal(model.champion, "Team One");
    assert.deepEqual(model.matchup, ["Team One", "Team Two"]);
    assert.deepEqual(model.conferences.map(c => c.name), sport === "nba" ? ["West", "East"] : ["AFC", "NFC"]);
    assert.doesNotMatch(JSON.stringify(model), /PRIVATE|ownerId|memberId|email|invite|password|profileKey/);
    assert.equal("url" in model, false);
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
  const { publicPlayerName } = await modelModule;
  for (const player of ["private@example.com", "<script>", "a".repeat(36), "ab", "a/b", "a?token", null]) {
    assert.throws(() => publicPlayerName(player));
  }
  assert.equal(publicPlayerName("O'Brien Jr"), "O'Brien Jr");
});

test("native sharing accepts only image files and never falls back to a URL", async () => {
  const { nativeSharePayload, createShareModel } = await modelModule;
  const model = createShareModel(context());
  const file = new File(["PNG fixture"], "predict-playoffs-nfl-2026-bracket.png", { type: "image/png" });
  const navigator = { share() {}, canShare: payload => payload.files[0] === file };
  assert.deepEqual(nativeSharePayload(model, file, navigator), { title: "My playoff bracket", files: [file] });
  assert.equal(nativeSharePayload(model, null, navigator), null);
  navigator.canShare = () => false;
  assert.equal(nativeSharePayload(model, file, navigator), null);
  navigator.canShare = () => { throw new Error("policy"); };
  assert.equal(nativeSharePayload(model, file, navigator), null);
  assert.equal(nativeSharePayload(model, file, { share() {} }), null);
  assert.equal(nativeSharePayload(model, file, {}), null);
  assert.equal(nativeSharePayload(model, file, { share() {}, canShare: true }), null);
});

test("share files use safe season filenames and reject empty, spoofed, wrong-type or oversized images", async () => {
  const { shareImageFilename, isShareImageFile, nativeSharePayload, MAX_SHARE_IMAGE_BYTES } = await modelModule;
  assert.equal(shareImageFilename({ sport: "NFL", season: "2026", kind: "picks" }), "predict-playoffs-nfl-2026-bracket.png");
  assert.equal(shareImageFilename({ sport: "NBA", season: "2026–27", kind: "results" }), "predict-playoffs-nba-2026-27-results.png");
  assert.equal(shareImageFilename({ sport: "NBA", season: "PRIVATE/URL", kind: "picks" }), "predict-playoffs-nba-season-bracket.png");
  const navigator = { share() { throw new Error("must not share"); }, canShare() { throw new Error("must not check an invalid file"); } };
  for (const file of [null, { size: 100, name: "image.png", type: "image/png" },
    new File([], "image.png", { type: "image/png" }),
    new File(["jpeg"], "image.png", { type: "image/jpeg" }),
    new File(["png"], "image.jpg", { type: "image/png" }),
    new File([new Uint8Array(MAX_SHARE_IMAGE_BYTES + 1)], "image.png", { type: "image/png" })]) {
    assert.equal(isShareImageFile(file), false);
    assert.equal(nativeSharePayload({}, file, navigator), null);
  }
});

test("PNG export verifies MIME, signature, dimensions, size and failed encodes", async () => {
  const { canvasPng } = await import("../frontend/share-card.js");
  const { MAX_SHARE_IMAGE_BYTES } = await modelModule;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64");
  const png = new Blob([bytes], { type: "image/png" });
  const canvas = { width: 1, height: 1, toBlob(callback, type) { assert.equal(type, "image/png"); callback(png); } };
  assert.equal(await canvasPng(canvas), png);
  for (const blob of [null, new Blob([], { type: "image/png" }),
    new Blob([bytes], { type: "image/jpeg" }), new Blob([new Uint8Array(68)], { type: "image/png" }),
    new Blob([new Uint8Array(MAX_SHARE_IMAGE_BYTES + 1)], { type: "image/png" })]) {
    await assert.rejects(canvasPng({ ...canvas, toBlob: callback => callback(blob) }));
  }
  await assert.rejects(canvasPng({ ...canvas, width: 1200 }), /PNG/);
  await assert.rejects(canvasPng({ ...canvas, toBlob() { throw new DOMException("Blocked", "SecurityError"); } }));
});

test("image download cleans temporary anchors and propagates failures for the visible save fallback", async () => {
  const { downloadShareImage, usesIosImageSaving } = await import("../frontend/sharing.js");
  const previousDocument = global.document;
  const anchors = [];
  let fail = false;
  global.document = { body: { appendChild() {} }, createElement: () => {
    const anchor = { click() { if (fail) throw new Error("Blocked"); }, remove() { this.removed = true; } };
    anchors.push(anchor); return anchor;
  } };
  try {
    downloadShareImage("blob:local-png", "predict-playoffs-nfl-2026-bracket.png");
    assert.equal(anchors[0].href, "blob:local-png");
    assert.equal(anchors[0].download, "predict-playoffs-nfl-2026-bracket.png");
    assert.equal(anchors[0].removed, true);
    fail = true;
    assert.throws(() => downloadShareImage("blob:local-png", "bracket.png"), /Blocked/);
    assert.equal(anchors[1].removed, true);
    assert.throws(() => downloadShareImage("https://example.com/bracket", "bracket.png"), /unavailable/);
    assert.equal(usesIosImageSaving({ userAgent: "iPhone" }), true);
    assert.equal(usesIosImageSaving({ platform: "MacIntel", maxTouchPoints: 5 }), true);
    assert.equal(usesIosImageSaving({ platform: "MacIntel", maxTouchPoints: 0 }), false);
    assert.equal(usesIosImageSaving({ userAgent: "Android" }), false);
  } finally { global.document = previousDocument; }
});

test("object URLs are revoked on close and retained briefly for asynchronous downloads", async () => {
  const { releaseShareImageUrl } = await import("../frontend/sharing.js");
  const previousRevoke = URL.revokeObjectURL, previousTimeout = global.setTimeout;
  const revoked = [], pending = [];
  URL.revokeObjectURL = url => revoked.push(url);
  global.setTimeout = (callback, delay) => pending.push({ callback, delay });
  try {
    releaseShareImageUrl(null);
    releaseShareImageUrl("blob:preview");
    assert.deepEqual(revoked, ["blob:preview"]);
    releaseShareImageUrl("blob:download", true);
    assert.equal(pending[0].delay, 60_000);
    assert.deepEqual(revoked, ["blob:preview"]);
    pending[0].callback();
    assert.deepEqual(revoked, ["blob:preview", "blob:download"]);
  } finally { URL.revokeObjectURL = previousRevoke; global.setTimeout = previousTimeout; }
});

test("share controls have visible text, a decorative standard share icon, and matching accessible names", () => {
  const source = fs.readFileSync(`${__dirname}/../frontend/share-entry.js`, "utf8");
  const sandbox = vm.createContext({ document: { createElement: tag => ({ tag, children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(node) { this.children.push(node); }, addEventListener() {} }) } });
  vm.runInContext(source, sandbox);
  const button = sandbox.createPredictionShareButton("JakeH");
  assert.equal(button.children[0].textContent, "Share bracket");
  assert.equal(button.attributes["aria-label"], "Share bracket");
  assert.match(button.innerHTML, /<svg[^>]+aria-hidden="true"[^>]+focusable="false"/);
  assert.equal((button.innerHTML.match(/<circle /g) || []).length, 3);
  assert.match(button.innerHTML, /<path /);
  const results = sandbox.createPredictionShareButton("JakeH", "results", "classic", "Share results");
  assert.equal(results.children[0].textContent, "Share results");
  assert.equal(results.attributes["aria-label"], "Share results");
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
    teamLogoUrl: name => `https://a.espncdn.com/i/teamlogos/nfl/500/${name}.png`,
    window: { location: { origin: "https://example.com" } }, showToast() {},
  });
  vm.runInContext(source.replace('import("./sharing.js")', "loadSharing()"), sandbox);
  await sandbox.sharePrediction("JakeH", "results", "vegas");
  assert.deepEqual(requests, ["/api/leaderboard/JakeH/bracket", "/api/leaderboard"]);
  assert.equal(opened[0].rank, 3);
  assert.equal(opened[0].mode, "vegas");
  assert.equal(opened[0].bracket, publicData);
  assert.equal(typeof opened[0].buildGames, "function");
  assert.equal(typeof opened[0].logoUrl, "function");
  assert.equal("groupLeaderboard" in opened[0], false);
});

test("editor sharing checks eligibility before fetching and again before opening the image", async () => {
  const source = fs.readFileSync(`${__dirname}/../frontend/share-entry.js`, "utf8");
  const requests = [], opened = [];
  let eligible = false, finish;
  const sandbox = vm.createContext({
    loadSharing: () => new Promise(resolve => { finish = () => resolve({ openShareCard: async value => opened.push(value) }); }),
    apiRequest: async path => { requests.push(path); return context().bracket; },
    showToast() {},
  });
  vm.runInContext(source.replace('import("./sharing.js")', "loadSharing()"), sandbox);
  await sandbox.sharePrediction("JakeH", "picks", "classic", () => eligible);
  assert.equal(requests.length, 0, "unsaved drafts never fetch a saved image");
  eligible = true;
  const sharing = sandbox.sharePrediction("JakeH", "picks", "classic", () => eligible);
  eligible = false;
  finish(); await sharing;
  assert.equal(requests.length, 2);
  assert.equal(opened.length, 0, "a draft edited during loading cannot open a stale image");
});

test("share logos reuse only sport-specific public CDN paths with anonymous CORS and no referrer", async () => {
  const { loadShareLogos } = await import("../frontend/share-card.js");
  const previousImage = global.Image, requested = [];
  global.Image = class {
    naturalWidth = 500;
    naturalHeight = 500;
    set src(url) {
      requested.push({ url, cors: this.crossOrigin, referrer: this.referrerPolicy });
      queueMicrotask(() => this.onload?.());
    }
  };
  try {
    for (const sport of ["NFL", "NBA"]) {
      const model = { sport, conferences: [{ seeds: ["One", "One", "Two", "Bad", "Private", "WrongSport", "Missing"].map(name => ({ name })) }] };
      const urls = { One: `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/min.png`,
        Two: `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/bos.png`,
        Bad: "https://untrusted.example/PRIVATE.png", Private: `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/min.png?invite=PRIVATE`,
        WrongSport: `https://a.espncdn.com/i/teamlogos/${sport === "NFL" ? "nba" : "nfl"}/500/min.png` };
      const logos = await loadShareLogos(model, name => urls[name]);
      assert.deepEqual([...logos.keys()], ["One", "Two"]);
    }
    assert.equal(requested.length, 4); // Duplicate seeds are fetched once per export.
    for (const request of requested) {
      assert.equal(request.cors, "anonymous"); assert.equal(request.referrer, "no-referrer");
      assert.doesNotMatch(request.url, /PRIVATE|invite/);
    }
  } finally { global.Image = previousImage; }
});

test("failed, empty, slow, or unavailable logos leave a usable text-only export", async () => {
  const { loadShareLogos, shareTeamName } = await import("../frontend/share-card.js");
  const previousImage = global.Image;
  global.Image = class {
    naturalWidth = 0;
    naturalHeight = 0;
    set src(url) {
      if (!url) return;
      if (url.endsWith("err.png")) queueMicrotask(() => this.onerror?.());
      if (url.endsWith("emp.png")) queueMicrotask(() => this.onload?.());
    }
  };
  try {
    const model = { sport: "NBA", conferences: [{ seeds: ["err", "emp", "slow"].map(name => ({ name })) }] };
    assert.equal((await loadShareLogos(model, name => `https://a.espncdn.com/i/teamlogos/nba/500/${name}.png`, { timeoutMs: 10 })).size, 0);
    assert.equal((await loadShareLogos(model)).size, 0);
    assert.equal((await loadShareLogos(model, () => { throw new Error("missing"); })).size, 0);
    assert.equal(shareTeamName("Portland Trail Blazers"), "Trail Blazers");
    assert.equal(shareTeamName("Minnesota Timberwolves"), "Timberwolves");
    assert.equal(shareTeamName("San Francisco 49ers"), "49ers");
    assert.equal(shareTeamName(null), "TBD");
  } finally { global.Image = previousImage; }
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
    for (const event of ["share_card_opened", "share_image_generated", "share_native_used", "share_image_downloaded"]) {
      sandbox.siteAnalytics.track(event, { player: "PRIVATE", groupId: "PRIVATE", url: "PRIVATE" });
      if (!blocked) assert.deepEqual(payloads.at(-1), { event, page: "/groups" });
    }
    sandbox.siteAnalytics.track("share_link_copied", {});
    assert.equal(payloads.length, blocked ? 0 : 4);
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
