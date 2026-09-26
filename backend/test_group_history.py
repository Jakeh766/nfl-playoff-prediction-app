"""History must persist, stay private, and never turn preseason into a title."""
import json
import unittest
from unittest.mock import patch

from test_auth import lambda_app as app, FakeGroupTable, event


class GroupHistoryTests(unittest.TestCase):
    def setUp(self):
        self.group_id = "11111111-1111-1111-1111-111111111111"
        self.group = {"groupKey": "group#" + self.group_id, "recordType": "group",
                      "groupId": self.group_id, "groupName": "Sunday Crew",
                      "sports": ["nfl", "nba"], "createdAt": 1}
        self.table = FakeGroupTable({self.group["groupKey"]: self.group})
        for user in ("a", "b"):
            key = app.membership_item_key(self.group_id, user)
            self.table.items[key] = {"groupKey": key, "recordType": "membership",
                                     "groupId": self.group_id, "userId": user, "joinedAt": 1}
        self.results = {"season": 2026, "updatedAt": "2027-02-10T00:00:00Z",
                        "roundWinners": {"superBowlChampion": "Winner"}}
        self.entries = [{"memberId": user, "leaderboardName": user.upper(),
                         "total": 12.5, "regularSeason": 10, "playoffs": 2.5}
                        for user in ("a", "b")]
        self.patches = [patch.object(app, "groups_table", return_value=self.table),
                        patch.object(app, "load_season_results", side_effect=lambda: self.results),
                        patch.object(app, "build_leaderboard", side_effect=lambda *a, **kw: {"entries": self.entries})]
        for active in self.patches:
            active.start()
            self.addCleanup(active.stop)

    def test_empty_until_final_then_idempotent_separate_sport_archives(self):
        self.results["roundWinners"] = {}
        self.assertEqual(app.archive_completed_group_seasons(), {"archived": 0})
        self.assertEqual(app.get_group_history(self.group_id), {"seasons": [], "standings": []})
        self.results["roundWinners"] = {"superBowlChampion": "Winner"}
        self.assertEqual(app.archive_completed_group_seasons(), {"archived": 2})
        self.assertEqual(app.archive_completed_group_seasons(), {"archived": 0})
        history = app.get_group_history(self.group_id)
        self.assertEqual(len(history["seasons"]), 1)
        self.assertEqual(history["seasons"][0]["champions"], ["A", "B"])
        self.assertEqual([row["rank"] for row in history["standings"]], [1, 1])
        self.assertNotIn("memberId", json.dumps(history, default=str))

    def test_later_members_and_groups_do_not_receive_past_titles(self):
        self.table.items[app.membership_item_key(self.group_id, "b")]["joinedAt"] = 9999999999999
        app.archive_completed_group_seasons()
        self.assertEqual(app.get_group_history(self.group_id)["seasons"][0]["champions"], ["A"])
        self.results["season"] = 2027
        self.group["createdAt"] = 9999999999999
        self.assertEqual(app.archive_completed_group_seasons(), {"archived": 0})

    def test_history_survives_membership_changes_and_merges_renamed_members(self):
        app.archive_completed_group_seasons()
        del self.table.items[app.membership_item_key(self.group_id, "b")]
        self.results["season"] = 2027
        self.entries[0]["leaderboardName"] = "New name"
        app.archive_completed_group_seasons()
        standings = app.get_group_history(self.group_id)["standings"]
        self.assertEqual(standings[0]["leaderboardName"], "New name")
        self.assertEqual(standings[0]["titles"], 2)
        self.assertEqual(standings[0]["total"], 25)
        self.assertEqual(standings[1]["seasons"], 1)

    def test_live_route_requires_membership_and_correct_sport(self):
        response = app.handler(event("GET", user_id="outsider", path=f"/api/groups/{self.group_id}/leaderboard"), None)
        self.assertEqual(response["statusCode"], 403)
        self.group["sports"] = ["nba"]
        with self.assertRaises(PermissionError):
            app.get_group_leaderboard(self.group_id, "a")

    def test_zero_scores_have_no_champion(self):
        for entry in self.entries:
            entry.update(total=0, regularSeason=0, playoffs=0)
        app.archive_completed_group_seasons()
        self.assertEqual(app.get_group_history(self.group_id)["seasons"][0]["champions"], [])

    def test_final_cutoff_does_not_move_with_later_result_refreshes(self):
        self.group["createdAt"] = 9999999999999
        app.archive_completed_group_seasons()
        self.group["createdAt"] = 1802304000001  # Just after the first final timestamp.
        self.results["updatedAt"] = "2027-03-01T00:00:00Z"
        self.assertEqual(app.archive_completed_group_seasons(), {"archived": 0})

    def test_scheduled_handler_dispatches_archive(self):
        result = app.handler({"source": "aws.events", "detail-type": "Scheduled Event"}, None)
        self.assertEqual(result, {"archived": 2})
