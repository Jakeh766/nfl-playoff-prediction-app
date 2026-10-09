"""Season grouping, participant deduplication and bounded private reporting."""
import importlib
import json
import os
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / "lambda"))
sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
seasons = importlib.import_module("season_analytics")


class Pages:
    def __init__(self, pages):
        self.pages = iter(pages)
        self.calls = []

    def scan(self, **arguments):
        self.calls.append(arguments.copy())
        return next(self.pages)


class SeasonTests(unittest.TestCase):
    def report(self, predictions, groups):
        tables = {"predictions": predictions, "groups": groups}
        with patch.dict(os.environ, PREDICTIONS_TABLE="predictions", GROUPS_TABLE="groups", RESULTS_SEASON="2026"), \
                patch.object(seasons, "reporting_resource", return_value=types.SimpleNamespace(Table=tables.__getitem__)):
            return seasons.report({}, None, None)

    def test_pagination_sport_seasons_unique_people_and_overlapping_groups(self):
        predictions = Pages([{"Items": [{"profileKey": "alice", "bracketBuilt": True},
                                        {"profileKey": "bob", "sport": "nfl", "season": 2026, "bracketBuilt": True}],
                              "LastEvaluatedKey": {"profileKey": "bob"}},
                             {"Items": [{"profileKey": "nba#2027#alice", "bracketBuilt": True},
                                        {"profileKey": "draft", "bracketBuilt": False}]}])
        groups = Pages([{"Items": [
            {"recordType": "group", "groupId": "both", "sports": ["nfl", "nba"]},
            {"recordType": "group", "groupId": "legacy"},
            {"recordType": "group", "groupId": "empty", "sports": ["nba"]},
            *[{"recordType": "membership", "groupId": group, "userId": user} for group, user in
              [("both", "alice"), ("both", "bob"), ("both", "no-bracket"), ("legacy", "alice"),
               ("legacy", "alice"), ("orphan", "bob"), ("empty", "no-bracket")]]]}])
        report = self.report(predictions, groups)
        nba, nfl = report["tables"][0]["rows"]
        self.assertEqual(nba, {"season": "NBA 2026–27", "brackets": 1, "competitions": 1,
                               "people": 1, "entries": 1, "average": 1.0, "largest": 1})
        self.assertEqual(nfl, {"season": "NFL 2026", "brackets": 2, "competitions": 2,
                               "people": 2, "entries": 3, "average": 1.5, "largest": 2})
        self.assertEqual(predictions.calls[1]["ExclusiveStartKey"], {"profileKey": "bob"})
        fields = set(predictions.calls[0]["ExpressionAttributeNames"].values())
        self.assertFalse(fields & {"picks", "seeds", "passwordHash", "inviteCode"})
        self.assertNotIn("alice", json.dumps(report))
        self.assertNotIn("both", json.dumps(report))

    def test_archives_preserve_past_members_and_override_current_rosters(self):
        groups = Pages([{"Items": [
            {"recordType": "group", "groupId": "group", "sports": ["nfl"]},
            {"recordType": "membership", "groupId": "group", "userId": "new"},
            {"recordType": "groupSeason", "groupId": "group", "sport": "nfl", "season": 2026,
             "entries": [{"memberId": "archived"}, {"memberId": "archived"}]},
            {"recordType": "groupSeason", "groupId": "past", "sport": "nfl", "season": 2025,
             "entries": [{"memberId": "archived"}, {"memberId": "other"}]},
            {"recordType": "groupSeason", "groupId": "invalid", "sport": "mlb", "season": 2025,
             "entries": [{"memberId": "other"}]}]}])
        report = self.report(Pages([{"Items": [{"profileKey": "new", "bracketBuilt": True}]}]), groups)
        rows = {row["season"]: row for row in report["tables"][0]["rows"]}
        self.assertEqual(rows["NFL 2026"]["people"], 1)
        self.assertEqual(rows["NFL 2026"]["largest"], 1)
        self.assertEqual(rows["NFL 2025"]["people"], 2)
        self.assertIsNone(rows["NFL 2025"]["brackets"])

    def test_empty_seasons_have_zero_counts_and_no_average(self):
        report = self.report(Pages([{}]), Pages([{}]))
        self.assertEqual(len(report["tables"][0]["rows"]), 2)
        for row in report["tables"][0]["rows"]:
            self.assertEqual(row["brackets"], 0)
            self.assertEqual(row["competitions"], 0)
            self.assertEqual(row["people"], 0)
            self.assertEqual(row["largest"], 0)
            self.assertIsNone(row["average"])

        for table in report["tables"][1:]:
            self.assertIn("0 total groups", table["title"])
            self.assertEqual(table["rows"], [
                {"mode": "Classic", "groups": 0, "share": None},
                {"mode": "Upset Edge", "groups": 0, "share": None}])

    def test_current_scoring_modes_use_per_sport_defaults_and_all_groups(self):
        groups = Pages([{"Items": [
            {"recordType": "group", "groupId": "legacy-classic"},
            {"recordType": "group", "groupId": "legacy-edge", "scoringOption": "vegas"},
            {"recordType": "group", "groupId": "mixed", "sports": ["nfl", "nba"],
             "scoringOption": "vegas", "scoringOptions": {"nfl": "classic"}},
            {"recordType": "membership", "groupId": "legacy-edge", "userId": "private-user",
             "scoringOption": "vegas"}], "LastEvaluatedKey": {"groupKey": "next"}},
            {"Items": [
                {"recordType": "group", "groupId": "nba-only", "sports": ["nba"],
                 "scoringOptions": {"nba": "classic"}},
                {"recordType": "group", "groupId": "nba-empty-default", "sports": ["nba"],
                 "scoringOptions": {}},
                {"recordType": "groupSeason", "groupId": "deleted-archive", "sport": "nfl",
                 "season": 2025, "scoringOption": "vegas", "entries": [{"memberId": "private-user"}]},
                {"recordType": "invite", "groupId": "invite-only", "scoringOption": "vegas"}]}])
        report = self.report(Pages([{}]), groups)
        nfl, nba = report["tables"][1:]
        self.assertEqual(nfl["title"], "Current NFL group scoring modes (3 total groups)")
        self.assertEqual(nba["title"], "Current NBA group scoring modes (3 total groups)")
        for table in (nfl, nba):
            self.assertEqual(table["rows"], [
                {"mode": "Classic", "groups": 2, "share": 2 / 3},
                {"mode": "Upset Edge", "groups": 1, "share": 1 / 3}])
        self.assertEqual(groups.calls[1]["ExclusiveStartKey"], {"groupKey": "next"})
        fields = set(groups.calls[0]["ExpressionAttributeNames"].values())
        self.assertTrue({"scoringOption", "scoringOptions", "sports"} <= fields)
        self.assertFalse(fields & {"groupName", "passwordHash", "inviteCode", "picks"})
        for private in ("private-user", "legacy-edge", "deleted-archive", "mixed"):
            self.assertNotIn(private, json.dumps(report))

    def test_single_mode_and_sport_have_complete_counts(self):
        for mode, counts in (("classic", (1, 0)), ("vegas", (0, 1))):
            report = self.report(Pages([{}]), Pages([{"Items": [
                {"recordType": "group", "groupId": "empty", "scoringOption": mode}]}]))
            self.assertEqual([row["groups"] for row in report["tables"][1]["rows"]], list(counts))
            self.assertEqual([row["share"] for row in report["tables"][1]["rows"]], list(counts))
            self.assertTrue(all(row["share"] is None for row in report["tables"][2]["rows"]))

    def test_reporting_scans_only_the_configured_environments_tables(self):
        for environment in ("dev", "prod"):
            resource = types.SimpleNamespace(Table=lambda _name: Pages([{}]))
            with patch.dict(os.environ, ENVIRONMENT=environment, RESULTS_SEASON="2026",
                            PREDICTIONS_TABLE=f"{environment}-predictions", GROUPS_TABLE=f"{environment}-groups"), \
                    patch.object(seasons, "reporting_resource", return_value=resource), \
                    patch.object(resource, "Table", wraps=resource.Table) as table:
                seasons.report({}, None, None)
            self.assertEqual([call.args[0] for call in table.call_args_list],
                             [f"{environment}-predictions", f"{environment}-groups"])

    def test_failed_and_bounded_scans_never_return_partial_totals(self):
        class Failing:
            def scan(self, **_arguments):
                raise RuntimeError("private upstream data")
        with self.assertRaises(RuntimeError):
            self.report(Pages([{}]), Failing())
        partial = Pages([{"Items": [{"recordType": "group", "groupId": "partial", "scoringOption": "vegas"}],
                         "LastEvaluatedKey": {"key": 1}}])
        with self.assertRaises(RuntimeError):
            self.report(Pages([{}]), partial)
        table = Pages([{"Items": [{"profileKey": "person"}], "LastEvaluatedKey": {"key": 1}}] * 100)
        with self.assertRaises(RuntimeError):
            list(seasons.scan_records(table, ["profileKey"], time.monotonic() + 10))
        expired = Pages([{}])
        with self.assertRaises(RuntimeError):
            list(seasons.scan_records(expired, ["profileKey"], 0))
        self.assertEqual(expired.calls, [])
