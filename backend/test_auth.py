"""Unit tests for authenticated prediction ownership in the Lambda handler."""

from __future__ import annotations

import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
MODULE_PATH = Path(__file__).parent / "lambda" / "app.py"
SPEC = importlib.util.spec_from_file_location("nfl_lambda_app", MODULE_PATH)
lambda_app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(lambda_app)


class FakeTable:
    def __init__(self, items=None):
        self.items = dict(items or {})

    def get_item(self, *, Key):
        item = self.items.get(Key["profileKey"])
        return {"Item": item} if item else {}

    def put_item(
        self,
        *,
        Item,
        ConditionExpression=None,
        ExpressionAttributeValues=None,
    ):
        existing = self.items.get(Item["profileKey"])
        if ConditionExpression and existing:
            owner = (ExpressionAttributeValues or {}).get(":owner")
            if existing.get("ownerId") != owner:
                raise ConditionalCheckFailed()
        self.items[Item["profileKey"]] = Item

    def delete_item(
        self,
        *,
        Key,
        ConditionExpression=None,
        ExpressionAttributeValues=None,
    ):
        existing = self.items.get(Key["profileKey"])
        if ConditionExpression:
            owner = (ExpressionAttributeValues or {}).get(":owner")
            if not existing or existing.get("ownerId") != owner:
                raise ConditionalCheckFailed()
        self.items.pop(Key["profileKey"], None)


class ConditionalCheckFailed(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


def event(
    method: str,
    user_id: str | None = "user-123",
    body=None,
    path: str = "/api/prediction",
):
    request_context = {"http": {"method": method}}
    if user_id:
        request_context["authorizer"] = {"jwt": {"claims": {"sub": user_id}}}
    return {
        "rawPath": path,
        "requestContext": request_context,
        "body": json.dumps(body) if body is not None else None,
    }


def valid_prediction():
    return {
        "displayName": "must not be persisted",
        "divisionWinners": {"AFC": {}, "NFC": {}},
        "seeds": {"AFC": ["team"] * 7, "NFC": ["team"] * 7},
        "picks": {"AFC": {}, "NFC": {}, "superBowl": "team"},
        "bracketBuilt": True,
    }


class PredictionAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.table = FakeTable()
        self.profiles = FakeTable(
            {
                "user#user-123": {
                    "profileKey": "user#user-123",
                    "leaderboardName": "Jake",
                    "normalizedName": "jake",
                }
            }
        )
        lambda_app.predictions_table = lambda: self.table
        lambda_app.profiles_table = lambda: self.profiles

    def test_prediction_route_requires_verified_claims(self):
        result = lambda_app.handler(event("GET", user_id=None), None)

        self.assertEqual(result["statusCode"], 401)

    def test_put_uses_sub_and_does_not_store_display_name(self):
        result = lambda_app.handler(event("PUT", body=valid_prediction()), None)
        stored = self.table.items["user-123"]

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(stored["profileKey"], "user-123")
        self.assertNotIn("displayName", stored)

    def test_get_cannot_read_another_users_prediction(self):
        self.table.items["another-user"] = {
            "profileKey": "another-user",
            "savedAt": 1,
        }

        result = lambda_app.handler(event("GET", user_id="user-123"), None)

        self.assertEqual(result["statusCode"], 404)

    def test_delete_only_removes_current_users_prediction(self):
        self.table.items = {
            "user-123": {"profileKey": "user-123"},
            "another-user": {"profileKey": "another-user"},
        }

        result = lambda_app.handler(event("DELETE"), None)

        self.assertEqual(result["statusCode"], 200)
        self.assertNotIn("user-123", self.table.items)
        self.assertIn("another-user", self.table.items)

    def test_prediction_cannot_be_saved_without_a_leaderboard_name(self):
        self.profiles.items = {}

        result = lambda_app.handler(event("PUT", body=valid_prediction()), None)

        self.assertEqual(result["statusCode"], 400)
        self.assertIn("leaderboard name", json.loads(result["body"])["message"])


class LeaderboardProfileTests(unittest.TestCase):
    def setUp(self):
        self.profiles = FakeTable()
        lambda_app.profiles_table = lambda: self.profiles

    def profile_event(self, method, user_id="user-123", name=None):
        body = {"leaderboardName": name} if name is not None else None
        return event(method, user_id=user_id, body=body, path="/api/profile")

    def test_profile_route_requires_verified_claims(self):
        result = lambda_app.handler(
            self.profile_event("GET", user_id=None),
            None,
        )

        self.assertEqual(result["statusCode"], 401)

    def test_names_are_unique_ignoring_case_and_outer_spaces(self):
        first = lambda_app.handler(self.profile_event("PUT", name="  Jake  "), None)
        second = lambda_app.handler(
            self.profile_event("PUT", user_id="user-456", name="jAkE"),
            None,
        )

        self.assertEqual(first["statusCode"], 200)
        self.assertEqual(json.loads(first["body"])["leaderboardName"], "Jake")
        self.assertEqual(second["statusCode"], 400)
        self.assertIn("already taken", json.loads(second["body"])["message"])

    def test_renaming_releases_the_previous_name(self):
        lambda_app.handler(self.profile_event("PUT", name="Jake"), None)
        rename = lambda_app.handler(self.profile_event("PUT", name="Gridiron Jake"), None)
        reclaimed = lambda_app.handler(
            self.profile_event("PUT", user_id="user-456", name="JAKE"),
            None,
        )

        self.assertEqual(rename["statusCode"], 200)
        self.assertEqual(reclaimed["statusCode"], 200)
        self.assertNotIn("name#jake", {
            key: value
            for key, value in self.profiles.items.items()
            if value.get("ownerId") == "user-123"
        })

    def test_deleting_profile_releases_its_name(self):
        lambda_app.handler(self.profile_event("PUT", name="Jake"), None)

        deleted = lambda_app.handler(self.profile_event("DELETE"), None)
        reclaimed = lambda_app.handler(
            self.profile_event("PUT", user_id="user-456", name="Jake"),
            None,
        )

        self.assertEqual(deleted["statusCode"], 200)
        self.assertEqual(reclaimed["statusCode"], 200)

    def test_invalid_characters_are_rejected(self):
        result = lambda_app.handler(
            self.profile_event("PUT", name="Jake🏈"),
            None,
        )

        self.assertEqual(result["statusCode"], 400)


if __name__ == "__main__":
    unittest.main()
