// Optional browser integration checks. No live accounts, AWS, or deployment.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PP_PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../frontend");
const output = path.join(root, "screenshots");
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  const relative = route === "/" ? "index.html" : route.slice(1);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404).end(); return;
  }
  const ext = path.extname(target);
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  // Same CSP restrictions relevant to cards: no inline scripts/styles or blob images.
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://a.espncdn.com; connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com; object-src 'none'; base-uri 'self'");
  response.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.PP_BROWSER_CHANNEL || "msedge", headless: true });
  const errors = [];
  const events = [];
  const records = new Map();
  async function boot(signedIn) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
    await context.addInitScript(({ signedIn }) => {
      if (signedIn) localStorage.setItem("road-to-bowl.auth.session", JSON.stringify({ accessToken: "fixture", idToken: "", expiresAt: Date.now() + 3600000 }));
      Object.defineProperty(navigator, "canShare", { value: ({ files }) => Boolean(files?.length) });
      Object.defineProperty(navigator, "share", { value: async payload => {
        if (window.cancelShare) throw new DOMException("Cancelled", "AbortError");
        window.sharedPayload = { title: payload.title, url: payload.url, files: payload.files?.map(file => ({ name: file.name, type: file.type, size: file.size })) };
      } });
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (this.canvas.width === 1200 && this.canvas.height === 630) {
          (this.canvas.bracketText || (this.canvas.bracketText = [])).push(String(args[0]));
        }
        return fillText.apply(this, args);
      };
    }, { signedIn });
    await context.route("**/auth-config.js", route => route.fulfill({ contentType: "application/javascript", body: 'window.AUTH_CONFIG = {environment:"dev", clientId:"fixture", region:"us-east-1"};' }));
    await context.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const sport = url.searchParams.get("sport") === "nba" ? "nba" : "nfl";
      let result = {}, status = 200;
      const record = records.get(sport);
      if (url.pathname === "/api/profile") result = { leaderboardName: "JakeH" };
      else if (url.pathname === "/api/prediction-window") result = { season: sport === "nba" ? 2027 : 2026, locked: false, serverTime: Date.now(), lockAt: "2099-12-31T23:59:59Z", devNflUnlocked: sport === "nfl" };
      else if (url.pathname === "/api/win-totals") result = { totals: {}, source: "Browser fixture" };
      else if (url.pathname === "/api/groups" && request.method() === "POST") result = { groupId: "fixture-group", groupName: "Browser Crew", sports: [sport], isCreator: true };
      else if (url.pathname === "/api/groups") result = { groups: [] };
      else if (url.pathname.endsWith("/invite")) result = { groupId: "fixture-group", groupName: "Browser Crew", inviteCode: "PRIVATE" };
      else if (url.pathname === "/api/analytics") { events.push(JSON.parse(request.postData())); status = 202; }
      else if (url.pathname === "/api/prediction" && request.method() === "PUT") {
        result = { ...JSON.parse(request.postData()), leaderboardName: "JakeH", savedAt: Date.now(), season: sport === "nba" ? 2027 : 2026,
          score: { status: "Playoffs in progress", regularSeason: 100, playoffs: 72, total: 172, possible: 200, maximum: 300 },
          vegasScore: { possible: 260, total: 181.25 }, championStatus: "alive" };
        records.set(sport, result);
      } else if (url.pathname === "/api/prediction" || url.pathname.endsWith("/bracket")) {
        result = record || { message: "No prediction" }; status = record ? 200 : 404;
        if (url.pathname.endsWith("/bracket")) assert.equal(request.headers().authorization, undefined);
      } else if (url.pathname === "/api/leaderboard") {
        assert.equal(request.headers().authorization, undefined);
        result = { season: sport === "nba" ? 2027 : 2026, entries: record ? [{ leaderboardName: "JakeH", superBowl: record.picks.superBowl,
          scores: { classic: record.score, vegas: record.vegasScore } }] : [] };
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    return { context, page };
  }
  try {
    const { context, page } = await boot(true);
    for (const name of ["index", "nba", "groups", "leaderboard", "scoring", "privacy"]) {
      await page.goto(`${origin}/${name}.html`, { waitUntil: "networkidle" });
      await page.locator("#header-account").click();
      await page.locator("#close-account-dialog").click();
      assert.deepEqual(errors, [], `${name} page loads without runtime errors`);
    }
    await page.goto(`${origin}/scoring.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => openPrediction());
    await page.waitForURL("**/picks.html");
    await page.goto(`${origin}/index.html`, { waitUntil: "networkidle" });
    await page.locator("#home-create-group").click();
    await page.locator("#group-name").fill("Browser Crew");
    await page.locator("#group-password").fill("fixture-password");
    await page.locator("#submit-group").click();
    await page.locator("#group-invite-link").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#group-invite-link").value.includes("invite="));
    assert.match(await page.locator("#group-invite-link").inputValue(), /invite=/);
    await page.locator("#close-group-invite").click();
    for (const sport of ["nfl", "nba"]) {
      await page.goto(`${origin}/picks.html${sport === "nba" ? "?sport=nba" : ""}`, { waitUntil: "networkidle" });
      await page.locator("#randomize-bracket").click();
      assert.equal(await page.evaluate(() => allGamesPicked()), true);
      assert.equal(await page.evaluate(() => validateSeeding()), "");
      await page.locator("#save-prediction").click();
      await page.getByRole("button", { name: "Share my picks", exact: true }).click();
      await page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.deepEqual(await page.locator(".prediction-share-preview canvas").evaluate(node => [node.width, node.height]), [1200, 630]);
      const bracketLabel = await page.locator("canvas").getAttribute("aria-label");
      assert.match(bracketLabel, /Full playoff bracket/);
      for (const conference of Object.keys(records.get(sport).seeds)) {
        for (const team of records.get(sport).seeds[conference]) assert.ok(bracketLabel.includes(team));
        for (const pick of Object.values(records.get(sport).picks[conference])) assert.ok(bracketLabel.includes(`pick ${pick}`));
      }
      const drawn = await page.locator("canvas").evaluate(node => node.bracketText);
      const allTeams = Object.values(records.get(sport).seeds).flat();
      for (const team of allTeams) {
        for (const word of team.split(" ")) assert.ok(drawn.some(text => text.split(" ").includes(word)), `export draws ${team}`);
      }
      assert.equal(drawn.filter(text => text === "First-round bye").length, sport === "nfl" ? 2 : 0);
      await page.screenshot({ path: path.join(output, `share-${sport}-desktop.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `share-${sport}-desktop-viewport.png`) });
      await page.locator(".prediction-share-preview canvas").screenshot({ path: path.join(output, `share-${sport}-card.png`) });
      const downloading = page.waitForEvent("download");
      await page.locator("[data-share-download]").click();
      const download = await downloading;
      await download.saveAs(path.join(output, `share-${sport}-download.png`));
      const bytes = fs.readFileSync(path.join(output, `share-${sport}-download.png`));
      assert.equal(bytes.readUInt32BE(16), 1200); assert.equal(bytes.readUInt32BE(20), 630);
      await page.locator("[data-share-copy]").click();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(new URL(link).searchParams.get("player"), "JakeH");
      assert.doesNotMatch(link, /group|invite|fixture|password/);
      await page.locator("[data-share-native]").click();
      assert.equal(await page.evaluate(() => sharedPayload.files[0].type), "image/png");
      const nativeEvents = events.filter(event => event.event === "share_native_used").length;
      await page.evaluate(() => { window.cancelShare = true; });
      await page.locator("[data-share-native]").click();
      assert.equal(events.filter(event => event.event === "share_native_used").length, nativeEvents);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, `share-${sport}-mobile.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `share-${sport}-mobile-viewport.png`) });
      assert.equal(await page.locator(".prediction-share-dialog").evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await page.getByRole("button", { name: "Close sharing" }).click();
      await page.getByRole("button", { name: "Share my results", exact: true }).click();
      await page.locator("[data-share-download]:not([disabled])").waitFor();
      const label = await page.locator("canvas").getAttribute("aria-label");
      assert.match(label, /172 points/); assert.match(label, /Rank 1 overall/);
      assert.match(label, /Full playoff bracket/);
      const resultsDownloading = page.waitForEvent("download");
      await page.locator("[data-share-download]").click();
      const resultsDownload = await resultsDownloading;
      const resultsPath = path.join(output, `share-${sport}-results-download.png`);
      await resultsDownload.saveAs(resultsPath);
      const resultsBytes = fs.readFileSync(resultsPath);
      assert.equal(resultsBytes.readUInt32BE(16), 1200); assert.equal(resultsBytes.readUInt32BE(20), 630);
      await page.locator("canvas").screenshot({ path: path.join(output, `share-${sport}-results.png`) });
      await page.screenshot({ path: path.join(output, `share-${sport}-results-mobile-viewport.png`) });
      await page.getByRole("button", { name: "Close sharing" }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      // Reload the saved record, then exercise locked/read-only behavior.
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => allGamesPicked()), true);
      await page.evaluate(() => setPredictionEditingLocked(true));
      assert.equal(await page.locator("#save-prediction").isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Share my picks", exact: true }).isEnabled(), true);
    }
    await context.close();
    const anonymous = await boot(false);
    for (const sport of ["nfl", "nba"]) {
      await anonymous.page.goto(`${origin}/leaderboard.html?player=JakeH${sport === "nba" ? "&sport=nba" : ""}`, { waitUntil: "networkidle" });
      await anonymous.page.locator("#public-bracket-content .public-champion").waitFor();
      assert.equal(await anonymous.page.evaluate(() => state.signedIn), false);
      await anonymous.page.getByRole("button", { name: "Share results", exact: true }).click();
      await anonymous.page.locator("[data-share-download]:not([disabled])").waitFor();
      await anonymous.page.getByRole("button", { name: "Close sharing" }).click();
      await anonymous.page.locator("#close-public-bracket").click();
      await anonymous.page.locator("#upset-leaderboard-mode").click();
      await anonymous.page.locator(".leaderboard-player-button").click();
      await anonymous.page.getByRole("button", { name: "Share results", exact: true }).click();
      await anonymous.page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.match(await anonymous.page.locator("canvas").getAttribute("aria-label"), /181.25 points, Upset Edge/);
    }
    assert.deepEqual(errors, []);
    for (const event of events) assert.doesNotMatch(JSON.stringify(event), /JakeH|PRIVATE|fixture|password|invite/);
    for (const name of ["share_card_opened", "share_image_generated", "share_native_used", "share_image_downloaded", "share_link_copied"]) assert.ok(events.some(event => event.event === name));
    await anonymous.context.close();
    console.log("Browser checks passed: page loading, account modal, home group creation/invite, NFL/NBA randomize/save/reload/lock, public anonymous links, Classic/Upset Edge sharing, PNG downloads, clipboard, native image sharing/cancel, and mobile overflow.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
