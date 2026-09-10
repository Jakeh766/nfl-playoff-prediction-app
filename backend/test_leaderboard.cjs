const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/../frontend/leaderboard.js', 'utf8'), context);

test('local preview has enough entries to exercise leaderboard scrolling', () => {
  assert.equal(vm.runInContext('LOCAL_PREVIEW_LEADERBOARD_NAMES.length', context), 16);
});

test('public leaderboard ranks and sorts by the selected scoring mode', () => {
  const entry = (name, classic, vegas) => ({
    leaderboardName: name,
    scores: { classic, vegas },
  });
  const entries = [
    entry('Zoe', { regularSeason: 55, playoffs: 35, total: 90 }, { regularSeason: 40, playoffs: 30, total: 70 }),
    entry('Adam', { regularSeason: 60, playoffs: 20, total: 80 }, { regularSeason: 65, playoffs: 35, total: 100 }),
    entry('Maya', { regularSeason: 45, playoffs: 25, total: 70 }, { regularSeason: 50, playoffs: 30, total: 80 }),
  ];
  context.entries = entries;

  const rankedNames = (mode) => Array.from(vm.runInContext(
    `rankLeaderboardEntries(entries, '${mode}').map((entry) => entry.leaderboardName)`,
    context,
  ));
  const namesFor = (key, mode, direction = 'descending') => Array.from(vm.runInContext(
    `sortLeaderboardEntries(rankLeaderboardEntries(entries, '${mode}'), { key: '${key}', direction: '${direction}' }, '${mode}').map((entry) => entry.leaderboardName)`,
    context,
  ));

  assert.deepEqual(rankedNames('classic'), ['Zoe', 'Adam', 'Maya']);
  assert.deepEqual(rankedNames('vegas'), ['Adam', 'Maya', 'Zoe']);
  assert.deepEqual(namesFor('rank', 'vegas', 'ascending'), ['Adam', 'Maya', 'Zoe']);
  assert.deepEqual(namesFor('player', 'classic', 'ascending'), ['Adam', 'Maya', 'Zoe']);
  assert.deepEqual(namesFor('field', 'classic'), ['Adam', 'Zoe', 'Maya']);
  assert.deepEqual(namesFor('playoffs', 'classic'), ['Zoe', 'Maya', 'Adam']);
  assert.deepEqual(namesFor('total', 'vegas'), ['Adam', 'Maya', 'Zoe']);
  assert.equal(entries[0].scores.classic.total, 90);
  assert.equal(entries[0].scores.vegas.total, 70);
  assert.equal('upsetBonus' in entries[0].scores.vegas, false);
});

test('zero-score players remain alphabetized and unranked', () => {
  context.tiedEntries = [
    { leaderboardName: 'Charlie', total: 0, regularSeason: 0, playoffs: 0 },
    { leaderboardName: 'Alpha', total: 0, regularSeason: 0, playoffs: 0 },
    { leaderboardName: 'Bravo', total: 0, regularSeason: 0, playoffs: 0 },
  ];

  assert.deepEqual(
    Array.from(vm.runInContext(
      'rankLeaderboardEntries(tiedEntries).map((entry) => [entry.leaderboardName, entry.rank])',
      context,
    ), (entry) => Array.from(entry)),
    [['Alpha', null], ['Bravo', null], ['Charlie', null]],
  );
});

test('podium places use medals and later places use numbers', () => {
  assert.equal(vm.runInContext('formatLeaderboardRank(1)', context), '🥇');
  assert.equal(vm.runInContext('formatLeaderboardRank(2)', context), '🥈');
  assert.equal(vm.runInContext('formatLeaderboardRank(3)', context), '🥉');
  assert.equal(vm.runInContext('formatLeaderboardRank(4)', context), '4');
  assert.equal(vm.runInContext('formatLeaderboardRank(null)', context), '—');
});

test('Upset Edge zero scores do not show unnecessary decimals', () => {
  assert.equal(vm.runInContext('formatLeaderboardScore(0, 2)', context), '0');
  assert.equal(vm.runInContext('formatLeaderboardScore(7.25, 2)', context), '7.25');
});

test('private leaderboard reads only its fixed scoring mode', () => {
  context.privateEntry = {
    leaderboardName: 'Group Player',
    scoringOption: 'vegas',
    regularSeason: 42.25,
    playoffs: 18.5,
    total: 60.75,
    scores: { vegas: { regularSeason: 42.25, playoffs: 18.5, total: 60.75 } },
  };

  assert.equal(vm.runInContext(`leaderboardSortValue(privateEntry, 'total', 'vegas')`, context), 60.75);
  assert.equal(vm.runInContext(`leaderboardSortValue(privateEntry, 'total', 'classic')`, context), null);
});
