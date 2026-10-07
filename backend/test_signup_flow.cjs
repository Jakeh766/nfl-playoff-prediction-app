const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const authSource = section("async function requestCognito(", "async function requestPasswordSignIn(") +
  section("function signInErrorMessage(", "async function submitForgotPassword(");
const event = { preventDefault() {} };

function boot(responses) {
  const requests = [];
  const analytics = [];
  const signIns = [];
  const elements = Object.fromEntries([
    "signedOutPanel", "createAccountPanel", "confirmAccountPanel", "forgotPasswordPanel",
    "resetPasswordPanel", "authMessage", "createEmail", "createPassword", "confirmEmail",
    "confirmationCode", "loginEmail", "loginPassword", "signIn",
  ].map(name => [name, {
    value: "", textContent: "", hidden: name !== "createAccountPanel", focused: false,
    focus() { this.focused = true; }, setAttribute() {},
    classList: { toggle(_class, hidden) { elements[name].hidden = hidden; } },
  }]));
  elements.createEmail.value = " existing@example.com ";
  elements.createPassword.value = "new-password";
  const context = vm.createContext({
    elements, pendingAccountCredentials: { email: "stale@example.com", password: "stale" },
    signInPending: false,
    authConfig: () => ({ cognitoEndpoint: "https://cognito-idp.us-east-1.amazonaws.com", clientId: "test-client" }),
    authIsConfigured: () => true,
    window: { siteAnalytics: { track: name => analytics.push(name) } },
    console: { error() {} }, resetPasswordVisibility() {}, resetSignInButton() {},
    finishPasswordSignIn: async (email, password) => { signIns.push({ email, password }); },
    fetch: async (_url, request) => {
      const operation = request.headers["X-Amz-Target"].split(".").at(-1);
      requests.push({ operation, parameters: JSON.parse(request.body) });
      const response = responses.shift();
      assert.ok(response, `Unexpected ${operation} request`);
      return { ok: !response.__type, json: async () => response };
    },
  });
  vm.runInContext(authSource, context);
  return { context, elements, requests, analytics, signIns };
}

test("duplicate email goes directly to sign-in without sending a verification code", async () => {
  const app = boot([{ __type: "com.amazon.cognito#UsernameExistsException", message: "User already exists" }]);
  await app.context.submitCreateAccount(event);
  assert.deepEqual(app.requests.map(request => request.operation), ["SignUp"]);
  assert.equal(app.elements.signedOutPanel.hidden, false);
  assert.equal(app.elements.confirmAccountPanel.hidden, true);
  assert.match(app.elements.authMessage.textContent, /An account already exists.*Sign in.*Forgot password/);
  assert.equal(app.elements.loginEmail.value, "existing@example.com");
  assert.equal(app.elements.loginPassword.focused, true);
  assert.equal(app.elements.createPassword.value, "");
  assert.equal(app.context.pendingAccountCredentials, null);
  assert.deepEqual(app.analytics, []);
  assert.deepEqual(app.signIns, []);
});

test("new account still verifies and signs in using its original password", async () => {
  const app = boot([{ UserConfirmed: false }, {}]);
  await app.context.submitCreateAccount(event);
  assert.equal(app.elements.confirmAccountPanel.hidden, false);
  assert.equal(app.elements.confirmationCode.focused, true);
  assert.equal(app.elements.createPassword.value, "");
  assert.deepEqual(app.analytics, ["account_created"]);
  app.elements.confirmationCode.value = " 123456 ";
  await app.context.submitConfirmAccount(event);
  assert.deepEqual(app.requests.map(request => request.operation), ["SignUp", "ConfirmSignUp"]);
  assert.equal(app.requests[1].parameters.ConfirmationCode, "123456");
  assert.deepEqual(app.signIns, [{ email: "existing@example.com", password: "new-password" }]);
  assert.equal(app.context.pendingAccountCredentials, null);
});

test("unfinished signup can still recover from sign-in and explicitly resend a code", async () => {
  const app = boot([{}, {}]);
  app.elements.loginEmail.value = "existing@example.com";
  app.elements.loginPassword.value = "original-password";
  app.context.finishPasswordSignIn = async () => {
    throw Object.assign(new Error("Confirm your account"), { code: "UserNotConfirmedException" });
  };
  await app.context.submitSignIn(event);
  assert.equal(app.elements.confirmAccountPanel.hidden, false);
  assert.match(app.elements.authMessage.textContent, /still needs verification.*Resend code/);
  assert.deepEqual(app.requests, []);
  await app.context.resendConfirmationCode();
  assert.deepEqual(app.requests.map(request => request.operation), ["ResendConfirmationCode"]);
  app.context.finishPasswordSignIn = async (email, password) => app.signIns.push({ email, password });
  app.elements.confirmationCode.value = "123456";
  await app.context.submitConfirmAccount(event);
  assert.deepEqual(app.signIns, [{ email: "existing@example.com", password: "original-password" }]);
});

test("invalid signup password stays on signup without sending a code", async () => {
  const app = boot([{ __type: "InvalidPasswordException" }]);
  await app.context.submitCreateAccount(event);
  assert.equal(app.elements.createAccountPanel.hidden, false);
  assert.match(app.elements.authMessage.textContent, /Choose a password/);
  assert.deepEqual(app.requests.map(request => request.operation), ["SignUp"]);
  assert.deepEqual(app.analytics, []);
});
