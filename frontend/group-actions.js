let groupInviteReturnFocus = null;

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
  if (typeof closeGroupSettings === "function") closeGroupSettings();
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
