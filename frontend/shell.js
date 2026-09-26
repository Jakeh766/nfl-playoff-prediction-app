const pageName = document.body.dataset.page || "home";
const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const routeHref = (path) => sportUrl(localPreview && path !== "/" ? `${path}.html` : path);

const header = document.querySelector("#site-header");
if (header) {
  header.className = "site-header";
  header.innerHTML = `
    <a class="brand" href="${sportUrl("/")}" aria-label="Predict Playoffs home">
      <img class="brand-mark" src="/assets/predict-playoffs-mark.svg" alt="" />
      <span class="brand-name">PREDICT PLAYOFFS</span>
    </a>
    <div class="sport-selector" role="group" aria-label="Sport">
      <button type="button" data-sport="nfl" aria-pressed="${!IS_NBA}">NFL</button>
      <button type="button" data-sport="nba" aria-pressed="${IS_NBA}">NBA</button>
    </div>
    <nav class="primary-nav" aria-label="Primary navigation">
      <a href="${routeHref("/picks")}" data-nav-page="picks">My Picks</a>
      <a href="${routeHref("/leaderboard")}" data-nav-page="leaderboard">Leaderboard</a>
      <a href="${routeHref("/scoring")}" data-nav-page="scoring">Scoring</a>
    </nav>
    <button class="button button-ghost header-account" id="header-account" type="button">
      Account
    </button>
  `;
  header.querySelector(`[data-nav-page="${pageName}"]`)?.setAttribute("aria-current", "page");
}

const dialogs = document.querySelector("#site-dialogs");
if (dialogs) {
  dialogs.innerHTML = `
    ${["home", "leaderboard"].includes(pageName) ? `
      <dialog class="account-dialog public-bracket-dialog" id="public-bracket-dialog" aria-labelledby="public-bracket-title">
        <div class="dialog-heading">
          <div>
            <p class="card-kicker">PUBLIC BRACKET</p>
            <h2 id="public-bracket-title">Saved bracket.</h2>
          </div>
          <button class="dialog-close" id="close-public-bracket" type="button" aria-label="Close public bracket">×</button>
        </div>
        <p class="public-bracket-status" id="public-bracket-status" role="status" aria-live="polite"></p>
        <div id="public-bracket-content"></div>
      </dialog>
    ` : ""}

    <div class="account-modal" id="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" aria-hidden="true" hidden>
      <div class="account-dialog auth-dialog" role="document">
      <div class="dialog-heading">
        <div>
          <p class="card-kicker">ACCOUNT</p>
          <h2 id="account-dialog-title">Your account.</h2>
        </div>
        <button class="dialog-close" id="close-account-dialog" type="button" aria-label="Close account">×</button>
      </div>

      <div id="account-auth-view">
        <div id="signed-out-panel">
          <h3>Sign in to your bracket.</h3>
          <p class="auth-description">Keep one prediction per sport synced across your devices.</p>
          <form class="sign-in-form" id="sign-in-form" method="post">
            <label for="login-email">Email address</label>
            <input id="login-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            <label for="login-password">Password</label>
            <div class="password-field">
              <input id="login-password" name="password" type="password" autocomplete="current-password" required />
              <button class="password-toggle" type="button" data-password-toggle aria-controls="login-password" aria-label="Show password" aria-pressed="false">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/><path class="password-toggle-slash" d="m4 4 16 16"/></svg>
              </button>
            </div>
            <button class="button button-primary auth-button" id="sign-in" type="submit">Sign in</button>
          </form>
          <div class="auth-links">
            <a href="#" id="forgot-password">Forgot password?</a>
            <a href="#" id="create-account">Create account</a>
          </div>
        </div>

        <div class="hidden" id="create-account-panel">
          <h3>Create your account.</h3>
          <p class="auth-description">Use your email and a password with at least six characters.</p>
          <form class="auth-form" id="create-account-form" method="post">
            <label for="create-email">Email address</label>
            <input id="create-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            <label for="create-password">Password</label>
            <div class="password-field">
              <input id="create-password" name="new-password" type="password" autocomplete="new-password" minlength="6" required />
              <button class="password-toggle" type="button" data-password-toggle aria-controls="create-password" aria-label="Show password" aria-pressed="false">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/><path class="password-toggle-slash" d="m4 4 16 16"/></svg>
              </button>
            </div>
            <button class="button button-primary auth-button" type="submit">Create account</button>
          </form>
          <button class="auth-back" id="create-account-back" type="button">Back to sign in</button>
        </div>

        <div class="hidden" id="confirm-account-panel">
          <h3>Confirm your account.</h3>
          <p class="auth-description">Enter the verification code sent to your email. If you do not have one, request a new code below.</p>
          <form class="auth-form" id="confirm-account-form" method="post">
            <input id="confirm-email" name="username" type="hidden" />
            <label for="confirmation-code">Verification code</label>
            <input id="confirmation-code" name="one-time-code" type="text" inputmode="numeric" autocomplete="one-time-code" required />
            <button class="button button-primary auth-button" type="submit">Confirm account</button>
          </form>
          <div class="auth-links">
            <button id="resend-confirmation" type="button">Resend code</button>
            <button id="confirm-account-back" type="button">Back to sign in</button>
          </div>
        </div>

        <div class="hidden" id="forgot-password-panel">
          <h3>Reset your password.</h3>
          <p class="auth-description">We will email you a verification code.</p>
          <form class="auth-form" id="forgot-password-form" method="post">
            <label for="forgot-email">Email address</label>
            <input id="forgot-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            <button class="button button-primary auth-button" type="submit">Send reset code</button>
          </form>
          <button class="auth-back" id="forgot-password-back" type="button">Back to sign in</button>
        </div>

        <div class="hidden" id="reset-password-panel">
          <h3>Choose a new password.</h3>
          <p class="auth-description">Enter your verification code and new password.</p>
          <form class="auth-form" id="reset-password-form" method="post">
            <label for="reset-email">Email address</label>
            <input id="reset-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            <label for="reset-code">Verification code</label>
            <input id="reset-code" name="one-time-code" type="text" inputmode="numeric" autocomplete="one-time-code" required />
            <label for="reset-password">New password</label>
            <div class="password-field">
              <input id="reset-password" name="new-password" type="password" autocomplete="new-password" minlength="6" required />
              <button class="password-toggle" type="button" data-password-toggle aria-controls="reset-password" aria-label="Show password" aria-pressed="false">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/><path class="password-toggle-slash" d="m4 4 16 16"/></svg>
              </button>
            </div>
            <button class="button button-primary auth-button" type="submit">Save new password</button>
          </form>
          <button class="auth-back" id="reset-password-back" type="button">Back to sign in</button>
        </div>

        <div class="hidden" id="signed-in-panel">
          <h3>Your bracket is ready.</h3>
          <p class="auth-description">Continue your picks or review your saved prediction.</p>
          <button class="button button-primary auth-button" id="open-prediction" type="button">Go to My Picks</button>
        </div>
        <p class="auth-message" id="auth-message" role="status" aria-live="polite"></p>
      </div>

      <div class="hidden" id="account-settings-view">
        <div class="account-details">
          <p><span>Leaderboard name</span><strong id="account-leaderboard-name"></strong></p>
          <p><span>Email address</span><strong id="account-email"></strong></p>
        </div>
        <div class="account-settings-actions">
          <button class="button button-secondary" id="change-leaderboard-name" type="button">Change leaderboard name</button>
          <button class="button button-ghost" id="account-sign-out" type="button">Sign out</button>
        </div>
        <button class="delete-account-button" id="delete-account" type="button">Delete account</button>
      </div>
      </div>
    </div>

    <dialog class="account-dialog" id="leaderboard-name-dialog" aria-labelledby="leaderboard-name-title" aria-describedby="leaderboard-name-description">
      <form id="leaderboard-name-form" method="post">
        <p class="card-kicker">LEADERBOARD PROFILE</p>
        <h2 id="leaderboard-name-title">Choose your name.</h2>
        <p id="leaderboard-name-description">Choose the public name that identifies your saved prediction and read-only bracket. Every name is unique, ignoring capitalization.</p>
        <label for="leaderboard-name">Leaderboard name</label>
        <input id="leaderboard-name" name="leaderboard-name" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9 ._'’\\-]*[A-Za-z0-9]" autocomplete="nickname" autocapitalize="words" spellcheck="false" required />
        <p class="input-hint">3–24 characters. Letters, numbers, spaces, periods, apostrophes, underscores, and hyphens.</p>
        <p class="dialog-message" id="leaderboard-name-message" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="button button-secondary" id="cancel-leaderboard-name" type="button">Cancel</button>
          <button class="button button-primary" id="save-leaderboard-name" type="submit">Save and continue</button>
        </div>
      </form>
    </dialog>

    ${["home", "leaderboard"].includes(pageName) ? `
      <dialog class="account-dialog" id="group-dialog" aria-labelledby="group-dialog-title" aria-describedby="group-dialog-description">
        <form id="group-form" method="post">
          <p class="card-kicker" id="group-dialog-kicker">PRIVATE GROUP</p>
          <h2 id="group-dialog-title">Create a group.</h2>
          <p id="group-dialog-description">Pick a unique group name. You can invite people with a private link or the group password.</p>
          <label for="group-name">Group name</label>
          <input id="group-name" name="group-name" type="text" minlength="3" maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9 ._'’\\-]*[A-Za-z0-9]" autocomplete="off" autocapitalize="words" spellcheck="false" required />
          <p class="input-hint">3–40 characters. Letters, numbers, spaces, periods, apostrophes, underscores, and hyphens.</p>
          <div id="group-scoring-field">
            <label for="group-scoring">Scoring option</label>
            <select id="group-scoring" name="scoring-option" aria-describedby="group-scoring-hint">
              <option value="classic">Classic · 300 points</option>
              <option value="vegas">Upset Edge · weighted picks</option>
            </select>
            <p class="input-hint" id="group-scoring-hint">Upset Edge multiplies each correct pick by the team’s fixed preseason win-total weight. An 8.5-win team is neutral; each win below or above changes the value by 10%. This choice sets your group’s ranking and cannot be changed.</p>
          </div>
          <label for="group-password">Group password</label>
          <div class="password-field">
            <input id="group-password" name="group-password" type="password" minlength="6" maxlength="128" autocomplete="off" data-bwignore="true" data-1p-ignore data-lpignore="true" data-form-type="other" data-keeper-ignore="true" required />
            <button class="password-toggle" type="button" data-password-toggle aria-controls="group-password" aria-label="Show password" aria-pressed="false">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/><path class="password-toggle-slash" d="m4 4 16 16"/></svg>
            </button>
          </div>
          <p class="input-hint">6–128 characters. Passwords are stored as secure hashes.</p>
          <p class="dialog-message" id="group-dialog-message" role="status" aria-live="polite"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" id="cancel-group" type="button">Cancel</button>
            <button class="button button-primary" id="submit-group" type="submit">Create group</button>
          </div>
        </form>
      </dialog>

      <dialog class="account-dialog" id="group-invite-dialog" aria-labelledby="group-invite-title" aria-describedby="group-invite-description">
        <div class="dialog-heading">
          <div>
            <p class="card-kicker">PRIVATE GROUP INVITE</p>
            <h2 id="group-invite-title">Invite your group.</h2>
          </div>
          <button class="dialog-close" id="close-group-invite" type="button" aria-label="Close group invite">×</button>
        </div>
        <p id="group-invite-description">Anyone with this link can join <strong id="group-invite-name"></strong> after signing in.</p>
        <label for="group-invite-link">Invite link</label>
        <input id="group-invite-link" type="url" readonly />
        <p class="dialog-message" id="group-invite-message" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="button button-secondary hidden" id="share-group-invite-native" type="button">Share link</button>
          <button class="button button-primary" id="copy-group-invite" type="button">Copy invite link</button>
        </div>
      </dialog>

      <dialog class="account-dialog" id="leave-group-dialog" aria-labelledby="leave-group-title" aria-describedby="leave-group-description">
        <form id="leave-group-form" method="post">
          <h2 id="leave-group-title">Leave this group?</h2>
          <p id="leave-group-description"></p>
          <div class="hidden" id="new-commissioner-field">
            <label for="new-commissioner">New commissioner</label>
            <select id="new-commissioner" name="new-commissioner"></select>
            <p class="input-hint">They will be able to manage and delete the group.</p>
          </div>
          <p class="dialog-message" id="leave-group-message" role="status" aria-live="polite"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" id="cancel-leave-group" type="button">Stay in group</button>
            <button class="button button-danger" id="confirm-leave-group" type="submit">Leave group</button>
          </div>
        </form>
      </dialog>

      <dialog class="account-dialog" id="delete-group-dialog" aria-labelledby="delete-group-title" aria-describedby="delete-group-description">
        <form id="delete-group-form" method="post">
          <p class="card-kicker">PERMANENT ACTION</p>
          <h2 id="delete-group-title">Delete this group?</h2>
          <p id="delete-group-description">As commissioner, you can permanently remove <strong id="delete-group-name"></strong> for every member, including its invite link and leaderboard. This cannot be undone.</p>
          <label for="delete-group-confirmation">Type <strong id="delete-group-confirmation-name"></strong> to confirm</label>
          <input id="delete-group-confirmation" name="confirmation" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" required />
          <p class="dialog-message" id="delete-group-message" role="status" aria-live="polite"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" id="cancel-delete-group" type="button">Keep this group</button>
            <button class="button button-danger" id="confirm-delete-group" type="submit" disabled>Delete group</button>
          </div>
        </form>
      </dialog>
    ` : ""}

    <dialog class="account-dialog" id="delete-account-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description">
      <form id="delete-account-form" method="post">
        <p class="card-kicker">PERMANENT ACTION</p>
        <h2 id="delete-account-title">Delete your account?</h2>
        <p id="delete-account-description">This permanently deletes your account, leaderboard name, group memberships, and saved brackets for both sports. This cannot be undone.</p>
        <label for="delete-account-confirmation">Type <strong>DELETE</strong> to confirm</label>
        <input id="delete-account-confirmation" name="confirmation" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required />
        <p class="dialog-message" id="delete-account-message" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="button button-secondary" id="cancel-delete-account" type="button">Keep my account</button>
          <button class="button button-danger" id="confirm-delete-account" type="submit" disabled>Permanently delete</button>
        </div>
      </form>
    </dialog>
  `;
}

const footer = document.querySelector("#site-footer");
if (footer) {
  footer.innerHTML = `
    <div class="footer-brand">
      <img class="footer-mark" src="/assets/predict-playoffs-mark.svg" alt="" />
      <div class="footer-wordmark">
        <span>PREDICT PLAYOFFS</span>
        <small>CALL IT BEFORE KICKOFF</small>
      </div>
    </div>
    <p>Your account details stay private. Not affiliated with the NFL or NBA.</p>
  `;
}

{
  document.querySelectorAll("a[data-clean-route]").forEach((link) => {
    link.href = routeHref(link.getAttribute("data-clean-route"));
  });
}

document.querySelectorAll(".sport-selector button").forEach(button => button.addEventListener("click", () => {
  const sport = button.dataset.sport;
  if (sport === SPORT) return;
  if (typeof state !== "undefined" && state.bracketBuilt && !state.savedAt &&
      !window.confirm("Switch sports and discard your unsaved bracket?")) {
    return;
  }
  const url = new URL(window.location.href);
  if (["/", "/nba"].includes(url.pathname) && !localPreview) {
    url.pathname = sport === "nba" ? "/nba" : "/";
    url.searchParams.delete("sport");
  } else if (sport === "nba") {
    url.searchParams.set("sport", sport);
  } else {
    url.searchParams.delete("sport");
  }
  url.searchParams.delete("invite");
  window.location.assign(url.href);
}));
if (IS_NBA && pageName === "home") {
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", "https://predictplayoffs.com/nba");
}
if (IS_NBA) applyNbaPresentation();

function applyNbaPresentation() {
  document.body.dataset.sport = "nba";
  document.title = document.title.replace("NFL", "NBA");
  const copy = new Map([
    ["Predict the 2026", "Predict the 2026–27"], ["NFL", "NBA"],
    ["Super Bowl", "NBA Finals"], ["SUPER BOWL", "NBA FINALS"],
    ["AFC", "West"], ["NFC", "East"],
    ["AMERICAN FOOTBALL CONFERENCE", "WESTERN CONFERENCE"],
    ["NATIONAL FOOTBALL CONFERENCE", "EASTERN CONFERENCE"],
    ["Choose the 14", "Choose the 16"],
    ["before kickoff", "before tip-off"], ["BEFORE KICKOFF", "BEFORE TIP-OFF"],
    ["kickoff deadline", "tip-off deadline"],
    ["Choose every division winner and wild card.", "Rank eight playoff teams from each conference."],
    ["Pick each North, South, East, and West winner first. Rank those four teams as seeds 1–4, then choose three wild cards. The No. 1 seeds earn a first-round bye.", "Rank the final eight playoff teams in each conference, after the Play-In. Pick each best-of-seven series winner through the NBA Finals. No byes or reseeding."],
    ["pick every game", "pick every series"], ["PICK EVERY GAME", "PICK EVERY SERIES"],
  ]);
  if (window.location.pathname === "/nba") copy.delete("Predict the 2026");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest("script, style, select, .sport-selector, [data-no-sport-copy]")) continue;
    let value = node.nodeValue;
    for (const [from, to] of copy) value = value.split(from).join(to);
    node.nodeValue = value;
  }
  document.querySelectorAll(".afc-card .conference-logo, .afc-label .bracket-conference-logo").forEach(logo => {
    logo.src = NBA_CONFERENCE_LOGOS.West;
    logo.alt = "Western Conference logo";
  });
  document.querySelectorAll(".nfc-card .conference-logo, .nfc-label .bracket-conference-logo").forEach(logo => {
    logo.src = NBA_CONFERENCE_LOGOS.East;
    logo.alt = "Eastern Conference logo";
  });
  document.querySelectorAll(".conference-logo-fallback").forEach((node, index) => node.textContent = index ? "E" : "W");
  const stats = document.querySelector(".countdown-stats");
  if (stats) stats.innerHTML = "<span>16 <small>TEAMS</small></span><span>300 <small>CLASSIC POINTS</small></span>";
  const disclaimer = document.querySelector("#site-footer > p");
  if (disclaimer) disclaimer.textContent = "Your account details stay private. Not affiliated with the NFL or NBA.";
  const trophy = document.querySelector(".trophy");
  if (trophy) trophy.innerHTML = '<circle cx="32" cy="21" r="18"/><path d="M28 40h8v25H28zM17 65h30v9H17zM11 74h42v11H11z"/><path class="trophy-detail" d="M14 21h36M32 3v36M20 8q24 13 0 26M44 8q-24 13 0 26"/>';
}
