"""Account cleanup must validate both sports before removing saved data."""
import json
import unittest
from unittest.mock import patch

from test_auth import FakeTable, FakeGroupTable, event, lambda_app


class AccountDeletionTests(unittest.TestCase):
    def setUp(self):
        self.predictions = FakeTable()
        self.profiles = FakeTable()
        self.groups = FakeGroupTable()
        for name, table in (("predictions_table", self.predictions),
                            ("profiles_table", self.profiles), ("groups_table", self.groups)):
            patcher = patch.object(lambda_app, name, return_value=table)
            patcher.start()
            self.addCleanup(patcher.stop)

    def profile_event(self, method, name=None):
        body = {"leaderboardName": name} if name is not None else None
        return event(method, path="/api/profile", body=body)

    def test_account_cleanup_checks_other_sport_commissionership_before_deleting_picks(self):
        lambda_app.put_profile("user-123", self.profile_event("PUT", name="Jake"))
        lambda_app.create_group("user-123", event("POST", body={
            "groupName": "NBA Crew", "password": "secret-password", "sports": ["nba"]}))
        self.predictions.items = {
            "user-123": {"profileKey": "user-123"},
            "nba#2027#user-123": {"profileKey": "nba#2027#user-123", "ownerId": "user-123"},
        }
        result = lambda_app.handler(self.profile_event("DELETE"), None)
        self.assertEqual(result["statusCode"], 409)
        self.assertIn("NBA Crew", json.loads(result["body"])["message"])
        self.assertEqual(len(self.predictions.items), 2)
        self.assertIsNotNone(lambda_app.get_profile("user-123"))

    def test_account_cleanup_deletes_all_owned_predictions_and_preserves_other_users(self):
        self.predictions.items = {
            "user-123": {"profileKey": "user-123"},
            "nba#2027#user-123": {"profileKey": "nba#2027#user-123", "ownerId": "user-123"},
            "user-456": {"profileKey": "user-456", "ownerId": "user-456"},
        }
        result = lambda_app.handler(self.profile_event("DELETE"), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(set(self.predictions.items), {"user-456"})

