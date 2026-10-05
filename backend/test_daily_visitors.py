"""Privacy, daily deduplication, concurrency and aggregate-only reporting."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib
import json
import os
from pathlib import Path
import sys
from threading import Lock
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / "lambda"))
visitors = importlib.import_module("daily_visitors")
NOW = datetime(2026, 10, 5, 23, 59, tzinfo=timezone.utc)
ENV = {"ENVIRONMENT": "dev", "ADMIN_ANALYTICS_CACHE_TABLE": "dev-cache"}


def request(**headers):
    return {"headers": {"user-agent": "Test browser", **headers},
            "requestContext": {"http": {"sourceIp": "192.0.2.1"}},
            "body": '{"event":"page_view","page":"/"}'}


class Cancelled(Exception):
    def __init__(self, reason):
        self.response = {"Error": {"Code": "TransactionCanceledException"},
                         "CancellationReasons": [{"Code": reason}]}


class MemoryDB:
    """Atomic in-memory store exercising conditional dedup and transaction rollback."""
    def __init__(self):
        self.items = {}
        self.writes = []
        self.lock = Lock()
        self.failure = None

    def get_item(self, Key, **_kwargs):
        with self.lock:
            return {"Item": deepcopy(self.items.get(Key["cacheKey"]["S"], {}))}

    def update_item(self, Key, ExpressionAttributeValues, **_kwargs):
        with self.lock:
            key = Key["cacheKey"]["S"]
            item = self.items.setdefault(key, {"cacheKey": Key["cacheKey"]})
            item.setdefault("salt", ExpressionAttributeValues[":salt"])
            item["expiresAt"] = ExpressionAttributeValues[":ttl"]
            self.writes.append(deepcopy(item))
            return {"Attributes": deepcopy(item)}

    def transact_write_items(self, TransactItems, ClientRequestToken):
        with self.lock:
            if self.failure:
                raise self.failure
            updates = [entry["Update"] for entry in TransactItems]
            self.assert_contract(updates)
            marker, count, started = [entry["Key"]["cacheKey"]["S"] for entry in updates]
            if marker in self.items:
                raise Cancelled("ConditionalCheckFailed")
            self.items[marker] = {"cacheKey": {"S": marker},
                "expiresAt": updates[0]["ExpressionAttributeValues"][":ttl"]}
            previous = int(self.items.get(count, {}).get("visitorCount", {"N": "0"})["N"])
            self.items[count] = {"cacheKey": {"S": count}, "visitorCount": {"N": str(previous + 1)},
                "expiresAt": updates[1]["ExpressionAttributeValues"][":ttl"]}
            self.items.setdefault(started, {"firstDay": updates[2]["ExpressionAttributeValues"][":day"]})
            self.writes.append(deepcopy(TransactItems))

    @staticmethod
    def assert_contract(updates):
        assert len(updates) == 3
        assert updates[0]["ConditionExpression"] == "attribute_not_exists(cacheKey)"
        assert "ADD visitorCount :one" in updates[1]["UpdateExpression"]


class DailyVisitorTests(unittest.TestCase):
    def setUp(self):
        self.db = MemoryDB()
        environment = patch.dict(os.environ, ENV)
        environment.start()
        self.addCleanup(environment.stop)
        storage = patch.object(visitors, "client", return_value=self.db)
        storage.start()
        self.addCleanup(storage.stop)
        visitors._salts.clear()

    def counts(self, day=NOW.date()):
        return visitors.report(day, day)[0]["visitors"]

    def test_reloads_and_different_pages_count_once_without_client_ids_or_cookies(self):
        self.assertTrue(visitors.record(request(), NOW))
        second = request(cookie="private", authorization="private")
        second["body"] = '{"event":"page_view","page":"/picks","invite":"private"}'
        self.assertFalse(visitors.record(second, NOW))
        self.assertEqual(self.counts(), 1)
        self.assertFalse(visitors.record(request(), NOW + timedelta(seconds=30)))
        self.assertEqual(self.counts(), 1)

    def test_midnight_rotates_secret_and_hash_and_counts_returning_visitor_again(self):
        visitors.record(request(), NOW)
        tomorrow = NOW + timedelta(minutes=2)
        visitors.record(request(), tomorrow)
        self.assertEqual(self.counts(), 1)
        self.assertEqual(self.counts(tomorrow.date()), 1)
        salts = [item["salt"]["S"] for key, item in self.db.items.items() if ":salt:" in key]
        hashes = [key.rsplit(":", 1)[1] for key in self.db.items if ":seen:" in key]
        self.assertEqual(len(set(salts)), 2)
        self.assertEqual(len(set(hashes)), 2)

    def test_concurrent_lambdas_share_secret_and_count_once(self):
        # Force every invocation through DynamoDB's conditional salt initialization.
        class NoSaltCache(dict):
            def get(self, *_args):
                return None
        with patch.object(visitors, "_salts", NoSaltCache()), ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _index: visitors.record(request(), NOW), range(24)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.counts(), 1)

    def test_different_ip_or_browser_counts_separately(self):
        visitors.record(request(), NOW)
        visitors.record(request(**{"user-agent": "Another browser"}), NOW)
        other = request()
        other["requestContext"]["http"]["sourceIp"] = "192.0.2.2"
        visitors.record(other, NOW)
        self.assertEqual(self.counts(), 3)

    def test_gpc_dnt_production_and_missing_identity_never_touch_storage(self):
        for event in [request(**{"Sec-GPC": "1"}), request(dnt="1"),
                      request(**{"user-agent": ""}), {"headers": {}}]:
            self.assertFalse(visitors.record(event, NOW))
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}):
            self.assertFalse(visitors.record(request(), NOW))
            with self.assertRaises(ValueError):
                visitors.report(NOW.date(), NOW.date())
        self.assertEqual(self.db.items, {})

    def test_cloudfront_viewer_ip_and_ports_ignore_spoofed_leftmost_values(self):
        for extra in [{"x-forwarded-for": "203.0.113.99, 192.0.2.1"},
                      {"x-forwarded-for": "203.0.113.99, 192.0.2.1, 198.51.100.1"},
                      {"cloudfront-viewer-address": "192.0.2.1:45678"},
                      {"cloudfront-viewer-address": "192.0.2.1:56789"}]:
            event = request(**{"x-amz-cf-id": "edge-request", **extra})
            event["requestContext"]["http"]["sourceIp"] = "198.51.100.1"
            self.assertEqual(visitors.request_identity(event)[0], "192.0.2.1")
            visitors.record(event, NOW)
        self.assertEqual(self.counts(), 1)
        self.assertEqual(visitors.request_identity(request(**{"x-forwarded-for": "spoof"}))[0], "192.0.2.1")
        self.assertIsNone(visitors.request_identity(request(**{"x-amz-cf-id": "edge"})))
        self.assertEqual(visitors.canonical_ip("[2001:db8::1]:443"), "2001:db8::1")
        self.assertEqual(visitors.canonical_ip("2001:0db8::1"), "2001:db8::1")

    def test_no_raw_identity_or_sensitive_values_in_storage_or_admin_report(self):
        event = request(cookie="SECRET_COOKIE", authorization="SECRET_TOKEN")
        event["rawQueryString"] = "invite=SECRET_INVITE"
        event["body"] = '{"page":"/picks?invite=SECRET_INVITE","visitorId":"SECRET_ID"}'
        visitors.record(event, NOW)
        serialized = json.dumps([self.db.items, self.db.writes, visitors.report(NOW.date(), NOW.date())])
        for private in ["192.0.2.1", "Test browser", "SECRET", "/picks", "invite", "user-agent"]:
            self.assertNotIn(private, serialized)
        rows = visitors.report(NOW.date(), NOW.date())
        self.assertEqual(set(rows[0]), {"day", "visitors"})
        self.assertNotIn("salt", json.dumps(rows))

    def test_short_identity_ttl_and_aggregate_retention(self):
        visitors.record(request(), NOW)
        expiry = int(datetime(2026, 10, 6, 1, tzinfo=timezone.utc).timestamp())
        for key, item in self.db.items.items():
            if ":seen:" in key or ":salt:" in key:
                self.assertEqual(int(item["expiresAt"]["N"]), expiry)
            elif ":count:" in key:
                self.assertEqual(int(item["expiresAt"]["N"]), int(NOW.timestamp()) + 400 * 86400)

    def test_failed_transaction_does_not_leave_marker_or_partial_count(self):
        self.db.failure = RuntimeError("storage unavailable")
        with self.assertRaises(RuntimeError):
            visitors.record(request(), NOW)
        self.assertFalse(any(":seen:" in key or ":count:" in key for key in self.db.items))
        self.db.failure = None
        self.assertTrue(visitors.record(request(), NOW))
        self.assertEqual(self.counts(), 1)

    def test_uncollected_history_is_null_zero_days_after_start_are_zero(self):
        day = NOW.date()
        self.assertIsNone(self.counts())
        visitors.record(request(), NOW)
        rows = visitors.report(day - timedelta(days=1), day + timedelta(days=1))
        self.assertEqual([row["visitors"] for row in rows], [None, 1, 0])

    def test_93_day_report_is_not_truncated_or_sorted_by_count(self):
        day = NOW.date()
        visitors.record(request(), NOW)
        rows = visitors.report(day - timedelta(days=92), day)
        self.assertEqual(len(rows), 93)
        self.assertEqual(rows[-1], {"day": "2026-10-05", "visitors": 1})


if __name__ == "__main__":
    unittest.main()
