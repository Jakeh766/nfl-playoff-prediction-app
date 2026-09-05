const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('public ranking switches scores, preserves both totals, and shares tied ranks', () => {
  const control = { value: 'classic', addEventListener() {} };
  const node = () => ({ classList: { toggle() {} } });
  const entry = (name, classic, vegas) => ({ leaderboardName: name,
    total: classic, regularSeason: classic, playoffs: 0,
    scores: { classic: { total: classic, regularSeason: classic, playoffs: 0 },
      vegas: { total: vegas, regularSeason: vegas, playoffs: 0 } } });
  const context = vm.createContext({ document: { querySelector: () => control },
    state: { leaderboard: { entries: [entry('A', 20, 10), entry('B', 10, 30), entry('C', 5, 30)] } },
    elements: { leaderboardTableShell: node(), emptyLeaderboard: node(),
      leaderboardBody: node(), leaderboardStatus: node() } });
  vm.runInContext(fs.readFileSync(__dirname + '/../frontend/leaderboard.js', 'utf8'), context);
  vm.runInContext('renderLeaderboardRows = (_body, entries) => { rendered = entries; }; renderLeaderboard();', context);
  assert.equal(context.rendered[0].leaderboardName, 'A');
  control.value = 'vegas';
  vm.runInContext('renderLeaderboard();', context);
  assert.equal(context.rendered[0].leaderboardName, 'B');
  assert.equal(context.rendered[0].total, 30);
  assert.equal(context.rendered[0].scores.classic.total, 10);
  assert.equal(context.rendered[1].rank, 1);
  assert.equal(context.rendered[2].rank, 3);
});
