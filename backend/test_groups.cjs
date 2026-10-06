const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(`${__dirname}/../frontend/${name}`, 'utf8');
const leaderboard = read('leaderboard.js');
const app = read('app.js');
const groups = read('groups.js');

class Element {
  constructor() { this.id = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.textContent = ''; this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  get innerHTML() { return ''; }
  set innerHTML(value) { this.children = []; }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.focused = true; }
  getClientRects() { return [1]; }
  reset() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  querySelector() { return this.children.find(node => node.className === 'group-card') || null; }
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
  const tabs = ['standings', 'members', 'history', 'settings'].map(view => {
    const tab = node(`#group-tab-${view}`);
    tab.dataset.groupView = view;
    tab.setAttribute('aria-controls', `group-panel-${view}`);
    return tab;
  });
  const group = { groupId: 'g', groupName: 'Crew', isCommissioner: true, sports: ['nfl', 'nba'], scoringOption: 'classic' };
  const location = { hash: '', pathname: '/groups', search: '', hostname: 'example.com', origin: 'https://example.com',
    replace(url) { context.redirect = url; } };
  const navigate = url => {
    context.lastUrl = url;
    const parsed = new URL(url, location.origin);
    location.pathname = parsed.pathname; location.search = parsed.search;
  };
  const context = vm.createContext({
    document: { title: '', createElement: () => new Element(), querySelector: node, getElementById: id => node(`#${id}`),
      querySelectorAll: selector => selector === '[data-group-view]' ? tabs : [], body: new Element() },
    state: { signedIn: true, groups: [group], activeGroupId: 'g', groupSummaries: {}, groupLeaderboard: { members: [
      { userId: 'a', displayName: 'Alice', isCommissioner: true, isCurrentUser: true, hasPrediction: true },
      { userId: 'b', displayName: '<Bob>', hasPrediction: false },
    ] } },
    elements: Object.fromEntries(Object.entries({ groupCards: '#group-cards', emptyGroups: '#empty', groupLeaderboardStatus: '#status',
      groupLeaderboard: '#group-leaderboard', groupLeaderboardBody: '#board', groupLeaderboardTableShell: '#board-shell',
      emptyGroupLeaderboard: '#empty-board', activeGroupName: '#active-group-name', leaveGroup: '#leave-group',
      editGroupSports: '#edit-group-sports', deleteGroup: '#delete-group' }).map(([key, id]) => [key, node(id)])),
    window: { location, history: { replaceState(_s, _t, url) { navigate(url); }, pushState(_s, _t, url) { navigate(url); } },
      events: {}, addEventListener(name, handler) { this.events[name] = handler; }, confirm: () => true },
    routeHref: path => path, URL, URLSearchParams, SPORT: 'nfl', IS_NBA: false, PAGE: 'groups',
    apiRequest: async (...args) => { context.requests.push(args); return {}; }, requests: [],
    showToast: text => { context.toast = text; }, FINAL_NAME: 'Super Bowl',
  });
  vm.runInContext(leaderboard, context);
  vm.runInContext(groups, context);
  context.realLoadGroupLeaderboard = context.loadGroupLeaderboard;
  context.loadGroupLeaderboard = async id => { context.loaded = id; };
  context.openGroupInviteDialog = async group => { context.invited = group.groupId; };
  return { context, node, tabs };
}

test('Groups owns its page and controls while the leaderboard stays public', () => {
  const html = read('groups.html');
  assert.match(html, /<title>Groups \| Predict Playoffs<\/title>/);
  assert.match(html, /data-page="groups"/);
  assert.match(html, /id="create-group"/); assert.match(html, /id="join-group"/);
  assert.doesNotMatch(html, /id="leaderboard-body"|public-leaderboard-panel/);
  for (const view of ['standings', 'members', 'history', 'settings']) assert.match(html, new RegExp(`id="group-panel-${view}"[^>]*role="tabpanel"`));
  assert.doesNotMatch(read('leaderboard.html'), /groups-leaderboard|group-settings|group-tabs|id="create-group"/);
  assert.doesNotMatch(leaderboard, /function refreshGroups|function submitGroup/);
  for (const file of ['index.html', 'nba.html']) {
    assert.match(read(file), /href="\/groups" data-clean-route="\/groups">View groups/);
    assert.match(read(file), /src="\/groups.js/);
  }
  assert.match(read('shell.js'), /routeHref\("\/groups"\).*data-nav-page="groups"/);
  const infra = fs.readFileSync(`${__dirname}/../terraform/modules/app/main.tf`, 'utf8');
  assert.match(infra, /"groups" = \{\s+source\s+= "\$\{var.frontend_dir\}\/groups.html"/);
  assert.match(infra, /"groups.js" = \{/);
});

test('legacy Groups URLs redirect to the standalone page and preserve NBA/local preview scope', () => {
  const source = read('shell.js');
  for (const [nba, local, expected] of [[false, false, '/groups'], [true, false, '/groups?sport=nba'], [true, true, '/groups.html?sport=nba']]) {
    const context = { document: { body: { dataset: { page: 'leaderboard' } } }, IS_NBA: nba,
      window: { location: { hostname: local ? 'localhost' : 'example.com', hash: '#groups', replace: url => { context.url = url; } } },
      sportUrl: path => path + (nba ? '?sport=nba' : '') };
    vm.runInNewContext(source.slice(0, source.indexOf('const header =')), context);
    assert.equal(context.url, expected);
  }
});

test('sign-out clears private cards, details and cached summaries', () => {
  const { context, node } = boot();
  context.authPanels = {};
  for (const name of ['accountAuthView', 'accountSettingsView', 'headerAccount', 'accountEmail', 'savedSection', 'signedOutPanel']) context.elements[name] = new Element();
  context.renderLeaderboardProfile = () => {};
  context.renderGroupCards();
  assert.equal(node('#group-cards').children.length, 1);
  context.state.groupSummaries.g = { members: [] };
  const start = app.indexOf('function renderAuthentication(');
  vm.runInContext(app.slice(start, app.indexOf('async function refreshProfile(', start)), context);
  context.renderAuthentication(false);
  assert.equal(context.state.groups.length, 0);
  assert.equal(context.state.groupLeaderboard, null);
  assert.equal(Object.keys(context.state.groupSummaries).length, 0);
  assert.equal(node('#group-cards').children.length, 0);
  assert.equal(node('#group-leaderboard').classes.has('hidden'), true);
  assert.match(node('#empty').textContent, /Sign in/);
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

const board = (name = 'Alice', total = 30) => ({
  scoringOption: 'classic', groupName: 'Crew', status: 'Scores updated',
  members: [{ userId: 'a', displayName: name, isCurrentUser: true, hasPrediction: total != null },
    { userId: 'b', displayName: 'Bob', hasPrediction: false }],
  entries: [{ leaderboardName: name, total, regularSeason: total, playoffs: 0 },
    { leaderboardName: 'Bob', hasPrediction: false, total: null }], history: { seasons: [], standings: [] },
});

test('group cards show metadata, commissioner role, all members and tied personal ranks safely', () => {
  const { context, node } = boot();
  context.state.groups[0].groupName = '<Crew & friends>';
  context.state.groupSummaries.g = board();
  context.state.groupSummaries.g.entries.push({ leaderboardName: 'Tied player', total: 30, regularSeason: 30, playoffs: 0 });
  context.renderGroupCards();
  const card = node('#group-cards').children[0];
  assert.equal(card.children[0].textContent, '<Crew & friends>');
  assert.equal(card.children[1].textContent, 'NFL + NBA · Classic');
  assert.equal(card.children[2].textContent, 'Commissioner');
  assert.equal(card.children[3].textContent, '2 members · NFL: Your rank #1');
  assert.equal(card.href, '/groups?group=g');
  context.state.groups[0].isCommissioner = false;
  context.state.groups[0].scoringOption = 'vegas';
  context.state.groupSummaries.g = board('Alice', null);
  context.renderGroupCards();
  assert.equal(node('#group-cards').children[0].children[1].textContent, 'NFL + NBA · Upset Edge');
  assert.match(node('#group-cards').children[0].children[2].textContent, /No rank yet/);
});

test('the directory deduplicates both sports and gets summaries using each group’s eligible sport', async () => {
  const { context, node } = boot();
  const dual = context.state.groups[0];
  const nba = { groupId: 'basketball', groupName: 'Basketball crew', sports: ['nba'], scoringOption: 'vegas' };
  context.apiRequest = async (path, options) => {
    context.requests.push([path, options]);
    if (path === '/api/groups') return { groups: options.sport === 'nfl' ? [dual] : [dual, nba] };
    return board();
  };
  await context.refreshGroups('');
  assert.deepEqual(Array.from(context.state.groups, group => group.groupId), ['basketball', 'g']);
  assert.equal(context.state.activeGroupId, '');
  assert.equal(node('#group-cards').children.length, 2);
  assert.equal(node('#group-cards').children[0].href, '/groups?sport=nba&group=basketball');
  assert.equal(context.requests.find(([path]) => path.includes('/basketball/'))[1].sport, 'nba');
  assert.equal(context.requests.find(([path]) => path.includes('/g/'))[1].sport, 'nfl');
  assert.equal(context.requests.length, 4);
});

test('summary requests use bounded concurrency and one failed board does not hide other groups', async () => {
  const { context } = boot();
  const list = Array.from({ length: 8 }, (_, index) => ({ groupId: `g${index}`, groupName: `Group ${index}`, sports: ['nfl'] }));
  let active = 0, peak = 0;
  context.apiRequest = async path => {
    if (path === '/api/groups') return { groups: list };
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (path.includes('/g0/')) throw new Error('Unavailable');
    return board();
  };
  await context.refreshGroups('');
  assert.equal(peak, 3);
  assert.equal(context.state.groups.length, 8);
  assert.equal(context.state.groupSummaries.g0.failed, true);
  assert.equal(context.groupCurrentRank(context.state.groupSummaries.g1), 1);
});

test('detail tabs preserve direct links, support arrow keys and return to the directory with browser Back', () => {
  const { context, node, tabs } = boot();
  context.initializeGroupsPage();
  context.openGroupDetail('g');
  assert.equal(context.loaded, 'g');
  assert.equal(context.lastUrl, '/groups?group=g');
  assert.equal(node('#groups-directory').classes.has('hidden'), true);
  tabs[2].events.click();
  assert.equal(context.lastUrl, '/groups?group=g&view=history');
  assert.equal(tabs[2].attributes['aria-selected'], 'true');
  assert.equal(tabs[2].tabIndex, 0);
  assert.equal(node('#group-panel-history').classes.has('hidden'), false);
  assert.equal(node('#group-panel-standings').classes.has('hidden'), true);
  tabs[2].events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(tabs[3].focused, true);
  assert.equal(context.lastUrl, '/groups?group=g&view=settings');
  context.window.location.search = '';
  context.window.events.popstate();
  assert.equal(context.state.activeGroupId, '');
  assert.equal(node('#group-leaderboard').classes.has('hidden'), true);
  assert.equal(context.document.title, 'Groups | Predict Playoffs');
  context.window.location.search = '?group=g&view=members';
  context.window.events.popstate();
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(context.document.title, 'Crew | Groups | Predict Playoffs');
  context.selectGroupView('unknown');
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
});

test('stale detail responses cannot repopulate a closed group or a signed-out page', async () => {
  const { context, node } = boot();
  let resolve;
  context.apiRequest = () => new Promise(done => { resolve = done; });
  const request = context.realLoadGroupLeaderboard('g');
  context.showGroupsDirectory();
  resolve(board());
  await request;
  assert.equal(context.state.groupLeaderboard, null);
  assert.equal(node('#board').children.length, 0);
  context.state.activeGroupId = 'g';
  const second = context.realLoadGroupLeaderboard('g');
  context.state.signedIn = false;
  resolve(board());
  await second;
  assert.equal(context.state.groupLeaderboard, null);
});

test('late directory responses and failures leave signed-out pages private', async () => {
  const { context } = boot();
  const group = context.state.groups[0];
  let resolve;
  const response = new Promise(done => { resolve = done; });
  context.apiRequest = () => response;
  const request = context.refreshGroups('');
  context.state.signedIn = false;
  context.state.groups = [];
  resolve({ groups: [group] });
  await request;
  assert.equal(context.state.groups.length, 0);
  assert.equal(Object.keys(context.state.groupSummaries).length, 0);
});

test('failed list and invalid group links show actionable directory states', async () => {
  const { context, node } = boot();
  context.apiRequest = async () => { throw new Error('Service unavailable'); };
  await context.refreshGroups();
  assert.match(node('#empty').textContent, /could not be loaded/);
  assert.equal(context.state.groups.length, 0);
  context.apiRequest = async path => path === '/api/groups' ? { groups: [{ groupId: 'g', groupName: 'Crew' }] } : board();
  await context.refreshGroups('removed');
  assert.equal(context.state.activeGroupId, '');
  assert.match(node('#groups-status').textContent, /no longer available/);
});

test('API sport override preserves authentication and is not passed as a fetch option', async () => {
  const requests = [];
  const context = vm.createContext({ URL, window: { location: { origin: 'https://example.com' } },
    getValidAccessToken: async () => 'existing-token',
    sportUrl: path => `${path}?sport=nba`,
    fetch: async (url, options) => { requests.push([url, options]); return { ok: true, json: async () => ({ groups: [] }) }; } });
  const start = app.indexOf('async function apiRequest(');
  vm.runInContext(app.slice(start, app.indexOf('let predictionCountdownTimer;', start)), context);
  await context.apiRequest('/api/groups', { sport: 'nfl' });
  assert.equal(requests[0][0], '/api/groups?sport=nfl');
  assert.equal(requests[0][1].headers.Authorization, 'Bearer existing-token');
  assert.equal('sport' in requests[0][1], false);
  await context.apiRequest('/api/groups');
  assert.equal(requests[1][0], '/api/groups?sport=nba');
});

test('create and join retain password/scoring behavior and open the resulting group', async () => {
  const { context, node } = boot();
  const controls = { groupForm: '#form', groupSportNfl: '#nfl', groupSportNba: '#nba', submitGroup: '#submit',
    groupDialogMessage: '#message', groupName: '#name', groupPassword: '#password', groupDialog: '#dialog' };
  for (const [key, id] of Object.entries(controls)) context.elements[key] = node(id);
  node('#name').value = 'Crew'; node('#password').value = 'shared-password';
  node('#group-scoring').value = 'vegas'; node('#nfl').checked = true; node('#nba').checked = true;
  context.apiRequest = async (path, options) => { context.requests.push([path, options]); return context.state.groups[0]; };
  context.refreshGroups = async id => { context.refreshed = id; };
  context.groupDialogMode = 'create';
  await context.submitGroup({ preventDefault() {} });
  assert.equal(context.requests[0][0], '/api/groups');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { groupName: 'Crew', password: 'shared-password', scoringOption: 'vegas', sports: ['nfl', 'nba'] });
  assert.equal(context.refreshed, 'g'); assert.equal(context.invited, 'g');
  context.groupDialogMode = 'join';
  await context.submitGroup({ preventDefault() {} });
  assert.equal(context.requests[1][0], '/api/groups/join');
  assert.deepEqual(JSON.parse(context.requests[1][1].body), { groupName: 'Crew', password: 'shared-password' });
  assert.equal(node('#submit').disabled, false);
});

test('sport settings preserve PATCH semantics and refresh the open group', async () => {
  const { context, node } = boot();
  for (const [key, id] of Object.entries({ editGroupSportNfl: '#nfl', editGroupSportNba: '#nba',
    editGroupSportsMessage: '#message', saveGroupSports: '#save', editGroupSportsDialog: '#dialog' })) context.elements[key] = node(id);
  node('#nfl').checked = true; node('#nba').checked = false;
  context.refreshGroups = async id => { context.refreshed = id; };
  await context.submitEditGroupSports({ preventDefault() {} });
  assert.equal(context.requests[0][0], '/api/groups/g');
  assert.equal(context.requests[0][1].method, 'PATCH');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { sports: ['nfl'] });
  assert.equal(context.refreshed, 'g');
});

test('leaving transfers commissioner access and returns to the directory', async () => {
  const { context, node } = boot();
  for (const [key, id] of Object.entries({ newCommissioner: '#successor', confirmLeaveGroup: '#confirm',
    leaveGroupMessage: '#message', leaveGroupDialog: '#dialog' })) context.elements[key] = node(id);
  context.leaveGroupPending = false; context.leaveGroupId = 'g'; node('#successor').value = 'b';
  context.state.groupSummaries.g = board();
  await context.submitLeaveGroup({ preventDefault() {} });
  assert.equal(context.requests[0][0], '/api/groups/g/membership');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { newCommissionerId: 'b' });
  assert.equal(context.state.groups.length, 0);
  assert.equal(context.state.activeGroupId, '');
  assert.equal(context.lastUrl, '/groups');
  assert.equal(context.state.groupSummaries.g, undefined);
});

test('deleting still requires commissioner and matching confirmation, then returns to the directory', async () => {
  const { context, node } = boot();
  for (const [key, id] of Object.entries({ confirmDeleteGroup: '#confirm', deleteGroupConfirmation: '#confirmation',
    deleteGroupMessage: '#message', deleteGroupDialog: '#dialog', deleteGroupConfirmationName: '#confirmation-name' })) context.elements[key] = node(id);
  context.deleteGroupPending = false; context.deleteGroupId = 'g'; node('#confirmation-name').textContent = 'Crew';
  node('#confirmation').value = 'wrong';
  await context.submitDeleteGroup({ preventDefault() {} });
  assert.equal(context.requests.length, 0);
  node('#confirmation').value = 'Crew';
  await context.submitDeleteGroup({ preventDefault() {} });
  assert.equal(context.requests[0][0], '/api/groups/g');
  assert.equal(context.requests[0][1].method, 'DELETE');
  assert.equal(context.state.groups.length, 0);
  assert.equal(context.lastUrl, '/groups');
});
