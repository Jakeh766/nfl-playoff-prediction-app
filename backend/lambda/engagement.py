"""Cookieless active-time estimates; atomic monthly buckets contain daily totals."""
from datetime import datetime, timedelta, timezone
import calendar
import os

import boto3

PAGES = {"/": "predictor", "/nba": "predictor", "/picks": "picks",
         "/leaderboard": "leaderboard", "/scoring": "scoring", "/privacy": "privacy"}
BUCKETS = {f"{page}_{sport}": (page.capitalize(), sport.upper())
           for page in ("predictor", "picks", "leaderboard", "scoring") for sport in ("nfl", "nba")}
BUCKETS["privacy_shared"] = ("Privacy policy", "Shared")


def record(event, payload):
    if os.environ.get("ENVIRONMENT") not in {"dev", "prod"} or os.environ.get("ACTIVE_ENGAGEMENT_ENABLED") != "true":
        raise ValueError("Active engagement collection is disabled")
    if set(payload) != {"event", "page", "sport", "milliseconds"} or payload["event"] != "active_time":
        raise ValueError("Only anonymous engagement fields are accepted")
    page, sport, milliseconds = payload["page"], payload["sport"], payload["milliseconds"]
    if (not isinstance(page, str) or page not in PAGES or not isinstance(sport, str)
            or sport not in ({"shared"} if page == "/privacy" else {"nba"} if page == "/nba" else {"nfl", "nba"})):
        raise ValueError("Unknown engagement page or sport")
    if type(milliseconds) is not int or not 1 <= milliseconds <= 60_000:
        raise ValueError("Engagement intervals must be between 1 and 60000 milliseconds")
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    if headers.get("sec-gpc") == "1" or headers.get("dnt") == "1":
        return
    now = datetime.now(timezone.utc)
    month_end = datetime(now.year, now.month, calendar.monthrange(now.year, now.month)[1], tzinfo=timezone.utc)
    # Reuse existing GetItem/UpdateItem permission. No new tables, identifiers,
    # event logs or IAM grants. One bounded counter per day/page/sport.
    table = boto3.resource("dynamodb").Table(os.environ["ADMIN_ANALYTICS_CACHE_TABLE"])
    table.update_item(Key={"cacheKey": f"engagement:v1:{now:%Y-%m}"},
        UpdateExpression="SET expiresAt = :ttl ADD #counter :milliseconds",
        ExpressionAttributeNames={"#counter": f"d{now.day:02d}_{PAGES[page]}_{sport}"},
        ExpressionAttributeValues={":ttl": int((month_end + timedelta(days=367)).timestamp()),
                                   ":milliseconds": milliseconds})


def report(start, end):
    table = boto3.resource("dynamodb").Table(os.environ["ADMIN_ANALYTICS_CACHE_TABLE"])
    daily = {str(start + timedelta(days=i)): None for i in range((end - start).days + 1)}
    totals = {bucket: 0 for bucket in BUCKETS}
    months = sorted({day[:7] for day in daily})
    for month in months:  # At most four small reads for the maximum 93-day range.
        item = table.get_item(Key={"cacheKey": f"engagement:v1:{month}"}, ConsistentRead=True).get("Item", {})
        for day in (day for day in daily if day.startswith(month)):
            for bucket in BUCKETS:
                value = item.get(f"d{day[-2:]}_{bucket}")
                if value is None:
                    continue
                milliseconds = int(value)
                if milliseconds < 0 or value != milliseconds:
                    raise ValueError("Invalid aggregate engagement counter")
                totals[bucket] += milliseconds
                daily[day] = (daily[day] or 0) + milliseconds / 1000
    measured = any(value is not None for value in daily.values())
    rows = [{"page": BUCKETS[bucket][0], "sport": BUCKETS[bucket][1], "seconds": value / 1000}
            for bucket, value in sorted(totals.items(), key=lambda pair: -pair[1]) if value]
    return {"value": sum(totals.values()) / 1000 if measured else None,
            "daily": daily, "rows": rows}
