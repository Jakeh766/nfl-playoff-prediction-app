const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('leaderboard sorts by every visible column while preserving both totals', () => {
  const entry = (name, rank, field, playoffs, classic, bonus, upsetTotal) => ({
    leaderboardName: name,
    rank,
    regularSeason: field,
    playoffs,
    scores: {
      classic: { total: classic, regularSeason: field, playoffs },
      vegas: { total: upsetTotal, regularSeason: field + bonus, playoffs, upsetBonus: bonus },
    },
  });
  const entries = [
    entry('Zoe', 1, 40, 20, 60, 12, 72),
    entry('Adam', 2, 70, 5, 75, 4, 79),
    entry('Maya', 3, 50, 30, 80, 20, 100),
  ];
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(__dirname + '/../frontend/leaderboard.js', 'utf8'), context);
  context.entries = entries;

  const namesFor = (key, direction = 'descending') => vm.runInContext(
    `sortLeaderboardEntries(entries, { key: '${key}', direction: '${direction}' }).map((entry) => entry.leaderboardName)`,
    context,
  );

  assert.deepEqual(namesFor('rank', 'ascending'), ['Zoe', 'Adam', 'Maya']);
  assert.deepEqual(namesFor('player', 'ascending'), ['Adam', 'Maya', 'Zoe']);
  assert.deepEqual(namesFor('field'), ['Adam', 'Maya', 'Zoe']);
  assert.deepEqual(namesFor('playoffs'), ['Maya', 'Zoe', 'Adam']);
  assert.deepEqual(namesFor('classic'), ['Maya', 'Adam', 'Zoe']);
  assert.deepEqual(namesFor('bonus'), ['Maya', 'Zoe', 'Adam']);
  assert.deepEqual(namesFor('upsetTotal'), ['Maya', 'Adam', 'Zoe']);
  assert.equal(entries[0].scores.classic.total, 60);
  assert.equal(entries[0].scores.vegas.upsetBonus, 12);
});
