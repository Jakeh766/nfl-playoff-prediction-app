const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
const picks = fs.readFileSync(path.join(__dirname, "../frontend/picks.js"), "utf8");
function section(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source section: ${start}`);
  return source.slice(first, last);
}

const mode = section(app, "const LOCAL_PREVIEW =", "const LEADERBOARD_PROFILE_PREVIEW =");
const visibility = section(app, "if (!TEST_MODE && elements.randomizeBracket)", "function createEmptyPicks()");
const randomize = section(picks, "function randomizeBracket()", "function getConferenceGames(");

function boot(environment, hostname, locked = false, sport = "nfl") {
  const classes = new Set();
  const state = { predictionsLocked: locked, seeds: { sentinel: "saved picks" } };
  let edits = 0;
  const context = vm.createContext({
    window: { AUTH_CONFIG: { environment }, location: { hostname } },
    document: { body: { dataset: { page: "picks" } } },
    elements: { randomizeBracket: { classList: { add: name => classes.add(name) } } },
    state,
    IS_NBA: sport === "nba",
    // Stop at the first attempted edit; guarded calls must never reach it.
    createEmptyDivisionWinners() { edits++; throw new Error("randomize attempted"); },
  });
  vm.runInContext(mode + visibility + randomize, context);
  return { classes, state, context, edits: () => edits };
}

test("production hides randomize and refuses direct calls for NFL and NBA picks", () => {
  for (const environment of ["prod", undefined, "unexpected"]) {
    for (const hostname of ["predictplayoffs.com", "www.predictplayoffs.com"]) {
      for (const sport of ["nfl", "nba"]) {
        const app = boot(environment, hostname, false, sport);
        const before = JSON.stringify(app.state);
        vm.runInContext("randomizeBracket()", app.context);
        assert.ok(app.classes.has("hidden"));
        assert.equal(app.edits(), 0);
        assert.equal(JSON.stringify(app.state), before);
      }
    }
  }
});

test("dev and local preview retain randomize while locked picks reject it", () => {
  for (const [environment, hostname] of [
    ["dev", "dev.example.com"], [undefined, "localhost"], [undefined, "127.0.0.1"],
  ]) {
    const open = boot(environment, hostname);
    assert.equal(open.classes.has("hidden"), false);
    assert.throws(() => vm.runInContext("randomizeBracket()", open.context), /randomize attempted/);
    assert.equal(open.edits(), 1);
    const locked = boot(environment, hostname, true);
    vm.runInContext("randomizeBracket()", locked.context);
    assert.equal(locked.edits(), 0);
  }
});
