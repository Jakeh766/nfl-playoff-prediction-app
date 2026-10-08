const AUTH_SESSION_KEY = "road-to-bowl.auth.session";
const SIGN_IN_LABEL = "Sign in";
let signInPending = false;
let deleteAccountPending = false;
let deleteGroupPending = false;
let deleteGroupId = "";
let leaveGroupPending = false;
let leaveGroupId = "";
let pendingPredictionSave = false;
let publicBracketRequest = 0;
let groupDialogMode = "create";
let pendingGroupAction = "";
let pendingAccountCredentials = null;

function groupInviteFromUrl() {
  const value = new URLSearchParams(window.location.search).get("invite") || "";
  const [groupId, inviteCode, extra] = value.split(".");
  if (
    extra ||
    !/^[0-9a-f-]{36}$/.test(groupId || "") ||
    !/^[A-Za-z0-9_-]{32}$/.test(inviteCode || "")
  ) {
    return null;
  }
  return { groupId, inviteCode };
}

let pendingGroupInvite = groupInviteFromUrl();

function authConfig() {
  const config = window.AUTH_CONFIG || {};
  const region = String(config.region || "");
  return {
    clientId: String(config.clientId || ""),
    cognitoEndpoint: region
      ? `https://cognito-idp.${region}.amazonaws.com`
      : "",
  };
}

function authIsConfigured() {
  const config = authConfig();
  return Boolean(config.clientId && config.cognitoEndpoint);
}

function resetSignInButton() {
  signInPending = false;
  elements.signIn.disabled = !authIsConfigured();
  elements.signIn.removeAttribute("aria-busy");
  elements.signIn.textContent = SIGN_IN_LABEL;
}

function loadAuthSession() {
  try {
    const savedSession = localStorage.getItem(AUTH_SESSION_KEY);
    const legacySession = sessionStorage.getItem(AUTH_SESSION_KEY);
    const serializedSession = savedSession || legacySession;
    if (!serializedSession) return null;

    const session = JSON.parse(serializedSession);
    if (!savedSession && legacySession) {
      localStorage.setItem(AUTH_SESSION_KEY, legacySession);
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    }
    return session;
  } catch (error) {
    console.warn("Discarding an invalid authentication session.");
    localStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

function saveAuthSession(tokenResponse, previousSession = null) {
  const session = {
    accessToken: tokenResponse.access_token,
    idToken: tokenResponse.id_token || previousSession?.idToken || "",
    refreshToken:
      tokenResponse.refresh_token || previousSession?.refreshToken || "",
    expiresAt: Date.now() + Number(tokenResponse.expires_in || 3600) * 1000,
  };
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  return session;
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function decodeJwtPayload(token) {
  if (!token) return {};
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (error) {
    console.warn("Could not decode the Cognito token.");
    return {};
  }
}

async function requestCognito(operation, parameters) {
  const config = authConfig();
  if (!config.cognitoEndpoint || !config.clientId) {
    throw new Error("Authentication is not configured for this environment.");
  }
  const response = await fetch(config.cognitoEndpoint, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${operation}`,
    },
    body: JSON.stringify(parameters),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Never render a provider response that could echo credentials or tokens.
    const alreadyConfirmed = operation === "ResendConfirmationCode" &&
      /already\s+confirmed|confirmed\s+user/i.test(payload.message || "");
    const error = new Error(alreadyConfirmed
      ? "This account is already confirmed."
      : "Cognito rejected the request. Please try again.");
    error.code = String(payload.__type || "").split("#").at(-1);
    throw error;
  }
  return payload;
}

async function requestPasswordSignIn(username, password) {
  const config = authConfig();
  const payload = await requestCognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });
  if (!payload.AuthenticationResult) {
    throw new Error("This account requires an additional sign-in step.");
  }
  return payload.AuthenticationResult;
}

async function finishPasswordSignIn(email, password) {
  const authentication = await requestPasswordSignIn(email, password);
  saveAuthSession({
    access_token: authentication.AccessToken,
    id_token: authentication.IdToken,
    refresh_token: authentication.RefreshToken,
    expires_in: authentication.ExpiresIn,
  });
  pendingAccountCredentials = null;
  window.siteAnalytics?.track("sign_in");
  elements.loginPassword.value = "";
  elements.authMessage.textContent = "";
  renderAuthentication(true);
  if (PAGE !== "groups") refreshGroupMemberships().catch(() => {});
  closeAccountModal();

  await refreshProfile();
  if (PAGE === "picks") {
    await refreshSavedPrediction();
    if (loadAuthSession() && !state.bracketBuilt) openPrediction();
  } else if (PAGE === "groups") {
    await refreshGroups();
  }
  if (typeof resumePendingGroupAction === "function") {
    await resumePendingGroupAction();
  }
}

function signInErrorMessage(error) {
  if (["NotAuthorizedException", "UserNotFoundException"].includes(error.code)) {
    return "Incorrect email or password.";
  }
  if (error.code === "UserNotConfirmedException") {
    return "Confirm your email before signing in.";
  }
  if (error.code === "PasswordResetRequiredException") {
    return "Reset your password before signing in.";
  }
  if (error.code === "TooManyRequestsException") {
    return "Too many sign-in attempts. Wait a moment and try again.";
  }
  return error.message;
}

async function submitSignIn(event) {
  event.preventDefault();
  if (signInPending) return;

  if (!authIsConfigured()) {
    elements.authMessage.textContent =
      "Authentication is not configured for this environment.";
    return;
  }

  signInPending = true;
  elements.signIn.disabled = true;
  elements.signIn.setAttribute("aria-busy", "true");
  elements.signIn.textContent = "Signing in…";
  elements.authMessage.textContent = "Signing in securely…";

  const email = elements.loginEmail.value.trim();
  const password = elements.loginPassword.value;
  try {
    await finishPasswordSignIn(email, password);
  } catch (error) {
    console.error("Could not sign in with Cognito.");
    if (error.code === "UserNotConfirmedException") {
      pendingAccountCredentials = { email, password };
      elements.loginPassword.value = "";
      elements.confirmEmail.value = email;
      showAuthPanel(
        "confirmAccount",
        "Your account still needs verification. Enter your code, or select Resend code below for a new one.",
      );
      elements.confirmationCode.focus();
    } else {
      elements.authMessage.textContent = signInErrorMessage(error);
    }
  } finally {
    resetSignInButton();
  }
}

const authPanels = {
  signIn: elements.signedOutPanel,
  createAccount: elements.createAccountPanel,
  confirmAccount: elements.confirmAccountPanel,
  forgotPassword: elements.forgotPasswordPanel,
  resetPassword: elements.resetPasswordPanel,
};

function showAuthPanel(name, message = "") {
  Object.entries(authPanels).forEach(([panelName, panel]) => {
    panel.classList.toggle("hidden", panelName !== name);
    if (panelName !== name) resetPasswordVisibility(panel);
  });
  elements.authMessage.textContent = message;
}

function accountIsAlreadyConfirmed(error) {
  return (
    error.code === "InvalidParameterException" &&
    /already\s+confirmed|confirmed\s+user/i.test(error.message || "")
  );
}

async function requestConfirmationCode(email) {
  const config = authConfig();
  return requestCognito("ResendConfirmationCode", {
    ClientId: config.clientId,
    Username: email,
  });
}

function cognitoErrorMessage(error) {
  if (error.code === "UsernameExistsException") {
    return "An account already exists for that email.";
  }
  if (error.code === "CodeMismatchException") {
    return "That verification code is incorrect.";
  }
  if (error.code === "ExpiredCodeException") {
    return "That verification code expired. Request a new one.";
  }
  if (error.code === "InvalidPasswordException") {
    return "Choose a password that meets the requirements.";
  }
  if (["LimitExceededException", "TooManyRequestsException"].includes(error.code)) {
    return "Too many attempts. Wait a moment and try again.";
  }
  return error.message;
}

async function submitCreateAccount(event) {
  event.preventDefault();
  const email = elements.createEmail.value.trim();
  const password = elements.createPassword.value;
  elements.authMessage.textContent = "Creating your account…";

  try {
    const config = authConfig();
    const result = await requestCognito("SignUp", {
      ClientId: config.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    window.siteAnalytics?.track("account_created");
    pendingAccountCredentials = { email, password };
    elements.createPassword.value = "";
    elements.confirmEmail.value = email;
    if (result.UserConfirmed) {
      elements.loginEmail.value = email;
      showAuthPanel("signIn", "Account created. You can sign in now.");
      return;
    }
    showAuthPanel("confirmAccount", "Enter the verification code we emailed you.");
    elements.confirmationCode.focus();
  } catch (error) {
    if (error.code === "UsernameExistsException") {
      pendingAccountCredentials = null;
      elements.createPassword.value = "";
      elements.loginEmail.value = email;
      showAuthPanel(
        "signIn",
        "An account already exists for this email. Sign in, or use Forgot password if you need a new password.",
      );
      elements.loginPassword.focus();
      return;
    }
    elements.authMessage.textContent = cognitoErrorMessage(error);
  }
}

async function submitConfirmAccount(event) {
  event.preventDefault();
  const email = elements.confirmEmail.value.trim();
  elements.authMessage.textContent = "Confirming your account…";

  try {
    const config = authConfig();
    await requestCognito("ConfirmSignUp", {
      ClientId: config.clientId,
      Username: email,
      ConfirmationCode: elements.confirmationCode.value.trim(),
    });
  } catch (error) {
    elements.authMessage.textContent = cognitoErrorMessage(error);
    return;
  }

  elements.confirmationCode.value = "";
  elements.loginEmail.value = email;
  const credentials = pendingAccountCredentials;
  pendingAccountCredentials = null;
  if (!credentials || credentials.email !== email) {
    showAuthPanel("signIn", "Email confirmed. Sign in to continue.");
    elements.loginPassword.focus();
    return;
  }

  elements.authMessage.textContent = "Email confirmed. Signing you in…";
  try {
    await finishPasswordSignIn(credentials.email, credentials.password);
  } catch (error) {
    console.error("Could not sign in after confirming the account.");
    showAuthPanel(
      "signIn",
      `Email confirmed. ${signInErrorMessage(error)}`,
    );
    elements.loginPassword.focus();
  }
}

async function resendConfirmationCode() {
  const email = elements.confirmEmail.value.trim();
  if (!email) {
    elements.authMessage.textContent = "Enter your email address first.";
    elements.confirmEmail.focus();
    return;
  }

  try {
    await requestConfirmationCode(email);
    elements.authMessage.textContent = "A new verification code is on its way.";
  } catch (error) {
    if (accountIsAlreadyConfirmed(error)) {
      pendingAccountCredentials = null;
      elements.loginEmail.value = email;
      showAuthPanel(
        "signIn",
        "This account is already confirmed. Sign in, or use Forgot password if you need a new password.",
      );
      elements.loginPassword.focus();
    } else {
      elements.authMessage.textContent = cognitoErrorMessage(error);
    }
  }
}

async function submitForgotPassword(event) {
  event.preventDefault();
  const email = elements.forgotEmail.value.trim();
  elements.authMessage.textContent = "Sending your reset code…";

  try {
    const config = authConfig();
    await requestCognito("ForgotPassword", {
      ClientId: config.clientId,
      Username: email,
    });
    elements.resetEmail.value = email;
    showAuthPanel("resetPassword", "Enter the verification code we emailed you.");
    elements.resetCode.focus();
  } catch (error) {
    elements.authMessage.textContent = cognitoErrorMessage(error);
  }
}

async function submitResetPassword(event) {
  event.preventDefault();
  const email = elements.resetEmail.value.trim();
  elements.authMessage.textContent = "Saving your new password…";

  try {
    const config = authConfig();
    await requestCognito("ConfirmForgotPassword", {
      ClientId: config.clientId,
      Username: email,
      ConfirmationCode: elements.resetCode.value.trim(),
      Password: elements.resetPassword.value,
    });
    elements.resetCode.value = "";
    elements.resetPassword.value = "";
    elements.loginEmail.value = email;
    showAuthPanel("signIn", "Password updated. You can sign in now.");
    elements.loginPassword.focus();
  } catch (error) {
    elements.authMessage.textContent = cognitoErrorMessage(error);
  }
}

async function getValidAccessToken() {
  const session = loadAuthSession();
  if (!session?.accessToken) return null;
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  if (!session.refreshToken) {
    clearAuthSession();
    return null;
  }

  try {
    const config = authConfig();
    const tokenResponse = await requestCognito("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: config.clientId,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    const authentication = tokenResponse.AuthenticationResult;
    if (!authentication) throw new Error("Cognito did not refresh the session.");
    return saveAuthSession(
      {
        access_token: authentication.AccessToken,
        id_token: authentication.IdToken,
        expires_in: authentication.ExpiresIn,
      },
      session,
    ).accessToken;
  } catch (error) {
    console.warn("The Cognito session could not be refreshed.");
    clearAuthSession();
    return null;
  }
}

function currentUserEmail() {
  const session = loadAuthSession();
  return String(decodeJwtPayload(session?.idToken || "").email || "");
}

function renderLeaderboardProfile() {
  elements.signedInPanel?.classList.toggle("hidden", !state.signedIn);
  elements.accountLeaderboardName.textContent =
    state.leaderboardName || "Not set yet";
  elements.changeLeaderboardName.textContent = state.leaderboardName
    ? "Change leaderboard name"
    : "Choose leaderboard name";
  elements.savedSection?.classList.toggle("hidden", !state.signedIn);
}

function renderAuthentication(signedIn) {
  state.signedIn = signedIn;
  state.userEmail = signedIn ? currentUserEmail() : "";
  if (signedIn) {
    Object.values(authPanels).forEach((panel) => panel.classList.add("hidden"));
  } else if (
    Object.values(authPanels).every((panel) => panel.classList.contains("hidden"))
  ) {
    elements.signedOutPanel.classList.remove("hidden");
  }
  elements.accountAuthView.classList.toggle("hidden", signedIn);
  elements.accountSettingsView.classList.toggle("hidden", !signedIn);
  elements.headerAccount.textContent = signedIn ? "Account" : "Sign in";
  elements.accountEmail.textContent = state.userEmail;
  document.body.classList.toggle("signed-in", signedIn);
  if (typeof renderHomeGroupInvite === "function") renderHomeGroupInvite();

  if (!signedIn) {
    state.leaderboardName = "";
    pendingPredictionSave = false;
    state.savedPrediction = null;
    state.groups = [];
    state.groupsLoaded = false;
    groupMembershipRequest++;
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    state.groupSummaries = {};
    elements.savedSection?.classList.add("hidden");
  }
  renderLeaderboardProfile();
  if (!signedIn && typeof renderGroups === "function") renderGroups();
  updateGroupsNavigation();
}

async function refreshProfile() {
  try {
    const profile = await apiRequest("/api/profile");
    state.leaderboardName = profile.leaderboardName;
  } catch (error) {
    if (error.status === 404) {
      state.leaderboardName = "";
    } else {
      throw error;
    }
  }
  renderLeaderboardProfile();
}

async function submitLeaderboardName(event) {
  event.preventDefault();
  const previousName = state.leaderboardName;
  elements.saveLeaderboardName.disabled = true;
  elements.saveLeaderboardName.setAttribute("aria-busy", "true");
  elements.saveLeaderboardName.textContent = "Saving…";
  elements.leaderboardNameMessage.textContent =
    "Reserving your leaderboard name…";

  try {
    const profile = await apiRequest("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        leaderboardName: elements.leaderboardNameInput.value,
      }),
    });
    state.leaderboardName = profile.leaderboardName;
    const shouldSavePrediction = pendingPredictionSave;
    pendingPredictionSave = false;
    elements.leaderboardNameMessage.textContent = "";
    renderLeaderboardProfile();
    elements.leaderboardNameDialog.close();

    if (shouldSavePrediction) {
      await savePrediction();
    } else {
      showToast(
        previousName
          ? `Leaderboard name changed to ${state.leaderboardName}.`
          : `Leaderboard name set to ${state.leaderboardName}.`,
      );
      if (elements.leaderboardBody) await loadLeaderboard();
      if (PAGE === "groups" && state.activeGroupId) await loadGroupLeaderboard();
    }
  } catch (error) {
    elements.leaderboardNameMessage.textContent = error.message;
    elements.leaderboardNameInput.focus();
  } finally {
    elements.saveLeaderboardName.disabled = false;
    elements.saveLeaderboardName.removeAttribute("aria-busy");
    elements.saveLeaderboardName.textContent = "Save leaderboard name";
  }
}

function openLeaderboardNameDialog(forPredictionSave = false) {
  pendingPredictionSave = forPredictionSave;
  elements.leaderboardNameInput.value = state.leaderboardName;
  elements.leaderboardNameMessage.textContent = "";
  elements.saveLeaderboardName.textContent = forPredictionSave
    ? "Save and continue"
    : "Save name";
  elements.leaderboardNameDialog.showModal();
  elements.leaderboardNameInput.focus();
  if (state.leaderboardName) elements.leaderboardNameInput.select();
}

function closeLeaderboardNameDialog() {
  pendingPredictionSave = false;
  elements.leaderboardNameMessage.textContent = "";
  elements.leaderboardNameDialog.close();
}

async function signOut() {
  const session = loadAuthSession();
  closeAccountModal();
  clearAuthSession();
  renderAuthentication(false);
  showAuthPanel("signIn");

  if (session?.accessToken) {
    try {
      await requestCognito("GlobalSignOut", {
        AccessToken: session.accessToken,
      });
    } catch (error) {
      console.warn("The Cognito session could not be invalidated remotely.");
    }
  }
  // Attempt global sign-out first: revoking this grant can invalidate its access
  // token. Still revoke the refresh token when that access token has expired.
  if (session?.refreshToken) {
    try {
      await requestCognito("RevokeToken", {
        ClientId: authConfig().clientId,
        Token: session.refreshToken,
      });
    } catch (_error) {
      console.warn("The Cognito refresh token could not be revoked remotely.");
    }
  }
}

function resetDeleteAccountDialog() {
  deleteAccountPending = false;
  elements.deleteAccountConfirmation.value = "";
  elements.deleteAccountMessage.textContent = "";
  elements.confirmDeleteAccount.disabled = true;
  elements.confirmDeleteAccount.removeAttribute("aria-busy");
  elements.confirmDeleteAccount.textContent = "Permanently delete";
}

function openDeleteAccountDialog() {
  resetDeleteAccountDialog();
  elements.deleteAccountDialog.showModal();
  elements.deleteAccountConfirmation.focus();
}

function updateDeleteAccountConfirmation() {
  elements.confirmDeleteAccount.disabled =
    deleteAccountPending || elements.deleteAccountConfirmation.value !== "DELETE";
}

async function submitDeleteAccount(event) {
  event.preventDefault();
  if (deleteAccountPending || elements.deleteAccountConfirmation.value !== "DELETE") {
    return;
  }

  deleteAccountPending = true;
  elements.confirmDeleteAccount.disabled = true;
  elements.confirmDeleteAccount.setAttribute("aria-busy", "true");
  elements.confirmDeleteAccount.textContent = "Deleting…";
  elements.deleteAccountMessage.textContent =
    "Deleting your saved bracket, group memberships, leaderboard profile, and account…";

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) throw new Error("Your session expired. Please sign in again.");

    // The profile endpoint checks commissioner roles across both sports before
    // removing memberships, predictions, and the profile.
    await apiRequest("/api/profile", { method: "DELETE" });
    await requestCognito("DeleteUser", { AccessToken: accessToken });
    window.siteAnalytics?.track("account_deleted");

    clearAuthSession();
    state.savedPrediction = null;
    state.savedAt = null;
    elements.deleteAccountDialog.close();
    renderAuthentication(false);
    showAuthPanel(
      "signIn",
      "Your account, group memberships, leaderboard name, and saved bracket were permanently deleted.",
    );
  } catch (error) {
    elements.deleteAccountMessage.textContent = `Could not delete your account: ${error.message}`;
  } finally {
    deleteAccountPending = false;
    elements.confirmDeleteAccount.removeAttribute("aria-busy");
    elements.confirmDeleteAccount.textContent = "Permanently delete";
    updateDeleteAccountConfirmation();
  }
}
