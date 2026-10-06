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


class ExportUnavailable(ValueError):
    """Only fixed application-authored diagnostics may reach the private UI."""


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ExportUnavailable("Export timestamp has no timezone.")
    return parsed.astimezone(timezone.utc)


def traffic_counts(compressed, start, end, collected_from, expected_rows):
    """All public paths, all rows (not just FirstVisit), one set for the whole range."""
    if len(compressed) > MAX_COMPRESSED:
        raise ExportUnavailable("Export exceeds the compressed size limit.")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            data = stream.read(MAX_DECOMPRESSED + 1)
    except (OSError, EOFError):
        raise ExportUnavailable("Export compression is invalid or incomplete.") from None
    if len(data) > MAX_DECOMPRESSED:
        raise ExportUnavailable("Export exceeds the decompressed size limit.")
    reader = csv.reader(io.StringIO(data.decode("utf-8"), newline=""), strict=True)
    header = next(reader, None)
    # Hosted releases differ in names of unused columns (User-Agent/UserAgent).
    # Check version and the fields we actually consume, not incidental labels.
    required = {"2Path", "Event", "Session", "Bot", "Date"}
    if (not header or header[0] != "2Path" or len(header) != len(CSV_HEADER)
            or len(set(header)) != len(header) or not required.issubset(header)):
        raise ExportUnavailable("GoatCounter CSV version or required columns are unsupported.")
    indexes = [header.index(field) for field in ("2Path", "Event", "Session", "Bot", "Date")]
    begin = max(datetime.combine(start, datetime.min.time(), timezone.utc), collected_from)
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc)
    sessions, days, pages = {}, {}, {}
    rows = 0
    for row in reader:
        if not row:
            continue
        rows += 1
        if rows > MAX_ROWS or len(row) != len(header):
            raise ExportUnavailable("Export row count or field count is invalid.")
        path, event, session, bot, created = [row[index] for index in indexes]
        # SQLite-backed exports serialize booleans as 0/1; other releases use
        # true/false. Both describe the same CSV v2 field.
        if event not in {"true", "false", "0", "1"} or not re.fullmatch(r"\d+", bot):
            raise ExportUnavailable("Export event or bot field is invalid.")
        # Exact allowlist: a private URL (even one with a public-looking path
        # plus query/fragment) must not contribute to the public visitor count.
        if event not in {"false", "0"} or bot != "0" or path not in PUBLIC_PATHS:
            continue
        created_at = timestamp(created)
        if not begin <= created_at < finish:
            continue
        # zint.Uint128.String uses two 64-bit hex halves separated by a dash.
        # Normalize the equivalent contiguous encoding without retaining IDs.
        if not re.fullmatch(r"(?:[0-9a-fA-F]{16}-[0-9a-fA-F]{16}|[0-9a-fA-F]{1,32})", session):
            raise ExportUnavailable("Export session information is missing or invalid.")
        normalized = int(session.replace("-", ""), 16)
        if normalized == 0:
            raise ExportUnavailable("Export session information is missing or invalid.")
        day = created_at.date().isoformat()
        days.setdefault(day, {"sessions": set(), "pageviews": 0})
        days[day]["sessions"].add(normalized)
        days[day]["pageviews"] += 1
        pages[path] = pages.get(path, 0) + 1
        first, last = sessions.get(normalized, (created_at, created_at))
        sessions[normalized] = (min(first, created_at), max(last, created_at))
    if rows != expected_rows:
        raise ExportUnavailable("Export row count does not match the completed export.")
    return {"sessions": len(sessions), "pageviews": sum(pages.values()), "pages": pages,
            "duration": sum((last - first).total_seconds() for first, last in sessions.values()) / len(sessions) if sessions else None,
            "daily": {day: {"sessions": len(counts["sessions"]), "pageviews": counts["pageviews"]} for day, counts in days.items()}}


def distinct_count(compressed, start, end, collected_from, expected_rows):
    return traffic_counts(compressed, start, end, collected_from, expected_rows)["sessions"]


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
                raise ExportUnavailable("GoatCounter returned an invalid export ID.")
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
        raise ExportUnavailable("GoatCounter could not finish the export.")
    if not metadata.get("finished_at"):
        return None
    if (metadata.get("format") != "csv" or metadata.get("start_from_hit_id") not in {None, 0}
            or type(metadata.get("num_rows")) is not int or not 0 <= metadata["num_rows"] <= MAX_ROWS):
        raise ExportUnavailable("Export metadata indicates an incomplete or oversized CSV.")
    # Construct the URL locally; never follow a returned path/download URL.
    return request(f"export/{export_id}/download", binary=True), metadata["num_rows"], timestamp(item["snapshotAt"])


def report(settings, start, end, request, *, include_traffic=False):
    label = "Distinct visitors (GoatCounter sessions)"
    definition = ("Cookieless short-lived session estimate across all public pages for the selected UTC dates; "
                  "not a permanent person ID. The same session counts once across pages and days. "
                  "Returning after the eight-hour identification window can count again.")
    result = {"label": label, "value": None, "format": "number", "note": definition}
    traffic = None
    def finish(ttl):
        return (result, ttl, traffic) if include_traffic else (result, ttl)
    if not settings.get("sessions_started_at"):
        result["note"] += " Enable Individual pageviews and Sessions, grant Export permission, and record sessions_started_at in dev configuration."
        return finish(900)
    try:
        collected_from = timestamp(settings["sessions_started_at"])
        covered = start >= collected_from.date()
        if not covered:
            result["note"] += f" Individual pageviews collection began {collected_from.isoformat()}; choose dates from {collected_from.date()} onward. Earlier site-wide counts cannot be reconstructed."
            if not include_traffic:
                return finish(900)
        snapshot = export_snapshot(settings.get("site", "predictplayoffs"), request)
        if snapshot is None:
            result["note"] += " The shared hourly export is preparing. Try again in 30 seconds."
            return finish(30)
        compressed, rows, as_of = snapshot
        if as_of < collected_from:
            raise ExportUnavailable("The export predates Individual pageviews collection.")
        traffic = traffic_counts(compressed, start, end, collected_from, rows)
        traffic.update(covered=covered, collectedFrom=collected_from.isoformat(), asOf=as_of.isoformat())
        result["value"] = traffic["sessions"] if covered else None
        result["note"] += (f" Export requested {as_of.isoformat()}; refreshed at most hourly. "
                           "New pageviews can take a few minutes to reach an export. Events and identified bots excluded.")
        if start == collected_from.date():
            result["note"] += f" Initial collection day is partial, starting {collected_from.isoformat()}."
        if end >= as_of.date():
            result["note"] += " Current-day data is incomplete."
        return finish(900)
    except HTTPError as error:
        # Only a fixed status number, never upstream body/URL/header or session ID.
        result["note"] += f" Session export unavailable (GoatCounter HTTP {int(error.code)}). Check Export permission; existing per-page metrics remain available."
    except ExportUnavailable as error:
        result["note"] += f" Session export unavailable: {error} Existing per-page metrics remain available; no partial count is shown."
    except Exception:
        result["note"] += " Session export unavailable or incomplete; existing per-page metrics remain available. No partial count is shown."
    return finish(60)
