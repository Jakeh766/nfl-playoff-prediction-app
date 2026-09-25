const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
const start = appSource.indexOf("function setAccountModalBackgroundInert(");
const end = appSource.indexOf("\nfunction openAccountModal(", start);
assert.ok(start >= 0 && end > start, "account modal background handler exists");
const handlerSource = appSource.slice(start, end);

function makeElement(id, tagName, inert = false) {
  return { id, tagName, inert, dataset: {} };
}

test("account modal leaves password-manager UI outside the page interactive", () => {
  const header = makeElement("site-header", "HEADER");
  const main = Object.freeze(makeElement("", "MAIN"));
  const toast = makeElement("toast", "DIV");
  const dialogs = makeElement("site-dialogs", "DIV");
  const footer = makeElement("site-footer", "FOOTER", true);
  const extensionOverlay = makeElement("extension-overlay", "BW-OVERLAY");
  const children = [header, main, toast, dialogs, footer, extensionOverlay];
  const document = {
    querySelectorAll(selector) {
      return children.filter((element) => selector.split(",").some((part) => {
        const rule = part.trim();
        if (rule === "body > :not(#site-dialogs)") return element !== dialogs;
        if (rule === "body > main") return element === main;
        if (rule.startsWith("body > #")) return element.id === rule.slice(8);
        if (rule.startsWith("#")) return element.id === rule.slice(1);
        return false;
      }));
    },
  };
  const context = vm.createContext({ document });
  vm.runInContext(handlerSource, context);

  vm.runInContext("setAccountModalBackgroundInert(true)", context);
  for (const element of [header, toast, footer]) {
    assert.equal(element.inert, true, `${element.id || "main"} is background`);
  }
  assert.equal(main.inert, false, "picks controls keep the same state while login is open");
  assert.equal(dialogs.inert, false, "account dialog remains interactive");
  assert.equal(extensionOverlay.inert, false, "injected autofill suggestion remains clickable");

  vm.runInContext("setAccountModalBackgroundInert(false)", context);
  for (const element of [header, main, toast]) assert.equal(element.inert, false);
  assert.equal(footer.inert, true, "pre-existing inert state is preserved");
  assert.equal(extensionOverlay.inert, false);
});
