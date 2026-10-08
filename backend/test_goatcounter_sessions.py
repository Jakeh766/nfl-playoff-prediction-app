"""GoatCounter's real CSV v2 schema, range deduplication and private export cache."""
import csv
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import gzip
import importlib
import io
import json
import os
from pathlib import Path
import sys
from threading import Lock
import types
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent / "lambda"))
sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
sessions = importlib.import_module("goatcounter_sessions")
providers = importlib.import_module("analytics_providers")

START, END = date(2026, 10, 5), date(2026, 10, 6)
COLLECTED = datetime(2026, 10, 5, tzinfo=timezone.utc)
SETTINGS = {"site": "predictplayoffs", "sessions_started_at": COLLECTED.isoformat()}
NOW = int(datetime(2026, 10, 6, 12, tzinfo=timezone.utc).timestamp())
SESSION_A, SESSION_B = "0123456789abcdef-0123456789abcdef", "fedcba9876543210-fedcba9876543210"


def row(path="/", session=SESSION_A, created="2026-10-05T10:00:00Z", **kwargs):
    data = dict(zip(sessions.CSV_HEADER, [path, "Public page", "0", "", "Chrome 1", "Windows",
                                        session, "0", "", "h", "1000,0,1", "US", "1", created]))
    data.update(kwargs)
    return [data[field] for field in sessions.CSV_HEADER]


def export(rows, header=None):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(sessions.CSV_HEADER if header is None else header)
    writer.writerows(rows)
    return gzip.compress(stream.getvalue().encode())


class ConditionalFailure(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class ExportCache:
    def __init__(self):
        self.item = {}
        self.writes = []
        self.lock = Lock()

    def get_item(self, **_kwargs):
        with self.lock:
            return {"Item": self.item.copy()}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues, **_kwargs):
        with self.lock:
            values = ExpressionAttributeValues
            self.writes.append(json.dumps(values))
            if ":now" in values:
                if self.item.get("nextExportAt", 0) > values[":now"]:
                    raise ConditionalFailure()
                self.item = {"nextExportAt": values[":next"], "expiresAt": values[":ttl"]}
            else:
                if self.item["nextExportAt"] != values[":next"]:
                    raise ConditionalFailure()
                self.item.update(exportId=values[":id"], snapshotAt=values[":snapshot"])


class SessionTests(unittest.TestCase):
    def test_traffic_preserves_repeat_views_range_uniques_daily_uniques_and_elapsed_duration(self):
        rows = [row(created="2026-10-05T23:50:00Z"),
                row(path="/picks", created="2026-10-06T00:10:00Z", FirstVisit="0"),
                row(path="/", created="2026-10-06T00:20:00Z", FirstVisit="0"),
                row(session=SESSION_B, created="2026-10-06T10:00:00Z"),
                row(path="/private", created="2026-10-06T11:00:00Z"),
                row(Event="1"), row(Bot="1")]
        result = sessions.traffic_counts(export(rows), START, END, COLLECTED, len(rows))
        self.assertEqual(result["sessions"], 2)
        self.assertEqual(result["pageviews"], 4)
        self.assertEqual(result["pages"], {"/": 3, "/picks": 1})
        self.assertEqual(result["duration"], 900)
        self.assertEqual(result["daily"]["2026-10-05"], {"sessions": 1, "pageviews": 1})
        self.assertEqual(result["daily"]["2026-10-06"], {"sessions": 2, "pageviews": 3})
        for identifier in (SESSION_A, SESSION_B):
            self.assertNotIn(identifier, json.dumps(result))

    def count(self, rows, start=START, end=END, collected=COLLECTED):
        return sessions.distinct_count(export(rows), start, end, collected, len(rows))

    def test_site_wide_dedup_includes_every_public_page_not_just_top_ten(self):
        rows = [row(path=path) for path in sessions.PUBLIC_PATHS]
        rows += [row(session=SESSION_B), row(FirstVisit="false"), row(created="2026-10-06T01:00:00Z")]
        self.assertEqual(self.count(rows), 2)
        self.assertGreater(len(sessions.PUBLIC_PATHS), 10)

    def test_same_session_across_midnight_counts_once_across_range(self):
        rows = [row(created="2026-10-05T23:59:59Z"), row(path="/picks", created="2026-10-06T00:00:00Z")]
        self.assertEqual(self.count(rows), 1)
        self.assertEqual(self.count(rows, end=START), 1)
        self.assertEqual(self.count(rows, start=END), 1)

    def test_utc_inclusive_days_timezone_offsets_and_revisits(self):
        rows = [row(created="2026-10-04T19:00:00-05:00", FirstVisit="false"),
                row(session=SESSION_B, created="2026-10-06T23:59:59Z"),
                row(session="abc", created="2026-10-07T00:00:00Z"),
                row(session="def", created="2026-10-04T23:59:59Z")]
        self.assertEqual(self.count(rows), 2)

    def test_private_urls_query_fragments_events_and_bots_are_excluded(self):
        rows = [row(), row(path="/admin/analytics", session="ab"), row(path="/groups?invite=PRIVATE", session="cd"),
                row(path="/picks?invite=PRIVATE", session="ef"), row(path="/picks#PRIVATE", session="aa"),
                row(path="https://private.example/picks", session="bb"), row(session="cc", Event="true"),
                row(session="dd", Bot="1")]
        self.assertEqual(self.count(rows), 1)

    def test_sport_paths_preserve_separate_counts_and_reject_extra_private_data(self):
        rows = [row(path="/leaderboard"), row(path="/nfl/leaderboard"), row(path="/nba/leaderboard"),
                row(path="/nba/leaderboard", FirstVisit="0"),
                row(path="/nba/leaderboard?invite=PRIVATE", session=SESSION_B),
                row(path="/nba/leaderboard#PRIVATE", session=SESSION_B),
                row(path="/other/leaderboard", session=SESSION_B)]
        result = sessions.traffic_counts(export(rows), START, END, COLLECTED, len(rows))
        self.assertEqual(result["pages"], {"/leaderboard": 1, "/nfl/leaderboard": 1, "/nba/leaderboard": 2})
        self.assertEqual(result["pageviews"], 4)
        self.assertEqual(result["sessions"], 1)
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_activation_time_excludes_earlier_rows_on_initial_day(self):
        self.assertEqual(self.count([row(), row(session=SESSION_B, created="2026-10-05T12:00:00Z")],
                                   collected=sessions.timestamp("2026-10-05T11:00:00Z")), 1)

    def test_empty_export_is_zero_but_invalid_missing_sessions_fail_closed(self):
        self.assertEqual(self.count([]), 0)
        for value in ("", "0", "not-a-session", "f" * 33):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.count([row(session=value)])

    def test_real_v2_header_quoted_fields_boolean_and_session_normalization(self):
        rows = [row(Title='Quoted "title", with\nnewline'), row(session=SESSION_A.upper()),
                row(session=SESSION_A.replace("-", ""), Event="false"), row(session=SESSION_B, Event="1")]
        self.assertEqual(self.count(rows), 1)
        for header in (["3Path", *sessions.CSV_HEADER[1:]], ["2", "Path", *sessions.CSV_HEADER[1:]]):
            with self.assertRaises(ValueError):
                sessions.distinct_count(export(rows, header), START, END, COLLECTED, len(rows))
        hosted_header = sessions.CSV_HEADER.copy()
        hosted_header[3] = "User-Agent"
        self.assertEqual(sessions.distinct_count(export(rows, hosted_header), START, END, COLLECTED, len(rows)), 1)

    def test_unpadded_provider_session_halves_deduplicate_without_boundary_collisions(self):
        # GoatCounter's zint.Uint128.Format prints each half without zero padding.
        rows = [row(session="1-23"), row(session="0000000000000001-0000000000000023"),
                row(session="00000000000000010000000000000023"), row(session="12-3"), row(session="0-ab")]
        self.assertEqual(self.count(rows), 3)
        for malformed in ("0-0", "-1", "1-", "1-2-3", "1-" + "f" * 17):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                self.count([row(session=malformed)])

    def test_truncated_corrupt_or_oversized_exports_never_return_partial_counts(self):
        with self.assertRaises(ValueError):
            sessions.distinct_count(export([row()]), START, END, COLLECTED, 2)
        with self.assertRaises(sessions.ExportUnavailable):
            sessions.distinct_count(export([row()])[:-8], START, END, COLLECTED, 1)
        with patch.object(sessions, "MAX_DECOMPRESSED", 10), self.assertRaises(ValueError):
            self.count([row()])
        with patch.object(sessions, "MAX_ROWS", 1), self.assertRaises(ValueError):
            self.count([row(), row()])
        with patch.object(sessions, "MAX_COMPRESSED", 10), self.assertRaises(ValueError):
            self.count([row()])

    def test_date_without_timezone_fails_closed(self):
        with self.assertRaises(ValueError):
            self.count([row(created="2026-10-05T01:00:00")])

    def test_historical_range_and_unconfigured_collection_do_not_request_exports(self):
        request = Mock()
        result, _ = sessions.report(SETTINGS, date(2026, 10, 4), END, request)
        self.assertIsNone(result["value"])
        self.assertIn("cannot be reconstructed", result["note"])
        sessions.report({}, START, END, request)
        request.assert_not_called()

    def setUp(self):
        self.cache = ExportCache()
        self.patchers = [patch.dict(os.environ, {"ENVIRONMENT": "dev", "ADMIN_ANALYTICS_CACHE_TABLE": "dev-cache"}),
            patch.object(sessions.boto3, "resource", return_value=types.SimpleNamespace(Table=lambda _name: self.cache)),
            patch.object(sessions.time, "time", return_value=NOW)]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def request(self, suffix, body=None, binary=False):
        if suffix == "export":
            self.assertEqual(body, {"format": "csv", "start_from_hit_id": 0})
            return {"id": 123, "path": "https://attacker.example/private"}
        if suffix == "export/123":
            return {"format": "csv", "finished_at": "2026-10-06T12:00:01Z", "num_rows": 2, "start_from_hit_id": None}
        self.assertEqual(suffix, "export/123/download")
        self.assertTrue(binary)
        return export([row(), row(path="/privacy", session=SESSION_B)])

    def test_shared_hourly_export_reused_for_different_ranges_only_aggregates_returned(self):
        request = Mock(side_effect=self.request)
        report, ttl = sessions.report(SETTINGS, START, END, request)
        self.assertEqual(report["value"], 2)
        self.assertEqual(ttl, 900)
        self.assertIn("not a permanent person ID", report["note"])
        self.assertIn("Initial collection day is partial", report["note"])
        self.assertIn("refreshed at most hourly", report["note"])
        second, _ = sessions.report(SETTINGS, END, END, request)
        self.assertEqual(second["value"], 0)
        self.assertEqual(sum(call.args[0] == "export" for call in request.call_args_list), 1)
        for secret in (SESSION_A, SESSION_B, "attacker.example"):
            self.assertNotIn(secret, json.dumps([report, second, self.cache.item, self.cache.writes]))

    def test_new_hour_refreshes_export_but_uncertain_post_is_never_retried(self):
        request = Mock(side_effect=self.request)
        sessions.report(SETTINGS, START, END, request)
        with patch.object(sessions.time, "time", return_value=NOW + sessions.EXPORT_INTERVAL):
            sessions.report(SETTINGS, START, END, request)
        self.assertEqual(sum(call.args[0] == "export" for call in request.call_args_list), 2)
        self.cache.item.clear()
        failed = Mock(side_effect=TimeoutError("PRIVATE-TOKEN"))
        result, _ = sessions.report(SETTINGS, START, END, failed)
        sessions.report(SETTINGS, END, END, failed)
        self.assertIsNone(result["value"])
        self.assertNotIn("PRIVATE-TOKEN", json.dumps(result))
        failed.assert_called_once()

    def test_concurrent_date_ranges_cannot_create_duplicate_hourly_exports(self):
        request = Mock(side_effect=self.request)
        with ThreadPoolExecutor(max_workers=4) as pool:
            reports = list(pool.map(lambda day: sessions.report(SETTINGS, day, END, request), [START, END, START, END]))
        self.assertEqual(sum(call.args[0] == "export" for call in request.call_args_list), 1)
        self.assertTrue(all(result["value"] in {None, 0, 2} for result, _ in reports))

    def test_pending_export_short_retry_then_finished_export_is_read(self):
        request = Mock(side_effect=lambda suffix, **kw: {"finished_at": None} if suffix == "export/123" else self.request(suffix, **kw))
        result, ttl = sessions.report(SETTINGS, START, END, request)
        self.assertIsNone(result["value"])
        self.assertEqual(ttl, 30)
        self.assertFalse(any(call.kwargs.get("binary") for call in request.call_args_list))
        ready, _ = sessions.report(SETTINGS, START, END, self.request)
        self.assertEqual(ready["value"], 2)

    def test_export_403_or_error_body_never_exposes_private_details(self):
        result, _ = sessions.report(SETTINGS, START, END,
            Mock(side_effect=HTTPError("https://private.example", 403, "PRIVATE-TOKEN", {}, None)))
        self.assertIsNone(result["value"])
        self.assertIn("HTTP 403", result["note"])
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("private.example", json.dumps(result))

    def test_export_failure_does_not_hide_existing_per_page_provider_metrics(self):
        def stats(url, token, body=None):
            if "/stats/total?" in url:
                return {"total": 3, "total_events": 0}
            if "/stats/hits?" in url:
                return {"hits": []}
            raise HTTPError(url, 403, "PRIVATE-TOKEN", {}, None)
        with patch.object(providers, "http_json", side_effect=stats):
            report = providers.goatcounter({"goatcounter": {**SETTINGS, "token": "PRIVATE-TOKEN"}}, START, END)
        self.assertEqual(report["metrics"][-1]["value"], 3)
        self.assertIsNone(report["metrics"][0]["value"])
        self.assertNotIn("PRIVATE-TOKEN", json.dumps(report))

    def test_shared_export_is_reused_between_environments_without_mixed_counts(self):
        rows = [row(), row(path="/prod/", session=SESSION_B),
                row(path="/prod/nba/picks", session=SESSION_B, created="2026-10-05T10:01:00Z"),
                row(path="/prod/picks?invite=PRIVATE"), row(path="/prod/admin/analytics")]
        def request(suffix, **kw):
            if suffix == "export/123":
                return {"format": "csv", "finished_at": "2026-10-06T12:00:01Z", "num_rows": len(rows)}
            if kw.get("binary"):
                return export(rows)
            return self.request(suffix, **kw)
        request = Mock(side_effect=request)
        table = Mock(return_value=self.cache)
        with patch.object(sessions.boto3, "resource", return_value=types.SimpleNamespace(Table=table)), \
                patch.dict(os.environ, {"GOATCOUNTER_EXPORT_CACHE_TABLE": "shared-metadata"}):
            dev, _, dev_traffic = sessions.report(SETTINGS, START, END, request, include_traffic=True)
            with patch.dict(os.environ, {"ENVIRONMENT": "prod", "ADMIN_ANALYTICS_CACHE_TABLE": "prod-private-reports"}):
                prod, _, prod_traffic = sessions.report(SETTINGS, START, END, request, include_traffic=True)
        self.assertEqual(dev["value"], 1)
        self.assertEqual(prod["value"], 1)
        self.assertEqual(dev_traffic["pageviews"], 1)
        self.assertEqual(prod_traffic["pageviews"], 2)
        self.assertEqual(prod_traffic["pages"], {"/": 1, "/nba/picks": 1})
        self.assertEqual(prod_traffic["duration"], 60)
        self.assertEqual(sum(call.args[0] == "export" for call in request.call_args_list), 1)
        self.assertTrue(all(call.args == ("shared-metadata",) for call in table.call_args_list))
        self.assertNotIn("PRIVATE", json.dumps([dev_traffic, prod_traffic]))

    def test_export_before_new_production_collection_is_pending_not_zero(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}):
            result, ttl, traffic = sessions.report({**SETTINGS, "sessions_started_at": "2026-10-06T13:00:00Z"},
                                                  END, END, self.request, include_traffic=True)
        self.assertIsNone(result["value"])
        self.assertIsNone(traffic)
        self.assertEqual(ttl, 60)
        self.assertIn("predates this environment", result["note"])

    def test_public_path_allowlist_stays_aligned_with_tracking_loader(self):
        loader = (Path(__file__).parent.parent / "frontend/goatcounter.js").read_text()
        for path in sessions.PUBLIC_PATHS:
            self.assertIn(json.dumps(path), loader)


if __name__ == "__main__":
    unittest.main()
