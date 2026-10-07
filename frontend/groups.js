const GROUP_VIEWS = ["standings", "history"];
let groupsRequest = 0;
let groupDetailRequest = 0;
let groupNavigationRequest = 0;
let groupInviteReturnFocus = null;
let groupSettingPending = false;
let groupTransferPending = false;
let groupPasswordRequest = 0;

function clearGroupSettingsPassword() {
  groupPasswordRequest++;
  document.getElementById("group-current-password").textContent = "";
  document.getElementById("group-password-status").textContent = "";
  document.getElementById("retry-group-password").classList.add("hidden");
}

function closeGroupSettings() {
  const panel = document.getElementById("group-settings-panel");
  if (!panel) return;
  if (panel.matches(":popover-open")) panel.hidePopover();
  document.getElementById("group-settings-trigger").setAttribute("aria-expanded", "false");
  clearGroupSettingsPassword();
}

async function loadGroupSettingsPassword() {
  clearGroupSettingsPassword();
  const groupId = state.activeGroupId;
  const request = groupPasswordRequest;
  const status = document.getElementById("group-password-status");
  status.textContent = "Loading password…";
  try {
    const invite = await apiRequest(`/api/groups/${encodeURIComponent(groupId)}/invite`);
    if (!state.signedIn || state.activeGroupId !== groupId || request !== groupPasswordRequest) return;
    const password = typeof invite.groupPassword === "string" ? invite.groupPassword : null;
    document.getElementById("group-current-password").textContent = password || "";
    status.textContent = password ? "" : "This older password cannot be recovered. Ask the commissioner to set a new group password.";
  } catch (error) {
    if (!state.signedIn || state.activeGroupId !== groupId || request !== groupPasswordRequest) return;
    status.textContent = "Password could not be loaded. Try again.";
    document.getElementById("retry-group-password").classList.remove("hidden");
  }
}

function groupMetadata(group) {
  const sports = group.sports || ["nfl"];
  const label = sport => groupScoringOption(group, sport) === "vegas" ? "Upset Edge" : "Classic";
  return new Set(sports.map(label)).size > 1
    ? sports.map(sport => `${sport.toUpperCase()} · ${label(sport)}`).join(" / ")
    : `${sports.map(sport => sport.toUpperCase()).join(" + ")} · ${label(sports[0])}`;
}

function groupScoringOption(group, sport = SPORT) {
  return group.scoringOptions?.[sport] || group.scoringOption || "classic";
}

function groupCurrentRank(board) {
  const member = board?.members?.find(item => item.isCurrentUser);
  if (!member?.hasPrediction) return null;
  return rankLeaderboardEntries(board.entries || [], board.scoringOption || "classic")
    .find(entry => entry.leaderboardName === member.displayName)?.rank ?? null;
}

function renderGroupCards() {
  if (!elements.groupCards) return;
  elements.groupCards.replaceChildren();
  for (const group of state.groups) {
    const card = document.createElement("a");
    card.className = "group-card";
    card.href = groupPageUrl(group.groupId, "standings", groupDisplaySport(group));
    const name = document.createElement("h2");
    name.textContent = group.groupName;
    const meta = document.createElement("p");
    meta.className = "group-card-meta";
    meta.textContent = groupMetadata(group);
    card.append(name, meta);
    if (group.isCommissioner ?? group.isCreator) {
      const badge = document.createElement("span");
      badge.className = "commissioner-badge";
      badge.textContent = "Commissioner";
      card.appendChild(badge);
    }
    const summary = state.groupSummaries?.[group.groupId];
    const stats = document.createElement("p");
    stats.className = "group-card-stats";
    const count = summary?.members?.length;
    const rank = groupCurrentRank(summary);
    stats.textContent = summary?.failed ? "Standings unavailable · Open group to retry"
      : summary ? `${count} ${count === 1 ? "member" : "members"} · ${groupDisplaySport(group).toUpperCase()}: ${rank ? `Your rank #${rank}` : "No rank yet"}`
      : "Loading members and rank…";
    card.appendChild(stats);
    const action = document.createElement("span");
    action.className = "group-card-action";
    action.textContent = "Open group";
    card.appendChild(action);
    card.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      if (groupDisplaySport(group) !== SPORT) return; // Native navigation switches the shared sport context.
      event.preventDefault();
      openGroupDetail(group.groupId);
    });
    elements.groupCards.appendChild(card);
  }
}

function selectGroupView(view = "standings", updateUrl = true) {
  const selected = GROUP_VIEWS.includes(view) ? view : "standings";
  document.querySelectorAll("[data-group-view]").forEach(tab => {
    const active = tab.dataset.groupView === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls"))?.classList.toggle("hidden", !active);
  });
  if (updateUrl && state.activeGroupId) {
    window.history.replaceState({}, "", groupPageUrl(state.activeGroupId, selected));
  }
}

function openGroupDetail(groupId, updateUrl = true) {
  if (!state.signedIn || !state.groups.some(group => group.groupId === groupId)) return;
  groupNavigationRequest++;
  closeGroupSettings();
  state.activeGroupId = groupId;
  state.groupLeaderboard = null;
  if (updateUrl) window.history.pushState({}, "", groupPageUrl(groupId));
  renderGroups();
  selectGroupView(new URLSearchParams(window.location.search).get("view"), false);
  if (["members", "settings"].includes(new URLSearchParams(window.location.search).get("view"))) selectGroupView("standings");
  elements.activeGroupName.focus();
  loadGroupLeaderboard(groupId);
}

function showGroupsDirectory(updateUrl = true) {
  groupNavigationRequest++;
  closeGroupSettings();
  state.activeGroupId = "";
  state.groupLeaderboard = null;
  groupDetailRequest++;
  if (updateUrl) window.history.pushState({}, "", groupPageUrl());
  renderGroups();
  elements.groupCards?.querySelector("a")?.focus();
}

function initializeGroupsPage() {
  if (PAGE !== "groups") return;
  document.getElementById("groups-back").addEventListener("click", () => showGroupsDirectory());
  document.querySelectorAll("[data-group-view]").forEach(tab => {
    tab.addEventListener("click", () => selectGroupView(tab.dataset.groupView));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = GROUP_VIEWS.indexOf(tab.dataset.groupView);
      const next = event.key === "Home" ? 0 : event.key === "End" ? GROUP_VIEWS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + GROUP_VIEWS.length) % GROUP_VIEWS.length;
      selectGroupView(GROUP_VIEWS[next]);
      document.getElementById(`group-tab-${GROUP_VIEWS[next]}`).focus();
    });
  });
  window.addEventListener("popstate", () => {
    const id = new URLSearchParams(window.location.search).get("group");
    if (id && state.groups.some(group => group.groupId === id)) openGroupDetail(id, false);
    else showGroupsDirectory(false);
  });
}

function renderGroups() {
  if (!elements.groupCards) return;
  closeGroupSettings();
  renderGroupHistory();
  const activeGroup = state.groups.find(
    (group) => group.groupId === state.activeGroupId,
  );
  const isCommissioner = Boolean(
    activeGroup?.isCommissioner ?? activeGroup?.isCreator,
  );
  elements.leaveGroup?.classList.toggle("hidden", !activeGroup || isCommissioner);
  elements.editGroupSports?.classList.toggle("hidden", !isCommissioner);
  elements.deleteGroup?.classList.toggle("hidden", !isCommissioner);
  for (const id of ["regenerate-group-invite"]) {
    document.getElementById(id)?.classList.toggle("hidden", !isCommissioner);
  }
  document.querySelectorAll("[data-commissioner-only]").forEach(section => section.classList.toggle("hidden", !isCommissioner));
  document.getElementById("group-settings-panel").classList.toggle("group-settings-commissioner", isCommissioner);
  document.querySelector(".group-leave-section").classList.toggle("hidden", !activeGroup || isCommissioner);
  document.getElementById("group-new-password").value = "";
  document.getElementById("group-password-editor").open = false;
  for (const id of ["group-name-editor", "group-scoring-editor", "group-invite-options", "group-commissioner-editor"]) {
    document.getElementById(id).open = false;
  }
  document.getElementById("group-competition-message").textContent = "";
  document.getElementById("group-name-message").textContent = "";
  document.getElementById("group-commissioner-message").textContent = "";
  document.getElementById("group-new-commissioner").replaceChildren();
  document.querySelector("#group-member-list")?.replaceChildren();
  if (document.querySelector("#group-member-count")) document.querySelector("#group-member-count").textContent = "";
  if (activeGroup) {
    elements.leaveGroup?.setAttribute(
      "aria-label",
      `Leave ${activeGroup.groupName}`,
    );
  } else {
    elements.leaveGroup?.removeAttribute("aria-label");
  }
  if (isCommissioner) {
    elements.deleteGroup.setAttribute(
      "aria-label",
      `Delete ${activeGroup.groupName}`,
    );
  } else {
    elements.deleteGroup?.removeAttribute("aria-label");
  }
  renderGroupCards();
  elements.emptyGroups.classList.toggle("hidden", Boolean(state.groups.length));
  if (!state.signedIn) elements.emptyGroups.textContent = "Sign in to see your groups, or create or join a group to get started.";
  elements.groupLeaderboard.classList.toggle("hidden", !activeGroup);
  document.querySelector(".groups-page").classList.toggle("group-open", Boolean(activeGroup));
  document.querySelector(".groups-intro").classList.toggle("hidden", Boolean(activeGroup));
  document.getElementById("groups-directory").classList.toggle("hidden", Boolean(activeGroup));
  const status = document.getElementById("groups-status");
  status.textContent = state.signedIn ? "" : "Sign in to see your groups.";
  elements.groupLeaderboardBody.replaceChildren();
  elements.groupLeaderboardTableShell.classList.add("hidden");
  elements.emptyGroupLeaderboard.classList.add("hidden");
  if (activeGroup) {
    elements.activeGroupName.textContent = activeGroup.groupName;
    document.getElementById("active-group-meta").textContent = groupMetadata(activeGroup);
    document.getElementById("group-settings-name").textContent = activeGroup.groupName;
    document.getElementById("group-new-name").value = activeGroup.groupName;
    renderGroupHub();
    document.title = `${activeGroup.groupName} | Groups | Predict Playoffs`;
    selectGroupView(new URLSearchParams(window.location.search).get("view"), false);
    if (["members", "settings"].includes(new URLSearchParams(window.location.search).get("view"))) selectGroupView("standings");
  } else {
    document.title = "Groups | Predict Playoffs";
  }
}

function initializeGroupSettings() {
  const settings = document.querySelector(".group-settings-actions");
  if (!settings) return;
  const trigger = document.getElementById("group-settings-trigger");
  const panel = document.getElementById("group-settings-panel");
  trigger.addEventListener("click", () => {
    if (panel.matches(":popover-open")) { closeGroupSettings(); return; }
    if (!state.signedIn || !state.activeGroupId) return;
    const rect = trigger.getBoundingClientRect();
    panel.style.setProperty("--settings-top", `${Math.min(rect.bottom + 12, window.innerHeight / 3)}px`);
    panel.style.setProperty("--settings-right", `${Math.max(16, window.innerWidth - rect.right)}px`);
    panel.showPopover();
    trigger.setAttribute("aria-expanded", "true");
    document.getElementById("close-group-settings").focus();
    renderGroupMembers();
    loadGroupSettingsPassword();
  });
  panel.addEventListener("beforetoggle", event => {
    const open = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (!open) {
      clearGroupSettingsPassword();
      document.getElementById("group-new-password").value = "";
    }
  });
  panel.addEventListener("toggle", event => {
    if (event.newState === "closed" && state.activeGroupId && !document.querySelector("dialog[open]") && document.activeElement === document.body) trigger.focus();
  });
  document.getElementById("close-group-settings").addEventListener("click", closeGroupSettings);
  document.getElementById("retry-group-password").addEventListener("click", loadGroupSettingsPassword);
  document.getElementById("regenerate-group-invite")?.addEventListener("click", regenerateActiveGroupInvite);
  document.getElementById("group-scoring-form")?.addEventListener("submit", event => submitGroupCompetition(event, "scoring"));
  document.getElementById("group-name-form")?.addEventListener("submit", event => submitGroupCompetition(event, "name"));
  document.getElementById("group-password-form")?.addEventListener("submit", event => submitGroupCompetition(event, "password"));
  document.getElementById("group-commissioner-form")?.addEventListener("submit", submitGroupCommissioner);
  document.getElementById("group-new-commissioner")?.addEventListener("change", () => {
    document.getElementById("save-group-commissioner").disabled = groupTransferPending || !document.getElementById("group-new-commissioner").value;
  });
  const actionDialogs = {
    "share-group-invite": elements.groupInviteDialog,
    "edit-group-sports": elements.editGroupSportsDialog,
    "leave-group": elements.leaveGroupDialog,
    "delete-group": elements.deleteGroupDialog,
  };
  Object.entries(actionDialogs).forEach(([id, dialog]) => {
    dialog?.addEventListener("close", () => {
      const trigger = id === "share-group-invite" && groupInviteReturnFocus
        ? groupInviteReturnFocus : document.getElementById(id);
      if (trigger?.getClientRects().length) trigger.focus();
      else if (state.activeGroupId) document.getElementById("group-settings-trigger")?.focus();
      else document.getElementById("groups-back")?.focus();
    });
  });
}

function renderGroupHub() {
  if (PAGE !== "groups") return;
  const board = state.groupLeaderboard;
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  const members = board?.members || [];
  const commissioner = members.find(member => member.isCommissioner);
  const season = board?.season;
  const seasonLabel = season ? (IS_NBA ? `${Number(season) - 1}–${String(season).slice(-2)}` : String(season)) : "Current";
  document.getElementById("group-season-label").textContent = `${SPORT.toUpperCase()} · ${seasonLabel} season`;
  document.getElementById("group-header-member-count").textContent = board ? String(members.length) : "Loading…";
  document.getElementById("group-header-commissioner").textContent = commissioner
    ? `${commissioner.displayName}${commissioner.isCurrentUser ? " (You)" : ""}`
    : (group?.isCommissioner ?? group?.isCreator) ? "You" : board ? "Commissioner unavailable" : "Loading…";
  renderGroupCommissioner();
  const predictions = members.filter(member => member.hasPrediction).length;
  document.getElementById("group-standings-summary").textContent = board
    ? `${predictions} of ${members.length} members have a prediction for ${SPORT.toUpperCase()}.`
    : "Your group’s race to the title.";
  const rank = groupCurrentRank(board);
  document.getElementById("group-personal-rank").textContent = board
    ? rank ? `Your rank #${rank}` : "You’re not ranked yet" : "";
  if (!board) elements.groupLeaderboardStatus.textContent = "Loading competition…";
  renderGroupCompetition();
}

function renderGroupCompetition() {
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  if (!group) return;
  const lock = state.groupLeaderboard?.scoringLock;
  const mode = state.groupLeaderboard?.scoringOption || groupScoringOption(group);
  const commissioner = Boolean(group.isCommissioner ?? group.isCreator);
  document.getElementById("group-settings-sports").textContent = (group.sports || ["nfl"]).map(sport => sport.toUpperCase()).join(" + ");
  document.getElementById("group-settings-scoring-label").textContent = `${SPORT.toUpperCase()} scoring`;
  document.getElementById("group-settings-scoring").textContent = mode === "vegas" ? "Upset Edge" : "Classic";
  const deadline = lock?.lockAt ? new Date(lock.lockAt).toLocaleString() : "";
  document.getElementById("group-scoring-lock-status").textContent = !lock ? "Checking scoring deadline…"
    : lock.locked ? `Scoring is locked for ${SPORT.toUpperCase()} this season.`
    : `Scoring locks ${deadline || "at the prediction deadline"}.`;
  document.getElementById("group-settings-scoring-select").value = mode;
  const disabled = !commissioner || lock?.locked !== false || groupSettingPending;
  document.getElementById("group-scoring-editor").classList.toggle("hidden", !commissioner || lock?.locked !== false);
  if (!commissioner || lock?.locked !== false) document.getElementById("group-scoring-editor").open = false;
  document.getElementById("group-settings-scoring-select").disabled = disabled;
  document.getElementById("save-group-scoring").disabled = disabled;
  document.getElementById("save-group-password").disabled = !commissioner || groupSettingPending;
  document.getElementById("save-group-name").disabled = !commissioner || groupSettingPending;
}

async function submitGroupCompetition(event, setting) {
  event.preventDefault();
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  if (groupSettingPending || !(group?.isCommissioner ?? group?.isCreator)) return;
  const password = document.getElementById("group-new-password");
  const message = document.getElementById(setting === "name" ? "group-name-message" : "group-competition-message");
  if (setting === "scoring" && state.groupLeaderboard?.scoringLock?.locked !== false) return;
  if (setting === "password" && (password.value.length < 6 || password.value.length > 128)) {
    message.textContent = "Group password must be between 6 and 128 characters.";
    return;
  }
  const body = setting === "password" ? { password: password.value }
    : setting === "name" ? { groupName: document.getElementById("group-new-name").value }
    : { scoringOption: document.getElementById("group-settings-scoring-select").value };
  groupSettingPending = true;
  if (setting === "password") clearGroupSettingsPassword();
  document.getElementById("save-group-password").disabled = true;
  document.getElementById("save-group-scoring").disabled = true;
  document.getElementById("save-group-name").disabled = true;
  message.textContent = "Saving…";
  try {
    const updated = await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}`, { method: "PATCH", body: JSON.stringify(body) });
    password.value = "";
    if (!state.signedIn || state.activeGroupId !== group.groupId) return;
    if (setting === "name") {
      group.groupName = updated.groupName;
      if (state.groupLeaderboard) state.groupLeaderboard.groupName = updated.groupName;
      if (state.groupSummaries?.[group.groupId]) state.groupSummaries[group.groupId].groupName = updated.groupName;
      elements.activeGroupName.textContent = updated.groupName;
      elements.deleteGroup?.setAttribute("aria-label", `Delete ${updated.groupName}`);
      document.getElementById("group-settings-name").textContent = updated.groupName;
      document.getElementById("group-new-name").value = updated.groupName;
      document.title = `${updated.groupName} | Groups | Predict Playoffs`;
      renderGroupCards();
      document.getElementById("group-name-editor").open = false;
    }
    if (setting === "scoring") await refreshGroups(group.groupId);
    if (!state.signedIn || state.activeGroupId !== group.groupId) return;
    if (setting === "password") {
      document.getElementById("group-password-editor").open = false;
      if (document.getElementById("group-settings-panel").matches(":popover-open")) await loadGroupSettingsPassword();
    }
    if (!state.signedIn || state.activeGroupId !== group.groupId) return;
    document.querySelector(`#group-${setting}-editor > summary`)?.focus();
    message.textContent = setting === "password" ? "Password updated. The old password no longer works." : setting === "name" ? "Group name updated. Invite links still work." : "Scoring system updated.";
    showToast(setting === "password" ? "Group password updated." : setting === "name" ? "Group name updated." : "Group scoring updated.");
  } catch (error) {
    password.value = "";
    if (state.signedIn && state.activeGroupId === group.groupId) {
      if (setting === "password" && document.getElementById("group-settings-panel").matches(":popover-open")) await loadGroupSettingsPassword();
      if (state.signedIn && state.activeGroupId === group.groupId) message.textContent = error.message;
    }
  } finally {
    groupSettingPending = false;
    renderGroupCompetition();
  }
}

function renderGroupCommissioner() {
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  const select = document.getElementById("group-new-commissioner");
  const previous = select.value;
  const candidates = (state.groupLeaderboard?.members || []).filter(member => !member.isCurrentUser && !member.isCommissioner);
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = candidates.length ? "Choose a member" : "Invite another member to transfer";
  select.appendChild(placeholder);
  for (const member of candidates) {
    const option = document.createElement("option");
    option.value = member.userId;
    option.textContent = member.displayName;
    select.appendChild(option);
  }
  select.value = candidates.some(member => member.userId === previous) ? previous : "";
  select.disabled = groupTransferPending || !(group?.isCommissioner ?? group?.isCreator) || !candidates.length;
  document.getElementById("save-group-commissioner").disabled = select.disabled || !select.value;
}

async function submitGroupCommissioner(event) {
  event.preventDefault();
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  const replacement = document.getElementById("group-new-commissioner").value;
  if (groupTransferPending || !(group?.isCommissioner ?? group?.isCreator) || !replacement) return;
  const member = state.groupLeaderboard?.members?.find(item => item.userId === replacement && !item.isCurrentUser && !item.isCommissioner);
  if (!member) return;
  const message = document.getElementById("group-commissioner-message");
  groupTransferPending = true;
  renderGroupCommissioner();
  message.textContent = "Transferring…";
  try {
    await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}/commissioner`, { method: "POST", body: JSON.stringify({ newCommissionerId: replacement }) });
    if (!state.signedIn || state.activeGroupId !== group.groupId) return;
    // Hide privileged controls immediately, even if the subsequent refresh fails.
    group.isCommissioner = false;
    group.isCreator = false;
    if (state.groupLeaderboard?.members) {
      state.groupLeaderboard.members.forEach(item => { item.isCommissioner = item.userId === replacement; });
    }
    renderGroups();
    await refreshGroups(group.groupId);
    if (!state.signedIn || state.activeGroupId !== group.groupId) return;
    document.getElementById("group-settings-trigger").focus();
    showToast(`${member.displayName} is now commissioner. You’re still a member.`);
  } catch (error) {
    if (state.signedIn && state.activeGroupId === group.groupId) message.textContent = error.message;
  } finally {
    groupTransferPending = false;
    renderGroupCommissioner();
  }
}

function renderGroupLeaderboard() {
  renderGroupMembers();
  renderGroupHistory();
  const leaderboard = state.groupLeaderboard;
  const mode = leaderboard?.scoringOption || "classic";
  const entries = rankLeaderboardEntries((leaderboard?.entries || [])
    .filter(entry => entry.hasPrediction !== false)
    .map(({ isCommissioner, ...entry }) => entry), mode);
  elements.groupLeaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyGroupLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  updateLeaderboardScoreHeading(elements.groupLeaderboardBody, mode);
  renderLeaderboardRows(elements.groupLeaderboardBody, entries, mode);
  renderGroupHub();
  if (leaderboard) {
    elements.activeGroupName.textContent = leaderboard.groupName;
    elements.groupLeaderboardStatus.textContent = leaderboard.status || "Results unavailable";
    elements.groupLeaderboardStatus.title = "";
  }
}

async function loadGroupLeaderboard(groupId = state.activeGroupId) {
  if (!groupId) return;
  const request = ++groupDetailRequest;
  renderGroupHistory();
  elements.groupLeaderboardStatus.textContent = "Loading competition…";
  document.querySelector("#group-members-status").textContent = "Loading members…";
  try {
    const leaderboard = await apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}/leaderboard`,
    );
    if (!state.signedIn || state.activeGroupId !== groupId || request !== groupDetailRequest) return;
    state.groupLeaderboard = leaderboard;
    state.groupSummaries[groupId] = leaderboard;
    renderGroupCards();
    renderGroupLeaderboard();
  } catch (error) {
    if (!state.signedIn || state.activeGroupId !== groupId || request !== groupDetailRequest) return;
    state.groupLeaderboard = null;
    renderGroupHub();
    document.getElementById("group-header-member-count").textContent = "Unavailable";
    elements.groupLeaderboardBody.innerHTML = "";
    elements.groupLeaderboardTableShell.classList.add("hidden");
    elements.emptyGroupLeaderboard.classList.add("hidden");
    elements.groupLeaderboardStatus.textContent = "Group details could not be loaded. Open the group again to retry.";
    elements.groupLeaderboardStatus.title = error.message;
    renderGroupHistory(true);
    document.querySelector("#group-member-list").replaceChildren();
    document.querySelector("#group-members-status").textContent = "Members could not be loaded. Open the group again to retry.";
  }
}

function renderGroupMembers() {
  const list = document.querySelector("#group-member-list");
  if (!list) return;
  list.replaceChildren();
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  if (!(group?.isCommissioner ?? group?.isCreator)) {
    document.querySelector("#group-member-count").textContent = "";
    return;
  }
  const members = state.groupLeaderboard?.members || [];
  document.querySelector("#group-member-count").textContent = `(${members.length})`;
  document.querySelector("#group-members-status").textContent = "";
  for (const member of members) {
    const item = document.createElement("li");
    item.className = "group-member";
    item.dataset.currentUser = String(Boolean(member.isCurrentUser));
    const identity = document.createElement("div");
    identity.className = "group-member-identity";
    const name = document.createElement("strong");
    name.textContent = member.displayName;
    const badges = document.createElement("div");
    badges.className = "group-member-badges";
    for (const [label, className, visible] of [
      ["Commissioner", "commissioner-badge", member.isCommissioner],
      ["You", "group-you-badge", member.isCurrentUser],
    ]) {
      if (!visible) continue;
      const badge = document.createElement("span");
      badge.className = className;
      badge.textContent = label;
      badges.appendChild(badge);
    }
    const prediction = document.createElement("span");
    prediction.className = "group-member-prediction";
    prediction.textContent = member.hasPrediction ? "Prediction saved" : "No prediction";
    badges.appendChild(prediction);
    identity.append(name, badges);
    item.append(identity);
    if ((group?.isCommissioner ?? group?.isCreator) && !member.isCommissioner && !member.isCurrentUser) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-link group-member-remove group-destructive";
      button.textContent = "Remove";
      button.setAttribute("aria-label", `Remove ${member.displayName}`);
      button.addEventListener("click", async () => {
        if (!window.confirm(`Remove ${member.displayName} from ${group.groupName}? They will not be able to rejoin with an invite or password.`)) return;
        button.disabled = true;
        const status = document.querySelector("#group-members-status");
        status.textContent = `Removing ${member.displayName}…`;
        try {
          await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
          await loadGroupLeaderboard(group.groupId);
          status.textContent = `${member.displayName} was removed.`;
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
        }
      });
      item.appendChild(button);
    }
    list.appendChild(item);
  }
}

async function regenerateActiveGroupInvite() {
  const group = state.groups.find(item => item.groupId === state.activeGroupId);
  if (!(group?.isCommissioner ?? group?.isCreator)) return;
  if (!window.confirm(`Regenerate the invite link for ${group.groupName}? Existing invite links will stop working.`)) return;
  const button = document.getElementById("regenerate-group-invite");
  button.disabled = true;
  try {
    await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}/invite`, { method: "POST" });
    showToast("Invite link regenerated. Old links no longer work.");
    await openGroupInviteDialog(group, button);
  } catch (error) {
    elements.groupLeaderboardStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderGroupHistory(failed = false) {
  const container = document.querySelector("#group-history-content");
  if (!container) return;
  container.replaceChildren();
  const add = (tag, text, parent = container, className = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    parent.appendChild(node);
    return node;
  };
  if (!state.groupLeaderboard || failed) {
    add("p", failed ? "Group history could not be loaded. Refresh to try again." : "Loading group history…");
    return;
  }
  const history = state.groupLeaderboard.history;
  if (!history) {
    add("p", "Group history is unavailable. Refresh to try again.");
    return;
  }
  const sport = IS_NBA ? "NBA" : "NFL";
  const seasons = history.seasons || [];
  const standings = history.standings || [];
  if (!seasons.length && !standings.length) {
    const empty = add("div", "", container, "group-history-empty");
    add("h4", "Your group’s story starts here.", empty);
    add("p", `No completed ${sport} seasons yet. After your first season ends, your champions and all-time standings will appear here.`, empty);
    const action = add("button", "View current standings", empty, "button button-secondary");
    action.type = "button";
    action.addEventListener("click", () => {
      selectGroupView("standings");
      document.getElementById("group-tab-standings").focus();
    });
    return;
  }
  add("p", `${sport} · Completed seasons only. Current-season scores are in Standings.`, container, "input-hint");
  if (seasons.length) {
    add("h4", "Group champions");
    const list = add("ol", "", container, "group-history-champions");
    for (const season of seasons) {
      const item = add("li", "", list);
      add("span", String(season.season), item, "group-history-year");
      add("strong", season.champions.length ? season.champions.join(" & ") : "No champion", item);
      add("span", `${season.champions.length > 1 ? "Shared title · " : ""}${season.scoringOption === "vegas" ? "Upset Edge" : "Classic"}`, item, "input-hint");
    }
  }
  if (!standings.length) return;
  add("h4", "All-time standings");
  add("p", "Ranked by titles, then total points. Tied records share a rank.", container, "input-hint");
  const shell = add("div", "", container, "leaderboard-table-shell");
  shell.tabIndex = 0;
  shell.setAttribute("role", "region");
  shell.setAttribute("aria-label", "All-time group standings");
  const table = add("table", "", shell, "leaderboard-table group-history-table");
  const head = add("tr", "", add("thead", "", table));
  for (const label of ["Rank", "Player", "Titles", "Seasons", "Total points"]) {
    add("th", label, head).scope = "col";
  }
  const body = add("tbody", "", table);
  for (const entry of standings) {
    const row = add("tr", "", body);
    add("td", String(entry.rank), row);
    add("th", entry.leaderboardName, row).scope = "row";
    add("td", String(entry.titles), row);
    add("td", String(entry.seasons), row);
    add("td", formatLeaderboardScore(entry.total, state.groupLeaderboard.scoringOption === "vegas" ? 2 : 0), row);
  }
}

async function refreshGroups(preferredGroupId = new URLSearchParams(window.location.search).get("group") || "") {
  const request = ++groupsRequest;
  const navigation = groupNavigationRequest;
  const status = document.getElementById("groups-status");
  if (status) status.textContent = "Loading your groups…";
  try {
    if (!await refreshGroupMemberships()) return;
    if (!state.signedIn || request !== groupsRequest) return;
    if (navigation !== groupNavigationRequest) preferredGroupId = state.activeGroupId;
    state.activeGroupId = state.groups.some(
      (group) => group.groupId === preferredGroupId,
    )
      ? preferredGroupId
      : "";
    state.groupLeaderboard = null;
    state.groupSummaries = {};
    if (!elements.groupCards) return;
    if (state.activeGroupId) {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("group") === state.activeGroupId ? params.get("view") || "standings" : "standings";
      window.history.replaceState({}, "", groupPageUrl(state.activeGroupId, view));
    }
    elements.emptyGroups.textContent =
      "You have not joined a group yet. Create one for friends or join one with its name and password.";
    elements.emptyGroups.title = "";
    renderGroups();
    if (preferredGroupId && !state.activeGroupId) status.textContent = "This group is no longer available to your account. Choose another group below.";
    if (state.activeGroupId) {
      const active = state.groups.find(group => group.groupId === state.activeGroupId);
      if (groupDisplaySport(active) !== SPORT) {
        window.location.replace(groupPageUrl(active.groupId, "standings", groupDisplaySport(active)));
        return;
      }
      await loadGroupLeaderboard(state.activeGroupId);
    }
    // Bound parallel reads; each board supplies both member count and personal rank.
    const queue = state.groups.filter(group => !state.groupSummaries[group.groupId]);
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && state.signedIn && request === groupsRequest) {
        const group = queue.shift();
        let summary;
        try {
          summary = await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}/leaderboard`, { sport: groupDisplaySport(group) });
        } catch {
          summary = { failed: true };
        }
        if (!state.signedIn || request !== groupsRequest) return;
        if (!state.groupSummaries[group.groupId]) state.groupSummaries[group.groupId] = summary;
        renderGroupCards();
      }
    }));
  } catch (error) {
    if (!state.signedIn || request !== groupsRequest) return;
    state.groups = [];
    state.groupsLoaded = false;
    updateGroupsNavigation();
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    if (!elements.groupCards) throw error;
    renderGroups();
    elements.emptyGroups.textContent =
      "Your groups could not be loaded. Please refresh and try again.";
    elements.emptyGroups.title = error.message;
  }
}

function resetLeaveGroupDialog() {
  leaveGroupPending = false;
  leaveGroupId = "";
  elements.leaveGroupDescription.textContent = "";
  elements.leaveGroupMessage.textContent = "";
  elements.confirmLeaveGroup.disabled = false;
  elements.confirmLeaveGroup.removeAttribute("aria-busy");
  elements.confirmLeaveGroup.textContent = "Leave group";
}

async function openLeaveGroupDialog(group) {
  if (!group || (group.isCommissioner ?? group.isCreator) || !elements.leaveGroupDialog) return;
  closeGroupSettings();
  resetLeaveGroupDialog();
  leaveGroupId = group.groupId;
  elements.leaveGroupTitle.textContent = `Leave ${group.groupName}?`;
  elements.leaveGroupDescription.textContent = "You can rejoin later with an invite or the group password.";
  elements.leaveGroupDialog.showModal();
  elements.confirmLeaveGroup.focus();
}

async function submitLeaveGroup(event) {
  event.preventDefault();
  const group = state.groups.find(
    (candidate) => candidate.groupId === leaveGroupId,
  );
  if (leaveGroupPending || !group || (group.isCommissioner ?? group.isCreator)) return;

  leaveGroupPending = true;
  elements.confirmLeaveGroup.disabled = true;
  elements.confirmLeaveGroup.setAttribute("aria-busy", "true");
  elements.confirmLeaveGroup.textContent = "Leaving…";
  elements.leaveGroupMessage.textContent = "Leaving the group…";
  try {
    await apiRequest(
      `/api/groups/${encodeURIComponent(group.groupId)}/membership`,
      {
        method: "DELETE",
        body: JSON.stringify({}),
      },
    );
    state.groups = state.groups.filter(
      (candidate) => candidate.groupId !== group.groupId,
    );
    updateGroupsNavigation();
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    elements.leaveGroupDialog.close();
    delete state.groupSummaries[group.groupId];
    showGroupsDirectory();
    showToast(`You left ${group.groupName}.`);
  } catch (error) {
    elements.leaveGroupMessage.textContent =
      `Could not leave the group: ${error.message}`;
  } finally {
    leaveGroupPending = false;
    elements.confirmLeaveGroup.removeAttribute("aria-busy");
    elements.confirmLeaveGroup.textContent = "Leave group";
    if (elements.leaveGroupDialog.open) {
      elements.confirmLeaveGroup.disabled = false;
    }
  }
}

function groupConfirmationMatches(value, groupName) {
  return Boolean(groupName) &&
    value.trim().toLowerCase() === groupName.trim().toLowerCase();
}

function resetDeleteGroupDialog() {
  deleteGroupPending = false;
  deleteGroupId = "";
  elements.deleteGroupName.textContent = "";
  elements.deleteGroupConfirmationName.textContent = "";
  elements.deleteGroupConfirmation.value = "";
  elements.deleteGroupMessage.textContent = "";
  elements.confirmDeleteGroup.disabled = true;
  elements.confirmDeleteGroup.removeAttribute("aria-busy");
  elements.confirmDeleteGroup.textContent = "Delete group";
}

function openDeleteGroupDialog(group) {
  if (
    !(group?.isCommissioner ?? group?.isCreator) ||
    !elements.deleteGroupDialog
  ) return;
  deleteGroupId = group.groupId;
  elements.deleteGroupName.textContent = group.groupName;
  elements.deleteGroupConfirmationName.textContent = group.groupName;
  elements.deleteGroupConfirmation.value = "";
  elements.deleteGroupMessage.textContent = "";
  elements.confirmDeleteGroup.disabled = true;
  closeGroupSettings();
  elements.deleteGroupDialog.showModal();
  elements.deleteGroupConfirmation.focus();
}

function updateDeleteGroupConfirmation() {
  elements.confirmDeleteGroup.disabled =
    deleteGroupPending ||
    !groupConfirmationMatches(
      elements.deleteGroupConfirmation.value,
      elements.deleteGroupConfirmationName.textContent,
    );
}

async function submitDeleteGroup(event) {
  event.preventDefault();
  const group = state.groups.find(
    (candidate) => candidate.groupId === deleteGroupId,
  );
  if (
    deleteGroupPending ||
    !(group?.isCommissioner ?? group?.isCreator) ||
    !groupConfirmationMatches(
      elements.deleteGroupConfirmation.value,
      group.groupName,
    )
  ) {
    return;
  }

  deleteGroupPending = true;
  elements.confirmDeleteGroup.disabled = true;
  elements.confirmDeleteGroup.setAttribute("aria-busy", "true");
  elements.confirmDeleteGroup.textContent = "Deleting…";
  elements.deleteGroupMessage.textContent =
    "Removing the group for every member…";

  try {
    await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}`, {
      method: "DELETE",
    });
    state.groups = state.groups.filter(
      (candidate) => candidate.groupId !== group.groupId,
    );
    updateGroupsNavigation();
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    elements.deleteGroupDialog.close();
    delete state.groupSummaries[group.groupId];
    showGroupsDirectory();
    showToast(`Deleted ${group.groupName}.`);
  } catch (error) {
    elements.deleteGroupMessage.textContent =
      `Could not delete the group: ${error.message}`;
  } finally {
    deleteGroupPending = false;
    elements.confirmDeleteGroup.removeAttribute("aria-busy");
    elements.confirmDeleteGroup.textContent = "Delete group";
    updateDeleteGroupConfirmation();
  }
}

function openGroupDialog(mode) {
  groupDialogMode = mode;
  const creating = mode === "create";
  elements.groupForm.reset();
  document.querySelector("#group-scoring-field").classList.toggle("hidden", !creating);
  elements.groupSportsField.classList.toggle("hidden", !creating);
  elements.groupSportNfl.checked = !IS_NBA;
  elements.groupSportNba.checked = IS_NBA;
  elements.groupDialogKicker.textContent = creating ? "NEW PRIVATE GROUP" : "JOIN PRIVATE GROUP";
  elements.groupDialogTitle.textContent = creating ? "Create a group." : "Join a group.";
  elements.groupDialogDescription.textContent = creating
    ? "Pick a unique group name. You can invite people with a private link or the group password."
    : "Enter the exact group name and the password shared by its creator.";
  elements.submitGroup.textContent = creating ? "Create group" : "Join group";
  elements.groupDialogMessage.textContent = "";
  elements.groupDialog.showModal();
  elements.groupName.focus();
}

async function submitGroup(event) {
  event.preventDefault();
  const creating = groupDialogMode === "create";
  const sports = [
    ...(elements.groupSportNfl.checked ? ["nfl"] : []),
    ...(elements.groupSportNba.checked ? ["nba"] : []),
  ];
  if (creating && !sports.length) {
    elements.groupDialogMessage.textContent = "Choose at least one sport.";
    return;
  }
  elements.submitGroup.disabled = true;
  elements.submitGroup.setAttribute("aria-busy", "true");
  elements.submitGroup.textContent = creating ? "Creating…" : "Joining…";
  elements.groupDialogMessage.textContent = creating
    ? "Creating your private group…"
    : "Checking the group password…";

  try {
    const group = await apiRequest(creating ? "/api/groups" : "/api/groups/join", {
      method: "POST",
      body: JSON.stringify({
        groupName: elements.groupName.value,
        password: elements.groupPassword.value,
        ...(creating ? { scoringOption: document.querySelector("#group-scoring").value, sports } : {}),
      }),
    });
    elements.groupDialog.close();
    state.groups = [
      ...state.groups.filter((existing) => existing.groupId !== group.groupId),
      group,
    ];
    window.siteAnalytics?.track(creating ? "group_created" : "group_joined");
    if (PAGE === "groups") await refreshGroups(group.groupId);
    else refreshGroupMemberships().catch(() => {});
    if (elements.homeGroupStatus) {
      elements.homeGroupStatus.textContent = creating
        ? `${group.groupName} is ready. Copy the invite link to bring people in.`
        : `You joined ${group.groupName}. Open Groups to view its standings.`;
    }
    showToast(creating ? `Created ${group.groupName}.` : `Joined ${group.groupName}.`);
    if (creating) await openGroupInviteDialog(group);
  } catch (error) {
    elements.groupDialogMessage.textContent = error.message;
    elements.groupPassword.value = "";
    elements.groupPassword.focus();
  } finally {
    elements.submitGroup.disabled = false;
    elements.submitGroup.removeAttribute("aria-busy");
    elements.submitGroup.textContent = creating ? "Create group" : "Join group";
  }
}

function openEditGroupSportsDialog() {
  const group = state.groups.find((candidate) => candidate.groupId === state.activeGroupId);
  if (!(group?.isCommissioner ?? group?.isCreator)) return;
  elements.editGroupSportNfl.checked = (group.sports || ["nfl"]).includes("nfl");
  elements.editGroupSportNba.checked = (group.sports || ["nfl"]).includes("nba");
  elements.editGroupSportsMessage.textContent = "";
  closeGroupSettings();
  elements.editGroupSportsDialog.showModal();
  elements.editGroupSportNfl.focus();
}

async function submitEditGroupSports(event) {
  event.preventDefault();
  const group = state.groups.find((candidate) => candidate.groupId === state.activeGroupId);
  if (!(group?.isCommissioner ?? group?.isCreator)) return;
  const sports = [
    ...(elements.editGroupSportNfl.checked ? ["nfl"] : []),
    ...(elements.editGroupSportNba.checked ? ["nba"] : []),
  ];
  if (!sports.length) {
    elements.editGroupSportsMessage.textContent = "Choose at least one sport.";
    return;
  }
  elements.saveGroupSports.disabled = true;
  elements.saveGroupSports.textContent = "Saving…";
  try {
    await apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}`, {
      method: "PATCH",
      body: JSON.stringify({ sports }),
    });
    elements.editGroupSportsDialog.close();
    await refreshGroups(group.groupId);
    showToast(`Updated sports for ${group.groupName}.`);
  } catch (error) {
    elements.editGroupSportsMessage.textContent = error.message;
  } finally {
    elements.saveGroupSports.disabled = false;
    elements.saveGroupSports.textContent = "Save sports";
  }
}

function renderHomeGroupInvite() {
  if (!elements.homeInviteCallout) return;
  const hasInviteParameter = new URLSearchParams(window.location.search).has("invite");
  const hasValidInvite = Boolean(pendingGroupInvite);
  elements.homeInviteCallout.classList.toggle("hidden", !hasValidInvite);
  document.body.classList.toggle("has-group-invite", hasValidInvite);
  elements.homeAcceptInvite.textContent = state.signedIn
    ? "Join group"
    : "Sign in to join group";
  if (hasInviteParameter && !pendingGroupInvite) {
    elements.homeGroupStatus.textContent =
      "This group invite link is invalid. Ask the sender for a new link.";
  }
}

function openGroupAction(mode) {
  if (state.signedIn) {
    openGroupDialog(mode);
    return;
  }
  pendingGroupAction = mode;
  showAuthPanel(
    "signIn",
    mode === "create"
      ? "Sign in to create a private group."
      : "Sign in to join a private group.",
  );
  openAccountModal(elements.loginEmail);
}

async function acceptPendingGroupInvite() {
  if (!pendingGroupInvite) return;
  if (!state.signedIn) {
    pendingGroupAction = "accept-invite";
    showAuthPanel("signIn", "Sign in to accept this private group invite.");
    openAccountModal(elements.loginEmail);
    return;
  }

  elements.homeAcceptInvite.disabled = true;
  elements.homeAcceptInvite.setAttribute("aria-busy", "true");
  elements.homeAcceptInvite.textContent = "Joining…";
  elements.homeInviteStatus.textContent = "Joining your group…";
  try {
    const group = await apiRequest("/api/groups/join-invite", {
      method: "POST",
      body: JSON.stringify(pendingGroupInvite),
    });
    refreshGroupMemberships().catch(() => {});
    pendingGroupInvite = null;
    window.siteAnalytics?.track("group_invite_joined");
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    renderHomeGroupInvite();
    elements.homeGroupStatus.textContent =
      `You joined ${group.groupName}. Open Groups to view its standings.`;
    showToast(`Joined ${group.groupName}.`);
  } catch (error) {
    elements.homeInviteStatus.textContent = error.message;
  } finally {
    elements.homeAcceptInvite.disabled = false;
    elements.homeAcceptInvite.removeAttribute("aria-busy");
    renderHomeGroupInvite();
  }
}

async function resumePendingGroupAction() {
  if (!pendingGroupAction) return;
  const action = pendingGroupAction;
  pendingGroupAction = "";
  closeAccountModal({ restoreFocus: false });
  if (action === "accept-invite") {
    await acceptPendingGroupInvite();
  } else {
    openGroupDialog(action);
  }
}

function groupInviteUrl(groupId, inviteCode) {
  const url = new URL("/", window.location.origin);
  if (IS_NBA) url.searchParams.set("sport", SPORT);
  url.searchParams.set("invite", `${groupId}.${inviteCode}`);
  return url.toString();
}

async function openGroupInviteDialog(group, trigger = null) {
  groupInviteReturnFocus = trigger;
  elements.groupInviteName.textContent = group.groupName;
  elements.groupInviteLink.value = "";
  elements.groupInviteMessage.textContent = "Creating a private invite link…";
  elements.copyGroupInvite.disabled = true;
  elements.shareGroupInviteNative.classList.toggle("hidden", !navigator.share);
  closeGroupSettings();
  elements.groupInviteDialog.showModal();

  try {
    const invite = await apiRequest(
      `/api/groups/${encodeURIComponent(group.groupId)}/invite`,
    );
    if (!invite.inviteCode) {
      elements.groupInviteMessage.textContent = "Invite sharing is unavailable. Ask the commissioner to reset the link using the group settings gear → Invite options.";
      return;
    }
    elements.groupInviteName.textContent = invite.groupName;
    elements.groupInviteLink.value = groupInviteUrl(
      invite.groupId,
      invite.inviteCode,
    );
    elements.groupInviteMessage.textContent =
      "Only share this link with people you want in the group.";
    elements.copyGroupInvite.disabled = false;
  } catch (error) {
    elements.groupInviteMessage.textContent = error.message;
  }
}

async function shareActiveGroupInvite(event) {
  const group = state.groups.find(
    (candidate) => candidate.groupId === state.activeGroupId,
  );
  if (group) await openGroupInviteDialog(group, event?.currentTarget);
}

async function copyGroupInviteLink() {
  const link = elements.groupInviteLink.value;
  if (!link) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      elements.groupInviteLink.select();
      document.execCommand("copy");
    }
    elements.groupInviteMessage.textContent = "Invite link copied.";
    elements.copyGroupInvite.textContent = "Copied";
    setTimeout(() => {
      elements.copyGroupInvite.textContent = "Copy invite link";
    }, 1800);
  } catch (error) {
    elements.groupInviteMessage.textContent =
      "Copy failed. Select the link and copy it manually.";
    elements.groupInviteLink.select();
  }
}

async function shareGroupInviteNatively() {
  const link = elements.groupInviteLink.value;
  if (!link || !navigator.share) return;
  try {
    await navigator.share({
      title: `Join ${elements.groupInviteName.textContent}`,
      text: "Join my Predict Playoffs private leaderboard.",
      url: link,
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      elements.groupInviteMessage.textContent = "The invite link could not be shared.";
    }
  }
}
