"""Small, read-only adapters. Return allowlisted summaries, never raw responses."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import boto3


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
        queryString=query, limit=100)["queryId"]
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


def custom(_config, start, end):
    base = 'filter type = "site_analytics" and environment = "dev"'
    queries = [base + " | stats count(*) as count, count_distinct(visitorId) as visitors, count_distinct(sessionId) as visits by event",
               base + ' and event = "page_view" | stats count(*) as pageviews by page | sort pageviews desc | limit 10']
    with ThreadPoolExecutor(max_workers=2) as executor:
        totals, pages = list(executor.map(lambda query: cloudwatch_query(query, start, end), queries))
    events = {row["event"]: row for row in totals}
    views = events.get("page_view", {})
    counts = lambda event: number(events.get(event, {}).get("count", 0))
    metrics = [metric("Pageviews", counts("page_view")),
               metric("Visitors with consent", views.get("visitors", 0), note="Approximate unique visitor IDs; cookieless visits excluded."),
               metric("Visits with consent", views.get("visits", 0), note="Unique session IDs; cookieless visits excluded.")]
    for event, label in [("account_created", "Accounts created"), ("sign_in", "Sign-ins"),
                         ("bracket_started", "Brackets started"), ("bracket_completed", "Brackets completed"),
                         ("prediction_saved", "Brackets saved"), ("group_created", "Groups created")]:
        metrics.append(metric(label, counts(event), note="Browser-reported event count."))
    metrics.append(metric("Groups joined", counts("group_joined") + counts("group_invite_joined"),
                          note="Includes joins through invitations."))
    return {"metrics": metrics, "tables": [table("Top pages", [("page", "Page", "text"),
             ("pageviews", "Pageviews", "number")], [{"page": safe_path(row.get("page")),
             "pageviews": number(row["pageviews"])} for row in pages])],
            "note": "Development events from CloudWatch. Counts include cookieless visits; visitor and visit counts require consent. Event counts are not account database totals."}


def goatcounter(config, start, end):
    settings = config.get("goatcounter", {})
    token, site = settings.get("token"), settings.get("site", "predictplayoffs")
    if not token:
        raise NotConfigured()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", site):
        raise ValueError("Invalid GoatCounter site")
    base = f"https://{site}.goatcounter.com/api/v0/stats"
    query = urlencode({"start": f"{start}T00:00:00Z", "end": f"{end}T23:00:00Z"})
    # Only paginated endpoints accept limit; /stats/total rejects it with 400.
    with ThreadPoolExecutor(max_workers=2) as executor:
        totals, hits = list(executor.map(lambda suffix: http_json(f"{base}/{suffix}", token),
                                        [f"total?{query}", f"hits?{query}&limit=10"]))
    paths = [hit for hit in hits.get("hits", []) if not hit.get("event")]
    referrals = {}
    def refs(hit):
        path_id = int(hit["path_id"])
        return http_json(f"{base}/hits/{path_id}?{query}&limit=20", token)
    with ThreadPoolExecutor(max_workers=3) as executor:
        for result in executor.map(refs, paths[:3]):
            for ref in result.get("refs", []):
                name = safe_source(ref.get("name"))
                referrals[name] = referrals.get(name, 0) + number(ref.get("count", 0))
    return {"metrics": [metric("Page visits", number(totals.get("total", 0)) - number(totals.get("total_events", 0)))],
            "tables": [table("Top pages", [("page", "Page", "text"), ("visits", "Page visits", "number")],
                             [{"page": safe_path(hit["path"]), "visits": number(hit["count"])} for hit in paths]),
                       table("Referrers across the top three pages", [("source", "Referrer", "text"), ("visits", "Page visits", "number")],
                             [{"source": key, "visits": value} for key, value in sorted(referrals.items(), key=lambda item: -item[1])])],
            "note": "GoatCounter deduplicates repeat visits. Page visits are not site-wide unique visitors or raw pageviews. Referrers cover only the top three returned pages."}


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
            "https://www.googleapis.com/auth/analytics.readonly",
            "https://www.googleapis.com/auth/webmasters.readonly"])
        _google_credentials.clear()
        _google_credentials[fingerprint] = credentials
    if not credentials.valid:
        transport = GoogleRequest()
        credentials.refresh(lambda *args, **kwargs: transport(*args, **{**kwargs, "timeout": 4}))
    return credentials.token


def ga_rows(report):
    dimensions = [header["name"] for header in report.get("dimensionHeaders", [])]
    metrics = [header["name"] for header in report.get("metricHeaders", [])]
    rows = []
    for row in report.get("rows", []):
        parsed = dict(zip(dimensions, [value["value"] for value in row.get("dimensionValues", [])]))
        parsed.update(zip(metrics, [number(value["value"]) for value in row.get("metricValues", [])]))
        rows.append(parsed)
    return rows


def ga4(config, start, end):
    property_id = str(config.get("ga4", {}).get("property_id", ""))
    if not property_id:
        raise NotConfigured()
    if not re.fullmatch(r"\d+", property_id):
        raise ValueError("GA4 requires numeric property ID")
    measures = [("totalUsers", "Visitors", "number"), ("sessions", "Visits", "number"),
                ("screenPageViews", "Pageviews", "number"), ("engagedSessions", "Engaged visits", "number"),
                ("engagementRate", "Engagement rate", "percent"), ("keyEvents", "Key events / conversions", "number"),
                ("sessionKeyEventRate", "Visit conversion rate", "percent"),
                ("averageSessionDuration", "Average visit duration", "seconds"),
                ("userEngagementDuration", "Total engagement time", "seconds")]
    ranges = [{"startDate": str(start), "endDate": str(end)}]
    reports = [{"dateRanges": ranges, "metrics": [{"name": item[0]} for item in measures]},
               {"dateRanges": ranges, "dimensions": [{"name": "pagePath"}],
                "metrics": [{"name": "screenPageViews"}], "limit": "10",
                "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}]},
               {"dateRanges": ranges, "dimensions": [{"name": "sessionSourceMedium"}],
                "metrics": [{"name": "sessions"}], "limit": "10",
                "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}]}]
    result = http_json(f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:batchRunReports",
                       google_token(), {"requests": reports})["reports"]
    totals = (ga_rows(result[0]) or [{}])[0]
    return {"metrics": [metric(label, totals.get(key, 0), format) for key, label, format in measures],
            "tables": [table("Top pages", [("page", "Page", "text"), ("pageviews", "Pageviews", "number")],
                             [{"page": safe_path(row["pagePath"]), "pageviews": row["screenPageViews"]} for row in ga_rows(result[1])]),
                       table("Traffic sources", [("source", "Source / medium", "text"), ("visits", "Visits", "number")],
                             [{"source": safe_source(row["sessionSourceMedium"]), "visits": row["sessions"]} for row in ga_rows(result[2])])],
            "range": {"start": str(start), "end": str(end), "timezone": "GA4 property timezone"},
            "note": "Optional, consented GA4 traffic. Key events must be marked in GA4. Property timezone and provider processing can differ from CloudWatch."}


def search_console(config, start, end):
    site = config.get("search_console", {}).get("site_url")
    if not site:
        raise NotConfigured()
    if not (site.startswith("sc-domain:") or site.startswith("https://")):
        raise ValueError("Invalid Search Console property")
    token = google_token()
    url = f"https://www.googleapis.com/webmasters/v3/sites/{quote(site, safe='')}/searchAnalytics/query"
    base = {"startDate": str(start), "endDate": str(end), "type": "web", "dataState": "final"}
    with ThreadPoolExecutor(max_workers=2) as executor:
        totals, pages = list(executor.map(lambda body: http_json(url, token, body),
            [base, {**base, "dimensions": ["page"], "rowLimit": 10}]))
    row = (totals.get("rows") or [{}])[0]
    return {"metrics": [metric("Impressions", row.get("impressions", 0)), metric("Clicks", row.get("clicks", 0)),
                         metric("Click-through rate", row.get("ctr", 0), "percent"),
                         metric("Average position", row.get("position"), "decimal")],
            "tables": [table("Top search pages", [("page", "Page", "text"), ("clicks", "Clicks", "number"),
                ("impressions", "Impressions", "number"), ("ctr", "CTR", "percent"), ("position", "Position", "decimal")],
                [{"page": safe_path(row["keys"][0]), **{key: number(row[key]) for key in
                  ("clicks", "impressions", "ctr", "position")}} for row in pages.get("rows", [])])],
            "range": {"start": str(start), "end": str(end), "timezone": "America/Los_Angeles"},
            "note": "Google web search performance for the configured property. Final data can lag several days. An unindexed development property may have no results."}


def clarity(config, _start, _end):
    token = config.get("clarity", {}).get("token")
    if not token:
        raise NotConfigured()
    data = http_json("https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3", token)
    summaries = {item["metricName"]: item.get("information", []) for item in data}
    metrics = []
    # No breakdown dimensions: rates/averages are provider aggregates, not sums
    # or unweighted averages of per-page percentages. Missing metrics stay absent.
    supported = {"Traffic": [("totalSessionCount", "Visits", "number"),
                              ("distinctUserCount", "Visitors", "number"),
                              ("totalBotSessionCount", "Bot visits", "number")],
                 "EngagementTime": [("activeTime", "Active engagement time", "seconds"),
                                    ("totalTime", "Total engagement time", "seconds")],
                 "ScrollDepth": [("averageScrollDepth", "Average scroll depth", "percent100")],
                 "RageClickCount": [("sessionsWithMetricPercentage", "Visits with rage clicks", "percent100")],
                 "DeadClickCount": [("sessionsWithMetricPercentage", "Visits with dead clicks", "percent100")]}
    for name, fields in supported.items():
        rows = summaries.get(name, [])
        if len(rows) == 1:
            for field, label, format in fields:
                if field in rows[0]:
                    metrics.append(metric(label, rows[0][field], format))
    if not metrics:
        raise ValueError("No supported Clarity summary metrics returned")
    return {"metrics": metrics, "tables": [], "range": {"window": "Latest 72 hours at retrieval", "timezone": "UTC"},
            "note": "Clarity's export supports only the latest 72 hours, independently of your selected dates. Summaries are cached for six hours; missing fields are not reported as zero. Visits include reported bot visits."}


PROVIDERS = {"custom": custom, "goatcounter": goatcounter, "ga4": ga4,
             "search-console": search_console, "clarity": clarity}
