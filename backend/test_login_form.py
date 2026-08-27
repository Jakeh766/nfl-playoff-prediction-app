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
        parser = FormParser()
        parser.feed((FRONTEND_DIR / "index.html").read_text(encoding="utf-8"))
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
        app_javascript = (FRONTEND_DIR / "app.js").read_text(encoding="utf-8")
        terraform = (
            FRONTEND_DIR.parent / "terraform" / "modules" / "app" / "main.tf"
        ).read_text(encoding="utf-8")
        self.assertIn('AuthFlow: "USER_PASSWORD_AUTH"', app_javascript)
        self.assertIn('"ALLOW_USER_PASSWORD_AUTH"', terraform)


if __name__ == "__main__":
    unittest.main()
