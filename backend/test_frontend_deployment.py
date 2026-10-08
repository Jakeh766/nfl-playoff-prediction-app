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

        for script in (root / "frontend").glob("*.js"):
            for dependency in re.findall(r'(?:from\s+|import\()"\./([^"?]+\.js)"', script.read_text(encoding="utf-8")):
                with self.subTest(script=script.name, dependency=dependency):
                    self.assertIn(dependency, deployed)
        # Native relative imports cannot inherit a page's ?v= release parameter.
        for module in ("sharing.js", "share-model.js", "share-card.js"):
            self.assertIn(f'"{module}"', manifest)
        self.assertIn('"public, no-cache, must-revalidate"', manifest)


if __name__ == "__main__":
    unittest.main()
