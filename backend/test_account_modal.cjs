const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
const start = appSource.indexOf("let restoreAccountModalMain = null;");
const end = appSource.indexOf("\nfunction openAccountModal(", start);
assert.ok(start >= 0 && end > start, "account modal background handler exists");
const handlerSource = appSource.slice(start, end);

function makeElement(id, tagName, inert = false) {
  const attributes = new Map();
  return {
    id, tagName, inert, dataset: {}, controls: [],
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    querySelectorAll() { return this.controls; },
  };
}

test("account modal leaves password-manager UI outside the page interactive", () => {
  const header = makeElement("site-header", "HEADER");
  const main = makeElement("", "MAIN");
  const toast = makeElement("toast", "DIV");
  const dialogs = makeElement("site-dialogs", "DIV");
  const footer = makeElement("site-footer", "FOOTER", true);
  const extensionOverlay = makeElement("extension-overlay", "BW-OVERLAY");
  const select = makeElement("seed", "SELECT");
  const customTabStop = makeElement("custom", "BUTTON");
  customTabStop.setAttribute("tabindex", "0");
  main.controls.push(select, customTabStop);
  main.setAttribute("aria-hidden", "false");
  const children = [header, main, toast, dialogs, footer, extensionOverlay];
  const document = {
    querySelector(selector) {
      assert.equal(selector, "body > main");
      return main;
    },
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
  let observerCallback;
  let disconnected = false;
  const context = vm.createContext({
    document,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe(target, options) {
        assert.equal(target, main);
        assert.equal(options.childList && options.subtree, true);
      }
      disconnect() { disconnected = true; }
    },
  });
  vm.runInContext(handlerSource, context);

  vm.runInContext("setAccountModalBackgroundInert(true)", context);
  for (const element of [header, toast, footer]) {
    assert.equal(element.inert, true, `${element.id || "main"} is background`);
  }
  assert.equal(dialogs.inert, false, "account dialog remains interactive");
  assert.equal(extensionOverlay.inert, false, "injected autofill suggestion remains clickable");
  assert.equal(main.inert, false, "team selectors must not have an inert ancestor");
  assert.equal(main.getAttribute("aria-hidden"), "true");
  for (const control of main.controls) assert.equal(control.getAttribute("tabindex"), "-1");

  // A repeated open must not overwrite the attributes saved for restoration.
  vm.runInContext("setAccountModalBackgroundInert(true)", context);
  const replacementSelect = makeElement("replacement-seed", "SELECT");
  main.controls = [replacementSelect];
  observerCallback();
  assert.equal(replacementSelect.getAttribute("tabindex"), "-1", "async seed renders stay out of tab order");

  vm.runInContext("setAccountModalBackgroundInert(false)", context);
  for (const element of [header, main, toast]) assert.equal(element.inert, false);
  assert.equal(footer.inert, true, "pre-existing inert state is preserved");
  assert.equal(extensionOverlay.inert, false);
  assert.equal(main.getAttribute("aria-hidden"), "false", "previous accessibility state is restored");
  assert.equal(select.getAttribute("tabindex"), null);
  assert.equal(customTabStop.getAttribute("tabindex"), "0");
  assert.equal(replacementSelect.getAttribute("tabindex"), null);
  assert.equal(disconnected, true, "stop observing after close");

  main.removeAttribute("aria-hidden");
  vm.runInContext("setAccountModalBackgroundInert(true); setAccountModalBackgroundInert(false)", context);
  assert.equal(main.getAttribute("aria-hidden"), null, "absent attributes remain absent after reopening");
});
