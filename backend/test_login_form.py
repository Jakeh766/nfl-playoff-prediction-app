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
        self.assertIn('apiRequest("/api/groups")', app_javascript)
        self.assertIn('"/api/groups/join"', app_javascript)
        self.assertIn("/leaderboard`", app_javascript)
        self.assertIn('path.startsWith("/api/groups")', app_javascript)

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
