const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
const deletion = source.slice(source.indexOf("async function submitDeleteAccount("),
  source.indexOf("\nlet groupMembershipRequest"));

function boot(blocked) {
  const calls = [];
  const records = { nfl: true, nba: true, profile: true, account: true };
  const elements = {
    deleteAccountConfirmation: { value: "DELETE" },
    confirmDeleteAccount: { setAttribute() {}, removeAttribute() {} },
    deleteAccountMessage: {}, deleteAccountDialog: { close() {} },
  };
  const context = vm.createContext({
    deleteAccountPending: false, elements, state: {}, window: {},
    getValidAccessToken: async () => "access",
    apiRequest: async (route, options = {}) => {
      calls.push(`${options.method || "GET"} ${route}`);
      // The current NFL page cannot see the NBA-only group this user manages.
      if (route === "/api/groups") return { groups: [] };
      if (route === "/api/prediction") records.nfl = false;
      if (route === "/api/profile") {
        if (blocked) throw new Error("Transfer commissioner for your NBA group first");
        records.nfl = records.nba = records.profile = false;
      }
      return {};
    },
    requestCognito: async operation => { calls.push(operation); records.account = false; },
    clearAuthSession() {}, renderAuthentication() {}, showAuthPanel() {},
    updateDeleteAccountConfirmation() {},
  });
  vm.runInContext(deletion, context);
  return { context, calls, records, elements };
}

test("blocked account deletion preserves both sports' predictions and the account", async () => {
  const app = boot(true);
  await app.context.submitDeleteAccount({ preventDefault() {} });
  assert.deepEqual(app.records, { nfl: true, nba: true, profile: true, account: true });
  assert.match(app.elements.deleteAccountMessage.textContent, /Transfer commissioner/);
  assert.equal(app.context.deleteAccountPending, false);
});

test("account deletion uses the server's cross-sport cleanup before deleting Cognito", async () => {
  const app = boot(false);
  await app.context.submitDeleteAccount({ preventDefault() {} });
  assert.deepEqual(app.calls, ["DELETE /api/profile", "DeleteUser"]);
  assert.deepEqual(app.records, { nfl: false, nba: false, profile: false, account: false });
});
