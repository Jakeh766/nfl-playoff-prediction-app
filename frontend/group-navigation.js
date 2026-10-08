let groupMembershipRequest = 0;

function groupPageUrl(groupId = "", view = "standings", sport = SPORT) {
  const url = new URL(routeHref("/groups"), window.location.origin);
  if (sport === "nba") url.searchParams.set("sport", "nba");
  else url.searchParams.delete("sport");
  if (groupId) {
    url.searchParams.set("group", groupId);
    if (view !== "standings") url.searchParams.set("view", view);
  }
  return url.pathname + url.search;
}

function groupDisplaySport(group) {
  const sports = group.sports || ["nfl"];
  return sports.includes(SPORT) ? SPORT : sports[0];
}

function singleNavigationGroup() {
  return state.signedIn && state.groupsLoaded && state.groups.length === 1 ? state.groups[0] : null;
}

function updateGroupsNavigation() {
  const link = document.querySelector('.primary-nav [data-nav-page="groups"]');
  if (!link) return;
  const group = singleNavigationGroup();
  link.href = group ? groupPageUrl(group.groupId, "standings", groupDisplaySport(group)) : groupPageUrl();
}

function initializeGroupsNavigation() {
  const link = document.querySelector('.primary-nav [data-nav-page="groups"]');
  if (!link) return;
  updateGroupsNavigation();
  link.addEventListener("click", event => {
    updateGroupsNavigation();
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    if (PAGE !== "groups" || !state.signedIn) return;
    const group = singleNavigationGroup();
    if (group && groupDisplaySport(group) !== SPORT) return; // Native navigation loads the correct sport.
    event.preventDefault();
    if (group) openGroupDetail(group.groupId);
    else showGroupsDirectory();
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted && state.signedIn) {
      const refresh = PAGE === "groups" ? refreshGroups : refreshGroupMemberships;
      refresh().catch(() => {});
    }
  });
}

async function refreshGroupMemberships() {
  const request = ++groupMembershipRequest;
  state.groupsLoaded = false;
  updateGroupsNavigation();
  if (!state.signedIn) return false;
  try {
    // Count memberships across both sports; a dual-sport group counts once.
    const payloads = await Promise.all(["nfl", "nba"].map(sport => apiRequest("/api/groups", { sport })));
    if (!state.signedIn || request !== groupMembershipRequest) return false;
    state.groups = [...new Map(payloads.flatMap(payload => payload.groups || []).map(group => [group.groupId, group])).values()]
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
    state.groupsLoaded = true;
    updateGroupsNavigation();
    return true;
  } catch (error) {
    if (!state.signedIn || request !== groupMembershipRequest) return false;
    state.groupsLoaded = false;
    updateGroupsNavigation();
    throw error;
  }
}
