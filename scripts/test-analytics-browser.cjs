// Optional visual/interaction check: local fixtures only, no accounts or live providers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PP_PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../frontend");
const output = path.join(root, "screenshots");
const column = (key, label, format = "number") => ({ key, label, format });
const metric = (label, value, format = "number", note) => ({ label, value, format, note });
const daily = { title: "Daily traffic", chart: "trend", series: ["pageviews"],
  columns: [column("day", "Day", "text"), column("pageviews", "Pageviews"), column("sessions", "Distinct sessions")],
  rows: Array.from({ length: 28 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, pageviews: i === 8 ? null : 20 + i % 7 * 15, sessions: 10 + i % 5 * 8 })) };
const table = (title, columns, rows) => ({ title, columns, rows });
const reports = {
  goatcounter: { metrics: [metric("Distinct visitors / sessions", 1268, "number", "Cookieless short-lived estimate, not permanent people."),
    metric("Pageviews", 3842, "number", "Includes repeat page loads; export coverage required."),
    metric("Average session duration", 89, "seconds", "First to last recorded pageview; single-page sessions count as 0. Time after the last view is unknown.")],
    tables: [daily, table("Pageviews by page", [column("page", "Page", "text"), column("pageviews", "Pageviews")],
      [{ page: "/", pageviews: 1800 }, { page: "/picks/nfl", pageviews: 1300 }, { page: "/leaderboard", pageviews: 742 }])] },
  custom: { metrics: ["Sign-ins", "Accounts created", "Accounts deleted", "Brackets created", "Brackets completed", "Brackets saved", "Groups created", "Group joins", "Invite joins"].map((label, i) => metric(label, i * 17)),
    engagement: metric("Total active engagement time", 8504, "seconds"),
    tables: [{ title: "Daily activity", chart: "trend", series: ["signin"],
      columns: [column("day", "Day", "text"), column("signin", "Sign-ins"), column("bracket_saved", "Brackets saved")],
      rows: daily.rows.map(row => ({ day: row.day, signin: row.sessions, bracket_saved: row.pageviews })) },
      table("Brackets by type", [column("type", "Bracket type", "text"), column("saved", "Brackets saved")], [{ type: "NFL", saved: 123 }, { type: "NBA", saved: 45 }])] },
  seasons: { metrics: [], range: { window: "All retained seasons", timezone: "Season totals" }, tables: [
    table("Activity by season", [column("season", "Season", "text"), ...["Saved brackets", "Competing groups", "People competing", "Group entries", "Avg. people / group", "Largest group"].map((s, i) => column(`v${i}`, s))],
      [{ season: "NFL 2026", v0: 180, v1: 24, v2: 160, v3: 195, v4: 8, v5: 14 }]),
    ...["NFL", "NBA"].map(sport => table(`Current ${sport} group scoring modes (24 total groups)`, [column("mode", "Scoring mode", "text"), column("groups", "Groups"), column("share", "% of total groups", "percent")], [{ mode: "Classic", groups: 18, share: .75 }, { mode: "Upset Edge", groups: 6, share: .25 }]))] },
  "search-console": { metrics: [metric("Clicks", 324), metric("Impressions", 6840), metric("CTR", .047, "percent"), metric("Average position", 12.4, "decimal")],
    tables: [{ title: "Daily search", chart: "trend", series: ["clicks"],
      columns: [column("day", "Day", "text"), column("clicks", "Clicks"), column("impressions", "Impressions")],
      rows: daily.rows.map(row => ({ day: row.day, clicks: row.sessions, impressions: row.pageviews })) },
      ...["query", "page", "country", "device"].map(key => table(`Search by ${key}`, [column(key, key, "text"), column("clicks", "Clicks")], [{ [key]: key === "query" ? "NFL playoff predictions" : key, clicks: 32 }]))] },
};
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  const target = path.resolve(root, route === "/admin/analytics" ? "admin-analytics.html" : route.slice(1));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404).end(); return; }
  const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.PP_BROWSER_CHANNEL || "msedge", headless: true });
    for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 390, "light"], ["narrow", 320, "light"], ["dark", 1440, "dark"]]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme });
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/auth-config.js", route => route.fulfill({ contentType: "application/javascript", body: 'window.AUTH_CONFIG = { environment: "dev", clientId: "fixture", region: "us-east-1" };' }));
      await page.route("**/api/admin/analytics**", route => {
        const url = new URL(route.request().url());
        requests.push(url.pathname);
        const provider = url.pathname.split("/").at(-1);
        const body = provider === "analytics" ? { environment: "dev", providers: Object.keys(reports) } :
          { provider, status: "ok", note: "Fixture coverage for layout verification.", range: { start: url.searchParams.get("start"), end: url.searchParams.get("end"), timezone: "UTC" }, ...reports[provider] };
        return route.fulfill({ json: body });
      });
      await context.addInitScript(() => {
        const token = `header.${btoa(JSON.stringify({ "cognito:groups": ["admin"], exp: Date.now() / 1000 + 3600 }))}.signature`;
        localStorage.setItem("road-to-bowl.auth.session", JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3600000 }));
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/admin/analytics`);
      await page.waitForFunction(() => document.querySelector("#analytics-reports").getAttribute("aria-busy") === "false");
      await page.evaluate(() => document.fonts.ready);
      assert.equal(requests.length, 5);
      for (const provider of ["goatcounter", "custom", "seasons", "search-console"]) {
        await page.locator(`#analytics-tab-${provider}`).click();
        const panel = page.locator(`#analytics-panel-${provider}`);
        await panel.waitFor({ state: "visible" });
        assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${provider} overflows viewport`);
        if (provider === "custom") {
          for (const group of await panel.locator(".analytics-metric-group .analytics-metrics").all()) {
            assert.equal(await group.evaluate(node => new Set([...node.children].map(child => child.getBoundingClientRect().left)).size), 1, "activity totals must remain in readable rows");
          }
        }
        if (provider === "seasons" && width === 1440) {
          const table = panel.locator(".analytics-table-wrap").first();
          assert.ok(await table.evaluate(node => node.scrollWidth <= node.clientWidth), "desktop season table should expose every column");
        }
        await page.screenshot({ path: path.join(output, `analytics-${name}-${provider}.png`), fullPage: true });
        if (provider !== "seasons") {
          const plot = panel.locator(".analytics-plot");
          await plot.focus();
          await plot.press("End");
          await panel.locator(".analytics-tooltip").waitFor({ state: "visible" });
          assert.equal((await plot.boundingBox()).height, 344);
          await plot.press("Escape");
          const select = panel.locator(".analytics-chart-controls select");
          const option = select.locator("option").nth(1);
          const label = await option.textContent();
          await select.selectOption(await option.getAttribute("value"));
          await panel.getByText(`Daily ${label.toLowerCase()}`, { exact: true }).first().waitFor();
        }
      }
      assert.equal(requests.length, 5, "section and chart controls must not fetch");
      await page.getByLabel("Search breakdown", { exact: true }).selectOption("3");
      assert.equal(await page.locator(".analytics-search-explorer .analytics-breakdown:visible").count(), 1);
      await page.locator("#analytics-tab-search-console").focus();
      await page.keyboard.press("Home");
      assert.equal(await page.locator("#analytics-tab-goatcounter").getAttribute("aria-selected"), "true");
      await page.locator("#analytics-preset").selectOption("7");
      await page.locator("#analytics-apply").click();
      await page.waitForFunction(() => document.querySelector("#analytics-reports").getAttribute("aria-busy") === "false");
      assert.equal(requests.length, 10);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Analytics ${name}: layout, charts, tabs, search and date refresh passed`);
    }
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
