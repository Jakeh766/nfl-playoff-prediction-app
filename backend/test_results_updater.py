"""Tests for durable, finalized-only NFL results ingestion."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
LAMBDA_DIR = Path(__file__).parent / "lambda"


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, LAMBDA_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


updater = load_module("nfl_results_updater", "results_updater.py")
scoring = load_module("nfl_results_scoring", "app.py")


def game(
    event_id: str,
    winner: str,
    loser: str,
    *,
    season_type: int = 3,
    week: int = 1,
    completed: bool = True,
    tied: bool = False,
):
    winner_score, loser_score = ((20, 20) if tied else (24, 17))
    return {
        "id": event_id,
        "date": f"2027-01-{int(event_id[-2:]) % 28 + 1:02d}T18:00:00Z",
        "season": {"year": 2026, "type": season_type},
        "week": {"number": week},
        "status": {"type": {"completed": completed}},
        "competitions": [{
            "competitors": [
                {"team": {"displayName": winner}, "score": str(winner_score)},
                {"team": {"displayName": loser}, "score": str(loser_score)},
            ]
        }],
    }


def scoreboard(*events):
    return {"events": list(events)}


def prediction():
    return {
        "divisionWinners": {
            "AFC": {"North": "Baltimore Ravens", "South": "Houston Texans",
                    "East": "Buffalo Bills", "West": "Kansas City Chiefs"},
            "NFC": {"North": "Minnesota Vikings", "South": "Tampa Bay Buccaneers",
                    "East": "Philadelphia Eagles", "West": "Los Angeles Rams"},
        },
        "seeds": {
            "AFC": ["Kansas City Chiefs", "Buffalo Bills", "Baltimore Ravens",
                    "Houston Texans", "Los Angeles Chargers", "Cincinnati Bengals",
                    "Miami Dolphins"],
            "NFC": ["Philadelphia Eagles", "Minnesota Vikings", "Los Angeles Rams",
                    "Tampa Bay Buccaneers", "Green Bay Packers", "Detroit Lions",
                    "Seattle Seahawks"],
        },
        "picks": {
            "AFC": {"wc-2-7": "Buffalo Bills", "wc-3-6": "Baltimore Ravens",
                    "wc-4-5": "Los Angeles Chargers", "div-1": "Kansas City Chiefs",
                    "div-2": "Buffalo Bills", "conf": "Buffalo Bills"},
            "NFC": {"wc-2-7": "Minnesota Vikings", "wc-3-6": "Los Angeles Rams",
                    "wc-4-5": "Green Bay Packers", "div-1": "Philadelphia Eagles",
                    "div-2": "Minnesota Vikings", "conf": "Minnesota Vikings"},
            "superBowl": "Minnesota Vikings",
        },
    }


def standings():
    picks = prediction()
    children = []
    for conference in ("AFC", "NFC"):
        children.append({
            "abbreviation": conference,
            "standings": {"entries": [
                {
                    "team": {"displayName": team},
                    "stats": [{"type": "playoffseed", "value": index}],
                }
                for index, team in enumerate(picks["seeds"][conference], start=1)
            ]},
        })
    return {"children": children}


class ResultsUpdaterTests(unittest.TestCase):
    def setUp(self):
        self.empty = updater.empty_results()
        self.now = "2027-01-01T00:00:00Z"

    def sync(self, current, payload, table=None):
        return updater.sync_results(current, payload, table, self.now)

    def test_preseason_and_in_progress_games_have_zero_points(self):
        pending = game("01", "Buffalo Bills", "Miami Dolphins", completed=False)
        results = self.sync(self.empty, scoreboard(pending))
        self.assertEqual(results["processedGames"], {})
        for mode in ("classic", "vegas"):
            score = scoring.score_prediction(prediction(), results, mode)
            self.assertEqual(score["total"], 0)
            self.assertEqual(score["possible"], 0)

    def test_regular_season_is_scored_only_after_final_standings(self):
        final = game("02", "Buffalo Bills", "Miami Dolphins", season_type=2, week=18)
        with mock.patch.object(updater, "EXPECTED_REGULAR_SEASON_GAMES", 1):
            results = self.sync(self.empty, scoreboard(final), standings())
        score = scoring.score_prediction(prediction(), results)
        self.assertEqual(score["regularSeason"], 150)
        self.assertEqual(results["status"], "Regular season final")

    def test_each_final_playoff_round_adds_points_without_cascading(self):
        current = self.empty
        stages = [
            (game("03", "Buffalo Bills", "Miami Dolphins", week=1), "wildCard", 5),
            (game("04", "Kansas City Chiefs", "Baltimore Ravens", week=2), "divisional", 15),
            (game("05", "Buffalo Bills", "Kansas City Chiefs", week=3),
             "conferenceChampions", 35),
            (game("06", "Minnesota Vikings", "Buffalo Bills", week=4),
             "superBowlChampion", 75),
        ]
        for event, category, expected_points in stages:
            current = self.sync(current, scoreboard(event))
            self.assertEqual(scoring.score_prediction(prediction(), current)["playoffs"],
                             expected_points)
            self.assertTrue(scoring.score_prediction(prediction(), current)["breakdown"][category]["settled"])

    def test_repeated_and_incomplete_syncs_retain_unique_known_results(self):
        final = game("07", "Buffalo Bills", "Miami Dolphins")
        first = self.sync(self.empty, scoreboard(final))
        repeated = self.sync(first, scoreboard(final))
        incomplete = self.sync(repeated, scoreboard())
        self.assertEqual(len(incomplete["processedGames"]), 1)
        self.assertEqual(incomplete["roundWinners"]["wildCard"], ["Buffalo Bills"])
        self.assertEqual(scoring.score_prediction(prediction(), first)["total"],
                         scoring.score_prediction(prediction(), incomplete)["total"])

    def test_corrected_final_game_replaces_its_prior_winner(self):
        first = self.sync(
            self.empty, scoreboard(game("08", "Buffalo Bills", "Miami Dolphins"))
        )
        corrected = self.sync(
            first, scoreboard(game("08", "Miami Dolphins", "Buffalo Bills"))
        )
        self.assertEqual(corrected["roundWinners"]["wildCard"], ["Miami Dolphins"])

    def test_duplicate_conflict_unknown_team_and_postseason_tie_fail_safely(self):
        with self.assertRaises(updater.ProviderDataError):
            self.sync(self.empty, scoreboard(
                game("09", "Buffalo Bills", "Miami Dolphins"),
                game("09", "Miami Dolphins", "Buffalo Bills"),
            ))
        with self.assertRaises(updater.ProviderDataError):
            self.sync(self.empty, scoreboard(game("10", "Unknown Team", "Buffalo Bills")))
        with self.assertRaises(updater.ProviderDataError):
            self.sync(self.empty, scoreboard(
                game("11", "Buffalo Bills", "Miami Dolphins", tied=True)
            ))

    def test_regular_season_tie_is_retained_without_a_winner(self):
        result = self.sync(self.empty, scoreboard(
            game("12", "Buffalo Bills", "Miami Dolphins", season_type=2, tied=True)
        ))
        self.assertTrue(result["processedGames"]["12"]["tied"])
        self.assertEqual(result["processedGames"]["12"]["winner"], "")

    def test_historical_team_alias_is_normalized(self):
        result = self.sync(self.empty, scoreboard(
            game("15", "Washington Football Team", "Dallas Cowboys")
        ))
        self.assertEqual(
            result["roundWinners"]["wildCard"], ["Washington Commanders"]
        )

    def test_manual_override_is_validated_and_persists_across_provider_sync(self):
        corrected = updater.apply_manual_override(
            self.empty,
            {"roundWinners": {"superBowlChampion": "Buffalo Bills"}},
            "ESPN correction pending",
            self.now,
        )
        refreshed = updater.sync_results(corrected, scoreboard(), None, "2027-02-02T00:00:00Z")
        self.assertEqual(refreshed["roundWinners"]["superBowlChampion"], "Buffalo Bills")
        self.assertTrue(refreshed["manualOverrides"])
        with self.assertRaises(ValueError):
            updater.apply_manual_override(self.empty, {"scoringOdds": {}}, "bad", self.now)

    def test_provider_failure_never_writes_over_last_known_good_item(self):
        known = self.sync(
            self.empty, scoreboard(game("13", "Buffalo Bills", "Miami Dolphins"))
        )

        class FakeTable:
            def __init__(self):
                self.puts = []

            def get_item(self, **_kwargs):
                return {"Item": known}

            def put_item(self, **kwargs):
                self.puts.append(kwargs)

        table = FakeTable()
        with mock.patch.object(updater, "results_table", return_value=table), \
             mock.patch.object(updater, "fetch_json", side_effect=RuntimeError("outage")):
            with self.assertRaises(RuntimeError):
                updater.handler({}, None)
        self.assertEqual(table.puts, [])

    def test_updater_cannot_change_frozen_upset_edge_snapshot(self):
        odds_path = LAMBDA_DIR / "scoring_odds.json"
        before = hashlib.sha256(odds_path.read_bytes()).hexdigest()
        results = self.sync(
            self.empty, scoreboard(game("14", "Miami Dolphins", "Buffalo Bills"))
        )
        vegas = scoring.score_prediction(
            {"picks": {"AFC": {"wc-2-7": "Miami Dolphins"}}}, results, "vegas"
        )
        after = hashlib.sha256(odds_path.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(vegas["total"], 7.0)


if __name__ == "__main__":
    unittest.main()
