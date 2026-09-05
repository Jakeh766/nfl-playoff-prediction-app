"""Unit tests for preseason prediction scoring."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
MODULE_PATH = Path(__file__).parent / "lambda" / "app.py"
SPEC = importlib.util.spec_from_file_location("nfl_scoring_app", MODULE_PATH)
lambda_app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(lambda_app)


def perfect_prediction():
    return {
        "divisionWinners": {
            "AFC": {
                "North": "Baltimore Ravens",
                "South": "Houston Texans",
                "East": "Buffalo Bills",
                "West": "Kansas City Chiefs",
            },
            "NFC": {
                "North": "Minnesota Vikings",
                "South": "Tampa Bay Buccaneers",
                "East": "Philadelphia Eagles",
                "West": "Los Angeles Rams",
            },
        },
        "seeds": {
            "AFC": [
                "Kansas City Chiefs",
                "Buffalo Bills",
                "Baltimore Ravens",
                "Houston Texans",
                "Los Angeles Chargers",
                "Cincinnati Bengals",
                "Miami Dolphins",
            ],
            "NFC": [
                "Philadelphia Eagles",
                "Minnesota Vikings",
                "Los Angeles Rams",
                "Tampa Bay Buccaneers",
                "Green Bay Packers",
                "Detroit Lions",
                "Seattle Seahawks",
            ],
        },
        "picks": {
            "AFC": {
                "wc-2-7": "Buffalo Bills",
                "wc-3-6": "Baltimore Ravens",
                "wc-4-5": "Los Angeles Chargers",
                "div-1": "Kansas City Chiefs",
                "div-2": "Buffalo Bills",
                "conf": "Buffalo Bills",
            },
            "NFC": {
                "wc-2-7": "Minnesota Vikings",
                "wc-3-6": "Los Angeles Rams",
                "wc-4-5": "Green Bay Packers",
                "div-1": "Philadelphia Eagles",
                "div-2": "Minnesota Vikings",
                "conf": "Minnesota Vikings",
            },
            "superBowl": "Minnesota Vikings",
        },
    }


def completed_results():
    prediction = perfect_prediction()
    return {
        "season": 2026,
        "status": "Final",
        "updatedAt": "2027-02-15",
        "divisionWinners": prediction["divisionWinners"],
        "seeds": prediction["seeds"],
        "roundWinners": {
            "wildCard": [
                "Buffalo Bills",
                "Baltimore Ravens",
                "Los Angeles Chargers",
                "Minnesota Vikings",
                "Los Angeles Rams",
                "Green Bay Packers",
            ],
            "divisional": [
                "Kansas City Chiefs",
                "Buffalo Bills",
                "Philadelphia Eagles",
                "Minnesota Vikings",
            ],
            "conferenceChampions": {
                "AFC": "Buffalo Bills",
                "NFC": "Minnesota Vikings",
            },
            "superBowlChampion": "Minnesota Vikings",
        },
    }


class PredictionScoringTests(unittest.TestCase):
    def test_vegas_perfect_bracket_and_allocations_equal_300(self):
        score = lambda_app.score_prediction(perfect_prediction(), completed_results(), "vegas")
        self.assertEqual(score["total"], 300)
        self.assertEqual(score["possible"], 300)
        self.assertEqual(score["regularSeason"], 150)
        self.assertEqual(score["playoffs"], 150)
        self.assertAlmostEqual(sum(v["maximum"] for v in score["breakdown"].values()), 300)

    def test_vegas_rewards_lower_market_total_in_seeding_and_playoffs(self):
        prediction = perfect_prediction()
        results = completed_results()
        # Vikings (7.5) carry more weight than Rams (11.5), in equal-value slots.
        full = lambda_app.score_prediction(prediction, results, "vegas")
        import copy
        losses = {}
        for team, index, game in (("Minnesota Vikings", 1, "wc-2-7"),
                                  ("Los Angeles Rams", 2, "wc-3-6")):
            partial = copy.deepcopy(results)
            partial["seeds"]["NFC"][index] = ""
            partial["roundWinners"]["wildCard"].remove(team)
            score = lambda_app.score_prediction(prediction, partial, "vegas")
            losses[team] = (full["regularSeason"] - score["regularSeason"],
                            full["playoffs"] - score["playoffs"])
        self.assertGreater(losses["Minnesota Vikings"][0], losses["Los Angeles Rams"][0])
        self.assertGreater(losses["Minnesota Vikings"][1], losses["Los Angeles Rams"][1])

    def test_vegas_blank_picks_do_not_inflate_remaining_credit(self):
        prediction = perfect_prediction()
        prediction["picks"]["NFC"]["wc-2-7"] = "wrong"
        wrong = lambda_app.score_prediction(prediction, completed_results(), "vegas")
        prediction["picks"]["NFC"]["wc-2-7"] = ""
        blank = lambda_app.score_prediction(prediction, completed_results(), "vegas")
        self.assertEqual(blank["total"], wrong["total"])
        self.assertLess(blank["total"], 300)
        self.assertEqual(lambda_app.score_prediction({}, completed_results(), "vegas")["total"], 0)

    def test_vegas_preseason_has_no_earned_or_settled_points(self):
        score = lambda_app.score_prediction(perfect_prediction(), {"season": 2026}, "vegas")
        self.assertEqual(score["total"], 0)
        self.assertEqual(score["possible"], 0)

    def test_perfect_bracket_scores_300_points(self):
        score = lambda_app.score_prediction(perfect_prediction(), completed_results())

        self.assertEqual(score["total"], 300)
        self.assertEqual(score["possible"], 300)
        self.assertEqual(score["maximum"], 300)
        self.assertEqual(score["regularSeason"], 150)
        self.assertEqual(score["playoffs"], 150)

    def test_exact_seed_points_follow_seed_position(self):
        prediction = perfect_prediction()
        prediction["seeds"]["AFC"][0] = "Miami Dolphins"
        prediction["seeds"]["NFC"][4] = "Philadelphia Eagles"

        score = lambda_app.score_prediction(prediction, completed_results())

        self.assertEqual(score["breakdown"]["exactSeeds"]["hits"], 12)
        self.assertEqual(score["breakdown"]["exactSeeds"]["points"], 33)
        self.assertEqual(score["breakdown"]["exactSeeds"]["maximum"], 40)

    def test_partial_seed_results_only_expose_weighted_available_points(self):
        results = completed_results()
        results["seeds"] = {
            "AFC": results["seeds"]["AFC"][:2],
            "NFC": results["seeds"]["NFC"][:1],
        }

        score = lambda_app.score_prediction(perfect_prediction(), results)

        self.assertEqual(score["breakdown"]["exactSeeds"]["points"], 13)
        self.assertEqual(score["breakdown"]["exactSeeds"]["possible"], 13)

    def test_round_winner_scores_without_an_exact_matchup(self):
        prediction = perfect_prediction()
        prediction["seeds"]["NFC"][6] = "Chicago Bears"
        results = completed_results()

        score = lambda_app.score_prediction(prediction, results)

        self.assertEqual(score["breakdown"]["wildCard"]["hits"], 6)
        self.assertEqual(score["breakdown"]["wildCard"]["points"], 30)

    def test_later_round_credit_does_not_cascade_from_earlier_misses(self):
        prediction = perfect_prediction()
        prediction["picks"]["NFC"]["div-1"] = "Seattle Seahawks"
        results = completed_results()

        score = lambda_app.score_prediction(prediction, results)

        self.assertEqual(score["breakdown"]["divisional"]["hits"], 3)
        self.assertEqual(score["breakdown"]["conferenceChampions"]["hits"], 2)
        self.assertEqual(score["breakdown"]["superBowlChampion"]["hits"], 1)

    def test_partial_results_only_expose_points_that_can_be_scored(self):
        results = completed_results()
        results["divisionWinners"] = {"AFC": {"East": "Buffalo Bills"}, "NFC": {}}
        results["seeds"] = {"AFC": [], "NFC": []}
        results["roundWinners"] = {
            "wildCard": ["Buffalo Bills"],
            "divisional": [],
            "conferenceChampions": {},
            "superBowlChampion": "",
        }

        score = lambda_app.score_prediction(perfect_prediction(), results)

        self.assertEqual(score["total"], 10)
        self.assertEqual(score["possible"], 10)
        self.assertEqual(score["breakdown"]["divisionWinners"]["settled"], 1)
        self.assertEqual(score["breakdown"]["wildCard"]["settled"], 1)


if __name__ == "__main__":
    unittest.main()
