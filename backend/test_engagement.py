"""Active-time input bounds, anonymity, atomic counters and range aggregation."""
from datetime import date, datetime, timezone
import importlib
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent / "lambda"))
sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
engagement = importlib.import_module("engagement")


class Counters:
    def __init__(self):
        self.items, self.writes, self.reads = {}, [], []

    def update_item(self, **kwargs):
        self.writes.append(kwargs)
        item = self.items.setdefault(kwargs["Key"]["cacheKey"], {})
        counter = kwargs["ExpressionAttributeNames"]["#counter"]
        values = kwargs["ExpressionAttributeValues"]
        item[counter] = item.get(counter, 0) + values[":milliseconds"]
        item["expiresAt"] = values[":ttl"]

    def get_item(self, Key, ConsistentRead):
        assert ConsistentRead is True
        self.reads.append(Key["cacheKey"])
        return {"Item": self.items.get(Key["cacheKey"], {})}


class EngagementTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, ENVIRONMENT="dev", ACTIVE_ENGAGEMENT_ENABLED="true", ADMIN_ANALYTICS_CACHE_TABLE="dev-cache")
        environment.start(); self.addCleanup(environment.stop)
        self.table = Counters()
        resource = patch.object(engagement.boto3, "resource", return_value=types.SimpleNamespace(Table=lambda name: self.table))
        resource.start(); self.addCleanup(resource.stop)
        self.now = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
        clock = patch.object(engagement, "datetime", Mock(wraps=datetime))
        self.clock = clock.start(); self.clock.now.return_value = self.now; self.addCleanup(clock.stop)
        self.payload = {"event": "active_time", "page": "/leaderboard", "sport": "nba", "milliseconds": 30000}

    def test_only_aggregate_atomic_increments_no_individual_records_or_logging(self):
        output = io.StringIO()
        with redirect_stdout(output):
            engagement.record({}, self.payload)
            engagement.record({"headers": {"Authorization": "private token"}, "requestContext": {"sourceIp": "private"}}, self.payload)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(set(self.table.items), {"engagement:v1:2026-10"})
        item = self.table.items["engagement:v1:2026-10"]
        self.assertEqual(set(item), {"d06_leaderboard_nba", "expiresAt"})
        self.assertEqual(item["d06_leaderboard_nba"], 60000)
        self.assertEqual(self.table.writes[0]["UpdateExpression"], "SET expiresAt = :ttl ADD #counter :milliseconds")
        self.assertNotIn("private", json.dumps(self.table.writes))
        self.assertGreater(item["expiresAt"], int(self.now.timestamp()))
        self.assertLess(item["expiresAt"], int(self.now.timestamp()) + 400 * 86400)

    def test_rejects_extra_fields_scalars_routes_sports_and_unknown_environment(self):
        for change in [{"milliseconds": value} for value in [0, -1, 60001, True, None, "100", 1.5]] + [
            {"page": "/leaderboard?invite=private"}, {"page": []}, {"page": "/admin/analytics"},
            {"page": "/nba", "sport": "nfl"}, {"page": "/privacy", "sport": "nba"}, {"sport": []},
            {"event": "page_view"}, {"accountId": "private"}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                engagement.record({}, {**self.payload, **change})
        with patch.dict(os.environ, ENVIRONMENT="preview"), self.assertRaises(ValueError):
            engagement.record({}, self.payload)
        self.assertEqual(self.table.writes, [])

    def test_prod_dispatch_stores_only_aggregate_counters_in_its_own_cache(self):
        prod_table = Counters()
        tables = {"dev-cache": self.table, "prod-cache": prod_table}
        app = importlib.import_module("app")
        event = {"rawPath": "/api/analytics", "requestContext": {"http": {"method": "POST"}},
                 "body": json.dumps(self.payload)}
        with patch.dict(os.environ, ENVIRONMENT="prod", ADMIN_ANALYTICS_CACHE_TABLE="prod-cache"), \
                patch.object(engagement.boto3, "resource", return_value=types.SimpleNamespace(Table=tables.__getitem__)):
            for headers in ({"Sec-GPC": "1"}, {"DNT": "1"}):
                self.assertEqual(app.handler({**event, "headers": headers}, None)["statusCode"], 202)
            self.assertEqual(prod_table.writes, [])
            self.assertEqual(app.handler(event, None)["statusCode"], 202)
            self.assertEqual(engagement.report(date(2026, 10, 6), date(2026, 10, 6))["value"], 30)
        self.assertEqual(self.table.writes, [])
        self.assertEqual(set(prod_table.items["engagement:v1:2026-10"]), {"d06_leaderboard_nba", "expiresAt"})

    def test_disabled_or_missing_flag_prevents_collection_in_both_environments(self):
        for environment in ("dev", "prod"):
            for enabled in ("false", "", "TRUE"):
                with patch.dict(os.environ, ENVIRONMENT=environment, ACTIVE_ENGAGEMENT_ENABLED=enabled), self.assertRaises(ValueError):
                    engagement.record({}, self.payload)
        self.assertEqual(self.table.writes, [])

    def test_privacy_headers_block_writes_and_allows_only_valid_shared_privacy_label(self):
        for headers in [{"Sec-GPC": "1"}, {"DNT": "1"}]:
            engagement.record({"headers": headers}, self.payload)
        self.assertEqual(self.table.writes, [])
        engagement.record({}, {**self.payload, "page": "/privacy", "sport": "shared", "milliseconds": 1})
        self.assertEqual(self.table.items["engagement:v1:2026-10"]["d06_privacy_shared"], 1)

    def test_daily_totals_page_sport_breakdown_month_boundaries_and_missing_days(self):
        self.table.items = {"engagement:v1:2026-09": {"d29_predictor_nfl": 999999, "d30_predictor_nfl": 60000},
                            "engagement:v1:2026-10": {"d01_predictor_nfl": 30000, "d01_leaderboard_nba": 45000,
                                                       "d04_privacy_shared": 999999}}
        report = engagement.report(date(2026, 9, 30), date(2026, 10, 3))
        self.assertEqual(report["value"], 135)
        self.assertEqual(report["daily"], {"2026-09-30": 60, "2026-10-01": 75, "2026-10-02": None, "2026-10-03": None})
        self.assertEqual(report["rows"], [{"page": "Predictor", "sport": "NFL", "seconds": 90},
                                          {"page": "Leaderboard", "sport": "NBA", "seconds": 45}])
        self.assertEqual(self.table.reads, ["engagement:v1:2026-09", "engagement:v1:2026-10"])
        missing = engagement.report(date(2026, 10, 2), date(2026, 10, 3))
        self.assertIsNone(missing["value"]); self.assertEqual(missing["rows"], [])

    def test_maximum_dashboard_range_uses_four_small_reads(self):
        report = engagement.report(date(2026, 7, 31), date(2026, 10, 31))
        self.assertEqual(len(report["daily"]), 93)
        self.assertEqual(len(self.table.reads), 4)

    def test_public_dispatch_accepts_valid_measurements_rejects_extra_data_and_hides_aws_errors(self):
        app = importlib.import_module("app")
        event = {"rawPath": "/api/analytics", "requestContext": {"http": {"method": "POST"}},
                 "body": json.dumps(self.payload)}
        self.assertEqual(app.handler(event, None)["statusCode"], 202)
        self.assertEqual(len(self.table.writes), 1)
        event["body"] = json.dumps({**self.payload, "email": "private"})
        self.assertEqual(app.handler(event, None)["statusCode"], 400)
        event["body"] = json.dumps(self.payload)
        with patch.object(engagement, "record", side_effect=RuntimeError("private secret")):
            result = app.handler(event, None)
            self.assertEqual(result["statusCode"], 503); self.assertNotIn("private", result["body"])


if __name__ == "__main__":
    unittest.main()
