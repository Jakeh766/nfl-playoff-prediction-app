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
  // Same CSP restrictions relevant to cards: no inline scripts/styles; blob images only for local PNG previews.
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: https://a.espncdn.com; connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com; object-src 'none'; base-uri 'self'");
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
  let savedAt = Date.UTC(2026, 9, 8, 14, 57);
  async function boot(signedIn, hasNativeShare = true, device = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...device });
    await context.addInitScript(({ signedIn, hasNativeShare }) => {
      if (signedIn) localStorage.setItem("road-to-bowl.auth.session", JSON.stringify({ accessToken: "fixture", idToken: "", expiresAt: Date.now() + 3600000 }));
      window.shareCalls = 0;
      Object.defineProperty(navigator, "userActivation", { value: { get isActive() { return Boolean(window.nativeActivation); } } });
      Object.defineProperty(navigator, "canShare", { writable: true, configurable: true, value: ({ files }) => !window.disableImageSharing && Boolean(files?.length) });
      Object.defineProperty(navigator, "share", { writable: true, configurable: true, value: hasNativeShare ? async payload => {
        window.shareCalls += 1;
        if (window.holdShare) await new Promise(resolve => { window.finishShare = resolve; });
        if (window.cancelShare) throw new DOMException("Cancelled", "AbortError");
        if (window.failShare) throw new DOMException("Unavailable", "NotAllowedError");
        const bytes = new Uint8Array(await payload.files[0].arrayBuffer());
        window.sharedPayload = { signature: Array.from(bytes.slice(0, 8)), title: payload.title, keys: Object.keys(payload), files: payload.files?.map(file => ({ name: file.name, type: file.type, size: file.size })) };
      } : undefined });
      const encodePng = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        if (this.width === 2400 && this.height === 1260) window.bracketCanvas = this;
        if (window.failImageEncode) { callback(null); return; }
        return encodePng.call(this, callback, ...args);
      };
      const decodeImage = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await decodeImage.call(this);
        if (this.src.startsWith("blob:") && window.bracketCanvas) {
          for (const property of ["bracketText", "bracketLabels", "bracketLogos", "bracketPaths"]) {
            this[property] = window.bracketCanvas[property];
          }
        }
      };
      const clickAnchor = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && window.failDownload) throw new Error("Download blocked");
        return clickAnchor.call(this);
      };
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        if (this.canvas.width === 2400 && this.canvas.height === 1260) {
          (this.canvas.bracketText || (this.canvas.bracketText = [])).push(String(args[0]));
          (this.canvas.bracketLabels || (this.canvas.bracketLabels = [])).push({ text: String(args[0]), color: this.fillStyle });
        }
        return fillText.apply(this, args);
      };
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.width === 2400 && this.canvas.height === 1260) {
          (this.canvas.bracketLogos || (this.canvas.bracketLogos = [])).push({ src: args[0].src, x: args[1], y: args[2], width: args[3], height: args[4] });
        }
        return drawImage.apply(this, args);
      };
      for (const method of ["beginPath", "moveTo", "lineTo", "stroke"]) {
        const original = CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method] = function (...args) {
          if (this.canvas.width === 2400 && this.canvas.height === 1260) {
            if (method === "beginPath") this.sharePath = [];
            if (method === "moveTo" || method === "lineTo") this.sharePath?.push(args.slice(0, 2));
            if (method === "stroke" && this.strokeStyle === "#536a84" && this.lineWidth === 2) {
              (this.canvas.bracketPaths || (this.canvas.bracketPaths = [])).push(this.sharePath);
            }
          }
          return original.apply(this, args);
        };
      }
    }, { signedIn, hasNativeShare });
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
        result = { ...JSON.parse(request.postData()), leaderboardName: "JakeH", savedAt: (savedAt += 60000), season: sport === "nba" ? 2027 : 2026,
          score: { status: "Playoffs in progress", regularSeason: 100, playoffs: 72, total: 172, possible: 200, maximum: 300 },
          vegasScore: { possible: 260, total: 181.25 }, championStatus: "alive" };
        if (sport === "nba") result.divisionWinners = {};
        records.set(sport, result);
      } else if (url.pathname === "/api/prediction" && request.method() === "DELETE") {
        records.delete(sport); result = { deleted: true };
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
      assert.equal(await page.locator("#saved-section, .saved-card").count(), 0);
      assert.equal(await page.locator("#save-state").textContent(), "Not saved yet");
      assert.equal(await page.locator("#share-bracket").isDisabled(), true);
      assert.equal(await page.locator("#save-prediction").textContent(), "Save prediction");
      await page.locator("#save-prediction").click();
      await page.waitForFunction(() => document.querySelector("#share-bracket").disabled === false);
      assert.equal(await page.locator("#toast").textContent(), "Prediction saved");
      assert.equal(await page.locator("#save-prediction").isDisabled(), true);
      const firstSaved = records.get(sport).savedAt;
      assert.equal(await page.locator("#save-state time").getAttribute("datetime"), new Date(firstSaved).toISOString());
      const originalChampion = records.get(sport).picks.superBowl;
      await page.locator("#super-bowl-game .team-pick:not(.selected)").click();
      assert.equal(await page.locator("#save-state").textContent(), "Unsaved changes");
      assert.equal(await page.locator("#share-bracket").isDisabled(), true);
      assert.equal(await page.locator("#bracket-share-help").textContent(), "Save changes before sharing");
      assert.equal(await page.locator("#save-prediction").textContent(), "Save changes");
      await page.locator(".final-actions").screenshot({ path: path.join(output, `social-bracket-${sport}-dirty-desktop.png`) });
      await page.evaluate(champion => handleGamePick("", "super-bowl", champion, true), originalChampion);
      assert.equal(await page.locator("#share-bracket").isEnabled(), true, "reverting a draft restores the saved state");
      await page.locator("#super-bowl-game .team-pick:not(.selected)").click();
      await page.locator("#save-prediction").click();
      await page.waitForFunction(() => document.querySelector("#share-bracket").disabled === false);
      assert.ok(records.get(sport).savedAt > firstSaved);
      assert.equal(await page.locator("#save-state time").getAttribute("datetime"), new Date(records.get(sport).savedAt).toISOString());
      const shareBracket = page.getByRole("button", { name: "Share bracket", exact: true });
      await shareBracket.waitFor();
      assert.equal(await shareBracket.locator("span").textContent(), "Share bracket");
      assert.equal(await shareBracket.getAttribute("aria-label"), "Share bracket");
      assert.equal(await shareBracket.locator('svg[aria-hidden="true"] circle').count(), 3);
      await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("show"));
      await page.locator("#bracket-section").screenshot({ path: path.join(output, `social-bracket-${sport}-bracket-desktop.png`) });
      await page.locator(".bracket-heading").screenshot({ path: path.join(output, `social-bracket-${sport}-heading-desktop.png`) });
      await page.locator(".final-actions").screenshot({ path: path.join(output, `social-bracket-${sport}-actions-desktop.png`) });
      await shareBracket.focus();
      await shareBracket.press("Enter");
      await page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.equal(await page.locator('.prediction-share-dialog [role="status"]').textContent(), "");
      assert.equal(await page.locator('.prediction-share-dialog [role="status"]').evaluate(node => node.getBoundingClientRect().height), 0);
      assert.doesNotMatch(await page.locator(".prediction-share-dialog").textContent(), /Your full saved bracket|Private group details are excluded|Ready to share your bracket image/);
      assert.equal(await page.evaluate(() => window.shareCalls), 0, "expired activation waits for a fresh click");
      const paths = await page.locator(".prediction-share-preview img").evaluate(node => node.bracketPaths);
      assert.equal(paths.length, 14, "every advancement has a connector");
      const centers = new Set([224, 312, 400, 488, 268, 444, 356]);
      for (const points of paths) {
        assert.equal(points.length, 4);
        for (const [, y] of points) assert.ok(centers.has(y), "connector meets the matchup center");
        assert.equal(points[1][0], points[2][0], "connector bend is vertical");
      }
      if (sport === "nba") {
        const firstRound = paths.filter(points => points[0][0] === 176 && points[3][0] === 196)
          .map(points => [points[0][1], points[3][1]]).sort((a, b) => a[0] - b[0]);
        assert.deepEqual(firstRound, [[224, 268], [312, 268], [400, 444], [488, 444]]);
      }
      assert.deepEqual(await page.locator(".prediction-share-preview img").evaluate(node => [node.naturalWidth, node.naturalHeight]), [2400, 1260]);
      const bracketLabel = await page.locator(".prediction-share-preview img").getAttribute("alt");
      assert.match(bracketLabel, /Full playoff bracket/);
      for (const conference of Object.keys(records.get(sport).seeds)) {
        for (const team of records.get(sport).seeds[conference]) assert.ok(bracketLabel.includes(team));
        for (const pick of Object.values(records.get(sport).picks[conference])) assert.ok(bracketLabel.includes(`pick ${pick}`));
      }
      const drawn = await page.locator(".prediction-share-preview img").evaluate(node => node.bracketText);
      const allTeams = Object.values(records.get(sport).seeds).flat();
      for (const team of allTeams) {
        const nickname = team.endsWith("Trail Blazers") ? "Trail Blazers" : team.split(" ").at(-1);
        assert.ok(drawn.includes(nickname), `export draws ${team}`);
      }
      assert.ok(!drawn.includes("Selected winners"));
      assert.ok(!drawn.includes("Fixed playoff bracket"));
      assert.ok(!drawn.some(text => text.includes("?player=") || text.includes("View my bracket")));
      const logos = await page.locator(".prediction-share-preview img").evaluate(node => node.bracketLogos.filter(logo => logo.src.includes("teamlogos")));
      assert.ok(logos.length >= 29, `${sport} export draws logos through every round`);
      assert.ok(logos.some(logo => logo.x > 575 && logo.x < 625 && logo.y > 430), "champion logo is centered");
      const labels = await page.locator(".prediction-share-preview img").evaluate(node => node.bracketLabels);
      assert.ok(labels.some(label => label.color === "#fffefa"), "selected winners use light text on navy");
      assert.ok(labels.some(label => label.color === "#566479"), "non-advanced teams use quieter text");
      assert.equal(drawn.filter(text => text === "First-round bye").length, sport === "nfl" ? 2 : 0);
      await page.screenshot({ path: path.join(output, `social-share-${sport}-desktop.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `social-share-${sport}-desktop-viewport.png`) });
      await page.locator(".prediction-share-preview img").screenshot({ path: path.join(output, `social-share-${sport}-card.png`) });
      const downloading = page.waitForEvent("download");
      await page.locator("[data-share-download]").click();
      const download = await downloading;
      await download.saveAs(path.join(output, `social-share-${sport}-download.png`));
      const bytes = fs.readFileSync(path.join(output, `social-share-${sport}-download.png`));
      assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(bytes.readUInt32BE(16), 2400); assert.equal(bytes.readUInt32BE(20), 1260);
      assert.ok(bytes.length < 1024 * 1024, "the full bracket PNG stays below 1 MB");
      assert.match(download.suggestedFilename(), /^predict-playoffs-(nfl-2026|nba-2026-27)-bracket\.png$/);
      assert.equal(await page.locator(".prediction-share-preview img").evaluate(async image => {
        const bitmap = await createImageBitmap(image);
        const surface = document.createElement("canvas"); surface.width = bitmap.width; surface.height = bitmap.height;
        const ctx = surface.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) return false;
        return true;
      }), true, "export has an opaque background throughout");
      assert.equal(await page.locator(".prediction-share-dialog input, .prediction-share-dialog a, [data-share-copy]").count(), 0);
      assert.doesNotMatch(await page.locator(".prediction-share-dialog").textContent(), /share link|public bracket link|copy.*link|copy.*url|view online/i);
      await page.locator("[data-share-native]").click();
      await page.waitForFunction(() => window.sharedPayload);
      assert.equal(await page.evaluate(() => sharedPayload.files[0].type), "image/png");
      assert.deepEqual(await page.evaluate(() => sharedPayload.keys.sort()), ["files", "title"]);
      assert.equal(await page.evaluate(() => sharedPayload.title), "My playoff bracket");
      assert.deepEqual(await page.evaluate(() => sharedPayload.signature), [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.match(await page.evaluate(() => sharedPayload.files[0].name), /^predict-playoffs-(nfl-2026|nba-2026-27)-bracket\.png$/);
      const nativeEvents = events.filter(event => event.event === "share_native_used").length;
      await page.evaluate(() => { window.cancelShare = true; });
      await page.locator("[data-share-native]").click();
      assert.equal(events.filter(event => event.event === "share_native_used").length, nativeEvents);
      assert.equal(await page.locator('.prediction-share-dialog [role="status"]').textContent(), "", "cancellation is quiet");
      await page.evaluate(() => { window.cancelShare = false; window.failShare = true; });
      await page.locator("[data-share-native]").click();
      assert.match(await page.locator('.prediction-share-dialog [role="status"]').textContent(), /download the bracket image/i);
      assert.equal(await page.locator("[data-share-download]").isEnabled(), true);
      await page.evaluate(() => { window.failShare = false; window.failDownload = true; });
      await page.locator("[data-share-download]").click();
      assert.match(await page.locator('.prediction-share-dialog [role="status"]').textContent(), /Download could not start/);
      assert.equal(await page.locator(".prediction-share-preview img").isVisible(), true);
      assert.equal(await page.locator("[data-share-download]").isEnabled(), true);
      await page.evaluate(() => { window.failDownload = false; });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, `social-share-${sport}-mobile.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `social-share-${sport}-mobile-viewport.png`) });
      assert.equal(await page.locator(".prediction-share-dialog").evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await page.getByRole("button", { name: "Close sharing" }).click();
      await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("show"));
      await page.locator(".bracket-heading").screenshot({ path: path.join(output, `social-bracket-${sport}-heading-mobile.png`) });
      await page.locator(".final-actions").screenshot({ path: path.join(output, `social-bracket-${sport}-actions-mobile.png`) });
      await page.locator("#save-prediction").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `social-bracket-${sport}-page-end-mobile.png`) });
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.locator(".final-actions").evaluate(node => node.scrollWidth <= node.clientWidth), true);
        assert.equal(await shareBracket.locator("span").isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator(".final-actions").evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.deepEqual(await page.locator(".final-actions button").allTextContents(), ["Share bracket", "Save changes"]);
      await page.evaluate(() => { window.disableImageSharing = true; });
      await shareBracket.click();
      await page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.equal(await page.locator("[data-share-native]").isVisible(), false);
      assert.equal(await page.locator('.prediction-share-dialog [role="status"]').textContent(), "");
      assert.doesNotMatch(await page.locator(".prediction-share-dialog").textContent(), /share link|public bracket link|copy.*link|copy.*url/i);
      const unsupportedDownloading = page.waitForEvent("download");
      await page.locator("[data-share-download]").click();
      await (await unsupportedDownloading).saveAs(path.join(output, `social-share-${sport}-unsupported-download.png`));
      await page.screenshot({ path: path.join(output, `social-share-${sport}-download-only-mobile.png`) });
      await page.getByRole("button", { name: "Close sharing" }).click();
      await page.evaluate(() => { window.disableImageSharing = false; });
      await page.setViewportSize({ width: 1440, height: 1000 });
      // Reload the saved record, then exercise locked/read-only behavior.
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => allGamesPicked()), true);
      const persistedTime = records.get(sport).savedAt;
      assert.equal(await page.locator("#save-state time").getAttribute("datetime"), new Date(persistedTime).toISOString(), "reload keeps the saved timestamp");
      await page.locator("#super-bowl-game .team-pick:not(.selected)").click();
      await page.evaluate(() => setPredictionEditingLocked(true));
      assert.equal(await page.locator("#save-state time").getAttribute("datetime"), new Date(persistedTime).toISOString());
      assert.equal(await page.evaluate(() => state.picks.superBowl), records.get(sport).picks.superBowl, "locking restores the persisted bracket");
      assert.equal(await page.locator(".team-pick:enabled").count(), 0);
      await page.locator(".final-actions").screenshot({ path: path.join(output, `social-bracket-${sport}-locked-desktop.png`) });
      assert.equal(await page.locator("#save-prediction").isDisabled(), true);
      assert.equal(await shareBracket.isEnabled(), true);
      // Missing/CORS-blocked logos must still yield a downloadable, origin-clean PNG.
      await context.route("https://a.espncdn.com/**", route => sport === "nfl" ? route.abort() : route.fulfill({
        status: 200, contentType: "image/png",
        headers: { "access-control-allow-origin": "https://not-permitted.example" },
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64"),
      }));
      await shareBracket.click();
      await page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.equal(await page.locator(".prediction-share-preview img").evaluate(node => (node.bracketLogos || []).filter(logo => logo.src.includes("teamlogos")).length), 0);
      assert.match(await page.locator(".prediction-share-preview img").getAttribute("alt"), /Full playoff bracket/);
      const fallbackDownloading = page.waitForEvent("download");
      await page.locator("[data-share-download]").click();
      await (await fallbackDownloading).saveAs(path.join(output, `social-share-${sport}-fallback-download.png`));
      await page.getByRole("button", { name: "Close sharing" }).click();
      await context.unroute("https://a.espncdn.com/**");
      await page.evaluate(() => { window.failImageEncode = true; });
      await shareBracket.click();
      await page.waitForFunction(() => document.querySelector('.prediction-share-dialog [role="status"]')?.textContent.includes("Could not generate"));
      assert.equal(await page.locator("[data-share-download]").isDisabled(), true);
      assert.equal(await page.locator("[data-share-native]").isVisible(), false);
      await page.getByRole("button", { name: "Close sharing" }).click();
      const callsBeforeAutoShare = await page.evaluate(() => window.shareCalls);
      await page.evaluate(() => { window.failImageEncode = false; window.nativeActivation = true; });
      await shareBracket.click();
      await page.waitForFunction(count => window.shareCalls > count && window.sharedPayload, callsBeforeAutoShare);
      assert.equal(await page.evaluate(() => window.shareCalls), callsBeforeAutoShare + 1, "active gesture opens native sharing automatically once");
      await page.getByRole("button", { name: "Close sharing" }).click();
      await page.evaluate(() => { window.nativeActivation = false; });
    }
    await page.evaluate(() => setPredictionEditingLocked(false));
    await page.locator("#header-account").click();
    await page.locator("#delete-prediction").click();
    await page.locator("#cancel-delete-prediction").click();
    assert.ok(records.has("nba"));
    await page.locator("#delete-prediction").click();
    await page.locator("#account-settings-view").screenshot({ path: path.join(output, "social-bracket-account-delete-desktop.png") });
    await page.locator("#confirm-delete-prediction").click();
    await page.waitForFunction(() => state.savedPrediction === null && !state.predictionDeleting);
    assert.equal(records.has("nba"), false);
    assert.equal(records.has("nfl"), true, "deletion affects only the selected sport");
    assert.equal(await page.locator("#save-state").textContent(), "Not saved yet");
    await page.locator("#randomize-bracket").click();
    await page.locator("#save-prediction").click();
    await page.waitForFunction(() => document.querySelector("#share-bracket").disabled === false);
    await context.close();
    const anonymous = await boot(false, false);
    for (const sport of ["nfl", "nba"]) {
      await anonymous.page.goto(`${origin}/leaderboard.html?player=JakeH${sport === "nba" ? "&sport=nba" : ""}`, { waitUntil: "networkidle" });
      await anonymous.page.locator("#public-bracket-content .public-champion").waitFor();
      assert.equal(await anonymous.page.evaluate(() => state.signedIn), false);
      await anonymous.page.getByRole("button", { name: "Share results", exact: true }).click();
      await anonymous.page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.equal(await anonymous.page.locator("[data-share-native]").isVisible(), false);
      assert.equal(await anonymous.page.locator(".prediction-share-dialog input, .prediction-share-dialog a, [data-share-copy]").count(), 0);
      const anonymousDownloading = anonymous.page.waitForEvent("download");
      await anonymous.page.locator("[data-share-download]").click();
      await (await anonymousDownloading).saveAs(path.join(output, `social-share-${sport}-anonymous-download.png`));
      await anonymous.page.getByRole("button", { name: "Close sharing" }).click();
      await anonymous.page.locator("#close-public-bracket").click();
      await anonymous.page.locator("#upset-leaderboard-mode").click();
      await anonymous.page.locator(".leaderboard-player-button").click();
      await anonymous.page.getByRole("button", { name: "Share results", exact: true }).click();
      await anonymous.page.locator("[data-share-download]:not([disabled])").waitFor();
      assert.match(await anonymous.page.locator(".prediction-share-preview img").getAttribute("alt"), /181.25 points, Upset Edge/);
    }
    assert.deepEqual(errors, []);
    for (const event of events) assert.doesNotMatch(JSON.stringify(event), /JakeH|PRIVATE|fixture|password|invite/);
    for (const name of ["share_card_opened", "share_image_generated", "share_native_used", "share_image_downloaded"]) assert.ok(events.some(event => event.event === name));
    assert.ok(!events.some(event => event.event === "share_link_copied"));
    await anonymous.context.close();
    // Chromium simulations validate our capability branches and mobile copy.
    // These cannot validate Safari/Android OS sheets or installed social apps.
    const profiles = [
      { name: "iphone-safari", native: true, device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } },
      { name: "android-chrome", native: true, device: { viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" } },
      { name: "desktop-chrome-no-files", native: true, noFiles: true },
      { name: "desktop-edge-no-share", native: false },
      { name: "desktop-safari", native: true, device: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" } },
      { name: "share-without-canShare", native: true, noCanShare: true },
      { name: "unavailable-fonts", native: false, noFonts: true },
    ];
    for (const profile of profiles) {
      const target = await boot(false, profile.native, profile.device);
      await target.page.goto(`${origin}/leaderboard.html?player=JakeH`, { waitUntil: "networkidle" });
      await target.page.locator("#public-bracket-content .public-champion").waitFor();
      await target.page.evaluate(({ noFiles, noCanShare, noFonts }) => {
        window.disableImageSharing = Boolean(noFiles);
        if (noCanShare) navigator.canShare = undefined;
        if (noFonts) document.fonts.load = () => Promise.reject(new Error("Fonts unavailable"));
      }, profile);
      await target.page.getByRole("button", { name: "Share bracket", exact: true }).click();
      await target.page.locator("[data-share-download]:not([disabled])").waitFor();
      const supportsFiles = profile.native && !profile.noFiles && !profile.noCanShare;
      assert.equal(await target.page.locator("[data-share-native]").isVisible(), supportsFiles);
      assert.equal(await target.page.locator(".prediction-share-help").isVisible(), profile.name === "iphone-safari");
      assert.equal(await target.page.locator(".prediction-share-preview img").isVisible(), true);
      await target.page.screenshot({ path: path.join(output, `social-compat-${profile.name}-ready.png`) });
      if (profile.name === "iphone-safari") {
        assert.match(await target.page.locator(".prediction-share-help").textContent(), /Downloads go to Files/);
        await target.page.evaluate(() => { window.holdShare = true; });
        await target.page.locator("[data-share-native]").click();
        assert.equal(await target.page.locator("[data-share-native]").isDisabled(), true);
        assert.equal(await target.page.locator("[data-share-download]").isEnabled(), true);
        await target.page.locator("[data-share-native]").evaluate(button => button.dispatchEvent(new Event("click")));
        assert.equal(await target.page.evaluate(() => window.shareCalls), 1, "a pending sheet cannot be opened twice");
        await target.page.evaluate(() => { window.holdShare = false; window.finishShare(); });
        await target.page.waitForFunction(() => window.sharedPayload);
      } else if (supportsFiles) {
        await target.page.locator("[data-share-native]").click();
        await target.page.waitForFunction(() => window.sharedPayload);
      }
      if (supportsFiles) {
        assert.equal(await target.page.evaluate(() => window.sharedPayload.files[0].type), "image/png");
        assert.deepEqual(await target.page.evaluate(() => window.sharedPayload.keys.sort()), ["files", "title"]);
      }
      await target.page.screenshot({ path: path.join(output, `social-compat-${profile.name}.png`) });
      const downloading = target.page.waitForEvent("download");
      await target.page.getByRole("button", { name: "Download bracket image", exact: true }).click();
      const download = await downloading;
      assert.equal(download.suggestedFilename(), "predict-playoffs-nfl-2026-bracket.png");
      assert.doesNotMatch(await target.page.locator(".prediction-share-dialog").textContent(), /copy URL|share link|public bracket link/i);
      await target.page.getByRole("button", { name: "Close sharing" }).click();
      await target.context.close();
    }
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: existing pages, persistence/lock/deletion, public scoring, NFL/NBA real opaque PNGs under 1 MB, safe filename/MIME/signature, prepared-file native sharing, automatic/expired activation, cancellation/error/retry, pending-share guard, generation/download failures, fallback and privacy. Chromium mobile/desktop capability simulations passed; physical social-app handoff is not tested.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
