"""Ensure every local page script is included in the deployed asset manifest."""

import re
import unittest
from pathlib import Path


class FrontendDeploymentTests(unittest.TestCase):
    def test_page_scripts_are_published(self):
        root = Path(__file__).resolve().parent.parent
        manifest = (root / "terraform/modules/app/main.tf").read_text()
        deployed = set(re.findall(r'^\s*"([^"\n]+\.js)"\s*=\s*\{', manifest, re.M))
        # Auth configuration is generated as its own S3 object.
        deployed.add("auth-config.js")
        for page in (root / "frontend").glob("*.html"):
            for script in re.findall(r'<script\b[^>]*\bsrc="/([^"?]+)', page.read_text()):
                with self.subTest(page=page.name, script=script):
                    self.assertIn(script, deployed)


if __name__ == "__main__":
    unittest.main()
