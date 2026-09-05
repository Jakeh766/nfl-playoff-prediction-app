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

    def scan(self, **_arguments):
        return {"Items": list(self.items.values())}


class FakeGroupTable:
    def __init__(self, items=None):
        self.items = dict(items or {})

    def get_item(self, *, Key):
        item = self.items.get(Key["groupKey"])
        return {"Item": item} if item else {}

    def put_item(self, *, Item, ConditionExpression=None):
        if ConditionExpression and Item["groupKey"] in self.items:
            raise ConditionalCheckFailed()
        self.items[Item["groupKey"]] = Item

    def delete_item(self, *, Key):
        self.items.pop(Key["groupKey"], None)

    def update_item(
        self,
        *,
        Key,
        UpdateExpression,
        ConditionExpression=None,
        ExpressionAttributeValues=None,
        ReturnValues=None,
    ):
        item = self.items[Key["groupKey"]]
        if ConditionExpression and "inviteCode" in item:
            raise ConditionalCheckFailed()
        if UpdateExpression != "SET inviteCode = :inviteCode":
            raise AssertionError(f"Unexpected update expression: {UpdateExpression}")
        item["inviteCode"] = ExpressionAttributeValues[":inviteCode"]
        return {"Attributes": item.copy()} if ReturnValues == "ALL_NEW" else {}

    def scan(self, **_arguments):
        return {"Items": list(self.items.values())}


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


class NameNormalizationTests(unittest.TestCase):
    def test_leaderboard_validation_messages_are_preserved(self):
        cases = (
            (None, "leaderboardName must be a string"),
            ("A", "Leaderboard name must be between 3 and 24 characters"),
            (
                "Jake🏈",
                "Leaderboard name may use letters, numbers, spaces, periods, underscores, and hyphens",
            ),
        )

        for value, message in cases:
            with self.subTest(value=value), self.assertRaisesRegex(
                ValueError, f"^{message}$"
            ):
                lambda_app.normalize_leaderboard_name(value)

    def test_group_validation_messages_are_preserved(self):
        cases = (
            (None, "groupName must be a string"),
            ("A", "Group name must be between 3 and 40 characters"),
            (
                "Crew🏈",
                "Group name may use letters, numbers, spaces, periods, underscores, and hyphens",
            ),
        )

        for value, message in cases:
            with self.subTest(value=value), self.assertRaisesRegex(
                ValueError, f"^{message}$"
            ):
                lambda_app.normalize_group_name(value)


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

    def test_prediction_cannot_be_created_or_changed_after_kickoff(self):
        original_lock_at = lambda_app.PREDICTION_LOCK_AT
        original_time = lambda_app.time.time
        lambda_app.PREDICTION_LOCK_AT = "2026-09-10T00:20:00Z"
        lambda_app.time.time = lambda: 1_789_000_000
        self.table.items["user-123"] = {
            "profileKey": "user-123",
            "savedAt": 123,
        }

        try:
            result = lambda_app.handler(event("PUT", body=valid_prediction()), None)
        finally:
            lambda_app.PREDICTION_LOCK_AT = original_lock_at
            lambda_app.time.time = original_time

        self.assertEqual(result["statusCode"], 423)
        self.assertEqual(self.table.items["user-123"]["savedAt"], 123)
        self.assertTrue(json.loads(result["body"])["locked"])


class PredictionWindowTests(unittest.TestCase):
    def test_window_endpoint_is_public_and_reports_server_time(self):
        original_lock_at = lambda_app.PREDICTION_LOCK_AT
        original_time = lambda_app.time.time
        lambda_app.PREDICTION_LOCK_AT = "2026-09-10T00:20:00Z"
        lambda_app.time.time = lambda: 1_788_900_000

        try:
            result = lambda_app.handler(
                event("GET", user_id=None, path="/api/prediction-window"),
                None,
            )
        finally:
            lambda_app.PREDICTION_LOCK_AT = original_lock_at
            lambda_app.time.time = original_time

        payload = json.loads(result["body"])
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(payload["lockAt"], "2026-09-10T00:20:00Z")
        self.assertEqual(payload["serverTime"], 1_788_900_000_000)
        self.assertFalse(payload["locked"])


class LeaderboardProfileTests(unittest.TestCase):
    def setUp(self):
        self.profiles = FakeTable()
        self.groups = FakeGroupTable()
        lambda_app.profiles_table = lambda: self.profiles
        lambda_app.groups_table = lambda: self.groups

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

    def test_deleting_profile_removes_private_group_memberships(self):
        self.groups.items = {
            "membership#group-1#user#user-123": {
                "groupKey": "membership#group-1#user#user-123",
                "recordType": "membership",
                "groupId": "group-1",
                "userId": "user-123",
            },
            "membership#group-1#user#user-456": {
                "groupKey": "membership#group-1#user#user-456",
                "recordType": "membership",
                "groupId": "group-1",
                "userId": "user-456",
            },
        }

        lambda_app.handler(self.profile_event("DELETE"), None)

        self.assertNotIn("membership#group-1#user#user-123", self.groups.items)
        self.assertIn("membership#group-1#user#user-456", self.groups.items)


class PrivateGroupTests(unittest.TestCase):
    def setUp(self):
        self.groups = FakeGroupTable()
        self.profiles = FakeTable(
            {
                "user#user-123": {
                    "profileKey": "user#user-123",
                    "recordType": "profile",
                    "leaderboardName": "Jake",
                },
                "user#user-456": {
                    "profileKey": "user#user-456",
                    "recordType": "profile",
                    "leaderboardName": "Sam",
                },
            }
        )
        self.predictions = FakeTable(
            {
                "user-123": {"profileKey": "user-123", "testScore": 10},
                "user-456": {"profileKey": "user-456", "testScore": 25},
            }
        )
        self.original_iterations = lambda_app.GROUP_PASSWORD_ITERATIONS
        self.original_results_loader = lambda_app.load_season_results
        self.original_scorer = lambda_app.score_prediction
        lambda_app.GROUP_PASSWORD_ITERATIONS = 10
        lambda_app.groups_table = lambda: self.groups
        lambda_app.profiles_table = lambda: self.profiles
        lambda_app.predictions_table = lambda: self.predictions
        lambda_app.load_season_results = lambda: {
            "season": 2026,
            "status": "In progress",
            "updatedAt": "2026-12-01",
        }
        lambda_app.score_prediction = lambda prediction, _results, scoring_option="classic": {
            "status": "In progress",
            "regularSeason": prediction["testScore"],
            "playoffs": 0,
            "total": prediction["testScore"],
            "possible": 25,
            "maximum": lambda_app.MAX_SCORE,
        }

    def tearDown(self):
        lambda_app.GROUP_PASSWORD_ITERATIONS = self.original_iterations
        lambda_app.load_season_results = self.original_results_loader
        lambda_app.score_prediction = self.original_scorer

    def create(self, user_id="user-123", name="Sunday Crew", password="secret1"):
        return lambda_app.handler(
            event(
                "POST",
                user_id=user_id,
                body={"groupName": name, "password": password},
                path="/api/groups",
            ),
            None,
        )

    def join(self, user_id="user-456", name="Sunday Crew", password="secret1"):
        return lambda_app.handler(
            event(
                "POST",
                user_id=user_id,
                body={"groupName": name, "password": password},
                path="/api/groups/join",
            ),
            None,
        )

    def join_invite(self, group_id, invite_code, user_id="user-456"):
        return lambda_app.handler(
            event(
                "POST",
                user_id=user_id,
                body={"groupId": group_id, "inviteCode": invite_code},
                path="/api/groups/join-invite",
            ),
            None,
        )

    def test_group_routes_require_authentication(self):
        result = lambda_app.handler(
            event("GET", user_id=None, path="/api/groups"),
            None,
        )

        self.assertEqual(result["statusCode"], 401)

    def test_vegas_group_option_is_saved_and_used(self):
        result = lambda_app.handler(event("POST", user_id="user-123", path="/api/groups",
            body={"groupName": "Vegas Crew", "password": "secret1", "scoringOption": "vegas"}), None)
        created = json.loads(result["body"])
        self.assertEqual(created["scoringOption"], "vegas")
        board = lambda_app.get_group_leaderboard(created["groupId"], "user-123")
        self.assertEqual(board["scoringOption"], "vegas")
        self.assertEqual(set(board["entries"][0]["scores"]), {"classic", "vegas"})

    def test_invalid_group_scoring_is_rejected(self):
        result = lambda_app.handler(event("POST", user_id="user-123", path="/api/groups",
            body={"groupName": "Vegas Crew", "password": "secret1", "scoringOption": "unknown"}), None)
        self.assertEqual(result["statusCode"], 400)

    def test_create_hashes_password_and_reserves_unique_name(self):
        created = self.create()
        payload = json.loads(created["body"])
        group = self.groups.items[f"group#{payload['groupId']}"]

        self.assertEqual(created["statusCode"], 201)
        self.assertNotIn("password", payload)
        self.assertNotEqual(group["passwordHash"], "secret1")
        self.assertNotIn("password", group)
        self.assertNotIn("inviteCode", payload)
        self.assertIn(
            f"membership#{payload['groupId']}#user#user-123",
            self.groups.items,
        )

        duplicate = self.create(user_id="user-456", name="  sunday crew  ")
        self.assertEqual(duplicate["statusCode"], 400)

    def test_join_requires_the_correct_password(self):
        created = json.loads(self.create()["body"])
        rejected = self.join(password="wrong-password")

        self.assertEqual(rejected["statusCode"], 400)
        self.assertNotIn(
            f"membership#{created['groupId']}#user#user-456",
            self.groups.items,
        )

        joined = self.join(name="sUNDAY cREW")
        self.assertEqual(joined["statusCode"], 200)
        self.assertIn(
            f"membership#{created['groupId']}#user#user-456",
            self.groups.items,
        )

    def test_group_list_only_returns_the_current_users_public_groups(self):
        self.create()

        creator_list = lambda_app.handler(
            event("GET", path="/api/groups"),
            None,
        )
        outsider_list = lambda_app.handler(
            event("GET", user_id="user-456", path="/api/groups"),
            None,
        )
        creator_payload = json.loads(creator_list["body"])

        self.assertEqual(len(creator_payload["groups"]), 1)
        self.assertEqual(creator_payload["groups"][0]["groupName"], "Sunday Crew")
        self.assertNotIn("passwordHash", creator_payload["groups"][0])
        self.assertNotIn("inviteCode", creator_payload["groups"][0])
        self.assertEqual(json.loads(outsider_list["body"])["groups"], [])

    def test_member_can_get_an_invite_and_outsider_can_join_with_it(self):
        created = json.loads(self.create()["body"])
        invite_path = f"/api/groups/{created['groupId']}/invite"

        forbidden = lambda_app.handler(
            event("GET", user_id="user-456", path=invite_path),
            None,
        )
        allowed = lambda_app.handler(event("GET", path=invite_path), None)
        invite = json.loads(allowed["body"])

        self.assertEqual(forbidden["statusCode"], 403)
        self.assertEqual(allowed["statusCode"], 200)
        self.assertEqual(len(invite["inviteCode"]), 32)

        rejected = self.join_invite(created["groupId"], "x" * 32)
        joined = self.join_invite(created["groupId"], invite["inviteCode"])
        self.assertEqual(rejected["statusCode"], 400)
        self.assertEqual(joined["statusCode"], 200)
        self.assertIn(
            f"membership#{created['groupId']}#user#user-456",
            self.groups.items,
        )

    def test_existing_group_gets_an_invite_code_when_first_shared(self):
        created = json.loads(self.create()["body"])
        group = self.groups.items[f"group#{created['groupId']}"]
        del group["inviteCode"]

        result = lambda_app.handler(
            event("GET", path=f"/api/groups/{created['groupId']}/invite"),
            None,
        )
        invite = json.loads(result["body"])

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(group["inviteCode"], invite["inviteCode"])

    def test_group_leaderboard_is_member_only_and_group_scoped(self):
        created = json.loads(self.create()["body"])
        group_path = f"/api/groups/{created['groupId']}/leaderboard"

        forbidden = lambda_app.handler(
            event("GET", user_id="user-456", path=group_path),
            None,
        )
        allowed = lambda_app.handler(event("GET", path=group_path), None)
        payload = json.loads(allowed["body"])

        self.assertEqual(forbidden["statusCode"], 403)
        self.assertEqual(allowed["statusCode"], 200)
        self.assertEqual(payload["groupName"], "Sunday Crew")
        self.assertEqual(
            [entry["leaderboardName"] for entry in payload["entries"]],
            ["Jake"],
        )
        self.assertNotIn("passwordHash", payload)


class PublicLeaderboardTests(unittest.TestCase):
    def setUp(self):
        self.predictions = FakeTable(
            {
                "user-123": {
                    "profileKey": "user-123",
                    "testScore": 25,
                    "picks": {"superBowl": "Detroit Lions"},
                },
                "user-456": {"profileKey": "user-456", "testScore": 10},
                "user-without-profile": {
                    "profileKey": "user-without-profile",
                    "testScore": 99,
                },
            }
        )
        self.profiles = FakeTable(
            {
                "user#user-123": {
                    "profileKey": "user#user-123",
                    "recordType": "profile",
                    "leaderboardName": "Jake",
                },
                "user#user-456": {
                    "profileKey": "user#user-456",
                    "recordType": "profile",
                    "leaderboardName": "Sam",
                },
                "name#jake": {
                    "profileKey": "name#jake",
                    "recordType": "leaderboardName",
                    "ownerId": "user-123",
                },
            }
        )
        self.original_results_loader = lambda_app.load_season_results
        self.original_scorer = lambda_app.score_prediction
        lambda_app.predictions_table = lambda: self.predictions
        lambda_app.profiles_table = lambda: self.profiles
        lambda_app.load_season_results = lambda: {
            "season": 2026,
            "status": "In progress",
            "updatedAt": "2026-12-01",
        }
        lambda_app.score_prediction = lambda prediction, _results, scoring_option="classic": {
            "status": "In progress",
            "regularSeason": prediction["testScore"],
            "playoffs": 0,
            "total": prediction["testScore"],
            "possible": 25,
            "maximum": lambda_app.MAX_SCORE,
        }

    def tearDown(self):
        lambda_app.load_season_results = self.original_results_loader
        lambda_app.score_prediction = self.original_scorer

    def test_leaderboard_is_public_ranked_and_sanitized(self):
        result = lambda_app.handler(
            event("GET", user_id=None, path="/api/leaderboard"),
            None,
        )
        payload = json.loads(result["body"])

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(
            [entry["leaderboardName"] for entry in payload["entries"]],
            ["Jake", "Sam"],
        )
        self.assertEqual([entry["rank"] for entry in payload["entries"]], [1, 2])
        self.assertEqual(payload["entries"][0]["superBowl"], "Detroit Lions")
        self.assertNotIn("profileKey", payload["entries"][0])
        self.assertNotIn("picks", payload["entries"][0])

    def test_saved_bracket_is_public_by_leaderboard_name_and_sanitized(self):
        self.profiles.items["user#user-123"]["leaderboardName"] = "Jake Picks"
        self.profiles.items.pop("name#jake")
        self.profiles.items["name#jake picks"] = {
            "profileKey": "name#jake picks",
            "recordType": "leaderboardName",
            "ownerId": "user-123",
        }
        self.predictions.items["user-123"].update(
            {
                "divisionWinners": {
                    "AFC": {"North": "Baltimore Ravens"},
                    "NFC": {"North": "Detroit Lions"},
                },
                "seeds": {
                    "AFC": ["Baltimore Ravens"] * 7,
                    "NFC": ["Detroit Lions"] * 7,
                },
                "picks": {
                    "AFC": {"conf": "Baltimore Ravens"},
                    "NFC": {"conf": "Detroit Lions"},
                    "superBowl": "Detroit Lions",
                },
                "bracketBuilt": True,
                "savedAt": 1_788_000_000_000,
                "privateNote": "do not expose",
            }
        )

        result = lambda_app.handler(
            event(
                "GET",
                user_id=None,
                path="/api/leaderboard/Jake%20Picks/bracket",
            ),
            None,
        )
        payload = json.loads(result["body"])

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(payload["leaderboardName"], "Jake Picks")
        self.assertEqual(payload["picks"]["superBowl"], "Detroit Lions")
        self.assertEqual(payload["score"]["total"], 25)
        self.assertNotIn("profileKey", payload)
        self.assertNotIn("ownerId", payload)
        self.assertNotIn("privateNote", payload)

        missing = lambda_app.handler(
            event(
                "GET",
                user_id=None,
                path="/api/leaderboard/Unknown/bracket",
            ),
            None,
        )
        self.assertEqual(missing["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
