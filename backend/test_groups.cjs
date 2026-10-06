const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(`${__dirname}/../frontend/${name}`, 'utf8');
const leaderboard = read('leaderboard.js');
const app = read('app.js');

class Element {
  constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.textContent = ''; this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.events[name] = callback; }
}
function boot() {
  const nodes = new Map();
  const node = name => { if (!nodes.has(name)) nodes.set(name, new Element()); return nodes.get(name); };
  const group = { groupId: 'g', groupName: 'Crew', isCommissioner: true };
  const context = vm.createContext({
    document: { createElement: () => new Element(), querySelector: node, getElementById: id => node(`#${id}`), querySelectorAll: () => [] },
    state: { signedIn: false, leaderboardView: 'groups', groups: [group], activeGroupId: 'g', groupLeaderboard: { members: [
      { userId: 'a', displayName: 'Alice', isCommissioner: true, isCurrentUser: true, hasPrediction: true },
      { userId: 'b', displayName: '<Bob>', hasPrediction: false },
    ] } },
    elements: { publicLeaderboardTab: node('#public'), groupsLeaderboardTab: node('#groups'), publicLeaderboardPanel: node('#public-panel'),
      groupsLeaderboardPanel: node('#groups-panel'), emptyGroups: node('#empty'), groupLeaderboardStatus: node('#status') },
    window: { location: { hash: '#groups', pathname: '/leaderboard', search: '?sport=nba' }, history: { replaceState(_s, _t, url) { context.lastUrl = url; } }, confirm: () => true },
    apiRequest: async (...args) => { context.requests.push(args); return {}; }, requests: [],
    loadGroupLeaderboard: async () => {}, showToast: text => { context.toast = text; },
    FINAL_NAME: 'NBA Finals', openPublicBracket: () => { context.opened = true; },
  });
  vm.runInContext(leaderboard, context);
  // Override network/render collaborators after loading the functions under test.
  context.loadGroupLeaderboard = async id => { context.loaded = id; };
  context.openGroupInviteDialog = async group => { context.invited = group.groupId; };
  const start = app.indexOf('function renderLeaderboardView(');
  vm.runInContext(app.slice(start, app.indexOf('function handleLeaderboardViewKeydown(', start)), context);
  return { context, node };
}

test('signed-out Groups deep links remain on My Groups and tabs preserve NBA scope', () => {
  const { context, node } = boot();
  context.renderLeaderboardView();
  assert.equal(context.state.leaderboardView, 'groups');
  assert.equal(node('#groups').attributes['aria-selected'], 'true');
  assert.match(node('#empty').textContent, /Sign in/);
  context.renderLeaderboardView('public');
  assert.equal(context.lastUrl, '/leaderboard?sport=nba');
  context.window.location.hash = '';
  context.renderLeaderboardView('groups');
  assert.equal(context.lastUrl, '/leaderboard?sport=nba#groups');
  assert.match(read('index.html'), /href="\/leaderboard#groups"[^>]*data-leaderboard-view="groups"/);
  assert.match(read('shell.js'), /data-nav-page="groups">My Groups/);
});

test('sign-out clears private group state and rendered members while retaining the Groups entry point', () => {
  const { context, node } = boot();
  context.document.body = new Element();
  context.authPanels = {};
  for (const name of ['accountAuthView', 'accountSettingsView', 'headerAccount', 'accountEmail', 'savedSection', 'signedOutPanel']) context.elements[name] = new Element();
  context.renderLeaderboardProfile = () => context.renderLeaderboardView();
  context.renderGroups = () => { context.cleared = true; node('#group-member-list').replaceChildren(); };
  node('#group-member-list').append(new Element());
  const start = app.indexOf('function renderAuthentication(');
  vm.runInContext(app.slice(start, app.indexOf('async function refreshProfile(', start)), context);
  context.renderAuthentication(false);
  assert.equal(context.state.groups.length, 0);
  assert.equal(context.state.groupLeaderboard, null);
  assert.equal(context.state.leaderboardView, 'groups');
  assert.equal(context.cleared, true);
  assert.equal(node('#group-member-list').children.length, 0);
});

test('standings identify commissioner and do not open a bracket for missing predictions', () => {
  const { context } = boot();
  const body = new Element();
  context.renderLeaderboardRows(body, [{ leaderboardName: 'Alice', isCommissioner: true, hasPrediction: false, total: null }]);
  const row = body.children[0];
  const button = row.children[1].children[0];
  assert.equal(button.children[0].textContent, 'Alice · Commissioner');
  assert.equal(button.children[1].textContent, 'No prediction');
  assert.equal(button.disabled, true);
  assert.equal(row.events.click, undefined);
  assert.equal(row.children[5].textContent, '—');
});

test('member list shows everyone and restricts removal controls to commissioner', async () => {
  const { context, node } = boot();
  context.renderGroupMembers();
  const list = node('#group-member-list');
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].children[0].textContent, /Commissioner · You/);
  assert.equal(list.children[0].children.length, 1);
  assert.equal(list.children[1].children[0].textContent, '<Bob> · No prediction');
  await list.children[1].children[1].events.click();
  assert.equal(context.requests[0][0], '/api/groups/g/members/b');
  assert.equal(context.requests[0][1].method, 'DELETE');
  assert.equal(context.loaded, 'g');
  context.state.groups[0].isCommissioner = false;
  context.renderGroupMembers();
  assert.ok(list.children.every(item => item.children.length === 1));
});

test('invite controls regenerate and revoke with explicit confirmation and handle failures', async () => {
  const { context, node } = boot();
  await context.changeActiveGroupInvite(false);
  assert.equal(context.requests[0][1].method, 'POST');
  assert.equal(context.invited, 'g');
  await context.changeActiveGroupInvite(true);
  assert.equal(context.requests[1][1].method, 'DELETE');
  context.window.confirm = () => false;
  await context.changeActiveGroupInvite(true);
  assert.equal(context.requests.length, 2);
  context.window.confirm = () => true;
  context.apiRequest = async () => { throw new Error('Refresh and try again'); };
  await context.changeActiveGroupInvite(false);
  assert.equal(node('#status').textContent, 'Refresh and try again');
  assert.equal(node('#regenerate-group-invite').disabled, false);
  context.state.groups[0].isCommissioner = false;
  await context.changeActiveGroupInvite(false);
  assert.equal(context.requests.length, 2);
});
