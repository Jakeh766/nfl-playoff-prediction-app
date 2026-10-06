(function initializeAdminAnalytics() {
  const sessionKey = "road-to-bowl.auth.session";
  const names = { goatcounter: "Traffic", custom: "PredictPlayoffs activity", "search-console": "Google Search" };
  const coverage = {
    goatcounter: ["Dev traffic", "GoatCounter · public development pages. Cookieless visitors/sessions and pageviews; GPC and Do Not Track exclude collection."],
    custom: ["Dev activity", "First-party AWS · sign-ins, accounts, brackets and groups in the development app."],
    "search-console": ["Production domain", "Search Console · sc-domain:predictplayoffs.com, including subdomains. The development CloudFront hostname is outside this property."],
  };
  const main = document.getElementById("analytics-main");
  const reports = document.getElementById("analytics-reports");
  const status = document.getElementById("analytics-status");
  const access = document.getElementById("analytics-access");
  const form = document.getElementById("analytics-range");
  const start = document.getElementById("analytics-start");
  const end = document.getElementById("analytics-end");
  const preset = document.getElementById("analytics-preset");
  const apply = document.getElementById("analytics-apply");
  let denied = false;

  function redirect() {
    denied = true;
    main.hidden = true;
    reports.replaceChildren();
    window.location.replace("/");
  }
  function claims(token) {
    try {
      const value = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")));
    } catch (_error) { return {}; }
  }
  function isAdmin(token) {
    const payload = claims(token);
    // This is a navigation hint only; the API performs the security check.
    return Array.isArray(payload["cognito:groups"]) && payload["cognito:groups"].includes("admin");
  }
  async function accessToken() {
    try {
      const config = window.AUTH_CONFIG || {};
      let session = JSON.parse(localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || "null");
      if (!session?.accessToken || !config.clientId || !config.region) return null;
      if (session.expiresAt > Date.now() + 60_000 && claims(session.accessToken).exp * 1000 > Date.now() + 60_000) return session.accessToken;
      if (!session.refreshToken) return null;
      const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com`, {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
        body: JSON.stringify({ AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: config.clientId,
          AuthParameters: { REFRESH_TOKEN: session.refreshToken } }),
      });
      if (!response.ok) return null;
      const result = (await response.json()).AuthenticationResult;
      if (!result?.AccessToken) return null;
      session = { accessToken: result.AccessToken, idToken: result.IdToken || session.idToken,
        refreshToken: result.RefreshToken || session.refreshToken,
        expiresAt: Date.now() + Number(result.ExpiresIn || 3600) * 1000 };
      localStorage.setItem(sessionKey, JSON.stringify(session));
      sessionStorage.removeItem(sessionKey);
      return session.accessToken;
    } catch (_error) { return null; }
  }
  async function api(path, token) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(18_000) });
    if ([401, 403].includes(response.status)) { redirect(); throw new Error("Access denied"); }
    if (response.status === 400) throw new Error((await response.json()).message || "Choose a valid date range.");
    if (!response.ok) throw new Error("This report could not be loaded. Try again later.");
    return response.json();
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function format(value, type) {
    if (value === null || value === undefined) return "Unavailable";
    if (type === "text") return String(value);
    if (!numeric(value)) return "Unavailable";
    if (type === "percent" || type === "percent100") return new Intl.NumberFormat(undefined,
      { style: "percent", maximumFractionDigits: 1 }).format(Number(value) / (type === "percent100" ? 100 : 1));
    if (type === "seconds") return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} s`;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: type === "decimal" ? 2 : 0 }).format(value);
  }
  function numeric(value) {
    return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
  }
  function barChart(title, items, { percent = false, note = "" } = {}) {
    const valid = items.filter(item => numeric(item.value) && Number(item.value) >= 0);
    if (!valid.length) return null;
    const maximum = percent ? 100 : Math.max(...valid.map(item => Number(item.value)));
    const figure = element("figure", undefined, "analytics-chart");
    const caption = element("figcaption");
    caption.append(element("span", title), element("span", percent ? "0–100%" : `0–${format(maximum)}`, "analytics-chart-scale"));
    figure.append(caption);
    const rows = element("ul", undefined, "analytics-bars");
    for (const item of valid) {
      const row = element("li", undefined, "analytics-bar-row");
      const label = element("div", undefined, "analytics-bar-label");
      label.append(element("span", item.label), element("strong", format(item.value, percent ? "percent100" : "number")));
      const track = element("div", undefined, "analytics-bar-track");
      track.setAttribute("aria-hidden", "true");
      const bar = element("span", undefined, "analytics-bar-fill");
      bar.style.width = `${maximum > 0 ? Math.min(100, Number(item.value) / maximum * 100) : 0}%`;
      track.append(bar);
      row.append(label, track);
      rows.append(row);
    }
    figure.append(rows);
    if (note) figure.append(element("p", note, "analytics-chart-note"));
    return figure;
  }
  function svgElement(tag, attributes, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function trendChart(title, rows, key, type, cumulative = false) {
    const valid = rows.filter(row => numeric(row[key]));
    if (!valid.length) return null;
    const figure = element("figure", undefined, "analytics-chart analytics-trend");
    figure.append(element("figcaption", title));
    const maximum = Math.max(1, ...valid.map(row => Number(row[key])));
    const svg = svgElement("svg", { viewBox: "0 0 540 170", role: "img", "aria-label": `${title}. Exact values are in the data table.` });
    const left = 58, top = 12, width = 465, height = 120;
    for (const fraction of [0, 0.5, 1]) {
      const y = top + height * (1 - fraction);
      svg.append(svgElement("line", { x1: left, x2: left + width, y1: y, y2: y, class: "analytics-gridline" }));
      svg.append(svgElement("text", { x: left - 8, y: y + 4, "text-anchor": "end", class: "analytics-axis" }, format(maximum * fraction, type)));
    }
    const dateKey = Object.keys(rows[0])[0];
    for (const index of [...new Set([0, rows.length - 1])]) {
      svg.append(svgElement("text", { x: left + (index ? width : 0), y: 158,
        "text-anchor": index ? "end" : "start", class: "analytics-axis" }, rows[index][dateKey]));
    }
    let segment = [];
    function flush() {
      if (!segment.length) return;
      svg.append(svgElement("polyline", { points: segment.join(" "), class: cumulative ? "analytics-line analytics-line-total" : "analytics-line" }));
      segment = [];
    }
    rows.forEach((row, index) => {
      if (!numeric(row[key])) { flush(); return; }
      const x = left + (rows.length > 1 ? index / (rows.length - 1) : 0.5) * width;
      const y = top + height * (1 - Number(row[key]) / maximum);
      segment.push(`${x},${y}`);
      const point = svgElement("circle", { cx: x, cy: y, r: 2.5, class: cumulative ? "analytics-point analytics-point-total" : "analytics-point" });
      point.append(svgElement("title", {}, `${row[dateKey]}: ${format(row[key], type)}`));
      svg.append(point);
    });
    flush();
    figure.append(svg);
    return figure;
  }
  function dailyCharts(report, provider) {
    const group = element("div", undefined, "analytics-daily");
    const options = report.columns.filter(column => column.format !== "text" && column.key !== "cumulative");
    if (!report.rows.length || !options.length) return group;
    const label = element("label", "Daily metric", "analytics-chart-choice");
    const select = element("select");
    select.setAttribute("aria-label", `Daily metric for ${names[provider]}`);
    for (const column of options) {
      const option = element("option", column.label);
      option.value = column.key;
      select.append(option);
    }
    select.value = report.series?.[0] || options[0].key;
    label.append(select);
    const plots = element("div", undefined, "analytics-trends");
    const note = element("p", "Full selected range; gaps mean unavailable. Running totals start at the selected start date. Today and initial collection days can be partial.", "analytics-chart-note");
    function draw() {
      plots.replaceChildren();
      const column = options.find(item => item.key === select.value) || options[0];
      const chart = trendChart(`Daily ${column.label.toLowerCase()}`, report.rows, column.key, column.format);
      if (chart) plots.append(chart);
      // Unique sessions and rates are not additive. Never accumulate them.
      if (column.format === "number" && column.key !== "sessions") {
        let sum = 0;
        const rows = report.rows.map(row => {
          if (!numeric(row[column.key])) return { ...row, cumulative: null };
          sum += Number(row[column.key]);
          return { ...row, cumulative: sum };
        });
        const running = trendChart(`Running ${column.label.toLowerCase()}`, rows, "cumulative", "number", true);
        if (running) plots.append(running);
      }
      if (!chart) plots.append(element("p", "No measured days for this metric in the selected range.", "analytics-empty"));
    }
    select.addEventListener("change", draw);
    group.append(label, plots, note);
    draw();
    return group;
  }
  function tableChart(report) {
    const label = report.columns.find(column => column.format === "text");
    const count = report.columns.find(column => column.format === "number");
    if (!label || !count || report.title === "Brackets by day and type") return null;
    const rows = report.rows.filter(row => numeric(row[count.key]) && Number(row[count.key]) >= 0)
      .sort((a, b) => Number(b[count.key]) - Number(a[count.key]));
    return barChart(`${report.title} · ${count.label.toLowerCase()}`, rows.slice(0, 5).map(row => ({
      label: row[label.key], value: row[count.key],
    })), { note: `Top ${Math.min(rows.length, 5)} of ${rows.length} returned rows.` });
  }
  function renderProvider(section, data) {
    section.replaceChildren();
    const heading = element("div", undefined, "analytics-provider-heading");
    const title = element("div", undefined, "analytics-provider-title");
    title.append(element("h2", names[data.provider]), element("span", coverage[data.provider][0], "analytics-scope"));
    heading.append(title);
    const states = { ok: data.cached ? "Cached report" : "Report ready", not_configured: "Setup needed",
      unavailable: "Unavailable", updating: "Refreshing" };
    const state = element("span", states[data.status] || "Unavailable", "analytics-provider-state");
    state.dataset.state = data.status;
    heading.append(state);
    section.append(heading);
    section.append(element("p", coverage[data.provider][1], "analytics-provider-coverage"));
    if (data.range) {
      const range = data.range.window || `${data.range.start} to ${data.range.end}`;
      const fetched = data.fetchedAt ? ` · Retrieved ${new Date(data.fetchedAt).toLocaleString()}` : "";
      section.append(element("p", `${range} · ${data.range.timezone}${fetched}`, "analytics-provider-range"));
    }
    if (data.status !== "ok") {
      section.append(element("p", data.message || "Try again later.", "analytics-empty"));
      if (data.status === "not_configured") {
        const link = element("a", "Set up this provider");
        link.href = "https://github.com/Jakeh766/nfl-playoff-prediction-app/blob/dev/docs/admin-analytics.md";
        link.rel = "noreferrer";
        section.append(link);
      }
      return;
    }
    const metrics = element("dl", undefined, "analytics-metrics");
    for (const metric of data.metrics || []) {
      const item = element("div");
      const value = element("dd", format(metric.value, metric.format));
      if (metric.note) value.append(element("span", metric.note, "analytics-metric-note"));
      item.append(element("dt", metric.label), value);
      metrics.append(item);
    }
    section.append(metrics);
    if (data.note) {
      const guide = element("details", undefined, "analytics-explainer");
      guide.append(element("summary", "Definitions and coverage"), element("p", data.note, "analytics-provider-note"));
      section.append(guide);
    }
    const breakdowns = element("div", undefined, "analytics-breakdowns");
    for (const report of data.tables || []) {
      const breakdown = element("div", undefined, "analytics-breakdown");
      const chart = report.chart === "trend" ? dailyCharts(report, data.provider) :
        data.provider === "goatcounter" ? tableChart(report) : null;
      if (chart) breakdown.append(chart);
      const details = element("details", undefined, "analytics-data-details");
      details.append(element("summary", `View data · ${report.title}`));
      if (report.title === "Brackets by type") details.open = true;
      const wrap = element("div", undefined, "analytics-table-wrap");
      wrap.setAttribute("tabindex", "0");
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", report.title);
      const table = element("table", undefined, "analytics-table");
      table.append(element("caption", report.title));
      const head = element("thead");
      const row = element("tr");
      for (const column of report.columns) {
        const cell = element("th", column.label);
        cell.scope = "col";
        row.append(cell);
      }
      head.append(row);
      table.append(head);
      const body = element("tbody");
      for (const values of report.rows) {
        const row = element("tr");
        for (const column of report.columns) row.append(element("td", format(values[column.key], column.format)));
        body.append(row);
      }
      if (!report.rows.length) {
        const row = element("tr");
        const cell = element("td", "No data reported for this range.");
        cell.colSpan = report.columns.length;
        row.append(cell);
        body.append(row);
      }
      table.append(body);
      wrap.append(table);
      details.append(wrap);
      breakdown.append(details);
      breakdowns.append(breakdown);
    }
    section.append(breakdowns);
  }
  function dates(days = 28, includeToday = false) {
    const finish = new Date();
    if (!includeToday) finish.setUTCDate(finish.getUTCDate() - 1);
    const begin = new Date(finish);
    begin.setUTCDate(begin.getUTCDate() - days + 1);
    start.value = begin.toISOString().slice(0, 10);
    end.value = finish.toISOString().slice(0, 10);
    const today = new Date();
    start.max = end.max = today.toISOString().slice(0, 10);
    today.setUTCDate(today.getUTCDate() - 365);
    start.min = end.min = today.toISOString().slice(0, 10);
  }
  async function loadReports(event) {
    event?.preventDefault();
    if (denied) return;
    apply.disabled = true;
    reports.replaceChildren();
    reports.setAttribute("aria-busy", "true");
    status.textContent = "Loading reports…";
    try {
      const token = await accessToken();
      if (!token || !isAdmin(token)) { redirect(); return; }
      const params = new URLSearchParams({ start: start.value, end: end.value });
      const session = await api(`/api/admin/analytics?${params}`, token);
      if (denied) return;
      main.hidden = false;
      access.hidden = true;
      reports.replaceChildren();
      const order = ["goatcounter", "custom", "search-console"];
      const providers = order.filter(provider => session.providers.includes(provider));
      let available = 0;
      await Promise.allSettled(providers.map(async provider => {
        const section = element("section", undefined, "analytics-provider");
        section.dataset.provider = provider;
        section.append(element("h2", names[provider]), element("p", "Loading…", "analytics-empty"));
        reports.append(section);
        let data;
        try { data = await api(`/api/admin/analytics/${provider}?${params}`, token); }
        catch (_error) { data = { provider, status: "unavailable", message: "This report could not be loaded. Try again later." }; }
        if (denied) return;
        renderProvider(section, { ...data, provider });
        if (data.status === "ok") available++;
      }));
      if (!denied) status.textContent = `${available} of ${providers.length} provider reports available. Update reports to retry; cached data is reused.`;
    } catch (error) {
      if (!denied) {
        access.textContent = "Reports could not be loaded. Reload this page to retry.";
        status.textContent = error.message;
      }
    } finally { apply.disabled = false; reports.setAttribute("aria-busy", "false"); }
  }
  // A logout or loss of admin membership in another tab clears rendered data.
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      main.hidden = true;
      reports.replaceChildren();
      access.hidden = false;
      loadReports();
    }
  });
  window.addEventListener("storage", async event => {
    if (event.key === sessionKey || event.key === null) {
      const token = await accessToken();
      if (!token || !isAdmin(token)) redirect();
    }
  });
  document.getElementById("admin-sign-out").addEventListener("click", () => {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
    redirect();
  });
  preset.addEventListener("change", () => {
    if (preset.value === "today") dates(1, true);
    else if (preset.value !== "custom") dates(Number(preset.value));
  });
  for (const input of [start, end]) input.addEventListener("change", () => { preset.value = "custom"; });
  form.addEventListener("submit", loadReports);
  dates();
  if (window.AUTH_CONFIG?.environment !== "dev") redirect();
  else loadReports();
})();
