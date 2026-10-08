"""Evaluate the deployed CSP expressions and guard browser/auth protections."""
import base64
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = (ROOT / "terraform/modules/app/main.tf").read_text(encoding="utf-8")


@unittest.skipUnless(shutil.which("terraform"), "Terraform CLI is required")
class BrowserSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assets = re.search(r'  frontend_files = merge\(\{.*?\n  \}\)', CONFIG, re.S)[0]
        rendering = re.search(r'locals \{\n  # One content-derived release version.*?\n\}', CONFIG, re.S)[0]
        security = re.search(r'locals \{\n  analytics_connections.*?\n\}', CONFIG, re.S)[0]
        fixture = 'variable "frontend_dir" { default = ' + json.dumps((ROOT / "frontend").as_posix()) + ' }\n'
        fixture += 'variable "environment" { default = "dev" }\nvariable "aws_region" { default = "us-east-1" }\n'
        fixture += 'locals {\n' + assets + '\n}\n' + rendering + '\n' + security
        binary = Path(shutil.which("terraform"))
        wrapper_binary = binary.with_name("terraform-bin" + binary.suffix)
        if wrapper_binary.is_file():
            binary = wrapper_binary
        cls.rendered = {}
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "main.tf").write_text(fixture, encoding="utf-8")
            for env in ("dev", "prod"):
                result = subprocess.run([str(binary), "console", "-no-color", f"-var=environment={env}"],
                    cwd=directory, input='jsonencode({csp=local.content_security_policy, pages=local.frontend_pages})\n',
                    capture_output=True, text=True, encoding="utf-8", timeout=30)
                if result.returncode:
                    raise AssertionError(result.stderr)
                cls.rendered[env] = json.loads(json.loads(result.stdout))

    def test_strict_csp_and_all_inline_blocks_have_exact_hashes(self):
        for env, rendered in self.rendered.items():
            csp = rendered["csp"]
            self.assertLessEqual(len(csp), 1783, (env, len(csp)))
            self.assertNotIn("unsafe-inline", csp)
            self.assertNotIn("unsafe-eval", csp)
            self.assertNotIn("*", csp)
            for directive in ("default-src 'self'", "object-src 'none'", "base-uri 'self'",
                              "frame-ancestors 'none'", "frame-src 'none'", "script-src-attr 'none'",
                              "form-action 'self'", "style-src 'self' https://fonts.googleapis.com",
                              "font-src 'self' https://fonts.gstatic.com"):
                self.assertIn(directive, csp)
            for page, html in rendered["pages"].items():
                for attrs, block in re.findall(r'<script\b([^>]*)>(.*?)</script>', html, re.S):
                    if "src=" in attrs:
                        continue
                    self.assertIn('type="application/ld+json"', attrs, page)
                    digest = base64.b64encode(hashlib.sha256(block.encode()).digest()).decode()
                    self.assertIn(f"'sha256-{digest}'", csp, page)
                self.assertNotRegex(html, r'<style\b|\sstyle=|\son(?:click|load|error)=')

    def test_auth_images_and_analytics_domains_are_allowed(self):
        for env, rendered in self.rendered.items():
            directives = {part.split()[0]: set(part.split()[1:]) for part in rendered["csp"].split("; ")}
            self.assertIn("https://cognito-idp.us-east-1.amazonaws.com", directives["connect-src"])
            self.assertIn("'self'", directives["connect-src"])
            self.assertIn("https://a.espncdn.com", directives["img-src"])
            self.assertEqual(directives["img-src"], {"'self'", "blob:", "https://a.espncdn.com"})
            # Generated PNG previews need blob images, never blob scripts/frames.
            for directive in ("script-src", "frame-src", "object-src"):
                self.assertNotIn("blob:", directives[directive])
            self.assertEqual(directives["connect-src"], {"'self'", "https://cognito-idp.us-east-1.amazonaws.com"} |
                             {"https://predictplayoffs.goatcounter.com"})
            self.assertIn("https://gc.zgo.at", directives["script-src"])
            self.assertIn("https://predictplayoffs.goatcounter.com", directives["connect-src"])

    def test_headers_attach_to_both_behaviors_and_preserve_environment_guards(self):
        self.assertEqual(CONFIG.count("response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id"), 2)
        policy = CONFIG.split('resource "aws_cloudfront_response_headers_policy" "security" {', 1)[1].split('\nresource ', 1)[0]
        self.assertRegex(policy, r'content_type_options\s*\{\s*override = true')
        self.assertRegex(policy, r'frame_option\s*= "DENY"')
        self.assertRegex(policy, r'referrer_policy\s*= "no-referrer"')
        self.assertIn('header   = "Permissions-Policy"', policy)
        self.assertIn('camera=(), microphone=(), geolocation=(), payment=(), usb=()', policy)
        self.assertIn('for_each = var.environment == "prod" ? [] : [1]', policy)
        self.assertIn('header   = "X-Robots-Tag"', policy)
        self.assertIn('value    = "noindex, nofollow"', policy)
        self.assertIn('var.environment == "prod" && length(var.cloudfront_aliases) > 0', policy)
        self.assertIn('access_control_max_age_sec = 31536000', policy)
        self.assertIn('include_subdomains         = false', policy)
        self.assertIn('preload                    = false', policy)
        client = CONFIG.split('resource "aws_cognito_user_pool_client" "browser" {', 1)[1].split('\nresource ', 1)[0]
        self.assertRegex(client, r'refresh_token_validity\s*= 7')
        self.assertRegex(client, r'enable_token_revocation\s*= true')
