"""Small, read-only adapters. Return allowlisted summaries, never raw responses."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from collections import deque
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
from threading import Lock
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import boto3
import goatcounter_sessions
import engagement
import season_analytics


class NotConfigured(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("Provider redirects are not allowed")


def http_json(url, token, body=None):
    request = Request(url, headers={"Authorization": f"Bearer {token}",
                                   "Content-Type": "application/json", "Accept": "application/json"},
                      data=json.dumps(body).encode() if body is not None else None)
    with build_opener(NoRedirect).open(request, timeout=4) as result:
        data = result.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError("Provider response too large")
        return json.loads(data)


def http_export(url, token):
    request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/gzip"})
    with build_opener(NoRedirect).open(request, timeout=4) as result:
        if result.status != 200:
            raise ValueError("Export is not ready")
        data = result.read(goatcounter_sessions.MAX_COMPRESSED + 1)
        if len(data) > goatcounter_sessions.MAX_COMPRESSED:
            raise ValueError("Export too large")
        return data


def number(value):
    if value is None:
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Invalid provider metric")
    return int(result) if result.is_integer() else result


def metric(label, value, format="number", note=""):
    return {"label": label, "value": number(value), "format": format, "note": note}


def table(title, columns, rows):
    return {"title": title, "columns": [{"key": key, "label": label, "format": format}
                                         for key, label, format in columns], "rows": rows[:20]}


def safe_path(value):
    value = str(value or "/")
    return (urlsplit(value).path or "/")[:200]


def safe_source(value):
    value = str(value or "Direct / unknown")
    if value.startswith(("http://", "https://")):
        url = urlsplit(value)
        return f"{url.scheme}://{url.hostname or ''}"[:200]
    return re.split(r"[?#]", value)[0][:200]


def cloudwatch_query(query, start, end):
    client = boto3.client("logs")
    query_id = client.start_query(logGroupName=os.environ["ADMIN_ANALYTICS_LOG_GROUP"],
        startTime=int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp()),
        endTime=int(datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp()),
        queryString=query, limit=3000)["queryId"]
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        result = client.get_query_results(queryId=query_id)
        if result["status"] == "Complete":
            return [{field["field"]: field["value"] for field in row} for row in result["results"]]
        if result["status"] not in {"Running", "Scheduled"}:
            raise ValueError("Query failed")
        time.sleep(0.25)
    client.stop_query(queryId=query_id)
    raise TimeoutError("Query timed out")


ACTIVITY = [("sign_in", "Sign-ins"), ("account_created", "Accounts created"),
            ("account_deleted", "Accounts deleted"), ("bracket_created", "Brackets created"),
            ("bracket_completed", "Brackets completed"), ("prediction_saved", "Brackets saved"),
            ("share_card_opened", "Share cards opened"), ("share_image_generated", "Share images generated"),
            ("share_native_used", "Native shares"), ("share_image_downloaded", "Share images downloaded"),
            ("share_link_copied", "Share links copied"),
            ("group_created", "Groups created"), ("group_joined", "Group joins"),
            ("group_invite_joined", "Invite joins")]
BRACKET_EVENTS = {"bracket_created", "bracket_completed", "prediction_saved"}


def custom(_config, start, end):
    environment = os.environ.get("ENVIRONMENT")
    if environment not in {"dev", "prod"}:
        raise ValueError("Invalid analytics environment")
    # One bounded aggregate query, never individual log records or identifiers.
    query = (f'filter type = "site_analytics" and environment = "{environment}" '
             '| stats count(*) as count by datefloor(@timestamp, 1d) as day, event, '
             'coalesce(bracketType, "unknown") as bracketType | sort day asc')
    rows = cloudwatch_query(query, start, end)
    daily = {str(start + timedelta(days=i)): {key: 0 for key, _ in ACTIVITY}
             for i in range((end - start).days + 1)}
    bracket_totals = {kind: {key: 0 for key in BRACKET_EVENTS} for kind in ("nfl", "nba", "unknown")}
    bracket_daily = {}
    for row in rows:
        event = "bracket_created" if row.get("event") == "bracket_started" else row.get("event")
        day = str(row.get("day", ""))[:10]
        if day not in daily or event not in daily[day]:
            continue
        count = number(row.get("count"))
        if count is None:
            raise ValueError("Missing activity count")
        daily[day][event] += count
        if event in BRACKET_EVENTS:
            kind = row.get("bracketType") if row.get("bracketType") in {"nfl", "nba"} else "unknown"
            bracket_totals[kind][event] += count
            bracket_daily.setdefault((day, kind), {key: 0 for key in BRACKET_EVENTS})[event] += count
    totals = {key: sum(row[key] for row in daily.values()) for key, _ in ACTIVITY}
    engagement_note = "Total active time across public page visits; pauses after 1 minute idle. GPC and Do Not Track exclude collection."
    if os.environ.get("ACTIVE_ENGAGEMENT_ENABLED") != "true":
        active = {"value": None, "daily": {}, "rows": []}
        engagement_note = "Active-time collection is disabled. Product activity remains available."
    else:
        try:
            active = engagement.report(start, end)
        except Exception:
            # A counter read failure must not hide product activity or leak errors.
            active = {"value": None, "daily": {}, "rows": []}
            engagement_note = "Active time is temporarily unavailable. Product activity remains available."
    daily_rows, cumulative = [], 0
    for day, counts in daily.items():
        total = sum(counts.values())
        cumulative += total
        daily_rows.append({"day": day, **counts, "total": total, "cumulative": cumulative,
                           "active_time": active["daily"].get(day)})
    columns = [("day", "Day (UTC)", "text")] + [(key, label, "number") for key, label in ACTIVITY]
    columns += [("total", "All actions", "number"), ("cumulative", "Running total", "number")]
    columns += [("active_time", "Active engagement time", "seconds")]
    day_table = table("Daily activity", columns, [])
    day_table.update(rows=daily_rows, chart="trend", series=["total", "cumulative"])
    type_columns = [("bracketType", "Bracket type", "text")] + [(key, label, "number") for key, label in ACTIVITY if key in BRACKET_EVENTS]
    type_rows = [{"bracketType": kind.upper() if kind != "unknown" else "Historical / unknown", **values}
                 for kind, values in bracket_totals.items() if kind != "unknown" or any(values.values())]
    by_day = table("Brackets by day and type", [("day", "Day (UTC)", "text")] + type_columns, [])
    by_day["rows"] = [{"day": day, "bracketType": kind.upper(), **bracket_daily.get((day, kind), {key: 0 for key in BRACKET_EVENTS})}
                      for day in daily for kind in ("nfl", "nba", "unknown")
                      if kind != "unknown" or (day, kind) in bracket_daily]
    return {"metrics": [metric(label, totals[key]) for key, label in ACTIVITY],
            "engagement": metric("Total active engagement time", active["value"], "seconds",
                                 engagement_note),
            "tables": [day_table, table("Brackets by type", type_columns, type_rows), by_day,
                       table("Active time by page", [("page", "Page", "text"), ("sport", "Sport", "text"),
                                                    ("seconds", "Active time", "seconds")], active["rows"])],
            "note": f"AWS · {environment}. Browser-reported successful actions, not database totals or a conversion funnel. Group joins and invite joins are separate. Created brackets are built brackets. Older bracket events without a type remain historical / unknown. Deletions and type breakdowns begin with this release. GPC/DNT suppress collection."}


def goatcounter(config, start, end):
    environment = os.environ.get("ENVIRONMENT")
    allowed_paths = goatcounter_sessions.public_paths(environment)
    settings = config.get("goatcounter", {})
    token, site = settings.get("token"), settings.get("site", "predictplayoffs")
    if not token:
        raise NotConfigured()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", site):
        raise ValueError("Invalid GoatCounter site")
    base = f"https://{site}.goatcounter.com/api/v0"
    # Explicit path filters apply to totals AND fallback tables. Never use the
    # shared site's unfiltered total, which includes the other environment.
    query = urlencode({"start": f"{start}T00:00:00Z", "end": f"{end}T23:00:00Z",
                       "path_by_name": "true", "include_paths": ",".join(sorted(allowed_paths))})
    # GoatCounter permits four requests per second. Three populated pages need
    # five requests; bound the burst even when independent calls run in parallel.
    starts, lock = deque(maxlen=4), Lock()
    def api_request(suffix, body=None, binary=False):
        for attempt in range(2):
            with lock:
                if len(starts) == 4:
                    pause = 1.05 - (time.monotonic() - starts[0])
                    if pause > 0:
                        time.sleep(pause)
                starts.append(time.monotonic())
            try:
                url = f"{base}/{suffix}"
                if binary:
                    return http_export(url, token)
                return http_json(url, token, body) if body is not None else http_json(url, token)
            except HTTPError as error:
                # POST must never be retried: a lost response may already have
                # created an export and consumed the site's hourly quota.
                if body is not None or error.code != 429 or attempt:
                    raise
                # One bounded retry also handles other reports sharing the quota.
                # Never expose the upstream body, URL, or Authorization header.
                time.sleep(1.05)
    def request(suffix):
        return api_request(f"stats/{suffix}")
    # Only paginated endpoints accept limit; /stats/total rejects it with 400.
    with ThreadPoolExecutor(max_workers=2) as executor:
        totals, hits = list(executor.map(request,
                                        [f"total?{query}", f"hits?{query}&limit=100"]))
    paths = [hit for hit in hits.get("hits") or []
             if not hit.get("event") and hit.get("path") in allowed_paths]
    events = number(totals.get("total_events", 0))
    sessions, cache_seconds, traffic = goatcounter_sessions.report(settings, start, end, api_request, include_traffic=True)
    sessions["label"] = "Distinct visitors / sessions"
    # A cookieless visitor estimate is the session count, not a second person ID.
    available = bool(traffic and traffic["covered"])
    coverage_note = sessions["note"]
    sessions["note"] = "Cookieless short-lived estimate, not permanent people." if sessions["value"] is not None else "Individual pageviews coverage required; see definitions and coverage."
    metrics = [sessions,
               metric("Pageviews", traffic["pageviews"] if available else None, note="Includes repeat page loads; export coverage required."),
               metric("Average session duration", traffic["duration"] if available else None, "seconds",
                      "First to last recorded pageview; single-page sessions count as 0. Time after the last view is unknown.")]
    tables = []
    if traffic:
        daily, cumulative = [], 0
        for i in range((end - start).days + 1):
            day = str(start + timedelta(days=i))
            measured = traffic["collectedFrom"][:10] <= day <= traffic["asOf"][:10]
            counts = traffic["daily"].get(day, {"sessions": 0, "pageviews": 0}) if measured else {"sessions": None, "pageviews": None}
            cumulative += counts["pageviews"] or 0
            daily.append({"day": day, **counts, "cumulative": cumulative if measured else None})
        day_table = table("Daily traffic", [("day", "Day (UTC)", "text"), ("sessions", "Distinct sessions", "number"),
                         ("pageviews", "Pageviews", "number"), ("cumulative", "Running pageviews", "number")], [])
        day_table.update(rows=daily, chart="trend", series=["pageviews", "cumulative"])
        tables.append(day_table)
        if available:
            tables.append(table("Pageviews by page", [("page", "Page", "text"), ("pageviews", "Pageviews", "number")],
                                [{"page": page, "pageviews": count} for page, count in sorted(traffic["pages"].items(), key=lambda pair: -pair[1])]))
    # Standard stats remain useful when export coverage is absent, but must not
    # be labelled raw pageviews or site-wide distinct sessions.
    if not available:
        metrics.append(metric("Unique visits per page", number(totals.get("total", 0)) - events,
                              note="Fallback GoatCounter statistic: repeat loads of a page within a session count once; different pages add visits."))
        tables.append(table("Unique visits by page", [("page", "Page", "text"), ("visits", "Unique visits", "number")],
                            [{"page": (hit["path"].removeprefix("/prod") or "/") if environment == "prod" else hit["path"], "visits": number(hit["count"])} for hit in paths]))
    return {"metrics": metrics, "tables": tables,
            "note": f"GoatCounter · cookieless {environment} traffic. Distinct visitors and sessions share one short-lived estimate across public pages, not permanent people. Daily sessions deduplicate per day and must not be summed for range-wide distinct sessions. " + coverage_note,
            "_cache_seconds": cache_seconds}


_google_credentials = {}


def google_token():
    # Google credentials live in their own Standard SecureString (4 KB limit).
    parameter = os.environ["ADMIN_GOOGLE_CREDENTIALS_PARAMETER"]
    try:
        result = boto3.client("ssm").get_parameter(Name=parameter, WithDecryption=True)
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") == "ParameterNotFound":
            raise NotConfigured() from None
        raise
    serialized = result["Parameter"]["Value"]
    data = json.loads(serialized)
    if not data.get("private_key") or not data.get("client_email"):
        raise NotConfigured()
    fingerprint = hashlib.sha256(serialized.encode()).hexdigest()
    vendor = str(Path(__file__).with_name("vendor"))
    if vendor not in sys.path:
        sys.path.insert(0, vendor)
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GoogleRequest
    credentials = _google_credentials.get(fingerprint)
    if credentials is None:
        data["token_uri"] = "https://oauth2.googleapis.com/token"
        credentials = service_account.Credentials.from_service_account_info(data, scopes=[
            "https://www.googleapis.com/auth/webmasters.readonly"])
        _google_credentials.clear()
        _google_credentials[fingerprint] = credentials
    if not credentials.valid:
        transport = GoogleRequest()
        credentials.refresh(lambda *args, **kwargs: transport(*args, **{**kwargs, "timeout": 4}))
    return credentials.token


def search_console(config, start, end):
    site = config.get("search_console", {}).get("site_url")
    if not site:
        raise NotConfigured()
    if not (site.startswith("sc-domain:") or site.startswith("https://")):
        raise ValueError("Invalid Search Console property")
    if os.environ.get("ENVIRONMENT") == "prod" and site not in {
            "sc-domain:predictplayoffs.com", "https://predictplayoffs.com/"}:
        raise ValueError("Invalid production Search Console property")
    token = google_token()
    url = f"https://www.googleapis.com/webmasters/v3/sites/{quote(site, safe='')}/searchAnalytics/query"
    base = {"startDate": str(start), "endDate": str(end), "type": "web", "dataState": "final"}
    if os.environ.get("ENVIRONMENT") == "prod":
        # Domain properties include subdomains. Every production query is
        # constrained to the public production hosts, including totals.
        base["dimensionFilterGroups"] = [{"groupType": "and", "filters": [{
            "dimension": "page", "operator": "includingRegex",
            "expression": r"^https://(www\.)?predictplayoffs\.com/"}]}]
    dimensions = [None, "date", "query", "page", "country", "device"]
    def fetch_dimension(dimension):
        body = base if dimension is None else {**base, "dimensions": [dimension], "rowLimit": 93 if dimension == "date" else 20}
        return http_json(url, token, body)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(fetch_dimension, dimensions))
    row = (results[0].get("rows") or [{}])[0]
    measures = [("clicks", "Clicks", "number"), ("impressions", "Impressions", "number"),
                ("ctr", "CTR", "percent"), ("position", "Average position", "decimal")]
    tables = []
    for dimension, result in zip(dimensions[1:], results[1:]):
        rows = []
        for entry in result.get("rows") or []:
            key = str(entry["keys"][0])
            key = safe_path(key) if dimension == "page" else key[:200]
            rows.append({dimension: key, **{key: number(entry.get(key)) for key, _, _ in measures}})
        if dimension == "date":
            by_date = {item["date"]: item for item in rows}
            rows = [{"date": str(start + timedelta(days=i)), **{key: None for key, _, _ in measures},
                     **by_date.get(str(start + timedelta(days=i)), {})} for i in range((end - start).days + 1)]
            cumulative = 0
            for item in rows:
                cumulative += item["clicks"] or 0
                item["cumulative"] = cumulative if item["clicks"] is not None else None
            report = table("Daily search performance", [("date", "Day (Pacific)", "text")] + measures +
                           [("cumulative", "Running clicks", "number")], [])
            report.update(rows=rows, chart="trend", series=["clicks", "cumulative"])
        else:
            report = table(f"Search by {dimension}", [(dimension, dimension.title(), "text")] + measures, rows)
        tables.append(report)
    return {"metrics": [metric(label, row.get(key, 0) if key != "position" else row.get(key), fmt)
                         for key, label, fmt in measures], "tables": tables,
            "range": {"start": str(start), "end": str(end), "timezone": "America/Los_Angeles"},
            "note": "Google Search Console · final web search data for the configured property. Pacific dates; data can lag several days. Missing days are unreported, not zero. Query/page/country/device tables show top returned rows; anonymized queries and API limits mean breakdowns may not add up to totals. CTR and average position use provider aggregates."}


PROVIDERS = {"custom": custom, "goatcounter": goatcounter, "search-console": search_console,
             "seasons": season_analytics.report}
