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
    valid_body = {
        "event": "page_view",
        "page": "/picks",
        "sessionId": "1b46c947-b87a-44c0-8b7c-a1f248645ad9",
        "visitorId": "23f1dc60-e4a2-4a12-b31c-1be61e25b455",
    }

    def test_daily_counter_receives_only_valid_dev_public_pageviews(self):
        import daily_visitors
        for environment, body, expected in [
            ("dev", {"event": "page_view", "page": "/"}, 1),
            ("prod", {"event": "page_view", "page": "/"}, 0),
            ("dev", {"event": "sign_in", "page": "/"}, 0),
            ("dev", {"event": "page_view", "page": "/picks?invite=private"}, 0),
            ("dev", {"event": "page_view", "page": "/admin/analytics"}, 0),
            ("dev", {"event": "page_view", "page": "/", "visitorId": "private"}, 0),
        ]:
            with self.subTest(environment=environment, body=body), patch.dict(os.environ, {"ENVIRONMENT": environment}), \
                 patch.object(daily_visitors, "record") as record, redirect_stdout(StringIO()):
                lambda_app.handler(analytics_event(body), None)
                self.assertEqual(record.call_count, expected)

    def test_counter_failure_returns_accepted_and_never_logs_exception_or_headers(self):
        import daily_visitors
        output = StringIO()
        event = analytics_event({"event": "page_view", "page": "/"})
        event["headers"] = {"user-agent": "PRIVATE-UA", "cookie": "PRIVATE-COOKIE"}
        with patch.dict(os.environ, {"ENVIRONMENT": "dev"}), \
             patch.object(daily_visitors, "record", side_effect=RuntimeError("PRIVATE-IP-TOKEN")), redirect_stdout(output):
            response = lambda_app.handler(event, None)
        self.assertEqual(response["statusCode"], 202)
        self.assertNotIn("PRIVATE", output.getvalue())
        self.assertNotIn("Set-Cookie", response["headers"])

    def test_event_is_logged_without_request_metadata(self):
        output = StringIO()
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}), redirect_stdout(output):
            result = lambda_app.handler(analytics_event(self.valid_body), None)

        record = json.loads(output.getvalue())
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(record["type"], "site_analytics")
        self.assertEqual(record["environment"], "prod")
        self.assertEqual(record["event"], "page_view")
        self.assertNotIn("email", record)
        self.assertNotIn("ip", record)

    def test_unknown_event_is_rejected(self):
        body = {**self.valid_body, "event": "made_up_event"}
        with patch.dict(os.environ, {"ENVIRONMENT": "dev"}):
            result = lambda_app.handler(analytics_event(body), None)

        self.assertEqual(result["statusCode"], 400)

    def test_all_aggregate_events_accept_cookieless_payloads(self):
        for name in (
            "page_view", "bracket_started", "bracket_completed", "prediction_saved",
            "account_created", "sign_in", "leaderboard_viewed", "group_created", "group_joined",
        ):
            output = StringIO()
            event = analytics_event({"event": name, "page": "/picks"})
            event["headers"] = {"cookie": "auth=private", "authorization": "private"}
            event["requestContext"]["http"].update(sourceIp="192.0.2.1", userAgent="private")
            event["requestContext"]["authorizer"] = {"jwt": {"claims": {"sub": "private"}}}
            with self.subTest(event=name), patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
                result = lambda_app.handler(event, None)
            self.assertEqual(result["statusCode"], 202)
            self.assertEqual(json.loads(output.getvalue()), {
                "type": "site_analytics", "environment": "dev", "event": name, "page": "/picks",
            })
            self.assertNotIn("Set-Cookie", result["headers"])

    def test_optional_ids_are_independent_and_preserved_when_supplied(self):
        for ids in ({}, {"visitorId": self.valid_body["visitorId"]},
                    {"sessionId": self.valid_body["sessionId"]}):
            output = StringIO()
            body = {"event": "page_view", "page": "/", **ids}
            with self.subTest(ids=ids), patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
                result = lambda_app.handler(analytics_event(body), None)
            self.assertEqual(result["statusCode"], 202)
            record = json.loads(output.getvalue())
            self.assertEqual({key: value for key, value in record.items() if key.endswith("Id")}, ids)

    def test_invalid_present_ids_are_rejected_without_logging(self):
        for key in ("visitorId", "sessionId"):
            for value in (None, "", "cognito-id", 123, {}, []):
                output = StringIO()
                with self.subTest(key=key, value=value), patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
                    result = lambda_app.handler(analytics_event({
                        "event": "page_view", "page": "/", key: value,
                    }), None)
                self.assertEqual(result["statusCode"], 400)
                self.assertEqual(output.getvalue(), "")

    def test_untrusted_fields_and_private_pages_never_enter_analytics_logs(self):
        output = StringIO()
        with patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
            result = lambda_app.handler(analytics_event({
                "event": "page_view", "page": "/", "cognitoId": "private",
                "email": "private", "ip": "192.0.2.1", "fingerprint": "private",
            }), None)
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(set(json.loads(output.getvalue())), {"type", "environment", "event", "page"})
        for page in ("/picks?invite=private", "/private/person", "/picks#private"):
            output = StringIO()
            with self.subTest(page=page), patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
                result = lambda_app.handler(analytics_event({"event": "page_view", "page": page}), None)
            self.assertEqual(result["statusCode"], 400)
            self.assertEqual(output.getvalue(), "")

    def test_public_nba_and_privacy_pages_are_accepted(self):
        for page in ("/nba", "/privacy"):
            with self.subTest(page=page), patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(StringIO()):
                result = lambda_app.handler(
                    analytics_event({**self.valid_body, "page": page}), None
                )
            self.assertEqual(result["statusCode"], 202)

    def test_analytics_route_is_disabled_for_unknown_environment(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "preview"}):
            result = lambda_app.handler(analytics_event(self.valid_body), None)

        self.assertEqual(result["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
