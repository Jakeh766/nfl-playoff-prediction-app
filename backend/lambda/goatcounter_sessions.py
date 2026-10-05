"""Deduplicate GoatCounter exports in memory; persist no pageviews/session IDs."""
from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
import gzip
import io
import os
import re
import time
from urllib.error import HTTPError

import boto3

PUBLIC_PATHS = frozenset({"/", "/index.html", "/nba", "/nba.html", "/picks", "/picks.html",
                         "/leaderboard", "/leaderboard.html", "/scoring", "/scoring.html",
                         "/privacy", "/privacy.html"})
CSV_HEADER = ["2Path", "Title", "Event", "UserAgent", "Browser", "System", "Session", "Bot",
              "Referrer", "Referrer scheme", "Screen size", "Location", "FirstVisit", "Date"]
MAX_COMPRESSED = 2_000_000
MAX_DECOMPRESSED = 10_000_000
MAX_ROWS = 100_000
EXPORT_INTERVAL = 3605  # Shared across date ranges/containers; GoatCounter allows one/hour.


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Export timestamp needs timezone")
    return parsed.astimezone(timezone.utc)


def distinct_count(compressed, start, end, collected_from, expected_rows):
    """All public paths, all rows (not just FirstVisit), one set for the whole range."""
    if len(compressed) > MAX_COMPRESSED:
        raise ValueError("Export too large")
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        data = stream.read(MAX_DECOMPRESSED + 1)
    if len(data) > MAX_DECOMPRESSED:
        raise ValueError("Export too large")
    reader = csv.reader(io.StringIO(data.decode("utf-8"), newline=""), strict=True)
    if next(reader, None) != CSV_HEADER:
        raise ValueError("Unsupported export schema")
    begin = max(datetime.combine(start, datetime.min.time(), timezone.utc), collected_from)
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc)
    sessions = set()
    rows = 0
    for row in reader:
        if not row:
            continue
        rows += 1
        if rows > MAX_ROWS or len(row) != len(CSV_HEADER):
            raise ValueError("Incomplete or oversized export")
        path, event, session, bot, created = row[0], row[2], row[6], row[7], row[13]
        if event not in {"true", "false"} or not re.fullmatch(r"\d+", bot):
            raise ValueError("Invalid export row")
        # Exact allowlist: a private URL (even one with a public-looking path
        # plus query/fragment) must not contribute to the public visitor count.
        if event != "false" or bot != "0" or path not in PUBLIC_PATHS:
            continue
        if not begin <= timestamp(created) < finish:
            continue
        # GoatCounter exports Uint128 sessions as hexadecimal, not UUID strings.
        if not re.fullmatch(r"[0-9a-fA-F]{1,32}", session) or int(session, 16) == 0:
            raise ValueError("Session information missing")
        sessions.add(int(session, 16))
    if rows != expected_rows:
        raise ValueError("Incomplete export")
    return len(sessions)


def export_snapshot(site, request):
    """Store only a provider export ID/time, never its contents, in the dev cache."""
    table = boto3.resource("dynamodb").Table(os.environ["ADMIN_ANALYTICS_CACHE_TABLE"])
    key = {"cacheKey": f"goatcounter-export:v1:{site}"}
    now = int(time.time())
    item = table.get_item(Key=key, ConsistentRead=True).get("Item", {})
    if int(item.get("nextExportAt", 0)) <= now:
        try:
            # Reserve quota BEFORE the network call. A timeout/crash cannot cause
            # another Lambda/date range to start another export in the same hour.
            table.update_item(Key=key,
                UpdateExpression="SET nextExportAt = :next, expiresAt = :ttl REMOVE exportId, snapshotAt",
                ConditionExpression="attribute_not_exists(nextExportAt) OR nextExportAt <= :now",
                ExpressionAttributeValues={":next": now + EXPORT_INTERVAL, ":now": now, ":ttl": now + 172800})
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            item = table.get_item(Key=key, ConsistentRead=True).get("Item", {})
        else:
            result = request("export", body={"format": "csv", "start_from_hit_id": 0})
            export_id = result.get("id")
            if type(export_id) is not int or not 0 < export_id <= 2_147_483_647:
                raise ValueError("Invalid export ID")
            snapshot = datetime.fromtimestamp(now, timezone.utc).isoformat()
            table.update_item(Key=key,
                UpdateExpression="SET exportId = :id, snapshotAt = :snapshot",
                ConditionExpression="nextExportAt = :next",
                ExpressionAttributeValues={":id": export_id, ":snapshot": snapshot, ":next": now + EXPORT_INTERVAL})
            item = {"exportId": export_id, "snapshotAt": snapshot}
    export_id = int(item.get("exportId", 0))
    if not 0 < export_id <= 2_147_483_647:
        return None
    metadata = request(f"export/{export_id}")
    if metadata.get("error"):
        raise ValueError("Export failed")
    if not metadata.get("finished_at"):
        return None
    if (metadata.get("format") != "csv" or metadata.get("start_from_hit_id") not in {None, 0}
            or type(metadata.get("num_rows")) is not int or not 0 <= metadata["num_rows"] <= MAX_ROWS):
        raise ValueError("Incomplete or oversized export")
    # Construct the URL locally; never follow a returned path/download URL.
    return request(f"export/{export_id}/download", binary=True), metadata["num_rows"], timestamp(item["snapshotAt"])


def report(settings, start, end, request):
    label = "Distinct visitors (GoatCounter sessions)"
    definition = ("Cookieless short-lived session estimate across all public pages for the selected UTC dates; "
                  "not a permanent person ID. The same session counts once across pages and days. "
                  "Returning after the eight-hour identification window can count again.")
    result = {"label": label, "value": None, "format": "number", "note": definition}
    if not settings.get("sessions_started_at"):
        result["note"] += " Enable Individual pageviews and Sessions, grant Export permission, and record sessions_started_at in dev configuration."
        return result, 900
    try:
        collected_from = timestamp(settings["sessions_started_at"])
        if start < collected_from.date():
            result["note"] += f" Individual pageviews collection began {collected_from.isoformat()}; choose dates from {collected_from.date()} onward. Earlier site-wide counts cannot be reconstructed."
            return result, 900
        snapshot = export_snapshot(settings.get("site", "predictplayoffs"), request)
        if snapshot is None:
            result["note"] += " The shared hourly export is preparing. Try again in 30 seconds."
            return result, 30
        compressed, rows, as_of = snapshot
        if as_of < collected_from:
            raise ValueError("Export predates collection")
        result["value"] = distinct_count(compressed, start, end, collected_from, rows)
        result["note"] += (f" Export requested {as_of.isoformat()}; refreshed at most hourly. "
                           "New pageviews can take a few minutes to reach an export. Events and identified bots excluded.")
        if start == collected_from.date():
            result["note"] += f" Initial collection day is partial, starting {collected_from.isoformat()}."
        if end >= as_of.date():
            result["note"] += " Current-day data is incomplete."
        return result, 900
    except HTTPError as error:
        # Only a fixed status number, never upstream body/URL/header or session ID.
        result["note"] += f" Session export unavailable (GoatCounter HTTP {int(error.code)}). Check Export permission; existing per-page metrics remain available."
    except Exception:
        result["note"] += " Session export unavailable or incomplete; existing per-page metrics remain available. No partial count is shown."
    return result, 60
