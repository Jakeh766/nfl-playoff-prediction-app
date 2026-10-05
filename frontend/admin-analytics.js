(function initializeAdminAnalytics() {
  const sessionKey = "road-to-bowl.auth.session";
  const names = { custom: "CloudWatch / custom analytics", goatcounter: "GoatCounter",
    ga4: "Google Analytics 4", "search-console": "Google Search Console", clarity: "Microsoft Clarity" };
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
    if (!Number.isFinite(Number(value))) return "Unavailable";
    if (type === "percent" || type === "percent100") return new Intl.NumberFormat(undefined,
      { style: "percent", maximumFractionDigits: 1 }).format(Number(value) / (type === "percent100" ? 100 : 1));
    if (type === "seconds") return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} s`;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: type === "decimal" ? 2 : 0 }).format(value);
  }
  function renderProvider(section, data) {
    section.replaceChildren();
    const heading = element("div", undefined, "analytics-provider-heading");
    heading.append(element("h2", names[data.provider]));
    const states = { ok: data.cached ? "Cached report" : "Report ready", not_configured: "Setup needed",
      unavailable: "Unavailable", updating: "Refreshing" };
    const state = element("span", states[data.status] || "Unavailable", "analytics-provider-state");
    state.dataset.state = data.status;
    heading.append(state);
    section.append(heading);
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
    if (data.note) section.append(element("p", data.note, "analytics-provider-note"));
    for (const report of data.tables || []) {
      const wrap = element("div", undefined, "analytics-table-wrap");
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
      section.append(wrap);
    }
  }
  function dates(days = 28) {
    const finish = new Date();
    finish.setUTCDate(finish.getUTCDate() - 1);
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
      const providers = session.providers.filter(provider => Object.hasOwn(names, provider));
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
  preset.addEventListener("change", () => { if (preset.value !== "custom") dates(Number(preset.value)); });
  for (const input of [start, end]) input.addEventListener("change", () => { preset.value = "custom"; });
  form.addEventListener("submit", loadReports);
  dates();
  if (window.AUTH_CONFIG?.environment !== "dev") redirect();
  else loadReports();
})();
