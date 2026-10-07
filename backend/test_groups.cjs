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
  matches(selector) { return selector === ':popover-open' && Boolean(this.popoverOpen); }
  showPopover() { this.events.beforetoggle?.({ newState: 'open' }); this.popoverOpen = true; this.events.toggle?.({ newState: 'open' }); }
  hidePopover() { this.events.beforetoggle?.({ newState: 'closed' }); this.popoverOpen = false; this.events.toggle?.({ newState: 'closed' }); }
  getBoundingClientRect() { return { bottom: 160, right: 950 }; }
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
  const tabs = ['standings', 'history'].map(view => {
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
    document: { title: '', createElement: () => new Element(), querySelector: selector => selector === 'dialog[open]' ? null : node(selector), getElementById: id => node(`#${id}`),
      querySelectorAll: selector => selector === '[data-group-view]' ? tabs : selector === '[data-commissioner-only]' ? [node('#commissioner-section')] : [], body: new Element() },
    state: { signedIn: true, groupsLoaded: true, groups: [group], activeGroupId: 'g', groupSummaries: {}, groupLeaderboard: { members: [
      { userId: 'a', displayName: 'Alice', isCommissioner: true, isCurrentUser: true, hasPrediction: true },
      { userId: 'b', displayName: '<Bob>', hasPrediction: false },
    ] } },
    elements: Object.fromEntries(Object.entries({ groupCards: '#group-cards', emptyGroups: '#empty', groupLeaderboardStatus: '#status',
      groupLeaderboard: '#group-leaderboard', groupLeaderboardBody: '#board', groupLeaderboardTableShell: '#board-shell',
      emptyGroupLeaderboard: '#empty-board', activeGroupName: '#active-group-name', leaveGroup: '#leave-group',
      editGroupSports: '#edit-group-sports', deleteGroup: '#delete-group' }).map(([key, id]) => [key, node(id)])),
    navigator: { clipboard: { writeText: async text => { context.copied = text; } } },
    window: { location, innerWidth: 1000, innerHeight: 800, history: { replaceState(_s, _t, url) { navigate(url); }, pushState(_s, _t, url) { navigate(url); } },
      events: {}, addEventListener(name, handler) { this.events[name] = handler; }, confirm: () => true },
    routeHref: path => path, URL, URLSearchParams, SPORT: 'nfl', IS_NBA: false, PAGE: 'groups',
    apiRequest: async (...args) => { context.requests.push(args); return {}; }, requests: [],
    showToast: text => { context.toast = text; }, FINAL_NAME: 'Super Bowl',
  });
  vm.runInContext(leaderboard, context);
  vm.runInContext(app.slice(app.indexOf('let groupMembershipRequest ='), app.indexOf('async function apiRequest(')), context);
  vm.runInContext(groups, context);
  node('#group-settings-panel').style = { setProperty() {} };
  context.realLoadGroupLeaderboard = context.loadGroupLeaderboard;
  context.realOpenGroupInviteDialog = context.openGroupInviteDialog;
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
  for (const view of ['standings', 'history']) assert.match(html, new RegExp(`id="group-panel-${view}"[^>]*role="tabpanel"`));
  assert.doesNotMatch(html, /group-tab-members|group-tab-settings|group-panel-members|group-panel-settings/);
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
  assert.equal(context.state.groupsLoaded, false);
  assert.equal(node(navSelector).href, '/groups');
  assert.equal(context.state.groupLeaderboard, null);
  assert.equal(Object.keys(context.state.groupSummaries).length, 0);
  assert.equal(node('#group-cards').children.length, 0);
  assert.equal(node('#group-leaderboard').classes.has('hidden'), true);
  assert.match(node('#empty').textContent, /Sign in/);
});

test('shared renderer does not open a bracket for missing predictions', () => {
  const { context } = boot();
  const body = new Element();
  context.renderLeaderboardRows(body, [{ leaderboardName: 'Alice', isCommissioner: true, hasPrediction: false, total: null }]);
  const row = body.children[0];
  const button = row.children[1].children[0];
  assert.equal(button.children[0].textContent, 'Alice · Commissioner');
  assert.equal(button.children[1].textContent, 'No prediction');
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-label'], undefined);
  assert.equal(row.dataset.hasPrediction, 'false');
  assert.equal(row.events.click, undefined);
  assert.equal(row.children[5].textContent, '—');
});

test('rendered primary navigation keeps the requested order, names, active page and sport scope', () => {
  const shell = read('shell.js');
  for (const page of ['picks', 'groups', 'leaderboard', 'scoring']) for (const nba of [false, true]) {
    const selected = [];
    const header = { innerHTML: '', querySelector: selector => ({ setAttribute: (key, value) => selected.push([selector, key, value]) }) };
    vm.runInNewContext(shell.slice(0, shell.indexOf('const dialogs =')), {
      IS_NBA: nba, document: { body: { dataset: { page } }, querySelector: () => header },
      window: { location: { hostname: 'example.com', hash: '' } }, sportUrl: path => path + (nba ? '?sport=nba' : ''),
    });
    const nav = header.innerHTML.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...nav.matchAll(/data-nav-page="([^"]+)">([^<]+)/g)].map(match => [match[1], match[2]]),
      [['picks', 'My Picks'], ['groups', 'Groups'], ['leaderboard', 'Leaderboard'], ['scoring', 'Scoring']]);
    assert.deepEqual(selected, [[`[data-nav-page="${page}"]`, 'aria-current', 'page']]);
    assert.match(nav, new RegExp(`href="/groups${nba ? '\\?sport=nba' : ''}"`));
  }
});

const navSelector = '.primary-nav [data-nav-page="groups"]';
const navClick = (link, overrides = {}) => {
  const event = { button: 0, prevented: false, preventDefault() { this.prevented = true; }, ...overrides };
  link.events.click(event);
  return event;
};

test('Groups nav routes 0, 2+, unknown and signed-out memberships to the directory, and exactly one to its detail', () => {
  for (const [count, known, signedIn, expected] of [[0, true, true, '/groups'], [1, true, true, '/groups?group=g'],
    [2, true, true, '/groups'], [1, false, true, '/groups'], [1, true, false, '/groups']]) {
    const { context, node } = boot();
    const group = context.state.groups[0];
    context.state.groups = Array.from({ length: count }, (_, index) => ({ ...group, groupId: index ? 'other' : 'g' }));
    context.state.groupsLoaded = known; context.state.signedIn = signedIn;
    context.initializeGroupsNavigation();
    const link = node(navSelector);
    const event = navClick(link);
    assert.equal(link.href, expected);
    assert.equal(event.prevented, signedIn, 'signed-out navigation uses its normal anchor');
    if (signedIn) assert.equal(context.lastUrl, expected);
  }
});

test('all main pages expose the same Groups destination through a normal anchor, including modified clicks', () => {
  for (const page of ['home', 'picks', 'leaderboard', 'scoring', 'privacy']) {
    const { context, node } = boot();
    context.PAGE = page;
    context.initializeGroupsNavigation();
    assert.equal(node(navSelector).href, '/groups?group=g');
    assert.equal(navClick(node(navSelector)).prevented, false);
  }
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const { context, node } = boot();
    context.initializeGroupsNavigation();
    assert.equal(navClick(node(navSelector), modifier).prevented, false);
    assert.equal(node(navSelector).href, '/groups?group=g');
    assert.equal(context.loaded, undefined);
  }
});

test('sole-group links retain the selected eligible sport and switch for a single-sport group, including local preview', () => {
  const { context, node } = boot();
  context.SPORT = 'nba'; context.IS_NBA = true;
  context.routeHref = path => `${path}.html?sport=nba`;
  context.initializeGroupsNavigation();
  assert.equal(node(navSelector).href, '/groups.html?sport=nba&group=g');
  context.state.groups[0].sports = ['nfl'];
  assert.equal(navClick(node(navSelector)).prevented, false);
  assert.equal(node(navSelector).href, '/groups.html?group=g');
  context.SPORT = 'nfl'; context.IS_NBA = false;
  context.state.groups[0].sports = ['nba'];
  assert.equal(navClick(node(navSelector)).prevented, false);
  assert.equal(node(navSelector).href, '/groups.html?sport=nba&group=g');
});

test('Back to Groups stays an intentional directory visit for a one-group user; history and direct URLs stay independent', async () => {
  const { context, node } = boot();
  context.initializeGroupsNavigation(); context.initializeGroupsPage();
  context.openGroupDetail('g');
  node('#groups-back').events.click();
  assert.equal(context.lastUrl, '/groups');
  assert.equal(context.state.activeGroupId, '');
  assert.equal(node(navSelector).href, '/groups?group=g');
  context.window.location.search = '?group=g&view=history';
  context.window.events.popstate();
  assert.equal(context.state.activeGroupId, 'g');
  assert.equal(node('#group-panel-history').classes.has('hidden'), false);
  context.window.location.search = '';
  context.window.events.popstate();
  assert.equal(context.state.activeGroupId, '');
  context.apiRequest = async path => path === '/api/groups' ? { groups: context.state.groups } : board();
  await context.refreshGroups();
  assert.equal(context.state.activeGroupId, '', 'loading /groups never automatically redirects a sole member');
});

test('membership loading waits for both sports, deduplicates dual-sport groups and never fetches standings on public pages', async () => {
  const { context, node } = boot();
  context.PAGE = 'leaderboard';
  const group = context.state.groups[0];
  let finishNBA;
  context.apiRequest = async (...args) => {
    context.requests.push(args);
    return args[1].sport === 'nfl' ? { groups: [group] } : new Promise(resolve => { finishNBA = resolve; });
  };
  const pending = context.refreshGroupMemberships();
  await Promise.resolve();
  assert.equal(context.state.groupsLoaded, false);
  assert.equal(node(navSelector).href, '/groups');
  finishNBA({ groups: [group] }); await pending;
  assert.equal(context.state.groups.length, 1);
  assert.equal(context.state.groupsLoaded, true);
  assert.equal(node(navSelector).href, '/groups?group=g');
  assert.equal(context.requests.length, 2);
  assert.ok(context.requests.every(([path]) => path === '/api/groups'));
  context.apiRequest = async (_path, options) => ({ groups: options.sport === 'nfl' ? [group] : [{ ...group, groupId: 'nba-only' }] });
  await context.refreshGroupMemberships();
  assert.equal(context.state.groups.length, 2);
  assert.equal(node(navSelector).href, '/groups');
});

test('failed membership refresh, signed-out sessions and late responses leave Groups on its directory fallback', async () => {
  const { context, node } = boot();
  context.apiRequest = async () => { throw new Error('Unavailable'); };
  await assert.rejects(context.refreshGroupMemberships(), /Unavailable/);
  assert.equal(context.state.groupsLoaded, false);
  assert.equal(node(navSelector).href, '/groups');
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  context.apiRequest = () => response;
  const pending = context.refreshGroupMemberships();
  context.state.signedIn = false; context.state.groups = [];
  finish({ groups: [{ groupId: 'stale', groupName: 'Stale group' }] }); await pending;
  assert.equal(context.state.groupsLoaded, false);
  assert.equal(context.state.groups.length, 0);
  context.apiRequest = () => { throw new Error('Signed-out users must not fetch memberships'); };
  assert.equal(await context.refreshGroupMemberships(), false);
});

test('directory navigation while memberships load is not undone by an earlier detail refresh', async () => {
  const { context } = boot();
  context.window.location.search = '?group=g';
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  context.apiRequest = path => path === '/api/groups' ? response : Promise.resolve(board());
  const pending = context.refreshGroups('g');
  context.showGroupsDirectory();
  finish({ groups: context.state.groups }); await pending;
  assert.equal(context.state.activeGroupId, '');
  assert.equal(context.lastUrl, '/groups');
});

test('superseded membership responses cannot replace a newer count or a new signed-in session', async () => {
  const { context, node } = boot();
  let finish;
  const old = new Promise(resolve => { finish = resolve; });
  context.apiRequest = () => old;
  const pending = context.refreshGroupMemberships();
  context.authPanels = {};
  for (const name of ['accountAuthView', 'accountSettingsView', 'headerAccount', 'accountEmail', 'savedSection', 'signedOutPanel']) context.elements[name] = new Element();
  context.renderLeaderboardProfile = () => {};
  const start = app.indexOf('function renderAuthentication(');
  vm.runInContext(app.slice(start, app.indexOf('async function refreshProfile(', start)), context);
  context.renderAuthentication(false);
  context.state.signedIn = true;
  context.apiRequest = async () => ({ groups: [{ groupId: 'new-user-group', groupName: 'New user' }] });
  await context.refreshGroupMemberships();
  finish({ groups: [{ groupId: 'old-user-group', groupName: 'Old user' }] }); await pending;
  assert.equal(node(navSelector).href, '/groups?group=new-user-group');
  assert.deepEqual(Array.from(context.state.groups, group => group.groupId), ['new-user-group']);
});

test('restoring a cached page rechecks membership and disables the shortcut while that check runs', async () => {
  const { context, node } = boot();
  context.PAGE = 'scoring';
  context.initializeGroupsNavigation();
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  context.apiRequest = () => response;
  const refresh = context.refreshGroupMemberships;
  let pending;
  context.refreshGroupMemberships = () => { pending = refresh(); return pending; };
  context.window.events.pageshow({ persisted: true });
  assert.equal(node(navSelector).href, '/groups');
  assert.equal(context.state.groupsLoaded, false);
  finish({ groups: [] }); await pending;
  assert.equal(context.state.groupsLoaded, true);
  assert.equal(node(navSelector).href, '/groups');
});

test('saved player rows show only an accessible player name and retain full-row activation', () => {
  for (const hasPrediction of [true, undefined]) {
    const { context } = boot();
    const body = new Element();
    const entry = { leaderboardName: '<Alice & friends>', hasPrediction, total: 30, rank: 1 };
    const opened = [];
    context.openPublicBracket = player => opened.push(player);
    context.renderLeaderboardRows(body, [entry]);
    const row = body.children[0];
    const button = row.children[1].children[0];
    assert.equal(row.dataset.hasPrediction, 'true');
    assert.equal(button.type, 'button');
    assert.equal(button.disabled, false);
    assert.equal(button.children.length, 1, 'no repeated label or extra icon');
    assert.equal(button.children[0].textContent, '<Alice & friends>');
    assert.equal(button.attributes['aria-label'], 'View bracket for <Alice & friends>');
    row.events.click();
    assert.deepEqual(opened, [entry]);
  }
});

test('member list shows everyone and restricts removal controls to commissioner', async () => {
  const { context, node } = boot();
  context.renderGroupMembers();
  const list = node('#group-member-list');
  assert.equal(list.children.length, 2);
  const identity = list.children[0].children[0];
  assert.equal(identity.children[0].textContent, 'Alice');
  assert.deepEqual(identity.children[1].children.map(badge => badge.textContent), ['Commissioner', 'You', 'Prediction saved']);
  assert.equal(list.children[0].children.length, 1);
  assert.equal(list.children[0].dataset.currentUser, 'true');
  assert.equal(list.children[1].children[0].children[0].textContent, '<Bob>');
  assert.equal(list.children[1].children[0].children[1].children[0].textContent, 'No prediction');
  await list.children[1].children[1].events.click();
  assert.equal(context.requests[0][0], '/api/groups/g/members/b');
  assert.equal(context.requests[0][1].method, 'DELETE');
  assert.equal(context.loaded, 'g');
  context.state.groups[0].isCommissioner = false;
  context.renderGroupMembers();
  assert.equal(list.children.length, 0, 'regular members have no roster');
});

test('group standings contain saved predictions only and never append commissioner labels', () => {
  const { context, node } = boot();
  context.state.groupLeaderboard = board();
  context.state.groupLeaderboard.members[0].isCommissioner = true;
  context.state.groupLeaderboard.entries[0].isCommissioner = true;
  context.renderGroupLeaderboard();
  const rows = node('#board').children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children[1].children[0].children[0].textContent, 'Alice');
  assert.equal(node('#group-member-list').children.length, 2);
  assert.equal(node('#group-header-commissioner').textContent, 'Alice (You)');
  assert.equal(context.state.groupLeaderboard.entries[0].isCommissioner, true);
  context.state.groupLeaderboard.entries = [{ leaderboardName: 'Bob', hasPrediction: false, total: null }];
  context.renderGroupLeaderboard();
  assert.equal(node('#board').children.length, 0);
  assert.equal(node('#empty-board').classes.has('hidden'), false);
  assert.equal(node('#board-shell').classes.has('hidden'), true);
  // Old API prediction entries omit hasPrediction; they remain supported.
  context.state.groupLeaderboard.entries = [{ leaderboardName: 'Alice', total: 10, regularSeason: 10, playoffs: 0 }];
  context.renderGroupLeaderboard();
  assert.equal(node('#board').children.length, 1);
});

test('member removal cancellation and failure preserve the roster and usable action', async () => {
  const { context, node } = boot();
  context.renderGroupMembers();
  const button = node('#group-member-list').children[1].children[1];
  context.window.confirm = () => false;
  await button.events.click();
  assert.equal(context.requests.length, 0);
  context.window.confirm = () => true;
  context.apiRequest = async () => { throw new Error('Removal failed'); };
  await button.events.click();
  assert.equal(button.disabled, false);
  assert.equal(node('#group-members-status').textContent, 'Removal failed');
  assert.equal(node('#group-member-list').children.length, 2);
});

test('group hub shows sport-scoped season, commissioner, complete member count and tied personal rank', () => {
  const { context, node } = boot();
  context.state.groupLeaderboard = { ...board(), season: 2026 };
  context.state.groupLeaderboard.members[0].isCommissioner = true;
  context.renderGroups();
  assert.equal(node('#active-group-meta').textContent, 'NFL + NBA · Classic');
  assert.equal(node('#group-header-member-count').textContent, '2');
  assert.equal(node('#group-header-commissioner').textContent, 'Alice (You)');
  assert.equal(node('#group-season-label').textContent, 'NFL · 2026 season');
  assert.equal(node('#group-standings-summary').textContent, '1 of 2 members have a prediction for NFL.');
  assert.equal(node('#group-personal-rank').textContent, 'Your rank #1');
  assert.equal(node('#commissioner-section').classes.has('hidden'), false);
  context.IS_NBA = true; context.SPORT = 'nba';
  context.state.groupLeaderboard.season = 2027;
  context.state.groupLeaderboard.members[0].isCurrentUser = false;
  context.state.groups[0].isCommissioner = false;
  context.renderGroups();
  assert.equal(node('#group-season-label').textContent, 'NBA · 2026–27 season');
  assert.equal(node('#group-header-commissioner').textContent, 'Alice');
  assert.equal(node('#group-personal-rank').textContent, '');
  assert.equal(node('#commissioner-section').classes.has('hidden'), true);
});

test('header loading and detail failures do not invent zero counts or stale personal ranks', async () => {
  const { context, node } = boot();
  context.state.groupLeaderboard = null;
  context.renderGroupHub();
  assert.equal(node('#group-header-member-count').textContent, 'Loading…');
  assert.equal(node('#group-personal-rank').textContent, '');
  context.apiRequest = async () => { throw new Error('Unavailable'); };
  await context.realLoadGroupLeaderboard('g');
  assert.equal(node('#group-header-member-count').textContent, 'Unavailable');
  assert.match(node('#status').textContent, /could not be loaded/);
  assert.match(node('#group-members-status').textContent, /could not be loaded/);
});

test('history without seasons is a single empty state that links back to standings', () => {
  const { context, node, tabs } = boot();
  context.state.groupLeaderboard = board();
  context.renderGroupHistory();
  const history = node('#group-history-content');
  assert.equal(history.children.length, 1);
  assert.equal(history.children[0].className, 'group-history-empty');
  assert.match(history.children[0].children[1].textContent, /No completed NFL seasons/);
  history.children[0].children[2].events.click();
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal(tabs[0].focused, true);
  assert.equal(context.lastUrl, '/groups?group=g');
});

test('history renders champions and all-time sections only when each has data, retaining shared titles', () => {
  const { context, node } = boot();
  context.state.groupLeaderboard = board();
  context.state.groupLeaderboard.history.seasons = [{ season: 2025, champions: ['Alice', 'Bob'], scoringOption: 'classic' }];
  context.renderGroupHistory();
  let children = node('#group-history-content').children;
  assert.ok(children.some(child => child.textContent === 'Group champions'));
  assert.ok(!children.some(child => child.textContent === 'All-time standings'));
  const champion = children.find(child => child.className === 'group-history-champions').children[0];
  assert.equal(champion.children[1].textContent, 'Alice & Bob');
  assert.match(champion.children[2].textContent, /Shared title/);
  context.state.groupLeaderboard.history.seasons = [];
  context.state.groupLeaderboard.history.standings = [{ rank: 1, leaderboardName: 'Alice', titles: 1, seasons: 1, total: 30 }];
  context.renderGroupHistory();
  children = node('#group-history-content').children;
  assert.ok(!children.some(child => child.textContent === 'Group champions'));
  assert.ok(children.some(child => child.textContent === 'All-time standings'));
  context.renderGroupHistory(true);
  assert.equal(node('#group-history-content').children.length, 1);
  assert.match(node('#group-history-content').children[0].textContent, /could not be loaded/);
});

test('header gear opens settings and retains commissioner sections without duplicating invites', async () => {
  const { context, node } = boot();
  context.initializeGroupSettings();
  node('#group-settings-trigger').events.click();
  assert.equal(node('#group-settings-panel').popoverOpen, true);
  assert.equal(node('#group-settings-trigger').attributes['aria-expanded'], 'true');
  assert.equal(node('#close-group-settings').focused, true);
  assert.equal(context.requests[0][0], '/api/groups/g/invite');
  node('#close-group-settings').events.click();
  assert.equal(node('#group-settings-panel').popoverOpen, false);
  assert.equal(node('#group-settings-trigger').attributes['aria-expanded'], 'false');
  const html = read('groups.html');
  for (const id of ['group-invites-heading', 'group-competition-heading', 'group-membership-heading', 'group-danger-heading']) {
    assert.match(html, new RegExp(`aria-labelledby="${id}"`));
  }
  assert.equal((html.match(/id="share-group-invite"/g) || []).length, 1);
  assert.match(html, />Group<\/h3>/);
  assert.match(html, /Manage members/);
  assert.doesNotMatch(html, /settings-share-group-invite|settings-group-members|group-settings-commissioner/);
  assert.match(html, /id="group-settings-panel"[^>]*popover role="dialog"/);
  assert.match(html, /id="group-settings-trigger"[^>]*aria-label="Group settings"/);
  assert.match(html, /id="group-password-editor"><summary>Change password/);
  assert.doesNotMatch(html, /group-settings-description|History includes only eligible seasons|Set a new password/);
});

test('invite dialog restores focus to the actual header, settings or regenerate opener', async () => {
  const { context, node } = boot();
  context.navigator = {};
  for (const [key, id] of Object.entries({ groupInviteDialog: '#invite-dialog', groupInviteName: '#invite-name',
    groupInviteLink: '#invite-link', groupInviteMessage: '#invite-message', copyGroupInvite: '#copy-invite',
    shareGroupInviteNative: '#share-native' })) context.elements[key] = node(id);
  context.apiRequest = async () => ({ groupId: 'g', groupName: 'Crew', inviteCode: 'private-test-code' });
  context.openGroupInviteDialog = context.realOpenGroupInviteDialog;
  context.initializeGroupSettings();
  for (const id of ['#share-group-invite']) {
    const trigger = node(id);
    await context.shareActiveGroupInvite({ currentTarget: trigger });
    node('#invite-dialog').close();
    assert.equal(trigger.focused, true);
  }
  await context.regenerateActiveGroupInvite();
  node('#invite-dialog').close();
  assert.equal(node('#regenerate-group-invite').focused, true);
});

test('invite controls only regenerate with confirmation, restrict role and handle failures', async () => {
  const { context, node } = boot();
  await context.regenerateActiveGroupInvite();
  assert.equal(context.requests[0][1].method, 'POST');
  assert.equal(context.invited, 'g');
  context.window.confirm = () => false;
  await context.regenerateActiveGroupInvite();
  assert.equal(context.requests.length, 1);
  context.window.confirm = () => true;
  context.apiRequest = async () => { throw new Error('Refresh and try again'); };
  await context.regenerateActiveGroupInvite();
  assert.equal(node('#status').textContent, 'Refresh and try again');
  assert.equal(node('#regenerate-group-invite').disabled, false);
  context.state.groups[0].isCommissioner = false;
  await context.regenerateActiveGroupInvite();
  assert.equal(context.requests.length, 1);
  assert.doesNotMatch(read('groups.html'), /revoke-group-invite|Revoke invite link/);
});

test('competition settings reflect the selected sport, scoring lock and role', () => {
  const { context, node } = boot();
  context.state.groups[0].scoringOptions = { nfl: 'classic', nba: 'vegas' };
  context.state.groupLeaderboard = { ...board(), scoringLock: { locked: false, lockAt: '2099-01-01T00:00:00Z' } };
  context.renderGroupCompetition();
  assert.equal(node('#group-settings-scoring').textContent, 'Classic');
  assert.equal(node('#save-group-scoring').disabled, false);
  assert.equal(node('#group-scoring-editor').classes.has('hidden'), false);
  assert.equal(node('#save-group-password').disabled, false);
  assert.match(context.groupMetadata(context.state.groups[0]), /NFL · Classic \/ NBA · Upset Edge/);
  context.state.groupLeaderboard.scoringLock.locked = true;
  context.renderGroupCompetition();
  assert.equal(node('#save-group-scoring').disabled, true);
  assert.equal(node('#group-scoring-editor').classes.has('hidden'), true);
  assert.equal(node('#group-settings-scoring-select').disabled, true);
  assert.equal(node('#save-group-password').disabled, false);
  assert.match(node('#group-scoring-lock-status').textContent, /locked for NFL/);
  context.state.groups[0].isCommissioner = false;
  context.renderGroups();
  assert.equal(node('#commissioner-section').classes.has('hidden'), true);
  assert.equal(node('#save-group-password').disabled, true);
  assert.equal(node('#edit-group-sports').classes.has('hidden'), true);
  assert.equal(node('#delete-group').classes.has('hidden'), true);
  assert.equal(node('#regenerate-group-invite').classes.has('hidden'), true);
  assert.equal(node('#leave-group').classes.has('hidden'), false);
  assert.equal(node('.group-leave-section').classes.has('hidden'), false);
});

test('commissioner updates and reloads visible password, clears inputs and keeps errors usable', async () => {
  const { context, node } = boot();
  node('#group-settings-panel').popoverOpen = true;
  context.apiRequest = async (...args) => { context.requests.push(args); return { groupPassword: 'new-secret' }; };
  node('#group-new-password').value = 'new-secret';
  await context.submitGroupCompetition({ preventDefault() {} }, 'password');
  assert.equal(context.requests[0][0], '/api/groups/g');
  assert.equal(context.requests[0][1].method, 'PATCH');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { password: 'new-secret' });
  assert.equal(node('#group-new-password').value, '');
  assert.equal(node('#group-current-password').textContent, 'new-secret');
  assert.equal(context.requests[1][0], '/api/groups/g/invite');
  assert.match(node('#group-competition-message').textContent, /old password no longer works/);
  context.apiRequest = async () => { throw new Error('Update failed'); };
  node('#group-new-password').value = 'another-secret';
  await context.submitGroupCompetition({ preventDefault() {} }, 'password');
  assert.equal(node('#group-new-password').value, '');
  assert.equal(node('#group-competition-message').textContent, 'Update failed');
  assert.equal(node('#save-group-password').disabled, false);
  assert.match(read('groups.html'), /id="group-new-password" type="text" autocomplete="off"/);
  node('#group-new-password').value = 'stale-secret';
  context.showGroupsDirectory();
  assert.equal(node('#group-new-password').value, '');
  assert.equal(node('#group-current-password').textContent, '');
});

test('both roles see the exact selectable password without a copy control; errors and legacy passwords stay usable', async () => {
  for (const commissioner of [false, true]) {
    const { context, node } = boot();
    context.state.groups[0].isCommissioner = commissioner;
    const password = '<secret & friends>  ';
    context.apiRequest = async (...args) => { context.requests.push(args); return { groupPassword: password }; };
    await context.loadGroupSettingsPassword();
    assert.equal(node('#group-current-password').textContent, password);
    context.apiRequest = async () => ({ groupPassword: null });
    await context.loadGroupSettingsPassword();
    assert.equal(node('#group-current-password').textContent, '');
    assert.match(node('#group-password-status').textContent, /commissioner to set a new/);
    context.apiRequest = async () => { throw new Error('Unavailable'); };
    await context.loadGroupSettingsPassword();
    assert.equal(node('#retry-group-password').classes.has('hidden'), false);
  }
  assert.doesNotMatch(read('groups.html'), /group-password-mask|••••|reveal.*password/i);
  assert.doesNotMatch(read('groups.html'), /copy-group-password/);
  assert.doesNotMatch(groups, /group-member-avatar/);
});

test('closing settings, switching groups and sign-out discard late password responses', async () => {
  for (const close of ['close', 'switch', 'signout']) {
    const { context, node } = boot();
    let finish;
    context.apiRequest = () => new Promise(resolve => { finish = resolve; });
    const pending = context.loadGroupSettingsPassword();
    if (close === 'close') context.closeGroupSettings();
    if (close === 'switch') context.state.activeGroupId = 'another';
    if (close === 'signout') { context.state.signedIn = false; context.renderGroups(); }
    finish({ groupPassword: 'private-password' });
    await pending;
    assert.equal(node('#group-current-password').textContent, '');
  }
});

test('password save finishing after dismissal does not restore a hidden password', async () => {
  const { context, node } = boot();
  node('#group-settings-panel').popoverOpen = true;
  node('#group-new-password').value = 'changed-password';
  let finish;
  context.apiRequest = (...args) => { context.requests.push(args); return new Promise(resolve => { finish = resolve; }); };
  const pending = context.submitGroupCompetition({ preventDefault() {} }, 'password');
  context.closeGroupSettings();
  finish({}); await pending;
  assert.equal(context.requests.length, 1);
  assert.equal(node('#group-current-password').textContent, '');
});

test('leave opens confirmation without sending a removal request; cancel preserves membership', async () => {
  const { context, node } = boot();
  context.state.groups[0].isCommissioner = false;
  for (const [key, id] of Object.entries({ leaveGroupDialog: '#leave-dialog', leaveGroupTitle: '#leave-title',
    leaveGroupDescription: '#leave-description', leaveGroupMessage: '#leave-message', confirmLeaveGroup: '#confirm-leave' })) context.elements[key] = node(id);
  await context.openLeaveGroupDialog(context.state.groups[0]);
  assert.equal(node('#leave-dialog').open, true);
  assert.equal(context.requests.length, 0);
  node('#leave-dialog').close();
  assert.equal(context.state.groups.length, 1);
});

test('scoring update is selected-sport PATCH; members and locked/unknown states cannot submit', async () => {
  const { context, node } = boot();
  context.state.groupLeaderboard = { ...board(), scoringLock: { locked: false } };
  node('#group-settings-scoring-select').value = 'vegas';
  context.refreshGroups = async id => { context.refreshed = id; };
  await context.submitGroupCompetition({ preventDefault() {} }, 'scoring');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { scoringOption: 'vegas' });
  assert.equal(context.refreshed, 'g');
  context.state.groupLeaderboard.scoringLock.locked = true;
  await context.submitGroupCompetition({ preventDefault() {} }, 'scoring');
  delete context.state.groupLeaderboard.scoringLock;
  await context.submitGroupCompetition({ preventDefault() {} }, 'scoring');
  context.state.groups[0].isCommissioner = false;
  node('#group-new-password').value = 'new-secret';
  await context.submitGroupCompetition({ preventDefault() {} }, 'password');
  assert.equal(context.requests.length, 1);
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
  tabs[1].events.click();
  assert.equal(context.lastUrl, '/groups?group=g&view=history');
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(node('#group-panel-history').classes.has('hidden'), false);
  assert.equal(node('#group-panel-standings').classes.has('hidden'), true);
  tabs[1].events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(tabs[0].focused, true);
  assert.equal(context.lastUrl, '/groups?group=g');
  context.window.location.search = '';
  context.window.events.popstate();
  assert.equal(context.state.activeGroupId, '');
  assert.equal(node('#group-leaderboard').classes.has('hidden'), true);
  assert.equal(context.document.title, 'Groups | Predict Playoffs');
  context.window.location.search = '?group=g&view=members';
  context.window.events.popstate();
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal(context.lastUrl, '/groups?group=g');
  context.window.location.search = '?group=g&view=settings';
  context.window.events.popstate();
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal(context.lastUrl, '/groups?group=g');
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

test('commissioner transfers separately, stays in group and loses management controls', async () => {
  const { context, node } = boot();
  context.renderGroups();
  assert.equal(node('#leave-group').classes.has('hidden'), true);
  assert.equal(node('#group-header-commissioner').textContent, 'Alice (You)');
  node('#group-new-commissioner').value = 'b';
  let finish;
  context.apiRequest = (...args) => { context.requests.push(args); return new Promise(resolve => { finish = resolve; }); };
  context.refreshGroups = async id => { context.refreshed = id; };
  const pending = context.submitGroupCommissioner({ preventDefault() {} });
  assert.equal(node('#save-group-commissioner').disabled, true);
  await context.submitGroupCommissioner({ preventDefault() {} });
  assert.equal(context.requests.length, 1);
  assert.equal(context.requests[0][0], '/api/groups/g/commissioner');
  assert.equal(context.requests[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { newCommissionerId: 'b' });
  finish({}); await pending;
  assert.equal(context.state.groups.length, 1);
  assert.equal(context.state.activeGroupId, 'g');
  assert.equal(context.state.groups[0].isCommissioner, false);
  assert.equal(context.state.groupLeaderboard.members[1].isCommissioner, true);
  assert.equal(node('#delete-group').classes.has('hidden'), true);
  assert.equal(node('#leave-group').classes.has('hidden'), false);
  assert.equal(context.refreshed, 'g');
  assert.match(context.toast, /still a member/);
  assert.equal(node('#group-settings-trigger').focused, true);
});

test('only commissioner can rename; successful PATCH updates header and directory without changing the group ID', async () => {
  const { context, node } = boot();
  context.state.groupSummaries.g = board();
  context.apiRequest = async (...args) => { context.requests.push(args); return { groupName: 'Renamed Crew' }; };
  node('#group-new-name').value = 'Renamed Crew';
  await context.submitGroupCompetition({ preventDefault() {} }, 'name');
  assert.equal(context.requests[0][0], '/api/groups/g');
  assert.equal(context.requests[0][1].method, 'PATCH');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), { groupName: 'Renamed Crew' });
  assert.equal(context.state.groups[0].groupName, 'Renamed Crew');
  assert.equal(context.state.groups[0].groupId, 'g');
  assert.equal(context.state.groupLeaderboard.groupName, 'Renamed Crew');
  assert.equal(node('#active-group-name').textContent, 'Renamed Crew');
  assert.equal(node('#group-cards').children[0].children[0].textContent, 'Renamed Crew');
  assert.equal(node('#group-name-editor').open, false);
  assert.match(node('#group-name-message').textContent, /Invite links still work/);
  context.apiRequest = async () => { throw new Error('Name already taken'); };
  node('#group-new-name').value = 'Taken Crew';
  await context.submitGroupCompetition({ preventDefault() {} }, 'name');
  assert.equal(node('#group-name-message').textContent, 'Name already taken');
  assert.equal(context.state.groups[0].groupName, 'Renamed Crew');
  assert.equal(node('#group-new-name').value, 'Taken Crew');
  context.state.groups[0].isCommissioner = false;
  await context.submitGroupCompetition({ preventDefault() {} }, 'name');
  assert.equal(context.requests.length, 1);
});

test('transfer only allows another member, handles errors and empty/loading rosters', async () => {
  const { context, node } = boot();
  context.renderGroupCommissioner();
  assert.equal(node('#group-new-commissioner').children[1].textContent, '<Bob>');
  for (const id of ['', 'a', 'outsider']) {
    node('#group-new-commissioner').value = id;
    await context.submitGroupCommissioner({ preventDefault() {} });
  }
  assert.equal(context.requests.length, 0);
  context.apiRequest = async () => { throw new Error('Membership changed'); };
  node('#group-new-commissioner').value = 'b';
  await context.submitGroupCommissioner({ preventDefault() {} });
  assert.equal(context.state.groups[0].isCommissioner, true);
  assert.equal(node('#group-commissioner-message').textContent, 'Membership changed');
  assert.equal(node('#save-group-commissioner').disabled, false);
  context.state.groupLeaderboard = null;
  context.renderGroupCommissioner();
  assert.equal(node('#group-new-commissioner').disabled, true);
  assert.equal(node('#save-group-commissioner').disabled, true);
  context.state.groups[0].isCommissioner = false;
  context.state.groupLeaderboard = board();
  node('#group-new-commissioner').value = 'b';
  context.apiRequest = async (...args) => context.requests.push(args);
  await context.submitGroupCommissioner({ preventDefault() {} });
  assert.equal(context.requests.length, 0);
});

test('late transfer response cannot repopulate a signed-out group', async () => {
  const { context, node } = boot();
  node('#group-new-commissioner').value = 'b';
  let finish;
  context.apiRequest = () => new Promise(resolve => { finish = resolve; });
  const pending = context.submitGroupCommissioner({ preventDefault() {} });
  context.state.signedIn = false; context.state.groups = []; context.state.groupLeaderboard = null;
  context.state.activeGroupId = '';
  finish({}); await pending;
  assert.equal(context.state.groups.length, 0);
  assert.equal(context.state.activeGroupId, '');
  assert.equal(node('#save-group-commissioner').disabled, true);
});

test('commissioners cannot leave; regular members leave and return to the directory', async () => {
  const { context, node } = boot();
  for (const [key, id] of Object.entries({ confirmLeaveGroup: '#confirm',
    leaveGroupMessage: '#message', leaveGroupDialog: '#dialog' })) context.elements[key] = node(id);
  context.leaveGroupPending = false; context.leaveGroupId = 'g';
  await context.openLeaveGroupDialog(context.state.groups[0]);
  assert.equal(node('#dialog').open, undefined);
  await context.submitLeaveGroup({ preventDefault() {} });
  assert.equal(context.requests.length, 0);
  context.state.groups[0].isCommissioner = false;
  context.state.groupSummaries.g = board();
  await context.submitLeaveGroup({ preventDefault() {} });
  assert.equal(context.requests[0][0], '/api/groups/g/membership');
  assert.deepEqual(JSON.parse(context.requests[0][1].body), {});
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
