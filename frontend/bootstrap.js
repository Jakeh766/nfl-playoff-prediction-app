let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

document.querySelectorAll(".conference-logo").forEach((logo) => {
  logo.addEventListener("error", () => logo.classList.add("logo-error"));
});
elements.buildBracket?.addEventListener("click", buildBracket);
elements.randomizeBracket?.addEventListener("click", randomizeBracket);
elements.savePrediction?.addEventListener("click", savePrediction);
elements.resetPicks?.addEventListener("click", resetGamePicks);
elements.signInForm.addEventListener("submit", submitSignIn);
elements.createAccountForm.addEventListener("submit", submitCreateAccount);
elements.confirmAccountForm.addEventListener("submit", submitConfirmAccount);
elements.forgotPasswordForm.addEventListener("submit", submitForgotPassword);
elements.resetPasswordForm.addEventListener("submit", submitResetPassword);
elements.leaderboardNameForm.addEventListener("submit", submitLeaderboardName);
elements.publicLeaderboardTab?.addEventListener("click", () => {
  renderLeaderboardView("public");
});
elements.groupsLeaderboardTab?.addEventListener("click", () => {
  renderLeaderboardView("groups");
});
elements.publicLeaderboardTab?.addEventListener("keydown", handleLeaderboardViewKeydown);
elements.groupsLeaderboardTab?.addEventListener("keydown", handleLeaderboardViewKeydown);
elements.createGroup?.addEventListener("click", () => openGroupAction("create"));
elements.joinGroup?.addEventListener("click", () => openGroupAction("join"));
elements.homeCreateGroup?.addEventListener("click", () => openGroupAction("create"));
elements.homeJoinGroup?.addEventListener("click", () => openGroupAction("join"));
elements.homeAcceptInvite?.addEventListener("click", acceptPendingGroupInvite);
elements.groupForm?.addEventListener("submit", submitGroup);
elements.cancelGroup?.addEventListener("click", () => elements.groupDialog.close());
elements.groupDialog?.addEventListener("close", () => {
  elements.groupForm.reset();
  elements.groupDialogMessage.textContent = "";
});
elements.shareGroupInvite?.addEventListener("click", shareActiveGroupInvite);
elements.copyGroupInvite?.addEventListener("click", copyGroupInviteLink);
elements.shareGroupInviteNative?.addEventListener("click", shareGroupInviteNatively);
elements.closeGroupInvite?.addEventListener("click", () => {
  elements.groupInviteDialog.close();
});
elements.groupInviteDialog?.addEventListener("close", () => {
  elements.groupInviteLink.value = "";
  elements.groupInviteMessage.textContent = "";
  elements.copyGroupInvite.textContent = "Copy invite link";
});
elements.changeLeaderboardName.addEventListener("click", () => {
  elements.accountDialog.close();
  openLeaderboardNameDialog(false);
});
elements.cancelLeaderboardName.addEventListener("click", closeLeaderboardNameDialog);
elements.leaderboardNameDialog.addEventListener("cancel", () => {
  pendingPredictionSave = false;
});
elements.leaderboardNameDialog.addEventListener("close", () => {
  pendingPredictionSave = false;
  elements.leaderboardNameMessage.textContent = "";
});
elements.forgotPassword.addEventListener("click", (event) => {
  event.preventDefault();
  elements.forgotEmail.value = elements.loginEmail.value.trim();
  showAuthPanel("forgotPassword");
  elements.forgotEmail.focus();
});
elements.createAccount.addEventListener("click", (event) => {
  event.preventDefault();
  elements.createEmail.value = elements.loginEmail.value.trim();
  showAuthPanel("createAccount");
  elements.createEmail.focus();
});
elements.createAccountBack.addEventListener("click", () => showAuthPanel("signIn"));
elements.confirmAccountBack.addEventListener("click", () => showAuthPanel("signIn"));
elements.forgotPasswordBack.addEventListener("click", () => showAuthPanel("signIn"));
elements.resetPasswordBack.addEventListener("click", () => showAuthPanel("signIn"));
elements.resendConfirmation.addEventListener("click", resendConfirmationCode);
elements.openPrediction.addEventListener("click", () => openPrediction());
elements.closePublicBracket?.addEventListener("click", () => {
  elements.publicBracketDialog.close();
});
elements.publicBracketDialog?.addEventListener("close", () => {
  publicBracketRequest += 1;
  elements.publicBracketStatus.textContent = "";
  elements.publicBracketStatus.title = "";
  elements.publicBracketContent.innerHTML = "";
});
elements.headerAccount.addEventListener("click", () => {
  elements.accountDialog.showModal();
});
elements.closeAccountDialog.addEventListener("click", () => {
  elements.accountDialog.close();
});
elements.accountDialog.addEventListener("close", () => {
  if (!state.signedIn) pendingGroupAction = "";
});
elements.accountSignOut.addEventListener("click", signOut);
elements.deleteAccount.addEventListener("click", () => {
  elements.accountDialog.close();
  openDeleteAccountDialog();
});
elements.deleteAccountForm.addEventListener("submit", submitDeleteAccount);
elements.deleteAccountConfirmation.addEventListener(
  "input",
  updateDeleteAccountConfirmation,
);
elements.cancelDeleteAccount.addEventListener("click", () => {
  if (!deleteAccountPending) elements.deleteAccountDialog.close();
});
elements.deleteAccountDialog.addEventListener("cancel", (event) => {
  if (deleteAccountPending) event.preventDefault();
});
elements.deleteAccountDialog.addEventListener("close", resetDeleteAccountDialog);
window.addEventListener("pageshow", resetSignInButton);

async function initializeAuthentication() {
  if (!authIsConfigured()) {
    if (LEADERBOARD_PROFILE_PREVIEW) {
      renderAuthentication(true);
      state.userEmail = "preview@example.com";
      elements.accountEmail.textContent = state.userEmail;
      renderLeaderboardProfile();
      openLeaderboardNameDialog(true);
      elements.leaderboardNameMessage.textContent =
        "Preview only — saving is unavailable on the local static server.";
      return;
    }
    renderAuthentication(false);
    elements.signIn.disabled = true;
    elements.authMessage.textContent = LOCAL_PREVIEW
      ? "Authentication and saved predictions are unavailable in the local static preview."
      : "Authentication is not configured for this deployment.";
    return;
  }

  resetSignInButton();

  try {
    const accessToken = await getValidAccessToken();
    renderAuthentication(Boolean(accessToken));
    if (!accessToken) {
      showAuthPanel("signIn");
      return;
    }

    await refreshProfile();
    if (PAGE === "picks") {
      await refreshSavedPrediction();
      if (!loadAuthSession()) return;
      openPrediction(false);
    } else if (PAGE === "leaderboard") {
      await refreshGroups();
    }
  } catch (error) {
    clearAuthSession();
    renderAuthentication(false);
    showAuthPanel("signIn", error.message);
  }
}

if (PAGE === "picks") loadWinTotals();
if (elements.leaderboardBody) loadLeaderboard();
if (["home", "picks"].includes(PAGE)) initializePredictionWindow();
if (typeof renderHomeGroupInvite === "function") renderHomeGroupInvite();
initializeAuthentication();
