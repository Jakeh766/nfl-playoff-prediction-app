const TEAMS = {
  AFC: [
    "Baltimore Ravens",
    "Buffalo Bills",
    "Cincinnati Bengals",
    "Cleveland Browns",
    "Denver Broncos",
    "Houston Texans",
    "Indianapolis Colts",
    "Jacksonville Jaguars",
    "Kansas City Chiefs",
    "Las Vegas Raiders",
    "Los Angeles Chargers",
    "Miami Dolphins",
    "New England Patriots",
    "New York Jets",
    "Pittsburgh Steelers",
    "Tennessee Titans",
  ],
  NFC: [
    "Arizona Cardinals",
    "Atlanta Falcons",
    "Carolina Panthers",
    "Chicago Bears",
    "Dallas Cowboys",
    "Detroit Lions",
    "Green Bay Packers",
    "Los Angeles Rams",
    "Minnesota Vikings",
    "New Orleans Saints",
    "New York Giants",
    "Philadelphia Eagles",
    "San Francisco 49ers",
    "Seattle Seahawks",
    "Tampa Bay Buccaneers",
    "Washington Commanders",
  ],
};

const LOCAL_PREVIEW =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const TEST_MODE =
  window.AUTH_CONFIG?.environment === "dev" || LOCAL_PREVIEW;
const LEADERBOARD_PROFILE_PREVIEW =
  LOCAL_PREVIEW &&
  new URLSearchParams(window.location.search).get("preview") ===
    "leaderboard-name";

const TEAM_DIVISIONS = {
  "Baltimore Ravens": "AFC North",
  "Buffalo Bills": "AFC East",
  "Cincinnati Bengals": "AFC North",
  "Cleveland Browns": "AFC North",
  "Denver Broncos": "AFC West",
  "Houston Texans": "AFC South",
  "Indianapolis Colts": "AFC South",
  "Jacksonville Jaguars": "AFC South",
  "Kansas City Chiefs": "AFC West",
  "Las Vegas Raiders": "AFC West",
  "Los Angeles Chargers": "AFC West",
  "Miami Dolphins": "AFC East",
  "New England Patriots": "AFC East",
  "New York Jets": "AFC East",
  "Pittsburgh Steelers": "AFC North",
  "Tennessee Titans": "AFC South",
  "Arizona Cardinals": "NFC West",
  "Atlanta Falcons": "NFC South",
  "Carolina Panthers": "NFC South",
  "Chicago Bears": "NFC North",
  "Dallas Cowboys": "NFC East",
  "Detroit Lions": "NFC North",
  "Green Bay Packers": "NFC North",
  "Los Angeles Rams": "NFC West",
  "Minnesota Vikings": "NFC North",
  "New Orleans Saints": "NFC South",
  "New York Giants": "NFC East",
  "Philadelphia Eagles": "NFC East",
  "San Francisco 49ers": "NFC West",
  "Seattle Seahawks": "NFC West",
  "Tampa Bay Buccaneers": "NFC South",
  "Washington Commanders": "NFC East",
};

const DIVISION_ORDER = ["North", "South", "East", "West"];

const DIVISION_TEAMS = {
  AFC: {
    North: ["Baltimore Ravens", "Cincinnati Bengals", "Cleveland Browns", "Pittsburgh Steelers"],
    South: ["Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Tennessee Titans"],
    East: ["Buffalo Bills", "Miami Dolphins", "New England Patriots", "New York Jets"],
    West: ["Kansas City Chiefs", "Los Angeles Chargers", "Denver Broncos", "Las Vegas Raiders"],
  },
  NFC: {
    North: ["Minnesota Vikings", "Green Bay Packers", "Chicago Bears", "Detroit Lions"],
    South: ["Tampa Bay Buccaneers", "Atlanta Falcons", "New Orleans Saints", "Carolina Panthers"],
    East: ["Philadelphia Eagles", "Dallas Cowboys", "Washington Commanders", "New York Giants"],
    West: ["San Francisco 49ers", "Los Angeles Rams", "Seattle Seahawks", "Arizona Cardinals"],
  },
};

const TEAM_LOGO_CODES = {
  "Arizona Cardinals": "ari",
  "Atlanta Falcons": "atl",
  "Baltimore Ravens": "bal",
  "Buffalo Bills": "buf",
  "Carolina Panthers": "car",
  "Chicago Bears": "chi",
  "Cincinnati Bengals": "cin",
  "Cleveland Browns": "cle",
  "Dallas Cowboys": "dal",
  "Denver Broncos": "den",
  "Detroit Lions": "det",
  "Green Bay Packers": "gb",
  "Houston Texans": "hou",
  "Indianapolis Colts": "ind",
  "Jacksonville Jaguars": "jax",
  "Kansas City Chiefs": "kc",
  "Las Vegas Raiders": "lv",
  "Los Angeles Chargers": "lac",
  "Los Angeles Rams": "lar",
  "Miami Dolphins": "mia",
  "Minnesota Vikings": "min",
  "New England Patriots": "ne",
  "New Orleans Saints": "no",
  "New York Giants": "nyg",
  "New York Jets": "nyj",
  "Philadelphia Eagles": "phi",
  "Pittsburgh Steelers": "pit",
  "San Francisco 49ers": "sf",
  "Seattle Seahawks": "sea",
  "Tampa Bay Buccaneers": "tb",
  "Tennessee Titans": "ten",
  "Washington Commanders": "wsh",
};

const FALLBACK_WIN_TOTALS = {
  "Arizona Cardinals": 4.5,
  "Atlanta Falcons": 7.5,
  "Baltimore Ravens": 11.5,
  "Buffalo Bills": 10.5,
  "Carolina Panthers": 7.5,
  "Chicago Bears": 9.5,
  "Cincinnati Bengals": 8.5,
  "Cleveland Browns": 6.5,
  "Dallas Cowboys": 8.5,
  "Denver Broncos": 9.5,
  "Detroit Lions": 10.5,
  "Green Bay Packers": 10.5,
  "Houston Texans": 9.5,
  "Indianapolis Colts": 7.5,
  "Jacksonville Jaguars": 8.5,
  "Kansas City Chiefs": 10.5,
  "Las Vegas Raiders": 6.5,
  "Los Angeles Chargers": 10.5,
  "Los Angeles Rams": 11.5,
  "Miami Dolphins": 4.5,
  "Minnesota Vikings": 7.5,
  "New England Patriots": 9.5,
  "New Orleans Saints": 6.5,
  "New York Giants": 7.5,
  "New York Jets": 5.5,
  "Philadelphia Eagles": 10.5,
  "Pittsburgh Steelers": 8.5,
  "San Francisco 49ers": 10.5,
  "Seattle Seahawks": 11.5,
  "Tampa Bay Buccaneers": 8.5,
  "Tennessee Titans": 6.5,
  "Washington Commanders": 7.5,
};

function createEmptyDivisionWinners() {
  return {
    AFC: { North: "", South: "", East: "", West: "" },
    NFC: { North: "", South: "", East: "", West: "" },
  };
}

const state = {
  signedIn: false,
  userEmail: "",
  leaderboardName: "",
  winTotals: { ...FALLBACK_WIN_TOTALS },
  oddsSource: "2026 sportsbook snapshot",
  divisionWinners: createEmptyDivisionWinners(),
  seeds: { AFC: Array(7).fill(""), NFC: Array(7).fill("") },
  picks: { AFC: {}, NFC: {}, superBowl: "" },
  bracketBuilt: false,
  savedAt: null,
  savedPrediction: null,
  leaderboard: null,
  leaderboardView: "public",
  groups: [],
  activeGroupId: "",
  groupLeaderboard: null,
};

const elements = {
  signedOutPanel: document.querySelector("#signed-out-panel"),
  signedInPanel: document.querySelector("#signed-in-panel"),
  signInForm: document.querySelector("#sign-in-form"),
  signIn: document.querySelector("#sign-in"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  forgotPassword: document.querySelector("#forgot-password"),
  createAccount: document.querySelector("#create-account"),
  createAccountPanel: document.querySelector("#create-account-panel"),
  createAccountForm: document.querySelector("#create-account-form"),
  createEmail: document.querySelector("#create-email"),
  createPassword: document.querySelector("#create-password"),
  createAccountBack: document.querySelector("#create-account-back"),
  confirmAccountPanel: document.querySelector("#confirm-account-panel"),
  confirmAccountForm: document.querySelector("#confirm-account-form"),
  confirmEmail: document.querySelector("#confirm-email"),
  confirmationCode: document.querySelector("#confirmation-code"),
  resendConfirmation: document.querySelector("#resend-confirmation"),
  confirmAccountBack: document.querySelector("#confirm-account-back"),
  forgotPasswordPanel: document.querySelector("#forgot-password-panel"),
  forgotPasswordForm: document.querySelector("#forgot-password-form"),
  forgotEmail: document.querySelector("#forgot-email"),
  forgotPasswordBack: document.querySelector("#forgot-password-back"),
  resetPasswordPanel: document.querySelector("#reset-password-panel"),
  resetPasswordForm: document.querySelector("#reset-password-form"),
  resetEmail: document.querySelector("#reset-email"),
  resetCode: document.querySelector("#reset-code"),
  resetPassword: document.querySelector("#reset-password"),
  resetPasswordBack: document.querySelector("#reset-password-back"),
  leaderboardNameDialog: document.querySelector("#leaderboard-name-dialog"),
  leaderboardNameForm: document.querySelector("#leaderboard-name-form"),
  leaderboardNameInput: document.querySelector("#leaderboard-name"),
  saveLeaderboardName: document.querySelector("#save-leaderboard-name"),
  cancelLeaderboardName: document.querySelector("#cancel-leaderboard-name"),
  leaderboardNameMessage: document.querySelector("#leaderboard-name-message"),
  changeLeaderboardName: document.querySelector("#change-leaderboard-name"),
  openPrediction: document.querySelector("#open-prediction"),
  deleteAccount: document.querySelector("#delete-account"),
  deleteAccountDialog: document.querySelector("#delete-account-dialog"),
  deleteAccountForm: document.querySelector("#delete-account-form"),
  deleteAccountConfirmation: document.querySelector("#delete-account-confirmation"),
  deleteAccountMessage: document.querySelector("#delete-account-message"),
  cancelDeleteAccount: document.querySelector("#cancel-delete-account"),
  confirmDeleteAccount: document.querySelector("#confirm-delete-account"),
  authMessage: document.querySelector("#auth-message"),
  headerAccount: document.querySelector("#header-account"),
  accountDialog: document.querySelector("#account-dialog"),
  accountLeaderboardName: document.querySelector("#account-leaderboard-name"),
  accountEmail: document.querySelector("#account-email"),
  closeAccountDialog: document.querySelector("#close-account-dialog"),
  accountSignOut: document.querySelector("#account-sign-out"),
  predictor: document.querySelector("#predictor"),
  oddsStatus: document.querySelector("#odds-status"),
  afcSeeds: document.querySelector("#afc-seeds"),
  nfcSeeds: document.querySelector("#nfc-seeds"),
  seedingMessage: document.querySelector("#seeding-message"),
  randomizeBracket: document.querySelector("#randomize-bracket"),
  buildBracket: document.querySelector("#build-bracket"),
  bracketSection: document.querySelector("#bracket-section"),
  afcBracket: document.querySelector("#afc-bracket"),
  nfcBracket: document.querySelector("#nfc-bracket"),
  superBowlStatus: document.querySelector("#super-bowl-status"),
  superBowlGame: document.querySelector("#super-bowl-game"),
  championDisplay: document.querySelector("#champion-display"),
  savePrediction: document.querySelector("#save-prediction"),
  resetPicks: document.querySelector("#reset-picks"),
  saveState: document.querySelector("#save-state"),
  savedSection: document.querySelector("#saved-section"),
  savedGrid: document.querySelector("#saved-grid"),
  emptyLocker: document.querySelector("#empty-locker"),
  publicLeaderboardTab: document.querySelector("#public-leaderboard-tab"),
  groupsLeaderboardTab: document.querySelector("#groups-leaderboard-tab"),
  publicLeaderboardPanel: document.querySelector("#public-leaderboard-panel"),
  groupsLeaderboardPanel: document.querySelector("#groups-leaderboard-panel"),
  groupTabs: document.querySelector("#group-tabs"),
  emptyGroups: document.querySelector("#empty-groups"),
  groupLeaderboard: document.querySelector("#group-leaderboard"),
  activeGroupName: document.querySelector("#active-group-name"),
  groupLeaderboardStatus: document.querySelector("#group-leaderboard-status"),
  groupLeaderboardTableShell: document.querySelector("#group-leaderboard-table-shell"),
  groupLeaderboardBody: document.querySelector("#group-leaderboard-body"),
  emptyGroupLeaderboard: document.querySelector("#empty-group-leaderboard"),
  createGroup: document.querySelector("#create-group"),
  joinGroup: document.querySelector("#join-group"),
  groupDialog: document.querySelector("#group-dialog"),
  groupForm: document.querySelector("#group-form"),
  groupDialogKicker: document.querySelector("#group-dialog-kicker"),
  groupDialogTitle: document.querySelector("#group-dialog-title"),
  groupDialogDescription: document.querySelector("#group-dialog-description"),
  groupName: document.querySelector("#group-name"),
  groupPassword: document.querySelector("#group-password"),
  groupDialogMessage: document.querySelector("#group-dialog-message"),
  cancelGroup: document.querySelector("#cancel-group"),
  submitGroup: document.querySelector("#submit-group"),
  leaderboardStatus: document.querySelector("#leaderboard-status"),
  leaderboardTableShell: document.querySelector("#leaderboard-table-shell"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  emptyLeaderboard: document.querySelector("#empty-leaderboard"),
  publicBracketDialog: document.querySelector("#public-bracket-dialog"),
  publicBracketTitle: document.querySelector("#public-bracket-title"),
  publicBracketStatus: document.querySelector("#public-bracket-status"),
  publicBracketContent: document.querySelector("#public-bracket-content"),
  closePublicBracket: document.querySelector("#close-public-bracket"),
  toast: document.querySelector("#toast"),
};

if (!TEST_MODE) {
  elements.randomizeBracket.classList.add("hidden");
}

function createEmptyPicks() {
  return { AFC: {}, NFC: {}, superBowl: "" };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const AUTH_SESSION_KEY = "road-to-bowl.auth.session";
const SIGN_IN_LABEL = "Sign in";
let signInPending = false;
let deleteAccountPending = false;
let pendingPredictionSave = false;
let publicBracketRequest = 0;
let groupDialogMode = "create";

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
    return JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || "null");
  } catch (error) {
    console.warn("Discarding an invalid authentication session.", error);
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
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearAuthSession() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function decodeJwtPayload(token) {
  if (!token) return {};
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (error) {
    console.warn("Could not decode the Cognito token.", error);
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
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${operation}`,
    },
    body: JSON.stringify(parameters),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Cognito rejected the request.");
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

  try {
    const authentication = await requestPasswordSignIn(
      elements.loginEmail.value.trim(),
      elements.loginPassword.value,
    );
    saveAuthSession({
      access_token: authentication.AccessToken,
      id_token: authentication.IdToken,
      refresh_token: authentication.RefreshToken,
      expires_in: authentication.ExpiresIn,
    });
    elements.loginPassword.value = "";
    elements.authMessage.textContent = "";
    renderAuthentication(true);
    await refreshProfile();
    await refreshSavedPrediction();
    if (loadAuthSession()) openPrediction();
  } catch (error) {
    console.error("Could not sign in with Cognito.", error);
    if (error.code === "UserNotConfirmedException") {
      elements.confirmEmail.value = elements.loginEmail.value.trim();
      showAuthPanel("confirmAccount", "Confirm your email before signing in.");
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
  });
  elements.authMessage.textContent = message;
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
  elements.authMessage.textContent = "Creating your account…";

  try {
    const config = authConfig();
    const result = await requestCognito("SignUp", {
      ClientId: config.clientId,
      Username: email,
      Password: elements.createPassword.value,
      UserAttributes: [{ Name: "email", Value: email }],
    });
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
    elements.confirmationCode.value = "";
    elements.loginEmail.value = email;
    showAuthPanel("signIn", "Email confirmed. You can sign in now.");
    elements.loginPassword.focus();
  } catch (error) {
    elements.authMessage.textContent = cognitoErrorMessage(error);
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
    const config = authConfig();
    await requestCognito("ResendConfirmationCode", {
      ClientId: config.clientId,
      Username: email,
    });
    elements.authMessage.textContent = "A new verification code is on its way.";
  } catch (error) {
    elements.authMessage.textContent = cognitoErrorMessage(error);
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
    console.warn("The Cognito session could not be refreshed.", error);
    clearAuthSession();
    return null;
  }
}

function currentUserEmail() {
  const session = loadAuthSession();
  return String(decodeJwtPayload(session?.idToken || "").email || "");
}

function renderLeaderboardView(view = state.leaderboardView) {
  const nextView = view === "groups" && state.signedIn ? "groups" : "public";
  const publicActive = nextView === "public";
  state.leaderboardView = nextView;

  elements.groupsLeaderboardTab.classList.toggle("hidden", !state.signedIn);
  elements.publicLeaderboardTab.classList.toggle("active", publicActive);
  elements.publicLeaderboardTab.setAttribute("aria-selected", String(publicActive));
  elements.publicLeaderboardTab.tabIndex = publicActive ? 0 : -1;
  elements.groupsLeaderboardTab.classList.toggle("active", !publicActive);
  elements.groupsLeaderboardTab.setAttribute("aria-selected", String(!publicActive));
  elements.groupsLeaderboardTab.tabIndex = publicActive ? -1 : 0;
  elements.publicLeaderboardPanel.classList.toggle("hidden", !publicActive);
  elements.groupsLeaderboardPanel.classList.toggle("hidden", publicActive);
}

function handleLeaderboardViewKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const view = event.key === "ArrowLeft" || event.key === "Home" ? "public" : "groups";
  renderLeaderboardView(view);
  (state.leaderboardView === "public"
    ? elements.publicLeaderboardTab
    : elements.groupsLeaderboardTab
  ).focus();
}

function renderLeaderboardProfile() {
  elements.signedInPanel.classList.toggle("hidden", !state.signedIn);
  elements.accountLeaderboardName.textContent =
    state.leaderboardName || "Not set yet";
  elements.changeLeaderboardName.textContent = state.leaderboardName
    ? "Change leaderboard name"
    : "Choose leaderboard name";
  elements.savedSection.classList.toggle("hidden", !state.signedIn);
  renderLeaderboardView();
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
  elements.headerAccount.classList.toggle("hidden", !signedIn);
  elements.accountEmail.textContent = state.userEmail;
  document.body.classList.toggle("signed-in", signedIn);

  if (!signedIn) {
    state.leaderboardName = "";
    pendingPredictionSave = false;
    state.savedPrediction = null;
    state.leaderboardView = "public";
    state.groups = [];
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    elements.predictor.classList.add("hidden");
    elements.savedSection.classList.add("hidden");
  }
  renderLeaderboardProfile();
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
      await loadLeaderboard();
      if (state.activeGroupId) await loadGroupLeaderboard();
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
  if (elements.accountDialog.open) elements.accountDialog.close();
  clearAuthSession();
  renderAuthentication(false);
  showAuthPanel("signIn");

  if (session?.accessToken) {
    try {
      await requestCognito("GlobalSignOut", {
        AccessToken: session.accessToken,
      });
    } catch (error) {
      console.warn("The Cognito session could not be invalidated remotely.", error);
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

    await apiRequest("/api/prediction", { method: "DELETE" });
    await apiRequest("/api/profile", { method: "DELETE" });
    await requestCognito("DeleteUser", { AccessToken: accessToken });

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

async function apiRequest(path, options = {}) {
  const protectedRequest =
    ["/api/prediction", "/api/profile"].includes(path) ||
    path.startsWith("/api/groups");
  const accessToken = protectedRequest ? await getValidAccessToken() : null;
  if (protectedRequest && !accessToken) {
    renderAuthentication(false);
    const error = new Error("Your session expired. Please sign in again.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || "The prediction service is unavailable.",
    );
    error.status = response.status;
    if (response.status === 401 && protectedRequest) {
      clearAuthSession();
      renderAuthentication(false);
    }
    throw error;
  }
  return payload;
}

async function refreshSavedPrediction() {
  try {
    state.savedPrediction = await apiRequest("/api/prediction");
  } catch (error) {
    if (error.status === 404) {
      state.savedPrediction = null;
    } else {
      elements.emptyLocker.classList.remove("hidden");
      elements.emptyLocker.textContent =
        "Your saved bracket could not be loaded. Please refresh and try again.";
      elements.emptyLocker.title = error.message;
    }
  }
  renderSavedPrediction();
}

function publicSeedTeam(bracket, conference, seed) {
  const name = bracket.seeds?.[conference]?.[seed - 1];
  return name ? { name, seed } : null;
}

function getPublicConferenceGames(bracket, conference) {
  const picks = bracket.picks?.[conference] || {};
  const seed = (number) => publicSeedTeam(bracket, conference, number);
  const wildCard = [
    { id: "wc-2-7", title: "Wild Card · 2 vs 7", teams: [seed(2), seed(7)] },
    { id: "wc-3-6", title: "Wild Card · 3 vs 6", teams: [seed(3), seed(6)] },
    { id: "wc-4-5", title: "Wild Card · 4 vs 5", teams: [seed(4), seed(5)] },
  ];
  const wildCardWinners = wildCard.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const remaining = [seed(1), ...wildCardWinners]
    .filter(Boolean)
    .sort((a, b) => a.seed - b.seed);
  const divisional = remaining.length === 4
    ? [
        {
          id: "div-1",
          title: "Divisional · High vs Low",
          teams: [remaining[0], remaining[3]],
        },
        {
          id: "div-2",
          title: "Divisional",
          teams: [remaining[1], remaining[2]],
        },
      ]
    : [
        { id: "div-1", title: "Divisional · High vs Low", teams: [seed(1), null] },
        { id: "div-2", title: "Divisional", teams: [null, null] },
      ];
  const divisionalWinners = divisional.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const championship = [
    {
      id: "conf",
      title: `${conference} Championship`,
      teams: divisionalWinners,
    },
  ];
  return { wildCard, divisional, championship };
}

function createPublicTeamPick(team, selected) {
  const row = document.createElement("div");
  row.className = "public-team-pick";
  row.classList.toggle("selected", Boolean(team && team.name === selected));

  const seed = document.createElement("span");
  seed.className = "team-seed";
  seed.textContent = team?.seed || "—";

  const logo = team
    ? createTeamLogo(team.name, "bracket-team-logo")
    : document.createElement("span");
  if (!team) logo.className = "bracket-logo-placeholder";

  const name = document.createElement("strong");
  name.className = "team-name";
  name.textContent = team?.name || "TBD";

  const check = document.createElement("span");
  check.className = "pick-check";
  check.textContent = team?.name === selected ? "✓" : "";
  row.append(seed, logo, name, check);
  return row;
}

function createPublicGameCard(conference, game, bracket) {
  const card = document.createElement("article");
  card.className = "game-card public-game-card";
  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = game.title;
  card.appendChild(title);
  const selected = bracket.picks?.[conference]?.[game.id] || "";
  game.teams.forEach((team) => {
    card.appendChild(createPublicTeamPick(team, selected));
  });
  return card;
}

function createPublicConferenceBracket(conference, bracket) {
  const section = document.createElement("section");
  section.className = "public-bracket-conference";

  const heading = document.createElement("div");
  heading.className = `bracket-conference-label ${conference.toLowerCase()}-label`;
  const logo = document.createElement("img");
  logo.className = "bracket-conference-logo";
  logo.src = `https://a.espncdn.com/i/teamlogos/nfl/500/${conference.toLowerCase()}.png`;
  logo.alt = `${conference} logo`;
  const label = document.createElement("span");
  label.textContent = conference;
  heading.append(logo, label);

  const rounds = document.createElement("div");
  rounds.className = "public-bracket-rounds";
  const games = getPublicConferenceGames(bracket, conference);
  [
    { key: "wildCard", label: "Wild Card" },
    { key: "divisional", label: "Divisional" },
    { key: "championship", label: `${conference} Champion` },
  ].forEach(({ key, label: roundLabel }) => {
    const round = document.createElement("div");
    round.className = "public-bracket-round";
    const title = document.createElement("div");
    title.className = "round-label";
    title.textContent = roundLabel;
    round.appendChild(title);
    games[key].forEach((game) => {
      round.appendChild(createPublicGameCard(conference, game, bracket));
    });
    rounds.appendChild(round);
  });

  section.append(heading, rounds);
  return section;
}

function renderPublicBracket(bracket) {
  elements.publicBracketContent.innerHTML = "";
  const score = bracket.score || {};
  const savedAt = bracket.savedAt
    ? ` · Saved ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(bracket.savedAt))}`
    : "";
  elements.publicBracketStatus.textContent =
    `${score.total ?? 0} / ${score.maximum ?? 302} points${savedAt}`;

  const conferences = document.createElement("div");
  conferences.className = "public-bracket-grid";
  conferences.append(
    createPublicConferenceBracket("AFC", bracket),
    createPublicConferenceBracket("NFC", bracket),
  );

  const champion = document.createElement("section");
  champion.className = "public-champion";
  const kicker = document.createElement("p");
  kicker.className = "card-kicker";
  kicker.textContent = "SUPER BOWL CHAMPION";
  const championName = bracket.picks?.superBowl || "No champion selected";
  champion.appendChild(kicker);
  if (bracket.picks?.superBowl) {
    champion.appendChild(createTeamLogo(championName, "champion-logo"));
  }
  const name = document.createElement("strong");
  name.textContent = championName;
  champion.appendChild(name);
  elements.publicBracketContent.append(conferences, champion);
}

async function openPublicBracket(entry) {
  const requestId = ++publicBracketRequest;
  elements.publicBracketTitle.textContent = `${entry.leaderboardName}'s bracket.`;
  elements.publicBracketStatus.textContent = "Loading saved bracket…";
  elements.publicBracketContent.innerHTML = "";
  elements.publicBracketDialog.showModal();

  try {
    const bracket = entry.bracket || await apiRequest(
      `/api/leaderboard/${encodeURIComponent(entry.leaderboardName)}/bracket`,
    );
    if (
      !elements.publicBracketDialog.open ||
      requestId !== publicBracketRequest
    ) {
      return;
    }
    renderPublicBracket(bracket);
  } catch (error) {
    if (requestId !== publicBracketRequest) return;
    elements.publicBracketStatus.textContent =
      "This bracket could not be loaded. Please try again.";
    elements.publicBracketStatus.title = error.message;
  }
}

function renderLeaderboardRows(body, entries) {
  body.innerHTML = "";
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    const rank = document.createElement("td");
    rank.className = "leaderboard-rank";
    rank.textContent = entry.rank <= 3
      ? ["🥇", "🥈", "🥉"][entry.rank - 1]
      : String(entry.rank);
    rank.setAttribute("aria-label", `Rank ${entry.rank}`);

    const player = document.createElement("th");
    player.scope = "row";
    const playerButton = document.createElement("button");
    playerButton.className = "leaderboard-player-button";
    playerButton.type = "button";
    const playerName = document.createElement("strong");
    playerName.textContent = entry.leaderboardName;
    const viewLabel = document.createElement("span");
    viewLabel.textContent = "View bracket";
    playerButton.append(playerName, viewLabel);
    playerButton.addEventListener("click", () => openPublicBracket(entry));
    player.appendChild(playerButton);

    const regularSeason = document.createElement("td");
    regularSeason.textContent = entry.regularSeason;
    const playoffs = document.createElement("td");
    playoffs.textContent = entry.playoffs;
    const total = document.createElement("td");
    total.className = "leaderboard-total";
    total.textContent = entry.total;

    row.append(rank, player, regularSeason, playoffs, total);
    body.appendChild(row);
  });
}

function renderLeaderboard() {
  const leaderboard = state.leaderboard;
  const entries = leaderboard?.entries || [];
  elements.leaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  renderLeaderboardRows(elements.leaderboardBody, entries);

  if (leaderboard) elements.leaderboardStatus.textContent = leaderboard.status;
}

function createPreviewPublicBracket(leaderboardName, variant = 0) {
  const rotate = (teams, amount) => {
    const shift = amount % teams.length;
    return [...teams.slice(shift), ...teams.slice(0, shift)];
  };
  const afc = rotate([
    "Kansas City Chiefs",
    "Buffalo Bills",
    "Baltimore Ravens",
    "Houston Texans",
    "Los Angeles Chargers",
    "Cincinnati Bengals",
    "Miami Dolphins",
  ], variant);
  const nfc = rotate([
    "Philadelphia Eagles",
    "Detroit Lions",
    "Los Angeles Rams",
    "Tampa Bay Buccaneers",
    "Green Bay Packers",
    "Minnesota Vikings",
    "Seattle Seahawks",
  ], variant * 2);
  const conferencePicks = (seeds) => ({
    "wc-2-7": seeds[1],
    "wc-3-6": seeds[2],
    "wc-4-5": seeds[3],
    "div-1": seeds[0],
    "div-2": seeds[1],
    conf: seeds[0],
  });
  return {
    leaderboardName,
    savedAt: Date.UTC(2026, 7, 28, 12) - variant * 60_000,
    seeds: { AFC: afc, NFC: nfc },
    picks: {
      AFC: conferencePicks(afc),
      NFC: conferencePicks(nfc),
      superBowl: variant % 2 ? nfc[0] : afc[0],
    },
    bracketBuilt: true,
    score: {
      status: "Preseason — scoring has not started",
      regularSeason: 0,
      playoffs: 0,
      total: 0,
      possible: 0,
      maximum: 302,
    },
  };
}

async function loadLeaderboard() {
  try {
    state.leaderboard = await apiRequest("/api/leaderboard");
  } catch (error) {
    if (LOCAL_PREVIEW) {
      state.leaderboard = {
        status: "Preseason — scoring has not started",
        entries: [
          { rank: 1, leaderboardName: "Gridiron Jake", regularSeason: 0, playoffs: 0, total: 0 },
          { rank: 1, leaderboardName: "Sunday Sam", regularSeason: 0, playoffs: 0, total: 0 },
          { rank: 1, leaderboardName: "Fourth Down Alex", regularSeason: 0, playoffs: 0, total: 0 },
        ],
      };
      state.leaderboard.entries.forEach((entry, index) => {
        entry.bracket = createPreviewPublicBracket(entry.leaderboardName, index);
      });
    } else {
      state.leaderboard = null;
      elements.leaderboardStatus.textContent =
        "The leaderboard could not be loaded. Please refresh and try again.";
      elements.emptyLeaderboard.classList.add("hidden");
      elements.leaderboardTableShell.classList.add("hidden");
      elements.leaderboardStatus.title = error.message;
      return;
    }
  }
  renderLeaderboard();
}

function renderGroups() {
  const activeGroup = state.groups.find(
    (group) => group.groupId === state.activeGroupId,
  );
  elements.groupTabs.innerHTML = "";
  elements.emptyGroups.classList.toggle("hidden", Boolean(state.groups.length));
  elements.groupLeaderboard.classList.toggle("hidden", !activeGroup);

  state.groups.forEach((group) => {
    const button = document.createElement("button");
    button.className = "group-tab";
    button.type = "button";
    button.textContent = group.groupName;
    button.classList.toggle("active", group.groupId === state.activeGroupId);
    button.setAttribute(
      "aria-pressed",
      String(group.groupId === state.activeGroupId),
    );
    button.addEventListener("click", () => {
      if (state.activeGroupId === group.groupId) return;
      state.activeGroupId = group.groupId;
      state.groupLeaderboard = null;
      renderGroups();
      loadGroupLeaderboard(group.groupId);
    });
    elements.groupTabs.appendChild(button);
  });

  if (activeGroup) elements.activeGroupName.textContent = activeGroup.groupName;
}

function renderGroupLeaderboard() {
  const leaderboard = state.groupLeaderboard;
  const entries = leaderboard?.entries || [];
  elements.groupLeaderboardTableShell.classList.toggle("hidden", !entries.length);
  elements.emptyGroupLeaderboard.classList.toggle("hidden", Boolean(entries.length));
  renderLeaderboardRows(elements.groupLeaderboardBody, entries);
  if (leaderboard) {
    elements.activeGroupName.textContent = leaderboard.groupName;
    elements.groupLeaderboardStatus.textContent = leaderboard.status;
    elements.groupLeaderboardStatus.title = "";
  }
}

async function loadGroupLeaderboard(groupId = state.activeGroupId) {
  if (!groupId) return;
  elements.groupLeaderboardStatus.textContent = "Loading group leaderboard…";
  try {
    const leaderboard = await apiRequest(
      `/api/groups/${encodeURIComponent(groupId)}/leaderboard`,
    );
    if (state.activeGroupId !== groupId) return;
    state.groupLeaderboard = leaderboard;
    renderGroupLeaderboard();
  } catch (error) {
    if (state.activeGroupId !== groupId) return;
    state.groupLeaderboard = null;
    elements.groupLeaderboardBody.innerHTML = "";
    elements.groupLeaderboardTableShell.classList.add("hidden");
    elements.emptyGroupLeaderboard.classList.add("hidden");
    elements.groupLeaderboardStatus.textContent =
      "The group leaderboard could not be loaded.";
    elements.groupLeaderboardStatus.title = error.message;
  }
}

async function refreshGroups(preferredGroupId = state.activeGroupId) {
  try {
    const payload = await apiRequest("/api/groups");
    elements.emptyGroups.textContent =
      "You have not joined a group yet. Create one for friends or join one with its name and password.";
    elements.emptyGroups.title = "";
    state.groups = payload.groups || [];
    state.activeGroupId = state.groups.some(
      (group) => group.groupId === preferredGroupId,
    )
      ? preferredGroupId
      : state.groups[0]?.groupId || "";
    state.groupLeaderboard = null;
    renderGroups();
    if (state.activeGroupId) await loadGroupLeaderboard(state.activeGroupId);
  } catch (error) {
    state.groups = [];
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    renderGroups();
    elements.emptyGroups.textContent =
      "Your groups could not be loaded. Please refresh and try again.";
    elements.emptyGroups.title = error.message;
  }
}

function openGroupDialog(mode) {
  groupDialogMode = mode;
  const creating = mode === "create";
  elements.groupForm.reset();
  elements.groupDialogKicker.textContent = creating ? "NEW PRIVATE GROUP" : "JOIN PRIVATE GROUP";
  elements.groupDialogTitle.textContent = creating ? "Create a group." : "Join a group.";
  elements.groupDialogDescription.textContent = creating
    ? "Pick a unique group name and share its password with the people you invite."
    : "Enter the exact group name and the password shared by its creator.";
  elements.submitGroup.textContent = creating ? "Create group" : "Join group";
  elements.groupDialogMessage.textContent = "";
  elements.groupDialog.showModal();
  elements.groupName.focus();
}

async function submitGroup(event) {
  event.preventDefault();
  const creating = groupDialogMode === "create";
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
      }),
    });
    elements.groupDialog.close();
    await refreshGroups(group.groupId);
    showToast(creating ? `Created ${group.groupName}.` : `Joined ${group.groupName}.`);
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

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function randomTeam(teams) {
  const availableTeams = teams.filter(Boolean);
  return availableTeams[Math.floor(Math.random() * availableTeams.length)];
}

function getTeamNickname(teamName) {
  return teamName.split(" ").at(-1);
}

function teamLogoUrl(teamName) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${TEAM_LOGO_CODES[teamName]}.png`;
}

function createTeamLogo(teamName, className = "team-logo") {
  const logo = document.createElement("img");
  logo.className = className;
  logo.src = teamLogoUrl(teamName);
  logo.alt = `${teamName} logo`;
  logo.loading = "lazy";
  logo.addEventListener("error", () => logo.classList.add("logo-error"));
  return logo;
}

function seedTeam(conference, seed) {
  const name = state.seeds[conference][seed - 1];
  return name ? { name, seed } : null;
}

function projectedWins(team) {
  return Number(state.winTotals[team] ?? 0);
}

function sortTeamsByProjection(teams) {
  return [...teams].sort(
    (a, b) => projectedWins(b) - projectedWins(a) || a.localeCompare(b),
  );
}

function appendDivisionGroupedOptions(select, conference, teams, selectedTeam) {
  const teamSet = new Set(teams);

  DIVISION_ORDER.forEach((division) => {
    const divisionTeams = sortTeamsByProjection(
      DIVISION_TEAMS[conference][division].filter((team) => teamSet.has(team)),
    );
    if (!divisionTeams.length) return;

    const group = document.createElement("optgroup");
    group.label = `${conference} ${division}`;

    divisionTeams.forEach((team) => {
      const option = document.createElement("option");
      option.value = team;
      option.textContent =
        selectedTeam === team
          ? team
          : `${team} (${projectedWins(team).toFixed(1)} proj)`;
      option.selected = selectedTeam === team;
      group.appendChild(option);
    });

    select.appendChild(group);
  });
}

function appendProjectedOptions(select, teams, selectedTeam) {
  sortTeamsByProjection(teams).forEach((team) => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent =
      selectedTeam === team
        ? team
        : `${team} (${projectedWins(team).toFixed(1)} proj)`;
    option.selected = selectedTeam === team;
    select.appendChild(option);
  });
}

async function loadWinTotals() {
  elements.oddsStatus.textContent =
    "Using the bundled 2026 sportsbook snapshot while live odds load…";

  try {
    const response = await fetch("/api/win-totals", { cache: "no-store" });
    if (!response.ok) throw new Error("Odds endpoint unavailable");

    const data = await response.json();
    if (data.apiVersion !== 2) {
      throw new Error("The odds API version does not match this frontend.");
    }
    if (!data.totals || Object.keys(data.totals).length < 32) {
      throw new Error("Incomplete odds response");
    }

    state.winTotals = { ...FALLBACK_WIN_TOTALS, ...data.totals };
    state.oddsSource = data.source;
    const sourceLabel =
      data.status === "live"
        ? "Live"
        : data.status === "cached"
          ? "Cached"
          : "Fallback";
    elements.oddsStatus.textContent = `${sourceLabel} projected wins from ${data.source}. Teams are ranked within each division.`;
    elements.oddsStatus.title = data.message || "";
  } catch (error) {
    const isMismatchedApi = error.message.includes("does not match");
    elements.oddsStatus.textContent = isMismatchedApi
      ? "The odds API and frontend versions do not match. Deploy the latest dev build."
      : "Projected wins use the bundled 2026 sportsbook snapshot because live odds are unavailable.";
    elements.oddsStatus.title = error.message;
  }

  if (!elements.predictor.classList.contains("hidden")) {
    renderSeedSelectors();
  }
}

function renderSeedSelectors() {
  renderConferenceSeeds("AFC", elements.afcSeeds);
  renderConferenceSeeds("NFC", elements.nfcSeeds);
}

function renderConferenceSeeds(conference, container) {
  container.innerHTML = "";

  const divisionHeading = document.createElement("div");
  divisionHeading.className = "seed-group-heading";
  divisionHeading.innerHTML =
    "<strong>1. Pick Division Winners</strong><span>Choose one team from each division</span>";
  container.appendChild(divisionHeading);

  const divisionGrid = document.createElement("div");
  divisionGrid.className = "division-winner-grid";
  DIVISION_ORDER.forEach((division) => {
    const field = document.createElement("label");
    field.className = "division-winner-field";

    const label = document.createElement("span");
    label.textContent = `${conference} ${division}`;

    const select = document.createElement("select");
    select.dataset.conference = conference;
    select.dataset.division = division;
    select.setAttribute("aria-label", `${conference} ${division} winner`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = `Select ${division} winner`;
    select.appendChild(placeholder);

    appendDivisionGroupedOptions(
      select,
      conference,
      DIVISION_TEAMS[conference][division],
      state.divisionWinners[conference][division],
    );

    select.addEventListener("change", handleDivisionWinnerChange);
    const control = document.createElement("div");
    control.className = "logo-select-control";
    const selectedTeam = state.divisionWinners[conference][division];
    if (selectedTeam) {
      control.appendChild(createTeamLogo(selectedTeam, "select-team-logo"));
    } else {
      const placeholderLogo = document.createElement("span");
      placeholderLogo.className = "select-logo-placeholder";
      placeholderLogo.textContent = "—";
      control.appendChild(placeholderLogo);
    }
    control.appendChild(select);
    field.append(label, control);
    divisionGrid.appendChild(field);
  });
  container.appendChild(divisionGrid);

  const seedingHeading = document.createElement("div");
  seedingHeading.className = "seed-group-heading seed-order-group";
  seedingHeading.innerHTML =
    "<strong>2. Rank Division Winners</strong><span>Choices sorted by projected wins</span>";
  container.appendChild(seedingHeading);

  for (let index = 0; index < 7; index += 1) {
    if (index === 4) {
      const group = document.createElement("div");
      group.className = "seed-group-heading wild-card-group";
      group.innerHTML =
        "<strong>3. Pick Wild Cards</strong><span>Seeds 5–7 · unlock after division picks</span>";
      container.appendChild(group);
    }

    const row = document.createElement("div");
    row.className = "seed-row";
    if (index >= 4) row.classList.add("wild-card-seed");

    const number = document.createElement("span");
    number.className = "seed-number";
    number.textContent = index + 1;

    const logoSlot = document.createElement("span");
    logoSlot.className = "seed-logo-slot";
    const selectedSeedTeam = state.seeds[conference][index];
    if (selectedSeedTeam) {
      logoSlot.appendChild(createTeamLogo(selectedSeedTeam, "seed-team-logo"));
    }

    const select = document.createElement("select");
    select.dataset.conference = conference;
    select.dataset.seedIndex = index;
    select.setAttribute("aria-label", `${conference} seed ${index + 1}`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      "Pick division winners first";
    select.appendChild(placeholder);

    const availableTeams =
      index < 4
        ? Object.values(state.divisionWinners[conference]).filter(Boolean)
        : TEAMS[conference];
    if (index < 4) {
      appendProjectedOptions(
        select,
        availableTeams,
        state.seeds[conference][index],
      );
    } else {
      appendDivisionGroupedOptions(
        select,
        conference,
        availableTeams,
        state.seeds[conference][index],
      );
    }

    select.addEventListener("change", handleSeedChange);

    const note = document.createElement("span");
    note.className = "seed-note";
    note.textContent =
      index === 0 ? "Division winner · bye" : index < 4 ? "Division winner" : "Wild card";

    row.append(number, logoSlot, select, note);
    container.appendChild(row);
  }

  updateDisabledTeamOptions(conference);
}

function handleSeedChange(event) {
  const { conference, seedIndex } = event.target.dataset;
  const index = Number(seedIndex);
  state.seeds[conference][index] = event.target.value;

  state.bracketBuilt = false;
  state.picks = createEmptyPicks();
  state.savedAt = null;
  elements.bracketSection.classList.add("hidden");
  elements.seedingMessage.textContent = "";
  updateSaveState(false);
  renderConferenceSeeds(
    conference,
    conference === "AFC" ? elements.afcSeeds : elements.nfcSeeds,
  );
}

function handleDivisionWinnerChange(event) {
  const { conference, division } = event.target.dataset;
  state.divisionWinners[conference][division] = event.target.value;

  const selectedWinners = new Set(
    Object.values(state.divisionWinners[conference]).filter(Boolean),
  );
  state.seeds[conference] = state.seeds[conference].map((team, index) => {
    if (index < 4 && !selectedWinners.has(team)) return "";
    if (index >= 4 && selectedWinners.has(team)) return "";
    return team;
  });

  if (!divisionWinnersComplete(conference)) {
    state.seeds[conference].fill("", 4);
  }

  state.bracketBuilt = false;
  state.picks = createEmptyPicks();
  state.savedAt = null;
  elements.bracketSection.classList.add("hidden");
  elements.seedingMessage.textContent = "";
  updateSaveState(false);
  renderConferenceSeeds(
    conference,
    conference === "AFC" ? elements.afcSeeds : elements.nfcSeeds,
  );
}

function divisionWinnersComplete(conference) {
  return Object.values(state.divisionWinners[conference]).every(Boolean);
}

function divisionSeedingComplete(conference) {
  const winners = Object.values(state.divisionWinners[conference]);
  const seeded = state.seeds[conference].slice(0, 4);
  return (
    divisionWinnersComplete(conference) &&
    seeded.every(Boolean) &&
    new Set(seeded).size === 4 &&
    seeded.every((team) => winners.includes(team))
  );
}

function updateDisabledTeamOptions(conference) {
  const selectedTeams = new Set(state.seeds[conference].filter(Boolean));
  document
    .querySelectorAll(
      `select[data-conference="${conference}"][data-seed-index]`,
    )
    .forEach((select) => {
      const ownValue = select.value;
      const seedIndex = Number(select.dataset.seedIndex);
      const isDivisionWinner = seedIndex < 4;
      const divisionPicksComplete = divisionWinnersComplete(conference);
      const wildCardsUnlocked = divisionPicksComplete;
      const divisionWinnerTeams = new Set(
        Object.values(state.divisionWinners[conference]).filter(Boolean),
      );

      select.disabled = isDivisionWinner ? !divisionPicksComplete : !wildCardsUnlocked;
      select.closest(".seed-row").classList.toggle("locked", select.disabled);
      select.options[0].textContent = select.disabled
        ? "Pick all division winners first"
        : isDivisionWinner
          ? `Select seed ${seedIndex + 1}`
          : "Select a wild-card team";

      Array.from(select.options).forEach((option) => {
        if (!option.value) return;
        const duplicateTeam = option.value !== ownValue && selectedTeams.has(option.value);
        const selectedDivisionWinner =
          !isDivisionWinner && divisionWinnerTeams.has(option.value);
        option.disabled = duplicateTeam || selectedDivisionWinner;
      });
    });
}

function validateSeeding() {
  for (const conference of ["AFC", "NFC"]) {
    const selections = state.seeds[conference];
    if (!divisionWinnersComplete(conference)) {
      return `Choose the ${conference} North, South, East, and West winners first.`;
    }
    if (!divisionSeedingComplete(conference)) {
      return `Rank all four ${conference} division winners as seeds 1–4.`;
    }
    if (selections.some((team) => !team)) {
      return `Choose all seven ${conference} playoff teams first.`;
    }
    if (new Set(selections).size !== selections.length) {
      return `Each ${conference} team can only be seeded once.`;
    }
  }
  return "";
}

function buildBracket() {
  const error = validateSeeding();
  elements.seedingMessage.textContent = error;
  if (error) return;

  if (!state.bracketBuilt) {
    state.picks = createEmptyPicks();
  }
  state.bracketBuilt = true;
  state.savedAt = null;
  renderBracket();
  elements.bracketSection.classList.remove("hidden");
  updateSaveState(false);
  requestAnimationFrame(() => {
    elements.bracketSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function randomizeBracket() {
  if (!TEST_MODE) return;

  state.divisionWinners = createEmptyDivisionWinners();
  state.seeds = { AFC: Array(7).fill(""), NFC: Array(7).fill("") };
  state.picks = createEmptyPicks();

  for (const conference of ["AFC", "NFC"]) {
    for (const division of DIVISION_ORDER) {
      state.divisionWinners[conference][division] = randomTeam(
        DIVISION_TEAMS[conference][division],
      );
    }

    const divisionWinners = Object.values(state.divisionWinners[conference]);
    const wildCards = shuffled(
      TEAMS[conference].filter((team) => !divisionWinners.includes(team)),
    ).slice(0, 3);
    state.seeds[conference] = [...shuffled(divisionWinners), ...wildCards];
  }

  state.bracketBuilt = true;
  state.savedAt = null;

  for (const conference of ["AFC", "NFC"]) {
    let games = getConferenceGames(conference);
    games.wildCard.forEach((game) => {
      state.picks[conference][game.id] = randomTeam(game.teams).name;
    });

    games = getConferenceGames(conference);
    games.divisional.forEach((game) => {
      state.picks[conference][game.id] = randomTeam(game.teams).name;
    });

    games = getConferenceGames(conference);
    const championship = games.championship[0];
    state.picks[conference][championship.id] = randomTeam(
      championship.teams,
    ).name;
  }

  state.picks.superBowl = randomTeam([
    getConferenceWinner("AFC"),
    getConferenceWinner("NFC"),
  ]).name;

  elements.seedingMessage.textContent = "";
  renderSeedSelectors();
  renderBracket();
  elements.bracketSection.classList.remove("hidden");
  updateSaveState(false);
  showToast("Random seeds and game picks are ready.");

  requestAnimationFrame(() => {
    elements.bracketSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function getConferenceGames(conference) {
  const picks = state.picks[conference];
  const wildCard = [
    { id: "wc-2-7", title: "Wild Card · 2 vs 7", teams: [seedTeam(conference, 2), seedTeam(conference, 7)] },
    { id: "wc-3-6", title: "Wild Card · 3 vs 6", teams: [seedTeam(conference, 3), seedTeam(conference, 6)] },
    { id: "wc-4-5", title: "Wild Card · 4 vs 5", teams: [seedTeam(conference, 4), seedTeam(conference, 5)] },
  ];

  const wildCardWinners = wildCard.map((game) => {
    const selected = picks[game.id];
    return game.teams.find((team) => team?.name === selected) || null;
  });
  const remaining = [seedTeam(conference, 1), ...wildCardWinners].filter(Boolean);
  const sorted = [...remaining].sort((a, b) => a.seed - b.seed);

  const divisional =
    sorted.length === 4
      ? [
          {
            id: "div-1",
            title: "Divisional · High vs Low",
            teams: [sorted[0], sorted[3]],
          },
          {
            id: "div-2",
            title: "Divisional",
            teams: [sorted[1], sorted[2]],
          },
        ]
      : [
          { id: "div-1", title: "Divisional · High vs Low", teams: [seedTeam(conference, 1), null] },
          { id: "div-2", title: "Divisional", teams: [null, null] },
        ];

  const divisionalWinners = divisional.map((game) => {
    const selected = picks[game.id];
    return game.teams.find((team) => team?.name === selected) || null;
  });

  const championship = [
    {
      id: "conf",
      title: `${conference} Championship`,
      teams: divisionalWinners,
    },
  ];

  return { wildCard, divisional, championship };
}

function clearInvalidDownstreamPicks(conference, games) {
  const picks = state.picks[conference];
  const orderedGames = [...games.wildCard, ...games.divisional, ...games.championship];
  orderedGames.forEach((game) => {
    if (picks[game.id] && !game.teams.some((team) => team?.name === picks[game.id])) {
      delete picks[game.id];
    }
  });

  const conferenceWinner = getConferenceWinner(conference, games);
  if (
    state.picks.superBowl &&
    !["AFC", "NFC"].some((side) => {
      const winner = side === conference ? conferenceWinner : getConferenceWinner(side);
      return winner?.name === state.picks.superBowl;
    })
  ) {
    state.picks.superBowl = "";
  }
}

function getConferenceWinner(conference, precomputedGames) {
  const games = precomputedGames || getConferenceGames(conference);
  const final = games.championship[0];
  return final.teams.find((team) => team?.name === state.picks[conference].conf) || null;
}

function renderBracket() {
  const afcGames = getConferenceGames("AFC");
  const nfcGames = getConferenceGames("NFC");
  clearInvalidDownstreamPicks("AFC", afcGames);
  clearInvalidDownstreamPicks("NFC", nfcGames);

  renderConferenceBracket("AFC", elements.afcBracket, getConferenceGames("AFC"));
  renderConferenceBracket("NFC", elements.nfcBracket, getConferenceGames("NFC"));
  renderSuperBowl();
}

function renderConferenceBracket(conference, container, games) {
  container.innerHTML = "";
  const rounds = [
    { key: "wildCard", label: "Wild Card" },
    { key: "divisional", label: "Divisional" },
    { key: "championship", label: `Pick ${conference} Champion` },
  ];
  if (conference === "NFC") rounds.reverse();

  rounds.forEach(({ key, label }) => {
    const round = document.createElement("div");
    round.className = `round ${key === "wildCard" ? "wild-card" : key}`;

    const heading = document.createElement("div");
    heading.className = "round-label";
    heading.textContent = label;
    round.appendChild(heading);

    games[key].forEach((game) => {
      round.appendChild(createGameCard(conference, game));
    });
    container.appendChild(round);
  });
}

function createGameCard(conference, game, isSuperBowl = false) {
  const card = document.createElement("div");
  card.className = "game-card";

  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = game.title;
  card.appendChild(title);

  const selectedTeam = isSuperBowl
    ? state.picks.superBowl
    : state.picks[conference][game.id];

  game.teams.forEach((team, index) => {
    const button = document.createElement("button");
    button.className = "team-pick";
    button.type = "button";
    button.disabled = !team;

    if (team) {
      const isSelected = team.name === selectedTeam;
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute(
        "aria-label",
        isSuperBowl
          ? `Choose ${team.name} as Super Bowl champion`
          : `Choose ${team.name} to win ${game.title}`,
      );
      if (isSelected) button.classList.add("selected");
    }

    const seed = document.createElement("span");
    seed.className = "team-seed";
    seed.textContent = team?.seed || "–";

    const name = document.createElement("span");
    name.className = "team-name";
    name.textContent = team
      ? getTeamNickname(team.name)
      : index === 0
        ? "Awaiting winner"
        : "Pick prior games";
    if (team) button.title = team.name;

    const check = document.createElement("span");
    check.className = "pick-check";
    check.textContent = team && team.name === selectedTeam ? "✓" : "";

    if (team) {
      button.append(
        seed,
        createTeamLogo(team.name, "bracket-team-logo"),
        name,
        check,
      );
    } else {
      const emptyLogo = document.createElement("span");
      emptyLogo.className = "bracket-logo-placeholder";
      button.append(seed, emptyLogo, name, check);
    }
    if (team) {
      button.addEventListener("click", () => handleGamePick(conference, game.id, team.name, isSuperBowl));
    }
    card.appendChild(button);
  });

  return card;
}

function handleGamePick(conference, gameId, teamName, isSuperBowl) {
  const hadBothFinalists = Boolean(
    getConferenceWinner("AFC") && getConferenceWinner("NFC"),
  );

  if (isSuperBowl) {
    state.picks.superBowl = teamName;
  } else {
    state.picks[conference][gameId] = teamName;
  }
  state.savedAt = null;
  updateSaveState(false);
  renderBracket();

  const hasBothFinalists = Boolean(
    getConferenceWinner("AFC") && getConferenceWinner("NFC"),
  );
  if (!isSuperBowl && gameId === "conf" && !hadBothFinalists && hasBothFinalists) {
    requestAnimationFrame(() => {
      elements.superBowlGame.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function renderSuperBowl() {
  const afcWinner = getConferenceWinner("AFC");
  const nfcWinner = getConferenceWinner("NFC");
  const missingFinalists = [
    !afcWinner ? "AFC champion" : "",
    !nfcWinner ? "NFC champion" : "",
  ].filter(Boolean);

  elements.superBowlStatus.textContent = missingFinalists.length
    ? `Choose the ${missingFinalists.join(" and ")} to unlock the final.`
    : "Both finalists are set. Click a team below to crown your champion.";

  const game = {
    id: "super-bowl",
    title: afcWinner && nfcWinner ? "Pick the Super Bowl champion" : "Super Bowl",
    teams: [afcWinner, nfcWinner],
  };
  elements.superBowlGame.innerHTML = "";
  elements.superBowlGame.appendChild(createGameCard("", game, true));

  const champion = state.picks.superBowl;
  const championName = elements.championDisplay.querySelector("strong");
  const existingLogo = elements.championDisplay.querySelector(".champion-logo");
  if (existingLogo) existingLogo.remove();
  if (champion) {
    const championLogo = createTeamLogo(champion, "champion-logo");
    elements.championDisplay.insertBefore(
      championLogo,
      elements.championDisplay.querySelector("p"),
    );
  }
  championName.textContent = champion || "Make your final pick";
  elements.championDisplay.classList.toggle("empty", !champion);
}

function allGamesPicked() {
  for (const conference of ["AFC", "NFC"]) {
    const picks = state.picks[conference];
    const required = ["wc-2-7", "wc-3-6", "wc-4-5", "div-1", "div-2", "conf"];
    if (required.some((id) => !picks[id])) return false;
  }
  return Boolean(state.picks.superBowl);
}

async function savePrediction() {
  if (!state.bracketBuilt) {
    showToast("Build your bracket before saving.");
    return;
  }
  if (!allGamesPicked()) {
    showToast("Pick a winner in every playoff game first.");
    return;
  }
  if (!state.leaderboardName) {
    openLeaderboardNameDialog(true);
    return;
  }

  const prediction = {
    divisionWinners: clone(state.divisionWinners),
    seeds: clone(state.seeds),
    picks: clone(state.picks),
    bracketBuilt: true,
  };

  elements.savePrediction.disabled = true;
  elements.savePrediction.textContent = "Saving…";
  try {
    const saved = await apiRequest("/api/prediction", {
      method: "PUT",
      body: JSON.stringify(prediction),
    });
    state.savedAt = saved.savedAt;
    state.savedPrediction = saved;
    updateSaveState(true);
    renderSavedPrediction();
    await loadLeaderboard();
    if (state.activeGroupId) await loadGroupLeaderboard();
    showToast("Prediction saved.");
  } catch (error) {
    updateSaveState(false);
    showToast(`Could not save: ${error.message}`);
  } finally {
    elements.savePrediction.disabled = false;
    elements.savePrediction.textContent = "Save prediction";
  }
}

function updateSaveState(saved) {
  elements.saveState.classList.toggle("saved", saved);
  elements.saveState.querySelector("span:last-child").textContent = saved
    ? "Saved online"
    : "Unsaved changes";
}

function openPrediction(scrollToPredictor = true) {
  const stored = state.savedPrediction;
  state.seeds = stored?.seeds
    ? clone(stored.seeds)
    : { AFC: Array(7).fill(""), NFC: Array(7).fill("") };
  state.divisionWinners = stored?.divisionWinners
    ? clone(stored.divisionWinners)
    : createEmptyDivisionWinners();

  if (stored?.seeds && !stored?.divisionWinners) {
    for (const conference of ["AFC", "NFC"]) {
      stored.seeds[conference].slice(0, 4).forEach((team) => {
        const division = TEAM_DIVISIONS[team]?.split(" ")[1];
        if (division) state.divisionWinners[conference][division] = team;
      });
    }
  }

  state.picks = stored?.picks ? clone(stored.picks) : createEmptyPicks();
  state.bracketBuilt = Boolean(stored?.bracketBuilt);
  state.savedAt = stored?.savedAt || null;

  elements.predictor.classList.remove("hidden");
  renderSeedSelectors();

  if (state.bracketBuilt && !validateSeeding()) {
    renderBracket();
    elements.bracketSection.classList.remove("hidden");
    updateSaveState(Boolean(state.savedAt));
    showToast("Loaded your saved prediction.");
  } else {
    elements.bracketSection.classList.add("hidden");
    showToast("Ready for your picks.");
  }

  if (scrollToPredictor) {
    requestAnimationFrame(() => {
      elements.predictor.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function resetGamePicks() {
  state.picks = createEmptyPicks();
  state.savedAt = null;
  renderBracket();
  updateSaveState(false);
  showToast("Game picks reset. Your seeding is unchanged.");
}

function createScoreSummary(score) {
  const summary = document.createElement("section");
  summary.className = "score-summary";
  summary.setAttribute("aria-label", "Prediction score");

  const top = document.createElement("div");
  top.className = "score-summary-top";

  const label = document.createElement("p");
  label.className = "score-summary-label";
  label.textContent = score.possible
    ? `${score.total} OF ${score.possible} AVAILABLE`
    : "CURRENT SCORE";

  const total = document.createElement("strong");
  total.className = "score-summary-total";
  total.textContent = `${score.total} / ${score.maximum}`;
  top.append(label, total);

  const status = document.createElement("p");
  status.className = "score-summary-status";
  status.textContent = score.status;

  const splits = document.createElement("div");
  splits.className = "score-splits";
  const regularSeason = document.createElement("span");
  regularSeason.append("PLAYOFF FIELD + SEEDS", document.createElement("strong"));
  regularSeason.querySelector("strong").textContent = `${score.regularSeason} pts`;
  const playoffs = document.createElement("span");
  playoffs.append("PLAYOFF ROUNDS", document.createElement("strong"));
  playoffs.querySelector("strong").textContent = `${score.playoffs} pts`;
  splits.append(regularSeason, playoffs);

  summary.append(top, status, splits);
  return summary;
}

function renderSavedPrediction() {
  const prediction = state.savedPrediction;
  elements.savedGrid.innerHTML = "";
  elements.emptyLocker.classList.toggle("hidden", Boolean(prediction));
  if (!prediction) return;

  const card = document.createElement("article");
  card.className = "saved-card";

  const top = document.createElement("div");
  top.className = "saved-card-top";

  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = "Your saved bracket";
  const time = document.createElement("time");
  time.dateTime = new Date(prediction.savedAt).toISOString();
  time.textContent = `Saved ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(prediction.savedAt))}`;
  identity.append(name, time);
  top.appendChild(identity);

  const champion = document.createElement("div");
  champion.className = "champion-chip";
  champion.textContent = `★ Champion: ${prediction.picks.superBowl}`;

  const scoreSummary = prediction.score
    ? createScoreSummary(prediction.score)
    : null;

  const actions = document.createElement("div");
  actions.className = "saved-card-actions";

  const load = document.createElement("button");
  load.type = "button";
  load.className = "button button-secondary";
  load.textContent = "Open bracket";
  load.addEventListener("click", () => openPrediction());

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-button";
  remove.textContent = "Delete";
  remove.setAttribute("aria-label", "Delete your saved prediction");
  remove.addEventListener("click", deletePrediction);

  actions.append(load, remove);
  card.append(top, champion);
  if (scoreSummary) card.appendChild(scoreSummary);
  card.appendChild(actions);
  elements.savedGrid.appendChild(card);
}

async function deletePrediction() {
  try {
    await apiRequest("/api/prediction", {
      method: "DELETE",
    });
    state.savedPrediction = null;
    state.savedAt = null;
    renderSavedPrediction();
    updateSaveState(false);
    await loadLeaderboard();
    if (state.activeGroupId) await loadGroupLeaderboard();
    showToast("Deleted your saved prediction.");
  } catch (error) {
    showToast(`Could not delete: ${error.message}`);
  }
}

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
elements.buildBracket.addEventListener("click", buildBracket);
elements.randomizeBracket.addEventListener("click", randomizeBracket);
elements.savePrediction.addEventListener("click", savePrediction);
elements.resetPicks.addEventListener("click", resetGamePicks);
elements.signInForm.addEventListener("submit", submitSignIn);
elements.createAccountForm.addEventListener("submit", submitCreateAccount);
elements.confirmAccountForm.addEventListener("submit", submitConfirmAccount);
elements.forgotPasswordForm.addEventListener("submit", submitForgotPassword);
elements.resetPasswordForm.addEventListener("submit", submitResetPassword);
elements.leaderboardNameForm.addEventListener("submit", submitLeaderboardName);
elements.publicLeaderboardTab.addEventListener("click", () => {
  renderLeaderboardView("public");
});
elements.groupsLeaderboardTab.addEventListener("click", () => {
  renderLeaderboardView("groups");
});
elements.publicLeaderboardTab.addEventListener("keydown", handleLeaderboardViewKeydown);
elements.groupsLeaderboardTab.addEventListener("keydown", handleLeaderboardViewKeydown);
elements.createGroup.addEventListener("click", () => openGroupDialog("create"));
elements.joinGroup.addEventListener("click", () => openGroupDialog("join"));
elements.groupForm.addEventListener("submit", submitGroup);
elements.cancelGroup.addEventListener("click", () => elements.groupDialog.close());
elements.groupDialog.addEventListener("close", () => {
  elements.groupForm.reset();
  elements.groupDialogMessage.textContent = "";
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
elements.closePublicBracket.addEventListener("click", () => {
  elements.publicBracketDialog.close();
});
elements.publicBracketDialog.addEventListener("close", () => {
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
    await refreshSavedPrediction();
    await refreshGroups();
    if (!loadAuthSession()) return;
    openPrediction(false);
  } catch (error) {
    clearAuthSession();
    renderAuthentication(false);
    showAuthPanel("signIn", error.message);
  }
}

loadWinTotals();
loadLeaderboard();
initializeAuthentication();
