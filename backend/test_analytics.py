"""Tests for privacy-conscious development-site analytics."""

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

    def test_dev_event_is_logged_without_request_metadata(self):
        output = StringIO()
        with patch.dict(os.environ, {"ENVIRONMENT": "dev"}), redirect_stdout(output):
            result = lambda_app.handler(analytics_event(self.valid_body), None)

        record = json.loads(output.getvalue())
        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(record["type"], "site_analytics")
        self.assertEqual(record["event"], "page_view")
        self.assertNotIn("email", record)
        self.assertNotIn("ip", record)

    def test_unknown_event_is_rejected(self):
        body = {**self.valid_body, "event": "made_up_event"}
        with patch.dict(os.environ, {"ENVIRONMENT": "dev"}):
            result = lambda_app.handler(analytics_event(body), None)

        self.assertEqual(result["statusCode"], 400)

    def test_analytics_route_is_disabled_outside_dev(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}):
            result = lambda_app.handler(analytics_event(self.valid_body), None)

        self.assertEqual(result["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
