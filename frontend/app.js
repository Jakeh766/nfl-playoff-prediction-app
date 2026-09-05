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
const PAGE = document.body.dataset.page || "home";
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
  predictionWindow: null,
  predictionsLocked: !LOCAL_PREVIEW,
  predictionClockOffset: 0,
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
  accountAuthView: document.querySelector("#account-auth-view"),
  accountSettingsView: document.querySelector("#account-settings-view"),
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
  homeCreateGroup: document.querySelector("#home-create-group"),
  homeJoinGroup: document.querySelector("#home-join-group"),
  homeGroupStatus: document.querySelector("#home-group-status"),
  homeInviteCallout: document.querySelector("#home-invite-callout"),
  homeAcceptInvite: document.querySelector("#home-accept-invite"),
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
  shareGroupInvite: document.querySelector("#share-group-invite"),
  groupInviteDialog: document.querySelector("#group-invite-dialog"),
  groupInviteName: document.querySelector("#group-invite-name"),
  groupInviteLink: document.querySelector("#group-invite-link"),
  groupInviteMessage: document.querySelector("#group-invite-message"),
  closeGroupInvite: document.querySelector("#close-group-invite"),
  copyGroupInvite: document.querySelector("#copy-group-invite"),
  shareGroupInviteNative: document.querySelector("#share-group-invite-native"),
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
  kickoffCountdown: document.querySelector("#kickoff-countdown"),
  countdownDays: document.querySelector("#countdown-days"),
  countdownHours: document.querySelector("#countdown-hours"),
  countdownMinutes: document.querySelector("#countdown-minutes"),
  countdownSeconds: document.querySelector("#countdown-seconds"),
  kickoffLockTime: document.querySelector("#kickoff-lock-time"),
  countdownStatus: document.querySelector("#countdown-status"),
  predictionLockNotice: document.querySelector("#prediction-lock-notice"),
  predictionLockTitle: document.querySelector("#prediction-lock-title"),
  predictionLockMessage: document.querySelector("#prediction-lock-message"),
};

if (!TEST_MODE && elements.randomizeBracket) {
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
let pendingGroupAction = "";

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
    window.siteAnalytics?.track("sign_in");
    elements.loginPassword.value = "";
    elements.authMessage.textContent = "";
    renderAuthentication(true);
    await refreshProfile();
    if (PAGE === "picks") {
      await refreshSavedPrediction();
      if (loadAuthSession() && !state.bracketBuilt) openPrediction();
    } else if (PAGE === "leaderboard") {
      await refreshGroups();
    }
    if (typeof resumePendingGroupAction === "function") {
      await resumePendingGroupAction();
    }
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
    window.siteAnalytics?.track("account_created");
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
  if (!elements.publicLeaderboardTab) return;
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
  elements.signedInPanel?.classList.toggle("hidden", !state.signedIn);
  elements.accountLeaderboardName.textContent =
    state.leaderboardName || "Not set yet";
  elements.changeLeaderboardName.textContent = state.leaderboardName
    ? "Change leaderboard name"
    : "Choose leaderboard name";
  elements.savedSection?.classList.toggle("hidden", !state.signedIn);
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
    state.leaderboardView = "public";
    state.groups = [];
    state.activeGroupId = "";
    state.groupLeaderboard = null;
    elements.savedSection?.classList.add("hidden");
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
      if (elements.leaderboardBody) await loadLeaderboard();
      if (PAGE === "leaderboard" && state.activeGroupId) await loadGroupLeaderboard();
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

let predictionCountdownTimer;

function predictionLockDateLabel(lockAt) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(lockAt));
}

function setPredictionEditingLocked(locked, message = "") {
  state.predictionsLocked = locked;
  document.body.classList.toggle("predictions-locked", locked);

  if (elements.predictionLockNotice) {
    elements.predictionLockNotice.classList.remove("hidden");
    elements.predictionLockNotice.classList.toggle("locked", locked);
    elements.predictionLockTitle.textContent = locked
      ? "Brackets are locked."
      : "Picks are open.";
    elements.predictionLockMessage.textContent = message;
  }

  [
    elements.randomizeBracket,
    elements.buildBracket,
    elements.resetPicks,
    elements.savePrediction,
  ].forEach((control) => {
    if (control) control.disabled = locked;
  });

  if (PAGE === "picks" && elements.afcSeeds?.childElementCount) {
    renderSeedSelectors();
    if (state.bracketBuilt) renderBracket();
  }
}

function renderPredictionCountdown() {
  if (!state.predictionWindow || !elements.kickoffCountdown) return;

  const lockTime = new Date(state.predictionWindow.lockAt).getTime();
  const now = Date.now() + state.predictionClockOffset;
  const remaining = Math.max(0, lockTime - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  elements.countdownDays.textContent = String(days).padStart(2, "0");
  elements.countdownHours.textContent = String(hours).padStart(2, "0");
  elements.countdownMinutes.textContent = String(minutes).padStart(2, "0");
  elements.countdownSeconds.textContent = String(seconds).padStart(2, "0");

  if (!remaining && !state.predictionsLocked) {
    state.predictionWindow.locked = true;
    setPredictionEditingLocked(true, "The NFL regular season has kicked off. Saved brackets are now read-only.");
  }

  elements.countdownStatus.textContent = remaining
    ? "Finish and save your bracket before kickoff."
    : "Kickoff has arrived. All saved brackets are read-only.";
  elements.kickoffCountdown.classList.toggle("locked", !remaining);
}

async function initializePredictionWindow() {
  try {
    const response = await fetch("/api/prediction-window", { cache: "no-store" });
    if (!response.ok) throw new Error("Prediction deadline unavailable");
    const windowState = await response.json();
    if (!windowState.lockAt || !Number.isFinite(windowState.serverTime)) {
      throw new Error("Invalid prediction deadline response");
    }

    state.predictionWindow = windowState;
    state.predictionClockOffset = windowState.serverTime - Date.now();
    const label = predictionLockDateLabel(windowState.lockAt);
    if (elements.kickoffLockTime) {
      elements.kickoffLockTime.dateTime = windowState.lockAt;
      elements.kickoffLockTime.textContent = `Deadline: ${label}`;
    }
    setPredictionEditingLocked(
      Boolean(windowState.locked),
      windowState.locked
        ? `The ${windowState.season} NFL regular season has kicked off. Saved brackets are read-only.`
        : `Create or change your bracket until ${label}.`,
    );
    renderPredictionCountdown();
    clearInterval(predictionCountdownTimer);
    predictionCountdownTimer = setInterval(renderPredictionCountdown, 1000);
  } catch (error) {
    if (elements.countdownStatus) {
      elements.countdownStatus.textContent = "The kickoff countdown is temporarily unavailable.";
      elements.countdownStatus.title = error.message;
    }
    if (!LOCAL_PREVIEW) {
      setPredictionEditingLocked(
        true,
        "We could not verify whether picks are still open. Refresh before editing your bracket.",
      );
    }
  }
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
