"""Unit tests for authenticated prediction ownership in the Lambda handler."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
MODULE_PATH = Path(__file__).parent / "lambda" / "app.py"
SPEC = importlib.util.spec_from_file_location("nfl_lambda_app", MODULE_PATH)
lambda_app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(lambda_app)


class FakeTable:
    def __init__(self, items=None):
        self.items = dict(items or {})
        self.name = "profiles-or-predictions"
        self.meta = types.SimpleNamespace(client=self)

    def batch_get_item(self, *, RequestItems):
        request = RequestItems[self.name]
        return {"Responses": {self.name: [self.items[key["profileKey"]]
                for key in request["Keys"] if key["profileKey"] in self.items]}}

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
        self.name = "groups"
        self.meta = types.SimpleNamespace(client=self)

    def batch_get_item(self, *, RequestItems):
        return {"Responses": {self.name: [self.items[key["groupKey"]].copy()
                for key in RequestItems[self.name]["Keys"] if key["groupKey"] in self.items]}}

    def query(self, *, IndexName, KeyConditionExpression, ExpressionAttributeValues, **kwargs):
        values = ExpressionAttributeValues
        attribute, placeholder = {"group-records": ("groupId", ":group"),
                                  "user-groups": ("userId", ":user"),
                                  "record-types": ("recordType", ":type")}[IndexName]
        return {"Items": [item.copy() for item in self.items.values()
                if item.get(attribute) == values[placeholder]
                and item["groupKey"].startswith(values.get(":prefix", ""))]}

    @staticmethod
    def condition_matches(item, condition, values):
        values = values or {}
        for attribute in re.findall(r"attribute_exists\((\w+)\)", condition):
            if not item or attribute not in item:
                return False
        for attribute in re.findall(r"attribute_not_exists\((\w+)\)", condition):
            if item and attribute in item:
                return False
        for attribute, placeholder in re.findall(r"(\w+) = (:\w+)", condition):
            if not item or item.get(attribute) != values[placeholder]:
                return False
        return True

    def transact_write_items(self, *, TransactItems):
        for action in TransactItems:
            operation = next(iter(action.values()))
            key = operation.get("Key", operation.get("Item"))["groupKey"]
            if not self.condition_matches(self.items.get(key), operation.get("ConditionExpression", ""),
                                          operation.get("ExpressionAttributeValues")):
                raise ConditionalCheckFailed()
        for action in TransactItems:
            if "Put" in action:
                self.items[action["Put"]["Item"]["groupKey"]] = action["Put"]["Item"]
            elif "Update" in action:
                operation = dict(action["Update"])
                operation.pop("TableName")
                self.update_item(**operation)
            elif "Delete" in action:
                self.items.pop(action["Delete"]["Key"]["groupKey"], None)

    def get_item(self, *, Key, ConsistentRead=False):
        item = self.items.get(Key["groupKey"])
        return {"Item": item} if item else {}

    @staticmethod
    def check_expression_values(values, *expressions):
        used = set(re.findall(r":[A-Za-z0-9_]+", " ".join(expression or "" for expression in expressions)))
        if used != set(values or {}):
            raise ValueError("DynamoDB requires every expression value to be used")

    def put_item(self, *, Item, ConditionExpression=None):
        if ConditionExpression and Item["groupKey"] in self.items:
            raise ConditionalCheckFailed()
        self.items[Item["groupKey"]] = Item

    def delete_item(
        self,
        *,
        Key,
        ConditionExpression=None,
        ExpressionAttributeValues=None,
    ):
        existing = self.items.get(Key["groupKey"])
        self.check_expression_values(ExpressionAttributeValues, ConditionExpression)
        if ConditionExpression:
            values = ExpressionAttributeValues or {}
            if not self.condition_matches(existing, ConditionExpression, values):
                raise ConditionalCheckFailed()
            if "commissionerId = :commissioner" in ConditionExpression:
                attribute, value_key = "commissionerId", ":commissioner"
            elif "createdBy = :commissioner" in ConditionExpression:
                if not existing or "commissionerId" in existing:
                    raise ConditionalCheckFailed()
                attribute, value_key = "createdBy", ":commissioner"
            elif "attribute_not_exists(commissionerId)" in ConditionExpression:
                if not existing or "commissionerId" in existing or "createdBy" in existing:
                    raise ConditionalCheckFailed()
                self.items.pop(Key["groupKey"])
                return
            else:
                attribute, value_key = "groupId", ":groupId"
            if not existing or existing.get(attribute) != values.get(value_key):
                raise ConditionalCheckFailed()
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
        values = ExpressionAttributeValues or {}
        self.check_expression_values(values, UpdateExpression, ConditionExpression)
        if UpdateExpression.startswith("SET inviteCode"):
            if not self.condition_matches(item, ConditionExpression or "", values):
                raise ConditionalCheckFailed()
            item["inviteCode"] = values[":inviteCode"]
            if ":revoked" in values:
                item["inviteRevoked"] = values[":revoked"]
        elif UpdateExpression == "SET commissionerId = :newCommissioner":
            current = values.get(":commissioner")
            if "commissionerId = :commissioner" == ConditionExpression:
                if item.get("commissionerId") != current:
                    raise ConditionalCheckFailed()
            elif "createdBy = :commissioner" in (ConditionExpression or ""):
                if "commissionerId" in item or item.get("createdBy") != current:
                    raise ConditionalCheckFailed()
            elif "commissionerId" in item or "createdBy" in item:
                raise ConditionalCheckFailed()
            item["commissionerId"] = values[":newCommissioner"]
        elif UpdateExpression.startswith(("SET groupName =", "SET sports = :sports", "SET scoringOptions =", "SET passwordSalt =")):
            if not self.condition_matches(item, ConditionExpression or "", values):
                raise ConditionalCheckFailed()
            if "commissionerId = :commissioner" in ConditionExpression:
                if item.get("commissionerId") != values[":commissioner"]:
                    raise ConditionalCheckFailed()
            elif "createdBy = :commissioner" in (ConditionExpression or ""):
                if "commissionerId" in item or item.get("createdBy") != values[":commissioner"]:
                    raise ConditionalCheckFailed()
            elif "commissionerId" in item or "createdBy" in item:
                raise ConditionalCheckFailed()
            for attribute, placeholder in re.findall(r"(\w+) = (:\w+)", UpdateExpression):
                item[attribute] = values[placeholder]
        else:
            raise AssertionError(f"Unexpected update expression: {UpdateExpression}")
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
    sport: str = "nfl",
):
    request_context = {"http": {"method": method}}
    if user_id:
        request_context["authorizer"] = {"jwt": {"claims": {"sub": user_id}}}
    return {
        "rawPath": path,
        "requestContext": request_context,
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": {"sport": sport},
    }


def valid_prediction():
    afc = ["Baltimore Ravens", "Houston Texans", "Buffalo Bills", "Kansas City Chiefs",
           "Denver Broncos", "Cincinnati Bengals", "Los Angeles Chargers"]
    nfc = ["Detroit Lions", "Tampa Bay Buccaneers", "Philadelphia Eagles", "Los Angeles Rams",
           "Green Bay Packers", "Minnesota Vikings", "Seattle Seahawks"]
    return {
        "divisionWinners": {
            "AFC": dict(zip(("North", "South", "East", "West"), afc[:4])),
            "NFC": dict(zip(("North", "South", "East", "West"), nfc[:4])),
        },
        "seeds": {"AFC": afc, "NFC": nfc},
        "picks": {
            c: {"wc-2-7": teams[1], "wc-3-6": teams[2], "wc-4-5": teams[3],
                "div-1": teams[0], "div-2": teams[1], "conf": teams[0]}
            for c, teams in (("AFC", afc), ("NFC", nfc))
        } | {"superBowl": afc[0]},
        "bracketBuilt": True,
    }


class NameNormalizationTests(unittest.TestCase):
    def test_leaderboard_validation_messages_are_preserved(self):
        cases = (
            (None, "leaderboardName must be a string"),
            ("A", "Leaderboard name must be between 3 and 24 characters"),
            (
                "Jake🏈",
                "Leaderboard name may use letters, numbers, spaces, periods, apostrophes, underscores, and hyphens",
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
                "Group name may use letters, numbers, spaces, periods, apostrophes, underscores, and hyphens",
            ),
        )

        for value, message in cases:
            with self.subTest(value=value), self.assertRaisesRegex(
                ValueError, f"^{message}$"
            ):
                lambda_app.normalize_group_name(value)

    def test_names_allow_straight_and_typographic_apostrophes(self):
        straight = lambda_app.normalize_leaderboard_name("Jake's bracket")
        typographic = lambda_app.normalize_leaderboard_name("Jake’s bracket")
        self.assertEqual(straight[0], "Jake's bracket")
        self.assertEqual(typographic[0], "Jake’s bracket")
        self.assertEqual(straight[1], typographic[1])
        self.assertEqual(
            lambda_app.normalize_group_name("Jake's Crew")[0],
            "Jake's Crew",
        )


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

    def test_put_uses_sub_and_stores_only_prediction_fields(self):
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
            with patch.dict(lambda_app.os.environ, {"ENVIRONMENT": "prod"}):
                result = lambda_app.handler(event("PUT", body=valid_prediction()), None)
        finally:
            lambda_app.PREDICTION_LOCK_AT = original_lock_at
            lambda_app.time.time = original_time

        self.assertEqual(result["statusCode"], 423)
        self.assertEqual(self.table.items["user-123"]["savedAt"], 123)
        self.assertTrue(json.loads(result["body"])["locked"])

    def test_dev_nfl_prediction_can_be_saved_after_kickoff(self):
        original_time = lambda_app.time.time
        lambda_app.time.time = lambda: 1_789_000_000
        try:
            with patch.dict(lambda_app.os.environ, {"ENVIRONMENT": "dev"}), patch.object(
                lambda_app, "PREDICTION_LOCK_AT", "2026-09-10T00:20:00Z"
            ):
                result = lambda_app.handler(event("PUT", body=valid_prediction()), None)
        finally:
            lambda_app.time.time = original_time

        self.assertEqual(result["statusCode"], 200)
        self.assertIn("user-123", self.table.items)


class PredictionWindowTests(unittest.TestCase):
    def test_only_dev_nfl_ignores_elapsed_lock_date(self):
        after_kickoff = 1_789_000_000
        with patch.object(lambda_app, "PREDICTION_LOCK_AT", "2026-09-10T00:20:00Z"):
            with patch.dict(lambda_app.os.environ, {"ENVIRONMENT": "dev"}):
                dev_window = lambda_app.prediction_window(after_kickoff)
                nba_token = lambda_app.SPORT.set("nba")
                try:
                    nba_window = lambda_app.prediction_window(2_000_000_000)
                finally:
                    lambda_app.SPORT.reset(nba_token)
            with patch.dict(lambda_app.os.environ, {"ENVIRONMENT": "prod"}):
                prod_window = lambda_app.prediction_window(after_kickoff)

        self.assertTrue(dev_window["devNflUnlocked"])
        self.assertFalse(dev_window["locked"])
        self.assertEqual(dev_window["season"], 2026)
        self.assertFalse(prod_window["devNflUnlocked"])
        self.assertTrue(prod_window["locked"])
        self.assertFalse(nba_window["devNflUnlocked"])
        self.assertTrue(nba_window["locked"])

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
        self.predictions = FakeTable()
        lambda_app.predictions_table = lambda: self.predictions
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
    def test_settings_are_commissioner_only_and_password_is_never_returned(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        for user in (None, "user-456", "outsider"):
            for body in ({"password": "new-secret"}, {"scoringOption": "vegas"}, {"sports": ["nba"]}):
                with self.subTest(user=user, body=body):
                    result = lambda_app.handler(event("PATCH", user_id=user, path=f"/api/groups/{group_id}", body=body), None)
                    self.assertEqual(result["statusCode"], 401 if user is None else 403)
        group = self.groups.items[f"group#{group_id}"]
        old_salt, old_hash = group["passwordSalt"], group["passwordHash"]
        result = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}", body={"password": "new-secret"}), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertNotEqual(group["passwordSalt"], old_salt)
        self.assertNotEqual(group["passwordHash"], old_hash)
        for key in ("password", "passwordHash", "passwordSalt", "passwordIterations"):
            self.assertNotIn(key, json.loads(result["body"]))
            self.assertNotIn(key, lambda_app.list_groups("user-456")["groups"][0])
            self.assertNotIn(key, lambda_app.get_group_leaderboard(group_id, "user-456"))
        self.assertEqual(self.join(user_id="new-member")["statusCode"], 400)
        self.assertEqual(self.join(user_id="new-member", password="new-secret")["statusCode"], 200)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))
        self.assertEqual(self.join_invite(group_id, group["inviteCode"], user_id="invite-member")["statusCode"], 200)

    def test_invalid_settings_do_not_partially_change_competition(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        original = self.groups.items[f"group#{group_id}"].copy()
        for body in ({}, {"password": "short"}, {"password": None}, {"scoringOption": "invalid"},
                     {"commissionerId": "outsider"}, {"scoringOptions": {"nfl": "vegas"}},
                     {"sports": ["nba"], "password": "bad"}, {"sports": ["nba"], "scoringOption": "vegas"}):
            with self.subTest(body=body):
                result = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}", body=body), None)
                self.assertEqual(result["statusCode"], 400)
                self.assertEqual(self.groups.items[f"group#{group_id}"], original)

    def test_group_rename_preserves_members_history_credentials_and_invites(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        original = self.groups.items[f"group#{group_id}"].copy()
        result = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                                         body={"groupName": "  Sunday   Legends  "}), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["groupName"], "Sunday Legends")
        self.assertNotIn("name#sunday crew", self.groups.items)
        self.assertEqual(self.groups.items["name#sunday legends"]["groupId"], group_id)
        updated = self.groups.items[f"group#{group_id}"]
        for key, value in original.items():
            if key not in ("groupName", "normalizedName"):
                self.assertEqual(updated[key], value)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))
        self.assertEqual(self.join(user_id="third", name="Sunday Legends")["statusCode"], 200)
        self.assertEqual(self.join(user_id="fourth", name="Sunday Crew")["statusCode"], 400)
        result = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                                         body={"groupName": "SUNDAY LEGENDS"}), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["groupName"], "SUNDAY LEGENDS")
        self.assertEqual(self.create(name="Sunday Crew", user_id="another")["statusCode"], 201)

    def test_group_rename_rejects_members_invalid_names_and_duplicate_reservations_atomically(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        self.create(name="Taken Name", user_id="another")
        original = {key: value.copy() for key, value in self.groups.items.items()}
        for user, name, status in (("user-456", "Member Rename", 403), ("outsider", "Outsider Rename", 403),
                                   ("user-123", "x", 400), ("user-123", "<invalid>", 400),
                                   ("user-123", "Taken Name", 400)):
            result = lambda_app.handler(event("PATCH", user_id=user, path=f"/api/groups/{group_id}",
                                             body={"groupName": name, "password": "changed-secret"}), None)
            self.assertEqual(result["statusCode"], status)
            self.assertEqual(self.groups.items, original)

    def test_group_rename_losing_commissioner_race_keeps_both_name_reservations_intact(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        transaction = self.groups.transact_write_items
        def transfer_first(**arguments):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "new-owner"
            return transaction(**arguments)
        with patch.object(self.groups, "transact_write_items", side_effect=transfer_first):
            result = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                                             body={"groupName": "New Name"}), None)
        self.assertEqual(result["statusCode"], 400)
        self.assertIn("name#sunday crew", self.groups.items)
        self.assertNotIn("name#new name", self.groups.items)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["groupName"], "Sunday Crew")

    def test_group_delete_rejects_a_concurrent_rename_before_removing_records(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        original_delete = self.groups.delete_item
        def rename_first(**arguments):
            group = self.groups.items[f"group#{group_id}"]
            group["groupName"] = "Renamed Crew"
            group["normalizedName"] = "renamed crew"
            self.groups.items["name#renamed crew"] = {"groupKey": "name#renamed crew", "groupId": group_id}
            return original_delete(**arguments)
        with patch.object(self.groups, "delete_item", side_effect=rename_first):
            self.assertEqual(self.delete(group_id)["statusCode"], 403)
        self.assertIn(f"group#{group_id}", self.groups.items)
        self.assertIn("name#renamed crew", self.groups.items)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-123"))

    def test_scoring_is_sport_specific_and_locked_at_exact_deadline_even_on_dev(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        path = f"/api/groups/{group_id}"
        lambda_app.update_group_settings(group_id, "user-123", event("PATCH", body={"sports": ["nfl", "nba"]}))
        nfl_lock = "2026-09-01T00:00:00Z"
        with patch.object(lambda_app, "PREDICTION_LOCK_AT", nfl_lock), patch.object(lambda_app.time, "time", return_value=1788220799):
            updated = lambda_app.handler(event("PATCH", path=path, body={"scoringOption": "vegas"}), None)
            self.assertEqual(updated["statusCode"], 200)
            self.assertEqual(json.loads(updated["body"])["scoringOptions"], {"nfl": "vegas", "nba": "classic"})
            self.assertEqual(lambda_app.get_group_leaderboard(group_id, "user-123")["scoringOption"], "vegas")
        with patch.object(lambda_app, "PREDICTION_LOCK_AT", nfl_lock), patch.object(lambda_app.time, "time", return_value=1788220800), \
             patch.dict(lambda_app.os.environ, {"ENVIRONMENT": "dev"}):
            self.assertFalse(lambda_app.prediction_window()["locked"])
            self.assertTrue(lambda_app.get_group_leaderboard(group_id, "user-123")["scoringLock"]["locked"])
            rejected = lambda_app.handler(event("PATCH", path=path, body={"scoringOption": "classic", "password": "new-secret"}), None)
            self.assertEqual(rejected["statusCode"], 403)
            self.assertEqual(self.join(user_id="still-old-password")["statusCode"], 200)
            nba_event = event("PATCH", path=path, body={"scoringOption": "vegas"})
            nba_event["queryStringParameters"] = {"sport": "nba"}
            self.assertEqual(lambda_app.handler(nba_event, None)["statusCode"], 200)
            self.assertEqual(lambda_app.group_scoring_option(self.groups.items[f"group#{group_id}"], "nfl"), "vegas")
        nba_deadline = lambda_app.calendar.timegm(lambda_app.time.strptime(lambda_app.NBA["lockAt"], "%Y-%m-%dT%H:%M:%SZ"))
        with patch.object(lambda_app.time, "time", return_value=nba_deadline):
            self.assertEqual(lambda_app.handler(nba_event, None)["statusCode"], 403)

    def test_legacy_scoring_defaults_and_concurrent_settings_guards(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        group = self.groups.items[f"group#{group_id}"]
        self.assertEqual(lambda_app.group_scoring_option(group, "nba"), "classic")
        self.join()
        original = self.groups.update_item
        def transfer(**kwargs):
            group["commissionerId"] = "user-456"
            return original(**kwargs)
        with patch.object(self.groups, "update_item", side_effect=transfer):
            with self.assertRaises(PermissionError):
                lambda_app.update_group_settings(group_id, "user-123", event("PATCH", body={"password": "new-secret"}))
        self.assertEqual(self.join(user_id="old-password-works")["statusCode"], 200)
        group["commissionerId"] = "user-123"
        group["scoringOptions"] = {"nfl": "classic", "nba": "classic"}
        def concurrent_scoring(**kwargs):
            group["scoringOptions"] = {"nfl": "classic", "nba": "vegas"}
            return original(**kwargs)
        with patch.object(self.groups, "update_item", side_effect=concurrent_scoring):
            with self.assertRaises(PermissionError):
                lambda_app.update_group_settings(group_id, "user-123", event("PATCH", body={"scoringOption": "vegas"}))
        self.assertEqual(group["scoringOptions"], {"nfl": "classic", "nba": "vegas"})

    def test_removal_blocks_old_new_invites_password_and_private_routes(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        code = self.groups.items[f"group#{group_id}"]["inviteCode"]
        path = f"/api/groups/{group_id}/members/user-456"
        self.assertEqual(lambda_app.handler(event("DELETE", user_id="user-456", path=path), None)["statusCode"], 403)
        self.assertEqual(lambda_app.handler(event("DELETE", user_id=None, path=path), None)["statusCode"], 401)
        self.assertEqual(lambda_app.handler(event("DELETE", path=f"/api/groups/{group_id}/members/user-123"), None)["statusCode"], 400)
        self.assertEqual(lambda_app.handler(event("DELETE", path=path), None)["statusCode"], 200)
        self.assertEqual(self.join_invite(group_id, code)["statusCode"], 403)
        self.assertEqual(self.join()["statusCode"], 403)
        new_code = lambda_app.change_group_invite(group_id, "user-123")["inviteCode"]
        self.assertEqual(self.join_invite(group_id, new_code)["statusCode"], 403)
        self.assertFalse(lambda_app.is_group_member(group_id, "user-456"))
        self.assertEqual(lambda_app.list_groups("user-456"), {"groups": []})
        for suffix in ("leaderboard", "members", "invite"):
            self.assertEqual(lambda_app.handler(event("GET", user_id="user-456", path=f"/api/groups/{group_id}/{suffix}"), None)["statusCode"], 403)
        self.assertEqual(len(lambda_app.list_group_members(group_id, "user-123")["members"]), 1)

    def test_invite_rotation_permissions_and_revoke_feature_removed(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        path = f"/api/groups/{group_id}/invite"
        old = self.groups.items[f"group#{group_id}"]["inviteCode"]
        self.assertEqual(lambda_app.handler(event("POST", user_id="user-456", path=path), None)["statusCode"], 403)
        self.assertEqual(lambda_app.handler(event("POST", user_id=None, path=path), None)["statusCode"], 401)
        rotated = json.loads(lambda_app.handler(event("POST", path=path), None)["body"])["inviteCode"]
        self.assertNotEqual(old, rotated)
        self.assertEqual(self.join_invite(group_id, old, user_id="new-user")["statusCode"], 400)
        self.assertEqual(self.join_invite(group_id, rotated, user_id="new-user")["statusCode"], 200)
        self.assertEqual(lambda_app.handler(event("DELETE", path=path), None)["statusCode"], 404)
        self.assertEqual(self.join_invite(group_id, rotated, user_id="another-user")["statusCode"], 200)
        self.assertEqual(lambda_app.get_group_invite(group_id, "user-456")["inviteCode"], rotated)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))
        self.assertTrue(lambda_app.change_group_invite(group_id, "user-123")["inviteCode"])

    def test_legacy_revoked_invite_stays_disabled_until_secondary_reset(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        group = self.groups.items[f"group#{group_id}"]
        group.update(inviteCode="", inviteRevoked=True)
        self.assertIsNone(lambda_app.get_group_invite(group_id, "user-123")["inviteCode"])
        code = lambda_app.change_group_invite(group_id, "user-123")["inviteCode"]
        self.assertFalse(group["inviteRevoked"])
        self.assertEqual(self.join_invite(group_id, code)["statusCode"], 200)

    def test_group_reads_do_not_scan_and_include_members_without_predictions(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        self.predictions.items.pop("user-456")
        lambda_app.add_group_membership(group_id, "no-profile")
        with patch.object(self.groups, "scan", side_effect=AssertionError("Groups scan")), \
             patch.object(self.profiles, "scan", side_effect=AssertionError("Profiles scan")), \
             patch.object(self.predictions, "scan", side_effect=AssertionError("Predictions scan")):
            self.assertEqual(len(lambda_app.list_groups("user-123")["groups"]), 1)
            board = lambda_app.get_group_leaderboard(group_id, "user-123")
            self.assertEqual(len(board["entries"]), 3)
            missing = [entry for entry in board["entries"] if not entry["hasPrediction"]]
            self.assertEqual(len(missing), 2)
            self.assertTrue(all(entry["total"] is None and entry["rank"] is None for entry in missing))
            self.assertEqual(sum(entry["isCommissioner"] for entry in board["entries"]), 1)
            self.assertEqual(len(board["members"]), 3)
            self.assertFalse(any("memberId" in entry for entry in board["entries"]))

    def test_equal_scoring_results_share_rank_with_existing_tiebreakers(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        self.predictions.items["user-456"]["testScore"] = self.predictions.items["user-123"]["testScore"]
        self.profiles.items["user#third"] = {"profileKey": "user#third", "recordType": "profile", "leaderboardName": "Third"}
        self.predictions.items["third"] = {"profileKey": "third", "testScore": 1}
        lambda_app.add_group_membership(group_id, "third")
        for members in (None, {"user-123", "user-456", "third"}):
            self.assertEqual([entry["rank"] for entry in lambda_app.build_leaderboard(members)["entries"]], [1, 1, 3])

    def test_concurrent_role_change_prevents_removal_and_invite_changes(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        original = self.groups.transact_write_items
        def transfer(**kwargs):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "user-456"
            return original(**kwargs)
        with patch.object(self.groups, "transact_write_items", side_effect=transfer):
            with self.assertRaises(PermissionError):
                lambda_app.remove_group_member(group_id, "user-123", "user-456")
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))

    def test_removed_replacement_cannot_become_commissioner_during_transfer(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        original = self.groups.transact_write_items
        def remove_replacement(**kwargs):
            self.groups.items[lambda_app.membership_item_key(group_id, "user-456")]["recordType"] = "removedMembership"
            return original(**kwargs)
        with patch.object(self.groups, "transact_write_items", side_effect=remove_replacement):
            rejected = self.transfer(group_id, "user-456")
        self.assertEqual(rejected["statusCode"], 403)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["commissionerId"], "user-123")
        self.assertTrue(lambda_app.is_group_member(group_id, "user-123"))

    def test_invite_revoked_between_read_and_join_cannot_add_a_membership(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        code = self.groups.items[f"group#{group_id}"]["inviteCode"]
        original = self.groups.transact_write_items
        def revoke_before_join(**kwargs):
            self.groups.items[f"group#{group_id}"].update(inviteCode="", inviteRevoked=True)
            return original(**kwargs)
        with patch.object(self.groups, "transact_write_items", side_effect=revoke_before_join):
            self.assertEqual(self.join_invite(group_id, code)["statusCode"], 403)
        self.assertFalse(lambda_app.is_group_member(group_id, "user-456"))

    def test_concurrent_invite_update_cannot_override_new_commissioner(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        old_code = self.groups.items[f"group#{group_id}"]["inviteCode"]
        original = self.groups.update_item
        def transfer_before_update(**kwargs):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "user-456"
            return original(**kwargs)
        with patch.object(self.groups, "update_item", side_effect=transfer_before_update):
            with self.assertRaises(PermissionError):
                lambda_app.change_group_invite(group_id, "user-123")
        self.assertEqual(self.groups.items[f"group#{group_id}"]["inviteCode"], old_code)

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

    def delete(self, group_id, user_id="user-123"):
        return lambda_app.handler(
            event(
                "DELETE",
                user_id=user_id,
                path=f"/api/groups/{group_id}",
            ),
            None,
        )

    def leave(self, group_id, user_id="user-456", new_commissioner_id=None):
        body = (
            {"newCommissionerId": new_commissioner_id}
            if new_commissioner_id is not None
            else {}
        )
        return lambda_app.handler(
            event(
                "DELETE",
                user_id=user_id,
                body=body,
                path=f"/api/groups/{group_id}/membership",
            ),
            None,
        )

    def transfer(self, group_id, replacement, user_id="user-123"):
        return lambda_app.handler(event("POST", user_id=user_id,
            path=f"/api/groups/{group_id}/commissioner", body={"newCommissionerId": replacement}), None)

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
        self.assertEqual(set(board["entries"][0]["scores"]), {"vegas"})

    def test_invalid_group_scoring_is_rejected(self):
        result = lambda_app.handler(event("POST", user_id="user-123", path="/api/groups",
            body={"groupName": "Vegas Crew", "password": "secret1", "scoringOption": "unknown"}), None)
        self.assertEqual(result["statusCode"], 400)

    def test_group_sports_filter_both_leaderboards_and_legacy_default(self):
        group_ids = {}
        for name, sports in (("NFL Crew", ["nfl"]), ("NBA Crew", ["nba"]), ("Both Crew", ["nfl", "nba"])):
            result = lambda_app.handler(event("POST", path="/api/groups", body={
                "groupName": name, "password": "secret1", "sports": sports,
            }), None)
            self.assertEqual(result["statusCode"], 201)
            group_ids[name] = json.loads(result["body"])["groupId"]
        del self.groups.items[f"group#{group_ids['NFL Crew']}"]["sports"]
        for sport, expected in (("nfl", {"NFL Crew", "Both Crew"}), ("nba", {"NBA Crew", "Both Crew"})):
            listed = lambda_app.handler(event("GET", path="/api/groups", sport=sport), None)
            self.assertEqual({group["groupName"] for group in json.loads(listed["body"])["groups"]}, expected)
        self.assertEqual(lambda_app.handler(event("GET", path=f"/api/groups/{group_ids['NFL Crew']}/leaderboard", sport="nba"), None)["statusCode"], 403)
        self.assertEqual(lambda_app.handler(event("GET", path=f"/api/groups/{group_ids['NBA Crew']}/leaderboard", sport="nfl"), None)["statusCode"], 403)
        with patch.object(lambda_app, "build_leaderboard", return_value={"entries": []}):
            self.assertEqual(lambda_app.handler(event("GET", path=f"/api/groups/{group_ids['Both Crew']}/leaderboard", sport="nfl"), None)["statusCode"], 200)
            self.assertEqual(lambda_app.handler(event("GET", path=f"/api/groups/{group_ids['Both Crew']}/leaderboard", sport="nba"), None)["statusCode"], 200)

    def test_group_creation_defaults_to_requested_sport_and_rejects_invalid_sports(self):
        created = lambda_app.handler(event("POST", path="/api/groups", sport="nba", body={
            "groupName": "NBA Crew", "password": "secret1",
        }), None)
        self.assertEqual(json.loads(created["body"])["sports"], ["nba"])
        for sports in ([], ["nfl", "other"], ["nba", "nba"], "nfl"):
            rejected = lambda_app.handler(event("POST", path="/api/groups", body={
                "groupName": "Invalid Crew", "password": "secret1", "sports": sports,
            }), None)
            self.assertEqual(rejected["statusCode"], 400)

    def test_only_current_commissioner_can_edit_sports(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        path = f"/api/groups/{group_id}"
        self.join()
        rejected = lambda_app.handler(event("PATCH", user_id="user-456", path=path, body={"sports": ["nba"]}), None)
        self.assertEqual(rejected["statusCode"], 403)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["sports"], ["nfl"])
        for sports in ([], ["nfl", "other"], ["nfl", "nfl"], "nba"):
            invalid = lambda_app.handler(event("PATCH", path=path, body={"sports": sports}), None)
            self.assertEqual(invalid["statusCode"], 400)
        updated = lambda_app.handler(event("PATCH", path=path, body={"sports": ["nba", "nfl"]}), None)
        self.assertEqual(json.loads(updated["body"])["sports"], ["nfl", "nba"])
        self.assertEqual(len([item for item in self.groups.items.values() if item.get("recordType") == "group"]), 1)
        self.transfer(group_id, "user-456")
        self.assertEqual(lambda_app.handler(event("PATCH", path=path, body={"sports": ["nfl"]}), None)["statusCode"], 403)
        self.assertEqual(lambda_app.handler(event("PATCH", user_id="user-456", path=path, body={"sports": ["nba"]}), None)["statusCode"], 200)

    def test_create_hashes_password_and_reserves_unique_name(self):
        created = self.create()
        payload = json.loads(created["body"])
        group = self.groups.items[f"group#{payload['groupId']}"]

        self.assertEqual(created["statusCode"], 201)
        self.assertEqual(group["createdBy"], "user-123")
        self.assertTrue(payload["isCreator"])
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

    def test_legacy_groups_can_edit_sports_and_transfer_without_unused_values(self):
        for keep_creator in (True, False):
            with self.subTest(keep_creator=keep_creator):
                created = json.loads(self.create(name=f"Legacy {keep_creator}")["body"])
                group_id = created["groupId"]
                self.join(name=f"Legacy {keep_creator}")
                group = self.groups.items[f"group#{group_id}"]
                group.pop("commissionerId", None)
                if not keep_creator:
                    del group["createdBy"]
                    # Make the inferred creator unambiguous even on fast machines.
                    group["createdAt"] = 1
                    self.groups.items[lambda_app.membership_item_key(group_id, "user-123")]["joinedAt"] = 1
                    self.groups.items[lambda_app.membership_item_key(group_id, "user-456")]["joinedAt"] = 2
                updated = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                    body={"sports": ["nfl", "nba"]}), None)
                self.assertEqual(updated["statusCode"], 200)
                self.assertTrue(json.loads(updated["body"])["isCommissioner"])
                transferred = self.transfer(group_id, "user-456")
                self.assertEqual(transferred["statusCode"], 200)
                self.assertEqual(group["commissionerId"], "user-456")

    def test_role_change_during_delete_preserves_memberships_name_and_history(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()
        history_key = f"history#{group_id}#nfl#2026"
        self.groups.items[history_key] = {"groupKey": history_key, "recordType": "groupSeason", "groupId": group_id}
        original_delete = self.groups.delete_item

        def transfer_before_delete(**kwargs):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "user-456"
            return original_delete(**kwargs)

        keys = set(self.groups.items)
        with patch.object(self.groups, "delete_item", side_effect=transfer_before_delete) as deletion:
            rejected = self.delete(group_id)
        self.assertEqual(rejected["statusCode"], 403)
        deletion.assert_called_once()
        self.assertEqual(set(self.groups.items), keys)

    def test_concurrent_password_and_invite_joins_preserve_original_membership(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()
        membership = dict(self.groups.items[lambda_app.membership_item_key(group_id, "user-456")])
        code = self.groups.items[f"group#{group_id}"]["inviteCode"]
        with patch.object(lambda_app, "is_group_member", return_value=False):
            self.assertEqual(self.join()["statusCode"], 200)
            self.assertEqual(self.join_invite(group_id, code)["statusCode"], 200)
        self.assertEqual(self.groups.items[lambda_app.membership_item_key(group_id, "user-456")], membership)

    def test_join_storage_failure_is_not_treated_as_success(self):
        created = json.loads(self.create()["body"])
        with patch.object(self.groups, "transact_write_items", side_effect=RuntimeError("Storage unavailable")):
            with self.assertRaises(RuntimeError):
                lambda_app.add_group_membership(created["groupId"], "user-456")

    def test_group_creator_can_delete_group_and_release_its_name(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()

        deleted = self.delete(group_id)
        self.assertEqual(deleted["statusCode"], 200)
        self.assertNotIn(f"group#{group_id}", self.groups.items)
        self.assertNotIn("name#sunday crew", self.groups.items)
        self.assertNotIn(
            f"membership#{group_id}#user#user-123",
            self.groups.items,
        )
        self.assertNotIn(
            f"membership#{group_id}#user#user-456",
            self.groups.items,
        )

        recreated = self.create(user_id="user-456")
        self.assertEqual(recreated["statusCode"], 201)

    def test_group_member_cannot_delete_group(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()

        rejected = self.delete(group_id, user_id="user-456")

        self.assertEqual(rejected["statusCode"], 403)
        self.assertIn(f"group#{group_id}", self.groups.items)
        self.assertIn("name#sunday crew", self.groups.items)

    def test_group_member_can_leave_without_affecting_the_group(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()

        result = self.leave(group_id)

        self.assertEqual(result["statusCode"], 200)
        self.assertNotIn(
            f"membership#{group_id}#user#user-456",
            self.groups.items,
        )
        self.assertIn(f"group#{group_id}", self.groups.items)

    def test_commissioner_must_transfer_role_before_leaving(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()

        rejected = self.leave(group_id, user_id="user-123")
        self.assertEqual(self.leave(group_id, user_id="user-123", new_commissioner_id="user-456")["statusCode"], 403)
        before = {key: dict(value) for key, value in self.groups.items.items()}
        transferred = self.transfer(group_id, "user-456")
        group = self.groups.items[f"group#{group_id}"]

        self.assertEqual(rejected["statusCode"], 403)
        self.assertEqual(transferred["statusCode"], 200)
        self.assertEqual(group["commissionerId"], "user-456")
        self.assertTrue(lambda_app.is_group_member(group_id, "user-123"))
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))
        self.assertEqual(set(self.groups.items), set(before))
        self.assertEqual({key: value for key, value in self.groups.items.items() if key != f"group#{group_id}"},
                         {key: value for key, value in before.items() if key != f"group#{group_id}"})
        self.assertEqual(group["createdBy"], "user-123")
        self.assertEqual(self.leave(group_id, user_id="user-123")["statusCode"], 200)
        self.assertNotIn(
            f"membership#{group_id}#user#user-123",
            self.groups.items,
        )
        listed = lambda_app.handler(
            event("GET", user_id="user-456", path="/api/groups"),
            None,
        )
        self.assertTrue(json.loads(listed["body"])["groups"][0]["isCommissioner"])

        old_commissioner_delete = self.delete(group_id, user_id="user-123")
        new_commissioner_delete = self.delete(group_id, user_id="user-456")
        self.assertEqual(old_commissioner_delete["statusCode"], 403)
        self.assertEqual(new_commissioner_delete["statusCode"], 200)

    def test_commissioner_can_only_transfer_to_another_member(self):
        created = json.loads(self.create()["body"])

        result = self.transfer(created["groupId"], "outsider")

        self.assertEqual(result["statusCode"], 400)
        self.assertIn(
            f"membership#{created['groupId']}#user#user-123",
            self.groups.items,
        )

    def test_transfer_rejects_members_outsiders_self_and_invalid_bodies(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        path = f"/api/groups/{group_id}/commissioner"
        for user in (None, "user-456", "outsider"):
            self.assertEqual(self.transfer(group_id, "user-456", user_id=user)["statusCode"], 401 if user is None else 403)
        for body in ({}, [], None, {"newCommissionerId": ""}, {"newCommissionerId": "user-123"},
                     {"newCommissionerId": "outsider"}, {"newCommissionerId": "user-456", "extra": True}):
            with self.subTest(body=body):
                self.assertEqual(lambda_app.handler(event("POST", path=path, body=body), None)["statusCode"], 400)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["commissionerId"], "user-123")
        self.assertEqual(lambda_app.handler(event("GET", path=path), None)["statusCode"], 404)

    def test_members_without_predictions_can_be_commissioner_but_leave_cannot_transfer(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        self.assertEqual(self.leave(group_id, new_commissioner_id="user-123")["statusCode"], 400)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))
        lambda_app.add_group_membership(group_id, "no-prediction")
        self.assertEqual(self.transfer(group_id, "no-prediction")["statusCode"], 200)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["commissionerId"], "no-prediction")
        self.assertTrue(lambda_app.is_group_member(group_id, "user-123"))

    def test_stale_transfer_cannot_replace_new_commissioner(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        lambda_app.add_group_membership(group_id, "third")
        original = self.groups.transact_write_items
        def concurrent_transfer(**kwargs):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "third"
            return original(**kwargs)
        with patch.object(self.groups, "transact_write_items", side_effect=concurrent_transfer):
            self.assertEqual(self.transfer(group_id, "user-456")["statusCode"], 403)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["commissionerId"], "third")
        self.assertTrue(lambda_app.is_group_member(group_id, "user-123"))

    def test_new_commissioner_cannot_leave_during_concurrent_transfer(self):
        group_id = json.loads(self.create()["body"])["groupId"]
        self.join()
        original = self.groups.transact_write_items
        def concurrent_transfer(**kwargs):
            self.groups.items[f"group#{group_id}"]["commissionerId"] = "user-456"
            return original(**kwargs)
        with patch.object(self.groups, "transact_write_items", side_effect=concurrent_transfer):
            self.assertEqual(self.leave(group_id)["statusCode"], 403)
        self.assertTrue(lambda_app.is_group_member(group_id, "user-456"))

    def test_group_members_endpoint_is_member_only(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        self.join()

        allowed = lambda_app.handler(
            event("GET", path=f"/api/groups/{group_id}/members"),
            None,
        )
        forbidden = lambda_app.handler(
            event(
                "GET",
                user_id="outsider",
                path=f"/api/groups/{group_id}/members",
            ),
            None,
        )

        members = json.loads(allowed["body"])["members"]
        self.assertEqual(allowed["statusCode"], 200)
        self.assertEqual(forbidden["statusCode"], 403)
        self.assertEqual(
            {member["userId"] for member in members},
            {"user-123", "user-456"},
        )
        creator = next(
            member for member in members if member["userId"] == "user-123"
        )
        self.assertTrue(creator["isCommissioner"])

    def test_account_deletion_is_blocked_while_user_manages_a_group(self):
        self.create()

        result = lambda_app.handler(
            event("DELETE", path="/api/profile"),
            None,
        )

        self.assertEqual(result["statusCode"], 409)
        self.assertIn(
            "appoint a new commissioner",
            json.loads(result["body"])["message"],
        )

    def test_legacy_group_creator_can_delete_when_membership_is_unambiguous(self):
        group_id = "00000000-0000-4000-8000-000000000000"
        self.groups.items = {
            f"name#legacy crew": {
                "groupKey": "name#legacy crew",
                "recordType": "groupName",
                "normalizedName": "legacy crew",
                "groupId": group_id,
            },
            f"group#{group_id}": {
                "groupKey": f"group#{group_id}",
                "recordType": "group",
                "groupId": group_id,
                "groupName": "Legacy Crew",
                "normalizedName": "legacy crew",
                "createdAt": 100,
            },
            f"membership#{group_id}#user#user-123": {
                "groupKey": f"membership#{group_id}#user#user-123",
                "recordType": "membership",
                "groupId": group_id,
                "userId": "user-123",
                "joinedAt": 100,
            },
            f"membership#{group_id}#user#user-456": {
                "groupKey": f"membership#{group_id}#user#user-456",
                "recordType": "membership",
                "groupId": group_id,
                "userId": "user-456",
                "joinedAt": 200,
            },
        }

        updated = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}", body={"sports": ["nfl", "nba"]}), None)
        self.assertEqual(updated["statusCode"], 200)
        self.assertEqual(self.groups.items[f"group#{group_id}"]["sports"], ["nfl", "nba"])

        deleted = self.delete(group_id)

        self.assertEqual(deleted["statusCode"], 200)
        self.assertNotIn(f"group#{group_id}", self.groups.items)

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
        self.assertTrue(creator_payload["groups"][0]["isCreator"])
        self.assertNotIn("passwordHash", creator_payload["groups"][0])
        self.assertNotIn("createdBy", creator_payload["groups"][0])
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

    def test_visible_password_is_member_only_and_updates_with_existing_patch(self):
        created = json.loads(self.create(password="<shared & secret>  ")["body"])
        group_id = created["groupId"]
        path = f"/api/groups/{group_id}/invite"
        self.join(password="<shared & secret>  ")
        for user in ("user-123", "user-456"):
            result = lambda_app.handler(event("GET", user_id=user, path=path), None)
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(json.loads(result["body"])["groupPassword"], "<shared & secret>  ")
            self.assertEqual(result["headers"]["Cache-Control"], "no-store")
            for key in ("passwordHash", "passwordSalt", "shareablePassword"):
                self.assertNotIn(key, json.loads(result["body"]))
        for user, status in ((None, 401), ("outsider", 403)):
            result = lambda_app.handler(event("GET", user_id=user, path=path), None)
            self.assertEqual(result["statusCode"], status)
            self.assertNotIn("groupPassword", json.loads(result["body"]))
        updated = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                                    body={"password": "replacement-secret"}), None)
        self.assertEqual(updated["statusCode"], 200)
        self.assertNotIn("shareablePassword", json.loads(updated["body"]))
        self.assertEqual(lambda_app.get_group_invite(group_id, "user-456")["groupPassword"], "replacement-secret")
        listed = lambda_app.list_groups("user-456")["groups"][0]
        for key in ("groupPassword", "shareablePassword"):
            self.assertNotIn(key, listed)
        lambda_app.remove_group_member(group_id, "user-123", "user-456")
        self.assertEqual(lambda_app.handler(event("GET", user_id="user-456", path=path), None)["statusCode"], 403)

    def test_legacy_password_stays_valid_until_commissioner_sets_visible_password(self):
        created = json.loads(self.create()["body"])
        group_id = created["groupId"]
        group = self.groups.items[f"group#{group_id}"]
        del group["shareablePassword"]
        self.assertIsNone(lambda_app.get_group_invite(group_id, "user-123")["groupPassword"])
        self.assertEqual(self.join()["statusCode"], 200)
        group["inviteRevoked"] = True
        self.assertIsNone(lambda_app.get_group_invite(group_id, "user-123")["groupPassword"])
        updated = lambda_app.handler(event("PATCH", path=f"/api/groups/{group_id}",
                                    body={"password": "visible-secret"}), None)
        self.assertEqual(updated["statusCode"], 200)
        self.assertEqual(lambda_app.get_group_invite(group_id, "user-123")["groupPassword"], "visible-secret")

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
        self.assertEqual(set(payload["entries"][0]["scores"]), {"classic", "vegas"})
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
