import unittest
from html.parser import HTMLParser
from pathlib import Path


FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


class FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.form_depth = 0
        self.controls = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "form" and attributes.get("id") == "sign-in-form":
            self.form_depth = 1
            self.controls.append((tag, attributes))
        elif self.form_depth:
            self.form_depth += tag == "form"
            if tag in {"input", "button"}:
                self.controls.append((tag, attributes))

    def handle_endtag(self, tag):
        if tag == "form" and self.form_depth:
            self.form_depth -= 1


class LoginFormTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = (FRONTEND_DIR / "shell.js").read_text(encoding="utf-8")
        cls.app_javascript = (FRONTEND_DIR / "app.js").read_text(encoding="utf-8")
        cls.bootstrap_javascript = (FRONTEND_DIR / "bootstrap.js").read_text(
            encoding="utf-8"
        )
        cls.leaderboard_javascript = (
            FRONTEND_DIR / "leaderboard.js"
        ).read_text(encoding="utf-8")
        cls.picks_javascript = (FRONTEND_DIR / "picks.js").read_text(
            encoding="utf-8"
        )
        parser = FormParser()
        parser.feed(cls.shell)
        cls.controls = parser.controls

    def control(self, tag, control_id):
        return next(
            attributes
            for control_tag, attributes in self.controls
            if control_tag == tag and attributes.get("id") == control_id
        )

    def test_login_uses_a_real_post_form(self):
        form = self.control("form", "sign-in-form")
        self.assertEqual(form.get("method"), "post")

    def test_email_is_identified_as_the_username(self):
        email = self.control("input", "login-email")
        self.assertEqual(email.get("type"), "email")
        self.assertEqual(email.get("name"), "username")
        self.assertEqual(email.get("autocomplete"), "username")
        self.assertIn("required", email)

    def test_password_is_identified_as_the_current_password(self):
        password = self.control("input", "login-password")
        self.assertEqual(password.get("type"), "password")
        self.assertEqual(password.get("name"), "password")
        self.assertEqual(password.get("autocomplete"), "current-password")
        self.assertIn("required", password)

    def test_sign_in_is_the_form_submit_button(self):
        submit = self.control("button", "sign-in")
        self.assertEqual(submit.get("type"), "submit")

    def test_frontend_and_cognito_client_enable_the_same_password_flow(self):
        app_javascript = self.app_javascript
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")
        self.assertIn('AuthFlow: "USER_PASSWORD_AUTH"', app_javascript)
        self.assertIn('"ALLOW_USER_PASSWORD_AUTH"', terraform)

    def test_authentication_survives_closing_the_browser(self):
        auth_storage = self.app_javascript[
            self.app_javascript.index("function loadAuthSession") :
            self.app_javascript.index("function decodeJwtPayload")
        ]

        self.assertIn(
            "localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))",
            auth_storage,
        )
        self.assertIn("localStorage.getItem(AUTH_SESSION_KEY)", auth_storage)
        self.assertIn("localStorage.removeItem(AUTH_SESSION_KEY)", auth_storage)
        self.assertIn("sessionStorage.getItem(AUTH_SESSION_KEY)", auth_storage)
        self.assertIn("sessionStorage.removeItem(AUTH_SESSION_KEY)", auth_storage)

    def test_all_account_flows_stay_in_the_application(self):
        app_javascript = self.app_javascript
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")

        for operation in (
            "SignUp",
            "ConfirmSignUp",
            "ResendConfirmationCode",
            "ForgotPassword",
            "ConfirmForgotPassword",
        ):
            self.assertIn(f'requestCognito("{operation}"', app_javascript)

        self.assertNotIn("aws_cognito_user_pool_domain", terraform)
        self.assertNotIn("aws_cognito_managed_login_branding", terraform)
        self.assertNotIn("allowed_oauth_flows                  =", terraform)
        self.assertNotIn("/oauth2/", app_javascript)

    def test_confirmation_reuses_the_initial_password_and_closes_the_dialog(self):
        confirmation_panel = self.shell[
            self.shell.index('id="confirm-account-panel"') :
            self.shell.index('id="forgot-password-panel"')
        ]

        self.assertIn(
            'id="confirm-email" name="username" type="hidden"',
            confirmation_panel,
        )
        self.assertNotIn('for="confirm-email"', confirmation_panel)
        self.assertIn(
            "pendingAccountCredentials = { email, password };",
            self.app_javascript,
        )
        self.assertIn(
            "await finishPasswordSignIn(credentials.email, credentials.password);",
            self.app_javascript,
        )
        self.assertIn(
            "closeAccountModal();",
            self.app_javascript,
        )

    def test_existing_unconfirmed_signup_resends_without_reusing_new_password(self):
        create_flow = self.app_javascript[
            self.app_javascript.index("async function submitCreateAccount") :
            self.app_javascript.index("async function submitConfirmAccount")
        ]

        self.assertIn('error.code === "UsernameExistsException"', create_flow)
        self.assertIn("pendingAccountCredentials = null;", create_flow)
        self.assertIn('elements.createPassword.value = "";', create_flow)
        self.assertIn("await requestConfirmationCode(email);", create_flow)
        self.assertIn("elements.confirmEmail.value = email;", create_flow)
        self.assertIn(
            "You started creating an account with this email earlier.",
            create_flow,
        )
        self.assertLess(
            create_flow.index("pendingAccountCredentials = null;"),
            create_flow.index("await requestConfirmationCode(email);"),
        )

        confirm_flow = self.app_javascript[
            self.app_javascript.index("async function submitConfirmAccount") :
            self.app_javascript.index("async function resendConfirmationCode")
        ]
        self.assertIn(
            'showAuthPanel("signIn", "Email confirmed. Sign in to continue.");',
            confirm_flow,
        )

    def test_confirmed_account_recovery_returns_to_sign_in(self):
        self.assertIn(
            'error.code === "InvalidParameterException"',
            self.app_javascript,
        )
        self.assertIn(
            "An account already exists for this email. Sign in, or use Forgot password",
            self.app_javascript,
        )
        self.assertIn(
            "This account is already confirmed. Sign in, or use Forgot password",
            self.app_javascript,
        )

    def test_unconfirmed_sign_in_points_to_resend_action(self):
        confirmation_panel = self.shell[
            self.shell.index('id="confirm-account-panel"') :
            self.shell.index('id="forgot-password-panel"')
        ]

        self.assertIn('id="resend-confirmation" type="button"', confirmation_panel)
        self.assertIn("request a new code below", confirmation_panel)
        self.assertIn("select Resend code below for a new one", self.app_javascript)

    def test_account_modal_avoids_the_browser_top_layer(self):
        account_markup = self.shell[
            self.shell.index('id="account-dialog"') :
            self.shell.index('id="leaderboard-name-dialog"')
        ]
        all_javascript = "\n".join(
            (self.app_javascript, self.bootstrap_javascript)
        )

        self.assertIn('role="dialog"', account_markup)
        self.assertIn('aria-modal="true"', account_markup)
        self.assertIn('aria-hidden="true" hidden', account_markup)
        self.assertNotIn('<dialog class="account-dialog auth-dialog"', self.shell)
        self.assertIn('<dialog class="account-dialog" id="leaderboard-name-dialog"', self.shell)
        self.assertIn('event.key === "Escape"', all_javascript)
        self.assertIn('event.key !== "Tab"', all_javascript)
        self.assertIn("accountModalReturnFocus.focus()", all_javascript)
        self.assertIn("setAccountModalBackgroundInert(true)", all_javascript)

    def test_account_deletion_requires_confirmation_and_removes_saved_data_first(self):
        html = self.shell
        app_javascript = self.app_javascript

        self.assertIn('id="delete-account-dialog"', html)
        self.assertIn('id="delete-account-confirmation"', html)
        self.assertIn('value !== "DELETE"', app_javascript)

        delete_flow = app_javascript[app_javascript.index("async function submitDeleteAccount") :]
        prediction_delete = delete_flow.index(
            'apiRequest("/api/prediction", { method: "DELETE" })'
        )
        profile_delete = delete_flow.index(
            'apiRequest("/api/profile", { method: "DELETE" })'
        )
        account_delete = delete_flow.index('requestCognito("DeleteUser"')
        self.assertLess(prediction_delete, account_delete)
        self.assertLess(prediction_delete, profile_delete)
        self.assertLess(profile_delete, account_delete)

    def test_signed_in_card_keeps_account_details_in_account_dialog(self):
        html = self.shell

        signed_in_panel = html[
            html.index('id="signed-in-panel"') : html.index('id="auth-message"')
        ]
        account_dialog = html[
            html.index('id="account-dialog"') : html.index('id="leaderboard-name-dialog"')
        ]

        self.assertIn('id="open-prediction"', signed_in_panel)
        self.assertNotIn('id="account-email"', signed_in_panel)
        self.assertNotIn('id="change-leaderboard-name"', signed_in_panel)
        self.assertIn('id="account-email"', account_dialog)
        self.assertIn('id="change-leaderboard-name"', account_dialog)
        self.assertIn('id="delete-account"', account_dialog)

    def test_leaderboard_name_is_required_and_sent_to_the_profile_api(self):
        html = self.shell
        app_javascript = self.app_javascript
        picks_javascript = self.picks_javascript

        self.assertIn('id="leaderboard-name-form"', html)
        self.assertIn('id="leaderboard-name"', html)
        self.assertIn("apostrophes, underscores, and hyphens", self.shell)
        self.assertIn("explainNameValidation", self.bootstrap_javascript)
        self.assertIn('maxlength="24"', html)
        self.assertIn('apiRequest("/api/profile", {', app_javascript)
        self.assertIn("openLeaderboardNameDialog(true);", picks_javascript)

        save_flow = picks_javascript[
            picks_javascript.index("async function savePrediction") :
        ]
        self.assertLess(
            save_flow.index("if (!allGamesPicked())"),
            save_flow.index("if (!state.leaderboardName)"),
        )

    def test_public_leaderboard_is_rendered_without_private_account_data(self):
        html = (FRONTEND_DIR / "leaderboard.html").read_text(encoding="utf-8")
        html += self.shell
        app_javascript = self.leaderboard_javascript

        self.assertIn('id="leaderboard-section"', html)
        self.assertIn('id="leaderboard-body"', html)
        self.assertIn('id="public-bracket-dialog"', html)
        self.assertIn('apiRequest("/api/leaderboard")', app_javascript)
        self.assertIn("View bracket", app_javascript)
        self.assertIn("encodeURIComponent(entry.leaderboardName)", app_javascript)
        leaderboard_renderer = app_javascript[
            app_javascript.index("function renderLeaderboard()") :
            app_javascript.index("async function loadLeaderboard()")
        ]
        self.assertNotIn("userEmail", leaderboard_renderer)
        self.assertNotIn("profileKey", leaderboard_renderer)

        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'route_key = "GET /api/leaderboard/{leaderboardName}/bracket"',
            terraform,
        )

    def test_public_and_group_leaderboards_share_a_toggleable_section(self):
        html = (FRONTEND_DIR / "leaderboard.html").read_text(encoding="utf-8")
        html += self.shell
        app_javascript = "\n".join(
            (
                self.app_javascript,
                self.leaderboard_javascript,
                self.bootstrap_javascript,
            )
        )

        self.assertIn('id="leaderboard-section"', html)
        self.assertIn('id="public-leaderboard-tab"', html)
        self.assertIn('id="groups-leaderboard-tab"', html)
        self.assertIn('id="public-leaderboard-panel"', html)
        self.assertIn('id="groups-leaderboard-panel"', html)
        self.assertNotIn('id="groups-section"', html)
        self.assertIn('renderLeaderboardView("groups")', app_javascript)
        self.assertIn('id="create-group"', html)
        self.assertIn('id="join-group"', html)
        self.assertIn('id="group-password"', html)
        self.assertIn('type="password"', html)
        self.assertIn(
            'id="group-password" name="group-password" type="password" minlength="6" maxlength="128" autocomplete="off" data-bwignore="true" data-1p-ignore data-lpignore="true" data-form-type="other" data-keeper-ignore="true"',
            html,
        )
        self.assertIn('apiRequest("/api/groups")', app_javascript)
        self.assertIn('"/api/groups/join"', app_javascript)
        self.assertIn("/leaderboard`", app_javascript)
        self.assertIn('path.startsWith("/api/groups")', app_javascript)

    def test_password_fields_share_an_accessible_visibility_toggle(self):
        password_ids = (
            "login-password",
            "create-password",
            "reset-password",
            "group-password",
        )
        for password_id in password_ids:
            self.assertIn(f'id="{password_id}"', self.shell)
            self.assertIn(
                f'data-password-toggle aria-controls="{password_id}" '
                'aria-label="Show password" aria-pressed="false"',
                self.shell,
            )

        self.assertEqual(self.shell.count('class="password-toggle" type="button"'), 4)
        self.assertIn(
            'document.querySelectorAll("[data-password-toggle]")',
            self.bootstrap_javascript,
        )
        toggle_flow = self.bootstrap_javascript[
            self.bootstrap_javascript.index("function setPasswordVisibility") :
            self.bootstrap_javascript.index("function resetPasswordVisibility")
        ]
        self.assertIn('input.type = visible ? "text" : "password";', toggle_flow)
        self.assertIn('visible ? "Hide password" : "Show password"', toggle_flow)
        self.assertIn('toggle.setAttribute("aria-pressed", String(visible));', toggle_flow)
        self.assertNotIn("input.value", toggle_flow)

    def test_homepage_exposes_group_actions_and_link_invites(self):
        home = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
        app_javascript = "\n".join(
            (
                self.app_javascript,
                self.leaderboard_javascript,
                self.bootstrap_javascript,
            )
        )
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")

        self.assertIn('id="home-groups"', home)
        self.assertIn('id="home-create-group"', home)
        self.assertIn('id="home-join-group"', home)
        self.assertIn('id="home-accept-invite"', home)
        self.assertLess(
            home.index('id="home-invite-callout"'),
            home.index('class="home-hero"'),
        )
        self.assertIn('document.body.classList.toggle("has-group-invite"', app_javascript)
        self.assertIn('"Sign in to join group"', app_javascript)
        self.assertIn('id="group-invite-dialog"', self.shell)
        leaderboard = (FRONTEND_DIR / "leaderboard.html").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="share-group-invite"', leaderboard)
        self.assertIn('apiRequest("/api/groups/join-invite"', app_javascript)
        self.assertIn("/invite`", app_javascript)
        self.assertIn('route_key          = "POST /api/groups/join-invite"', terraform)
        self.assertIn('route_key          = "GET /api/groups/{groupId}/invite"', terraform)
        groups_resource = 'Resource = aws_dynamodb_table.groups.arn'
        groups_resource_index = terraform.index(groups_resource)
        groups_permissions = terraform[:groups_resource_index].rsplit("{", 1)[-1]
        self.assertIn('"dynamodb:UpdateItem"', groups_permissions)

    def test_group_deletion_is_creator_only_and_confirmed(self):
        html = (FRONTEND_DIR / "leaderboard.html").read_text(encoding="utf-8")
        app_javascript = "\n".join(
            (
                self.app_javascript,
                self.leaderboard_javascript,
                self.bootstrap_javascript,
            )
        )
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")

        self.assertIn('id="delete-group"', html)
        self.assertIn('id="delete-group-dialog"', self.shell)
        self.assertIn("activeGroup?.isCreator", app_javascript)
        self.assertIn("apiRequest(`/api/groups/${encodeURIComponent(group.groupId)}`", app_javascript)
        self.assertIn('route_key          = "DELETE /api/groups/{groupId}"', terraform)
        self.assertIn('id="leave-group"', html)
        self.assertIn('id="leave-group-dialog"', self.shell)
        self.assertIn('}/members`', app_javascript)
        self.assertIn('}/membership`', app_javascript)
        self.assertIn('route_key          = "GET /api/groups/{groupId}/members"', terraform)
        self.assertIn('route_key          = "DELETE /api/groups/{groupId}/membership"', terraform)

    def test_primary_features_have_clean_dedicated_pages(self):
        home = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
        picks = (FRONTEND_DIR / "picks.html").read_text(encoding="utf-8")
        leaderboard = (FRONTEND_DIR / "leaderboard.html").read_text(
            encoding="utf-8"
        )
        scoring = (FRONTEND_DIR / "scoring.html").read_text(encoding="utf-8")
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")

        self.assertNotIn('id="predictor"', home)
        self.assertNotIn('id="leaderboard-section"', home)
        self.assertNotIn('id="scoring-section"', home)
        self.assertIn('id="predictor"', picks)
        self.assertIn('id="saved-section"', picks)
        self.assertIn('id="leaderboard-section"', leaderboard)
        self.assertIn('id="scoring-section"', scoring)

        for route, source in (
            ("picks", "picks.html"),
            ("leaderboard", "leaderboard.html"),
            ("scoring", "scoring.html"),
        ):
            self.assertIn(f'"{route}" = {{', terraform)
            self.assertIn(f'${{var.frontend_dir}}/{source}', terraform)

    def test_deployed_frontend_files_are_not_browser_cached(self):
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")
        cache_directive = (
            'cache_control = "no-store, no-cache, must-revalidate, max-age=0"'
        )
        self.assertEqual(terraform.count(cache_directive), 2)


if __name__ == "__main__":
    unittest.main()
