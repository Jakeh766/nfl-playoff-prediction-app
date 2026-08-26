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

    def put_item(self, *, Item):
        self.items[Item["profileKey"]] = Item

    def delete_item(self, *, Key):
        self.items.pop(Key["profileKey"], None)


def event(method: str, user_id: str | None = "user-123", body=None):
    request_context = {"http": {"method": method}}
    if user_id:
        request_context["authorizer"] = {"jwt": {"claims": {"sub": user_id}}}
    return {
        "rawPath": "/api/prediction",
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
        lambda_app.predictions_table = lambda: self.table

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


if __name__ == "__main__":
    unittest.main()
