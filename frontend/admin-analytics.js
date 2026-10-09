(function initializeAdminAnalytics() {
  const sessionKey = "road-to-bowl.auth.session";
  const names = { goatcounter: "Traffic", custom: "PredictPlayoffs activity", "search-console": "Google Search", seasons: "Season activity" };
  const coverage = {
    goatcounter: ["Dev traffic", "GoatCounter"],
    custom: ["Dev activity", "First-party AWS"],
    seasons: ["Dev seasons", "Saved brackets and group competition records"],
    "search-console": ["Production domain", "Google Search Console · predictplayoffs.com"],
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
  const order = ["goatcounter", "custom", "seasons", "search-console"];
  const tabs = order.map(provider => document.getElementById(`analytics-tab-${provider}`));
  const chartDisposers = new Set();
  const chartCleanup = new WeakMap();
  const chartChoices = new Map();
  let selectedProvider = "goatcounter";
  let chartSequence = 0;
  let denied = false;

  function clearReports() {
    for (const dispose of chartDisposers) dispose();
    chartDisposers.clear();
    reports.replaceChildren();
  }
  function selectProvider(provider, focus = false) {
    selectedProvider = provider;
    for (const tab of tabs) {
      const selected = tab.dataset.provider === provider;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const section of reports.children) section.hidden = section.dataset.provider !== provider;
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectProvider(order[index]));
    tab.addEventListener("keydown", event => {
      const next = { ArrowRight: (index + 1) % order.length, ArrowLeft: (index + order.length - 1) % order.length,
        Home: 0, End: order.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectProvider(order[next], true);
    });
  }

  function redirect() {
    denied = true;
    chartChoices.clear();
    main.hidden = true;
    clearReports();
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
    if (type === "seconds") {
      if (Number(value) < 0) return "Unavailable";
      const seconds = Math.round(Number(value));
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor(seconds % 3600 / 60);
      return [hours ? `${format(hours)} hr` : "", minutes ? `${minutes} min` : "",
        seconds % 60 || !seconds ? `${seconds % 60} sec` : ""].filter(Boolean).join(" ");
    }
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: type === "decimal" ? 2 : 0 }).format(value);
  }
  function numeric(value) {
    return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
  }
  function svgElement(tag, attributes, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function trendChart(title, rows, key, type) {
    const valid = rows.filter(row => numeric(row[key]));
    if (!valid.length) return null;
    const figure = element("figure", undefined, "analytics-chart analytics-trend");
    figure.append(element("figcaption", title));
    const maximum = Math.max(...valid.map(row => Number(row[key]))) || 1;
    const dateKey = Object.keys(rows[0])[0];
    const plot = element("div", undefined, "analytics-plot");
    plot.tabIndex = 0;
    plot.setAttribute("role", "group");
    plot.setAttribute("aria-label", `${title} interactive chart`);
    const hint = element("p", "Hover or tap for values. Keyboard: use arrow keys, Home or End; Escape closes the tooltip.", "analytics-chart-hint");
    hint.id = `analytics-chart-hint-${++chartSequence}`;
    plot.setAttribute("aria-describedby", hint.id);
    const svg = svgElement("svg", { "aria-hidden": "true", preserveAspectRatio: "none" });
    const tooltip = element("div", undefined, "analytics-tooltip");
    tooltip.hidden = true;
    tooltip.setAttribute("role", "tooltip");
    const date = element("span", undefined, "analytics-tooltip-date");
    const value = element("strong");
    const metric = element("span", title, "analytics-tooltip-metric");
    tooltip.append(date, value, metric);
    const announcement = element("span", undefined, "analytics-sr-only");
    announcement.setAttribute("aria-live", "polite");
    announcement.setAttribute("aria-atomic", "true");
    plot.append(svg, tooltip, announcement);
    figure.append(plot, hint);
    let viewWidth = 540, width = 462, index = rows.findLastIndex(row => numeric(row[key]));
    const left = 62, top = 24, height = 168;
    let crosshair, marker;
    let focused = false, pinned = false;
    const xFor = i => left + (rows.length > 1 ? i / (rows.length - 1) : 0.5) * width;
    const yFor = row => top + height * (1 - Number(row[key]) / maximum);
    function dayLabel(day, full = false) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(full ? { year: "numeric" } : {}),
        timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
    }
    function hide() {
      tooltip.hidden = true;
      crosshair?.setAttribute("visibility", "hidden");
      marker?.setAttribute("visibility", "hidden");
    }
    function show(next, announce = false) {
      index = Math.max(0, Math.min(rows.length - 1, next));
      const row = rows[index], measured = numeric(row[key]);
      date.textContent = dayLabel(row[dateKey], true);
      value.textContent = measured ? format(row[key], type) : "Unavailable";
      metric.textContent = measured ? title : "No data for this day";
      tooltip.hidden = false;
      const x = xFor(index);
      crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);
      crosshair.setAttribute("visibility", "visible");
      marker.setAttribute("visibility", measured ? "visible" : "hidden");
      if (measured) { marker.setAttribute("cx", x); marker.setAttribute("cy", yFor(row)); }
      // Keep the readout inside the chart at both edges, including narrow screens.
      const tooltipWidth = tooltip.getBoundingClientRect().width || 180;
      tooltip.style.left = `${Math.max(4, Math.min(viewWidth - tooltipWidth - 4, x - tooltipWidth / 2))}px`;
      if (announce) announcement.textContent = `${row[dateKey]}. ${title}: ${value.textContent}.`;
    }
    function draw() {
      const measuredWidth = plot.getBoundingClientRect().width;
      if (measuredWidth > 0) viewWidth = Math.max(240, measuredWidth);
      width = viewWidth - left - 16;
      svg.setAttribute("viewBox", `0 0 ${viewWidth} 244`);
      svg.replaceChildren();
      for (const fraction of type === "number" && maximum < 4 ? [0, 1] : [0, 0.25, 0.5, 0.75, 1]) {
        const y = top + height * (1 - fraction);
        svg.append(svgElement("line", { x1: left, x2: left + width, y1: y, y2: y, class: "analytics-gridline" }));
        const unit = maximum >= 3600 ? 3600 : maximum >= 60 ? 60 : 1;
        const tick = type === "seconds" ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(maximum * fraction / unit)} ${unit === 3600 ? "hr" : unit === 60 ? "min" : "sec"}` : type === "number" && maximum >= 10_000 ?
          new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(maximum * fraction) : format(maximum * fraction, type);
        svg.append(svgElement("text", { x: left - 12, y: y + 4, "text-anchor": "end", class: "analytics-axis" }, tick));
      }
      for (const i of [...new Set([0, ...(rows.length > 14 && viewWidth > 500 ? [Math.floor(rows.length / 2)] : []), rows.length - 1])]) {
        svg.append(svgElement("text", { x: xFor(i), y: 224, "text-anchor": i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle",
          class: "analytics-axis" }, dayLabel(rows[i][dateKey])));
      }
      let segment = [];
      function flush() {
        if (!segment.length) return;
        if (segment.length > 1) svg.append(svgElement("polygon", { points: `${segment[0].split(",")[0]},${top + height} ${segment.join(" ")} ${segment.at(-1).split(",")[0]},${top + height}`,
          class: "analytics-area" }));
        svg.append(svgElement("polyline", { points: segment.join(" "), class: "analytics-line" }));
        segment = [];
      }
      rows.forEach((row, i) => {
        if (!numeric(row[key])) { flush(); return; }
        segment.push(`${xFor(i)},${yFor(row)}`);
      });
      flush();
      rows.forEach((row, i) => {
        if (numeric(row[key])) svg.append(svgElement("circle", { cx: xFor(i), cy: yFor(row), r: rows.length > 45 ? 2 : 3,
          class: "analytics-point" }));
      });
      crosshair = svgElement("line", { y1: top, y2: top + height, class: "analytics-crosshair", visibility: "hidden" });
      marker = svgElement("circle", { r: 5, class: "analytics-selected", visibility: "hidden" });
      svg.append(crosshair, marker);
      if (!tooltip.hidden) show(index);
    }
    function pointAt(event) {
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width) return;
      const x = (event.clientX - bounds.left) * viewWidth / bounds.width;
      if (x < left || x > left + width) { if (!focused && !pinned) hide(); return; }
      show(rows.length > 1 ? Math.round((x - left) / width * (rows.length - 1)) : 0);
    }
    plot.addEventListener("pointermove", pointAt);
    plot.addEventListener("pointerdown", event => { pinned = event.pointerType !== "mouse"; pointAt(event); });
    plot.addEventListener("pointerleave", () => { if (!focused && !pinned) hide(); });
    plot.addEventListener("focus", () => { focused = true; show(index, true); });
    plot.addEventListener("blur", () => { focused = pinned = false; hide(); });
    plot.addEventListener("keydown", event => {
      if (event.key === "Escape") { pinned = false; hide(); return; }
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: rows.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); show(next, true);
    });
    draw();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(draw);
      observer.observe(plot);
      const dispose = () => { observer.disconnect(); chartDisposers.delete(dispose); };
      chartDisposers.add(dispose);
      chartCleanup.set(figure, dispose);
    }
    return figure;
  }
  function dailyCharts(report, provider) {
    const group = element("div", undefined, "analytics-daily");
    const options = report.columns.filter(column => column.format !== "text" && column.key !== "cumulative");
    if (!report.rows.length || !options.length) return group;
    const controls = element("div", undefined, "analytics-chart-controls");
    const label = element("label", "Metric", "analytics-chart-choice");
    const select = element("select");
    select.setAttribute("aria-label", `Daily metric for ${names[provider]}`);
    for (const column of options) {
      const option = element("option", column.label);
      option.value = column.key;
      select.append(option);
    }
    const choiceKey = `${provider}:${report.title}`;
    const choice = chartChoices.get(choiceKey);
    select.value = options.some(column => column.key === choice?.metric) ? choice.metric : report.series?.[0] || options[0].key;
    label.append(select);
    controls.append(label);
    const plots = element("div", undefined, "analytics-trends");
    const note = element("p", "Gaps mean unavailable. Recent days may be partial.", "analytics-chart-note");
    let currentChart;
    function draw() {
      if (currentChart) chartCleanup.get(currentChart)?.();
      plots.replaceChildren();
      const column = options.find(item => item.key === select.value) || options[0];
      chartChoices.set(choiceKey, { metric: column.key });
      currentChart = trendChart(`Daily ${column.label.toLowerCase()}`, report.rows, column.key, column.format);
      plots.append(currentChart || element("p", "No measured days for this metric in the selected range.", "analytics-empty"));
    }
    select.addEventListener("change", draw);
    group.append(controls, plots, note);
    draw();
    return group;
  }
  function tableChart(report) {
    const label = report.columns.find(column => column.format === "text");
    const count = report.columns.find(column => column.format === "number");
    if (!label || !count || report.title === "Brackets by day and type") return null;
    const rows = report.rows.filter(row => numeric(row[count.key]) && Number(row[count.key]) >= 0)
      .sort((a, b) => Number(b[count.key]) - Number(a[count.key]));
    const figure = element("figure", undefined, "analytics-chart analytics-pie");
    figure.append(element("figcaption", report.title));
    const total = rows.reduce((sum, row) => sum + Number(row[count.key]), 0);
    if (!total) {
      figure.append(element("p", rows.length ? "No visits recorded for this range." : "No data reported for this range.", "analytics-empty"));
      return figure;
    }
    const layout = element("div", undefined, "analytics-pie-layout");
    const plot = element("div", undefined, "analytics-pie-plot");
    const svg = svgElement("svg", { viewBox: "0 0 240 240", "aria-hidden": "true" });
    const legend = element("ul", undefined, "analytics-pie-legend");
    const hint = "Hover or tap a slice, or focus a page for details.";
    const readout = element("p", hint, "analytics-pie-readout");
    readout.setAttribute("role", "status");
    const colors = ["var(--analytics-daily)", "var(--analytics-total)", "var(--red)", "var(--gold)",
      "#8a5e9b", "#568e99", "#c78348", "#8b7f67", "#ab6281", "#7589ad", "#82994e", "#777777"];
    const slices = [];
    let angle = -Math.PI / 2;
    const pageName = path => {
      const specific = /^\/(nfl|nba)\/(picks|leaderboard|scoring)$/.exec(path);
      if (specific) return `${specific[1].toUpperCase()} ${specific[2]}`;
      if (/^\/(picks|leaderboard|scoring)(\.html)?$/.test(path)) return `${path} (sport not recorded)`;
      return path;
    };
    for (const [index, row] of rows.entries()) {
      const value = Number(row[count.key]);
      const share = value / total;
      const color = colors[index % colors.length];
      const page = pageName(row[label.key]);
      const description = `${page} · ${format(value)} ${count.label.toLowerCase()} · ${format(share, "percent")}`;
      let slice;
      if (share > 0) {
        const finish = angle + share * Math.PI * 2;
        const point = a => `${120 + 112 * Math.cos(a)},${120 + 112 * Math.sin(a)}`;
        slice = share === 1 ? svgElement("circle", { cx: 120, cy: 120, r: 112 }) :
          svgElement("path", { d: `M120,120 L${point(angle)} A112,112 0 ${share > 0.5 ? 1 : 0},1 ${point(finish)} Z` });
        slice.setAttribute("class", "analytics-pie-slice");
        slice.style.fill = color;
        slice.append(svgElement("title", {}, description));
        svg.append(slice);
        slices.push(slice);
        angle = finish;
      }
      const show = () => {
        for (const other of slices) other.style.opacity = other === slice || !slice ? "1" : "0.45";
        readout.textContent = description;
      };
      const reset = () => { for (const other of slices) other.style.opacity = "1"; readout.textContent = hint; };
      if (slice) {
        slice.addEventListener("pointerenter", show);
        slice.addEventListener("pointerleave", reset);
        slice.addEventListener("click", show);
      }
      const item = element("li");
      const button = element("button", undefined, "analytics-pie-key");
      button.type = "button";
      button.setAttribute("aria-label", description);
      const swatch = element("span", undefined, "analytics-pie-swatch");
      swatch.style.background = color;
      swatch.setAttribute("aria-hidden", "true");
      button.append(swatch, element("span", page, "analytics-pie-page"),
        element("strong", format(value)), element("span", format(share, "percent"), "analytics-pie-share"));
      button.addEventListener("focus", show);
      button.addEventListener("blur", reset);
      button.addEventListener("pointerenter", show);
      button.addEventListener("pointerleave", reset);
      button.addEventListener("click", show);
      item.append(button);
      legend.append(item);
    }
    plot.append(svg, readout);
    layout.append(plot, legend);
    figure.append(layout, element("p", `Counts and percentages cover the ${rows.length} returned pages; omitted pages are not included.`, "analytics-chart-note"));
    return figure;
  }
  function engagementEstimate(activity, traffic, selectedRange) {
    const total = activity.engagement?.value;
    const sessions = traffic?.metrics?.find(metric => metric.label === "Distinct visitors / sessions")?.value;
    const matchingDates = [activity, traffic].every(report => report?.range?.timezone === "UTC" &&
      report.range.start === selectedRange.get("start") && report.range.end === selectedRange.get("end"));
    const available = activity.status === "ok" && traffic?.status === "ok" && matchingDates &&
      Number.isFinite(total) && total >= 0 && Number.isSafeInteger(sessions) && sessions > 0;
    return { label: "Estimated active engagement time per session", value: available ? total / sessions : null, format: "seconds",
      note: "Estimate: total active time ÷ GoatCounter distinct sessions for the same dates. Page coverage, delivery and freshness differ; individual sessions are not matched." +
        (available ? "" : " Requires measured active time and a positive distinct-session count for this range.") };
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
    const tab = tabs[order.indexOf(data.provider)];
    const tabState = tab.querySelector(".analytics-tab-state");
    tabState.textContent = data.status === "ok" ? "Ready" : states[data.status] || "Unavailable";
    tab.dataset.state = data.status;
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
    function metricList(items) {
      const list = element("dl", undefined, "analytics-metrics");
      list.dataset.count = String(items.length);
      for (const metric of items) {
        const item = element("div");
        const value = element("dd", format(metric.value, metric.format));
        if (metric.value === null || metric.value === undefined) value.className = "analytics-metric-missing";
        if (metric.note) value.append(element("span", metric.note, "analytics-metric-note"));
        item.append(element("dt", metric.label), value);
        list.append(item);
      }
      return list;
    }
    if (data.provider === "custom" && data.metrics?.length === 9) {
      const groups = element("div", undefined, "analytics-metric-groups");
      for (const [heading, labels] of [["Accounts & access", ["Sign-ins", "Accounts created", "Accounts deleted"]],
        ["Brackets", ["Brackets created", "Brackets completed", "Brackets saved"]],
        ["Groups", ["Groups created", "Group joins", "Invite joins"]]]) {
        const group = element("div", undefined, "analytics-metric-group");
        group.append(element("h3", heading), metricList(data.metrics.filter(metric => labels.includes(metric.label))));
        groups.append(group);
      }
      section.append(groups);
    } else if (data.metrics?.length) section.append(metricList(data.metrics));
    if (data.provider === "seasons") {
      section.append(element("p", "Whole-season totals. People are members with saved brackets; a person in multiple groups counts once under People competing and once per group under Group entries. Group sizes count these competitors. Historical totals use archived competitions; deleted or unsaved brackets are not included.", "analytics-provider-coverage"));
    }
    if (data.note) {
      const guide = element("details", undefined, "analytics-explainer");
      guide.append(element("summary", "Definitions and coverage"), element("p", data.note, "analytics-provider-note"));
      section.append(guide);
    }
    let updateEngagement;
    if (data.engagement) {
      const engagementMetrics = element("div");
      section.append(engagementMetrics);
      updateEngagement = estimate => engagementMetrics.replaceChildren(metricList([data.engagement, estimate]));
      updateEngagement({ label: "Estimated active engagement time per session", value: null, format: "seconds",
        note: "Waiting for Traffic and active-time measurements for the selected dates." });
    }
    const breakdowns = element("div", undefined, "analytics-breakdowns");
    const searchBreakdowns = [];
    for (const report of data.tables || []) {
      const breakdown = element("div", undefined, "analytics-breakdown");
      const chart = report.chart === "trend" ? dailyCharts(report, data.provider) :
        data.provider === "goatcounter" ? tableChart(report) : null;
      if (chart) breakdown.append(chart);
      // Charts expose exact values through their controls and legend, without duplicate tables.
      if (chart) { breakdowns.append(breakdown); continue; }
      if (data.provider === "search-console" && report.chart !== "trend") {
        searchBreakdowns.push({ report, breakdown });
      }
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
        const cell = element("td", report.emptyMessage || "No data reported for this range.");
        cell.colSpan = report.columns.length;
        row.append(cell);
        body.append(row);
      }
      table.append(body);
      wrap.append(table);
      breakdown.append(wrap);
      breakdowns.append(breakdown);
    }
    if (searchBreakdowns.length) {
      const explorer = element("div", undefined, "analytics-search-explorer");
      const label = element("label", "Break down search by", "analytics-chart-choice");
      const select = element("select");
      select.setAttribute("aria-label", "Search breakdown");
      for (const [index, { report, breakdown }] of searchBreakdowns.entries()) {
        const dimension = report.title.replace(/^Search by /, "");
        const option = element("option", dimension.charAt(0).toUpperCase() + dimension.slice(1));
        option.value = String(index); select.append(option);
        breakdown.hidden = index !== 0;
        explorer.append(breakdown);
      }
      select.value = "0";
      select.addEventListener("change", () => {
        for (const [index, { breakdown }] of searchBreakdowns.entries()) breakdown.hidden = String(index) !== select.value;
      });
      label.append(select);
      explorer.prepend(label);
      breakdowns.append(explorer);
    }
    section.append(breakdowns);
    return updateEngagement;
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
    clearReports();
    for (const tab of tabs) { tab.dataset.state = "updating"; tab.querySelector(".analytics-tab-state").textContent = "Loading"; }
    reports.setAttribute("aria-busy", "true");
    status.textContent = "Loading reports…";
    try {
      const token = await accessToken();
      if (!token || !isAdmin(token)) { redirect(); return; }
      const params = new URLSearchParams({ start: start.value, end: end.value });
      const session = await api(`/api/admin/analytics?${params}`, token);
      if (denied) return;
      const production = session.environment === "prod";
      coverage.goatcounter = production ? ["Production traffic", "GoatCounter · production pages only"] : ["Dev traffic", "GoatCounter"];
      coverage.custom = [production ? "Production activity" : "Dev activity", "First-party AWS"];
      coverage.seasons = [production ? "Production seasons" : "Dev seasons", "Saved brackets and group competition records"];
      document.getElementById("analytics-environment").textContent = `Private · ${session.environment} dashboard`;
      document.getElementById("analytics-coverage").textContent = session.environment === "prod"
        ? "Traffic and active engagement time measure public production pages; activity and seasons measure production. Google Search covers predictplayoffs.com. Per-session active time is an estimate because measurement coverage differs. Seasons covers all retained seasons, independent of the date range."
        : "Traffic, activity and seasons measure dev; Google Search measures the connected property. Seasons covers all retained seasons, independent of the date range.";
      main.hidden = false;
      access.hidden = true;
      clearReports();
      const providers = order.filter(provider => session.providers.includes(provider));
      const loaded = new Map();
      let available = 0;
      await Promise.allSettled(providers.map(async provider => {
        const section = element("section", undefined, "analytics-provider");
        section.dataset.provider = provider;
        section.id = `analytics-panel-${provider}`;
        section.setAttribute("role", "tabpanel");
        section.setAttribute("aria-labelledby", `analytics-tab-${provider}`);
        section.tabIndex = 0;
        section.hidden = provider !== selectedProvider;
        section.append(element("h2", names[provider]), element("div", undefined, "analytics-skeleton"), element("p", "Loading report…", "analytics-empty"));
        reports.append(section);
        let data;
        try { data = await api(`/api/admin/analytics/${provider}?${params}`, token); }
        catch (_error) { data = { provider, status: "unavailable", message: "This report could not be loaded. Try again later." }; }
        if (denied) return;
        const updateEngagement = renderProvider(section, { ...data, provider });
        loaded.set(provider, { data, updateEngagement });
        if (data.status === "ok") available++;
      }));
      if (!denied) {
        const activity = loaded.get("custom");
        activity?.updateEngagement?.(engagementEstimate(activity.data, loaded.get("goatcounter")?.data, params));
      }
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
      clearReports();
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
  if (!["dev", "prod"].includes(window.AUTH_CONFIG?.environment)) redirect();
  else loadReports();
})();
