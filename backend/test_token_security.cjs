const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = require("./frontend-source.cjs")("app.js");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const authSource = section("function loadAuthSession()", "async function finishPasswordSignIn(") +
  section("async function getValidAccessToken()", "function currentUserEmail()") +
  section("async function signOut()", "function resetDeleteAccountDialog()");

function boot(options = {}) {
  const values = new Map();
  const legacyValues = new Map();
  const storage = map => ({ getItem: key => map.get(key) || null,
    setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
  const requests = [];
  const logs = [];
  const context = vm.createContext({
    AUTH_SESSION_KEY: "road-to-bowl.auth.session", localStorage: storage(values),
    sessionStorage: storage(legacyValues), Date, atob,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    authConfig: () => ({ cognitoEndpoint: "https://cognito-idp.us-east-1.amazonaws.com", clientId: "test-client" }),
    closeAccountModal() {}, renderAuthentication() {}, showAuthPanel() {},
    fetch: async (url, request) => {
      requests.push({ url, request });
      if (options.failFetch) throw new Error("token-sensitive-network-error");
      return { ok: !options.failProvider, json: async () => options.failProvider
        ? { __type: "NotAuthorizedException", message: "token-sensitive-provider-response" }
        : { AuthenticationResult: { AccessToken: "fresh-access", IdToken: "fresh-id", RefreshToken: "refresh", ExpiresIn: 3600 } } };
    },
  });
  vm.runInContext(authSource, context);
  return { context, requests, logs, values, legacyValues };
}

test("persistent sessions and legacy sessions retain the existing login experience", () => {
  const app = boot();
  const saved = app.context.saveAuthSession({ access_token: "access", id_token: "id", refresh_token: "refresh", expires_in: 3600 });
  assert.deepEqual(JSON.parse(JSON.stringify(app.context.loadAuthSession())), JSON.parse(JSON.stringify(saved)));
  const legacy = app.values.get(app.context.AUTH_SESSION_KEY);
  app.values.clear();
  app.legacyValues.set(app.context.AUTH_SESSION_KEY, legacy);
  assert.equal(app.context.loadAuthSession().refreshToken, "refresh");
  assert.equal(app.legacyValues.size, 0);
  assert.equal(app.values.get(app.context.AUTH_SESSION_KEY), legacy);
});

test("password login and refresh send secrets only in Cognito POST bodies", async () => {
  const app = boot();
  const signedIn = await app.context.requestPasswordSignIn("test@example.com", "test-password");
  assert.equal(signedIn.AccessToken, "fresh-access");
  app.context.saveAuthSession({ access_token: "expired-access", refresh_token: "test-refresh", expires_in: -1 });
  assert.equal(await app.context.getValidAccessToken(), "fresh-access");
  assert.equal(app.context.loadAuthSession().refreshToken, "test-refresh");
  for (const { url, request } of app.requests) {
    assert.equal(url, "https://cognito-idp.us-east-1.amazonaws.com");
    assert.equal(request.method, "POST");
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(request.credentials, "omit");
    assert.equal(request.cache, "no-store");
    assert.doesNotMatch(JSON.stringify(request.headers), /password|test-refresh|expired-access/);
  }
  assert.equal(JSON.parse(app.requests[1].request.body).AuthParameters.REFRESH_TOKEN, "test-refresh");
  assert.equal(app.logs.length, 0);
});

test("malformed stored sessions and JWTs never put parser input into logs", () => {
  const app = boot();
  app.values.set(app.context.AUTH_SESSION_KEY, '{"accessToken":"TOKEN-MARKER",');
  assert.equal(app.context.loadAuthSession(), null);
  app.context.decodeJwtPayload("header." + Buffer.from('{"TOKEN-MARKER":').toString("base64") + ".sig");
  assert.doesNotMatch(JSON.stringify(app.logs), /TOKEN-MARKER|SyntaxError/);
  assert.equal(app.values.size, 0);
});

test("provider responses are not rendered and failed refresh clears local credentials", async () => {
  const app = boot({ failProvider: true });
  await assert.rejects(app.context.requestPasswordSignIn("test@example.com", "test-password"), error =>
    error.code === "NotAuthorizedException" && !error.message.includes("token-sensitive"));
  app.context.saveAuthSession({ access_token: "expired-access", refresh_token: "refresh", expires_in: -1 });
  assert.equal(await app.context.getValidAccessToken(), null);
  assert.equal(app.values.size, 0);
  assert.doesNotMatch(JSON.stringify(app.logs), /token-sensitive|expired-access|refreshToken/);
});

test("sign-out revokes refresh tokens even without an access token and keeps GlobalSignOut", async () => {
  for (const access_token of ["expired-access", ""]) {
    const app = boot();
    app.context.saveAuthSession({ access_token, refresh_token: "test-refresh", expires_in: -1 });
    await app.context.signOut();
    assert.equal(app.values.size, 0);
    assert.equal(app.legacyValues.size, 0);
    const revoke = app.requests.at(-1);
    assert.match(revoke.request.headers["X-Amz-Target"], /RevokeToken$/);
    assert.deepEqual(JSON.parse(revoke.request.body), { ClientId: "test-client", Token: "test-refresh" });
    assert.equal(app.requests.length, access_token ? 2 : 1);
    if (access_token) assert.match(app.requests[0].request.headers["X-Amz-Target"], /GlobalSignOut$/);
  }
});

test("remote revocation failure never prevents local sign-out or exposes errors", async () => {
  const app = boot({ failFetch: true });
  app.context.saveAuthSession({ access_token: "access", refresh_token: "refresh" });
  await app.context.signOut();
  assert.equal(app.values.size, 0);
  assert.equal(app.requests.length, 2);
  assert.doesNotMatch(JSON.stringify(app.logs), /token-sensitive|test-password/);
});
