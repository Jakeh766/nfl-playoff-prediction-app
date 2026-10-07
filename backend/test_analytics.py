"""Tests for privacy-conscious first-party site analytics."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
MODULE_PATH = Path(__file__).parent / "lambda" / "app.py"
SPEC = importlib.util.spec_from_file_location("nfl_lambda_analytics", MODULE_PATH)
lambda_app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(lambda_app)


def analytics_event(body):
    return {
        "rawPath": "/api/analytics",
        "requestContext": {"http": {"method": "POST"}},
        "body": json.dumps(body),
    }


class AnalyticsTests(unittest.TestCase):
    def call(self, body, headers=None, environment="dev"):
        output = StringIO()
        event = analytics_event(body)
        event["headers"] = headers or {}
        event["requestContext"]["http"].update(sourceIp="192.0.2.1", userAgent="PRIVATE")
        with patch.dict(os.environ, {"ENVIRONMENT": environment}), redirect_stdout(output):
            result = lambda_app.handler(event, None)
        return result, output.getvalue()

    def test_all_product_events_accept_identifier_free_payloads(self):
        for name in lambda_app.ANALYTICS_EVENTS:
            body = {"event": name, "page": "/picks"}
            if name in {"bracket_created", "bracket_completed", "prediction_saved"}:
                body["bracketType"] = "nba"
            result, output = self.call(body)
            self.assertEqual(result["statusCode"], 202)
            self.assertEqual(json.loads(output), {"type": "site_analytics", "environment": "dev", **body})
            self.assertNotIn("Set-Cookie", result["headers"])

    def test_bracket_type_must_be_allowlisted(self):
        for kind in (None, "", "private", 123, [], {}):
            result, output = self.call({"event": "prediction_saved", "page": "/picks", "bracketType": kind})
            self.assertEqual(result["statusCode"], 400)
            self.assertEqual(output, "")
        for kind in ("nfl", "nba"):
            self.assertEqual(self.call({"event": "bracket_created", "page": "/picks", "bracketType": kind})[0]["statusCode"], 202)

    def test_untrusted_identifiers_and_metadata_never_reach_logs(self):
        result, output = self.call({"event": "sign_in", "page": "/", "sessionId": "PRIVATE", "visitorId": "PRIVATE",
                                    "email": "PRIVATE", "ip": "PRIVATE", "bracketType": "PRIVATE"},
                                   {"cookie": "PRIVATE", "authorization": "PRIVATE"})
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(json.loads(output), {"type": "site_analytics", "environment": "dev", "event": "sign_in", "page": "/"})

    def test_private_pages_and_nonproduct_events_are_rejected(self):
        for page in ("/picks?invite=PRIVATE", "/picks#PRIVATE", "/admin/analytics", "/private"):
            result, output = self.call({"event": "sign_in", "page": page})
            self.assertEqual(result["statusCode"], 400)
            self.assertEqual(output, "")
        for name in ("page_view", "leaderboard_viewed", "made_up"):
            self.assertEqual(self.call({"event": name, "page": "/"})[0]["statusCode"], 400)

    def test_privacy_headers_suppress_collection(self):
        for headers in ({"Sec-GPC": "1"}, {"DNT": "1"}):
            result, output = self.call({"event": "account_deleted", "page": "/"}, headers)
            self.assertEqual(result["statusCode"], 202)
            self.assertEqual(output, "")

    def test_unknown_environment_is_disabled(self):
        self.assertEqual(self.call({"event": "sign_in", "page": "/"}, environment="preview")[0]["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
