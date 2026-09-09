import re
import unittest
from pathlib import Path


FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


class BracketInteractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.styles = (FRONTEND_DIR / "styles.css").read_text(encoding="utf-8")

    def test_hover_styles_do_not_override_a_selected_team(self):
        hover_selectors = re.findall(
            r"([^{}]*\.team-pick[^{}]*:hover)\s*\{",
            self.styles,
        )

        self.assertGreaterEqual(len(hover_selectors), 2)
        for selector in hover_selectors:
            self.assertIn(
                ":not(.selected)",
                selector,
                f"Selected bracket teams must be excluded from hover rule: {selector}",
            )


if __name__ == "__main__":
    unittest.main()
