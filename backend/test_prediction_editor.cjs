const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/../frontend/picks.js`, "utf8");
const locks = fs.readFileSync(`${__dirname}/../frontend/prediction-window.js`, "utf8");

function control() {
  const attributes = {};
  const classes = new Set();
  return { textContent: "", disabled: false,
    classList: { add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); } },
    setAttribute: (key, value) => { attributes[key] = value; },
    getAttribute: key => attributes[key], removeAttribute: key => { delete attributes[key]; },
    focus() {}, scrollIntoView() {} };
}

function boot() {
  const record = { seeds: { AFC: ["One", "Two"], NFC: ["Three", "Four"] },
    divisionWinners: { AFC: { North: "One" }, NFC: { South: "Three" } },
    picks: { AFC: { conf: "One" }, NFC: { conf: "Three" }, superBowl: "One" },
    bracketBuilt: true, savedAt: Date.UTC(2026, 9, 8, 14, 57),
    score: { total: 172, possible: 200 } };
  const state = { ...structuredClone(record), savedPrediction: structuredClone(record),
    signedIn: true, leaderboardName: "Player", predictionsLocked: false,
    predictionLoading: false, predictionLoadFailed: false,
    predictionSaving: false, predictionDeleting: false };
  const elements = Object.fromEntries(["saveState", "savePrediction", "bracketShareSlot", "bracketShareHelp",
    "predictionSettings", "deletePrediction", "predictionLoadError", "predictor", "bracketSection",
    "confirmDeletePrediction", "cancelDeletePrediction", "deletePredictionConfirmation", "deletePredictionMessage",
    "afcSeeds", "nfcSeeds", "buildBracket", "randomizeBracket", "resetPicks", "seedingMessage"].map(key => [key, control()]));
  const time = control(), share = control();
  elements.saveState.querySelector = () => time;
  elements.bracketShareSlot.querySelector = () => share;
  const calls = [], toasts = [];
  const sandbox = vm.createContext({ state, elements, window: {}, PAGE: "picks", SPORT: "nfl",
    CONFERENCES: ["AFC", "NFC"], TEAM_DIVISIONS: {}, IS_NBA: false,
    document: { addEventListener() {}, body: { classList: control().classList } },
    Intl, Date, clearInterval, setInterval, requestAnimationFrame: action => action(),
    clone: structuredClone, closeAccountModal() {}, renderSeedSelectors() {},
    showToast: message => toasts.push(message),
    apiRequest: async (path, options = {}) => {
      calls.push({ path, options });
      return { ...JSON.parse(options.body), savedAt: record.savedAt + 60_000 };
    } });
  vm.runInContext(source, sandbox);
  vm.runInContext(locks, sandbox);
  sandbox.renderSeedSelectors = () => {};
  sandbox.renderBracket = () => {};
  sandbox.validateSeeding = () => "";
  sandbox.allGamesPicked = () => true;
  sandbox.getConferenceWinner = conference => state.picks[conference].conf;
  sandbox.emptySeeds = () => ({ AFC: [], NFC: [] });
  sandbox.createEmptyPicks = () => ({ AFC: {}, NFC: {}, superBowl: "" });
  sandbox.createEmptyDivisionWinners = () => ({ AFC: {}, NFC: {} });
  return { sandbox, state, elements, time, share, record, calls, toasts };
}

test("first-save state and saved timestamps use persisted metadata and locale date/time", () => {
  const { sandbox, state, elements, time, share, record } = boot();
  state.savedPrediction = null;
  sandbox.updateSaveState();
  assert.equal(time.textContent, "Not saved yet");
  assert.equal(elements.savePrediction.textContent, "Save prediction");
  assert.equal(share.disabled, true);
  state.savedPrediction = record;
  sandbox.updateSaveState();
  assert.equal(time.dateTime, new Date(record.savedAt).toISOString());
  assert.equal(time.textContent, "Saved " + new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(record.savedAt)));
  assert.equal(share.disabled, false);
  assert.equal(elements.savePrediction.disabled, true);
  sandbox.loadPredictionIntoEditor(false);
  assert.equal(state.savedAt, record.savedAt, "loading never generates a new saved timestamp");
});

test("pick, seed, division and reset changes gate sharing; reverting restores the saved state", () => {
  const { sandbox, state, elements, time, share, record } = boot();
  sandbox.handleGamePick("", "super-bowl", "Three", true);
  assert.equal(time.textContent, "Unsaved changes");
  assert.equal(share.disabled, true);
  assert.equal(elements.bracketShareHelp.textContent, "Save changes before sharing");
  assert.equal(elements.savePrediction.textContent, "Save changes");
  assert.equal(state.savedAt, record.savedAt);
  sandbox.handleGamePick("", "super-bowl", "One", true);
  assert.equal(share.disabled, false);
  for (const change of [() => { state.seeds.AFC.reverse(); },
    () => { state.divisionWinners.AFC.North = "Two"; }, () => sandbox.resetGamePicks()]) {
    change(); sandbox.updateSaveState();
    assert.equal(share.disabled, true);
    sandbox.loadPredictionIntoEditor(false);
    assert.equal(share.disabled, false);
  }
});

test("comparison ignores scores and object key order, and supports older records without divisions", () => {
  const { sandbox, state } = boot();
  state.savedPrediction.score = { total: 999 };
  state.picks = { superBowl: "One", NFC: { conf: "Three" }, AFC: { conf: "One" } };
  assert.equal(sandbox.predictionHasUnsavedChanges(), false);
  delete state.savedPrediction.divisionWinners;
  assert.equal(sandbox.predictionHasUnsavedChanges(), false);
});

test("saving changes updates the timestamp and avoids duplicate writes", async () => {
  const { sandbox, state, time, share, calls, toasts } = boot();
  await sandbox.savePrediction();
  assert.equal(calls.length, 0);
  state.picks.superBowl = "Three";
  await sandbox.savePrediction();
  assert.equal(calls.length, 1);
  assert.equal(time.dateTime, new Date(state.savedPrediction.savedAt).toISOString());
  assert.equal(share.disabled, false);
  assert.deepEqual(toasts, ["Prediction saved"]);
});

test("failed saves preserve the draft and saved timestamp; load failures prevent overwrites", async () => {
  const { sandbox, state, share, record, elements } = boot();
  state.picks.superBowl = "Three";
  sandbox.apiRequest = async () => { throw new Error("Service unavailable"); };
  await sandbox.savePrediction();
  assert.equal(state.savedPrediction.savedAt, record.savedAt);
  assert.equal(state.picks.superBowl, "Three");
  assert.equal(share.disabled, true);
  await sandbox.refreshSavedPrediction();
  assert.equal(state.predictionLoadFailed, true);
  assert.equal(elements.savePrediction.disabled, true);
  assert.match(elements.predictionLoadError.textContent, /Refresh before saving or sharing/);
});

test("edits during an in-flight save remain dirty instead of sharing an older snapshot", async () => {
  const { sandbox, state, share, elements, time } = boot();
  state.picks.superBowl = "Three";
  let finish;
  sandbox.apiRequest = (_path, options) => new Promise(resolve => {
    finish = () => resolve({ ...JSON.parse(options.body), savedAt: Date.UTC(2026, 9, 8, 15, 14) });
  });
  const saving = sandbox.savePrediction();
  assert.equal(elements.savePrediction.textContent, "Saving…");
  assert.equal(share.disabled, true);
  state.picks.superBowl = "One";
  finish(); await saving;
  assert.equal(state.savedPrediction.picks.superBowl, "Three");
  assert.equal(state.picks.superBowl, "One");
  assert.equal(time.textContent, "Unsaved changes");
  assert.equal(share.disabled, true);
});

test("locking restores the persisted bracket, preserves its timestamp, and keeps sharing available", async () => {
  const { sandbox, state, elements, share, record, time, calls } = boot();
  state.picks.superBowl = "Three";
  sandbox.setPredictionEditingLocked(true);
  assert.equal(state.picks.superBowl, record.picks.superBowl);
  assert.equal(time.dateTime, new Date(record.savedAt).toISOString());
  assert.equal(elements.savePrediction.disabled, true);
  assert.equal(elements.resetPicks.disabled, true);
  assert.equal(share.disabled, false);
  sandbox.handleGamePick("", "super-bowl", "Three", true);
  await sandbox.savePrediction();
  assert.equal(state.picks.superBowl, record.picks.superBowl);
  assert.equal(calls.length, 0);
});

test("a saved prediction loaded after the deadline replaces any earlier local draft", async () => {
  const { sandbox, state, share, record } = boot();
  state.savedPrediction = null;
  state.predictionsLocked = true;
  state.picks.superBowl = "Three";
  sandbox.apiRequest = async () => structuredClone(record);
  await sandbox.refreshSavedPrediction();
  assert.equal(state.picks.superBowl, record.picks.superBowl);
  assert.equal(state.savedAt, record.savedAt);
  assert.equal(share.disabled, false);
});

test("prediction deletion uses only the existing sport-specific endpoint and handles failure", async () => {
  const { sandbox, state, calls, share, elements } = boot();
  sandbox.apiRequest = async (path, options) => { calls.push({ path, options }); throw new Error("Try again"); };
  await sandbox.deletePrediction();
  assert.ok(state.savedPrediction);
  assert.match(elements.deletePredictionMessage.textContent, /Try again/);
  sandbox.apiRequest = async (path, options) => { calls.push({ path, options }); return { deleted: true }; };
  await sandbox.deletePrediction();
  assert.equal(state.savedPrediction, null);
  assert.equal(share.disabled, true);
  assert.equal(state.bracketBuilt, false);
  assert.deepEqual(calls.map(call => [call.path, call.options.method]), [
    ["/api/prediction", "DELETE"], ["/api/prediction", "DELETE"],
  ]);
});
