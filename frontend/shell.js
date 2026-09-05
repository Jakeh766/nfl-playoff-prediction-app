const pageName = document.body.dataset.page || "home";
const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const routeHref = (path) => localPreview && path !== "/" ? `${path}.html` : path;

const header = document.querySelector("#site-header");
if (header) {
  header.className = "site-header";
  header.innerHTML = `
    <a class="brand" href="/" aria-label="Predict Playoffs home">
      <img class="brand-mark" src="/assets/predict-playoffs-mark.svg" alt="" />
      <span class="brand-name">PREDICT PLAYOFFS</span>
    </a>
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

    <dialog class="account-dialog auth-dialog" id="account-dialog" aria-labelledby="account-dialog-title">
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
          <p class="auth-description">Keep one prediction synced across your devices.</p>
          <form class="sign-in-form" id="sign-in-form" method="post">
            <label for="login-email">Email address</label>
            <input id="login-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            <label for="login-password">Password</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required />
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
            <input id="create-password" name="new-password" type="password" autocomplete="new-password" minlength="6" required />
            <button class="button button-primary auth-button" type="submit">Create account</button>
          </form>
          <button class="auth-back" id="create-account-back" type="button">Back to sign in</button>
        </div>

        <div class="hidden" id="confirm-account-panel">
          <h3>Confirm your account.</h3>
          <p class="auth-description">Enter the verification code sent to your email.</p>
          <form class="auth-form" id="confirm-account-form" method="post">
            <label for="confirm-email">Email address</label>
            <input id="confirm-email" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required />
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
            <input id="reset-password" name="new-password" type="password" autocomplete="new-password" minlength="6" required />
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
    </dialog>

    <dialog class="account-dialog" id="leaderboard-name-dialog" aria-labelledby="leaderboard-name-title" aria-describedby="leaderboard-name-description">
      <form id="leaderboard-name-form" method="post">
        <p class="card-kicker">LEADERBOARD PROFILE</p>
        <h2 id="leaderboard-name-title">Choose your name.</h2>
        <p id="leaderboard-name-description">Choose the public name that identifies your saved prediction and read-only bracket. Every name is unique, ignoring capitalization.</p>
        <label for="leaderboard-name">Leaderboard name</label>
        <input id="leaderboard-name" name="leaderboard-name" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9 ._\\-]*[A-Za-z0-9]" autocomplete="nickname" autocapitalize="words" spellcheck="false" required />
        <p class="input-hint">3–24 characters. Letters, numbers, spaces, periods, underscores, and hyphens.</p>
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
          <input id="group-name" name="group-name" type="text" minlength="3" maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9 ._\\-]*[A-Za-z0-9]" autocomplete="off" autocapitalize="words" spellcheck="false" required />
          <p class="input-hint">3–40 characters. Letters, numbers, spaces, periods, underscores, and hyphens.</p>
          <div id="group-scoring-field">
            <label for="group-scoring">Scoring option</label>
            <select id="group-scoring" name="scoring-option" aria-describedby="group-scoring-hint">
              <option value="classic">Classic · 300 points</option>
              <option value="vegas">Upset Edge · Classic + bonus</option>
            </select>
            <p class="input-hint" id="group-scoring-hint">Upset Edge adds a fixed market-based bonus for every correct pick in seeding and playoffs. Lower-projected teams earn bigger bonuses. Totals can exceed 300. This choice sets your group’s ranking and cannot be changed.</p>
          </div>
          <label for="group-password">Group password</label>
          <input id="group-password" name="group-password" type="password" minlength="6" maxlength="128" autocomplete="current-password" required />
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
    ` : ""}

    <dialog class="account-dialog" id="delete-account-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description">
      <form id="delete-account-form" method="post">
        <p class="card-kicker">PERMANENT ACTION</p>
        <h2 id="delete-account-title">Delete your account?</h2>
        <p id="delete-account-description">This permanently deletes your account, leaderboard name, group memberships, and saved bracket. This cannot be undone.</p>
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
    <p>Your account details stay private. Not affiliated with the NFL.</p>
  `;
}

if (localPreview) {
  document.querySelectorAll("a[data-clean-route]").forEach((link) => {
    link.href = routeHref(link.getAttribute("data-clean-route"));
  });
}
