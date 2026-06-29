"""AWS Lambda API for NFL win totals and saved playoff predictions."""

from __future__ import annotations

import json
import os
import re
import statistics
import time
from decimal import Decimal
from urllib.parse import unquote
from urllib.request import Request, urlopen

import boto3

API_VERSION = 2
ODDS_URL = "https://www.vegasinsider.com/nfl/odds/win-totals/"
CACHE_KEY = "current"
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "21600"))

FALLBACK_TOTALS = {
    "Arizona Cardinals": 4.5,
    "Atlanta Falcons": 7.5,
    "Baltimore Ravens": 11.5,
    "Buffalo Bills": 10.5,
    "Carolina Panthers": 7.5,
    "Chicago Bears": 9.5,
    "Cincinnati Bengals": 8.5,
    "Cleveland Browns": 6.5,
    "Dallas Cowboys": 8.5,
    "Denver Broncos": 9.5,
    "Detroit Lions": 10.5,
    "Green Bay Packers": 10.5,
    "Houston Texans": 9.5,
    "Indianapolis Colts": 7.5,
    "Jacksonville Jaguars": 8.5,
    "Kansas City Chiefs": 10.5,
    "Las Vegas Raiders": 6.5,
    "Los Angeles Chargers": 10.5,
    "Los Angeles Rams": 11.5,
    "Miami Dolphins": 4.5,
    "Minnesota Vikings": 7.5,
    "New England Patriots": 9.5,
    "New Orleans Saints": 6.5,
    "New York Giants": 7.5,
    "New York Jets": 5.5,
    "Philadelphia Eagles": 10.5,
    "Pittsburgh Steelers": 8.5,
    "San Francisco 49ers": 10.5,
    "Seattle Seahawks": 11.5,
    "Tampa Bay Buccaneers": 8.5,
    "Tennessee Titans": 6.5,
    "Washington Commanders": 7.5,
}


def cache_table():
    return boto3.resource("dynamodb").Table(os.environ["CACHE_TABLE"])


def predictions_table():
    return boto3.resource("dynamodb").Table(os.environ["PREDICTIONS_TABLE"])


def fetch_live_totals() -> dict[str, float]:
    request = Request(
        ODDS_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/126 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=12) as response:
        html = response.read().decode("utf-8", errors="ignore")

    totals: dict[str, float] = {}
    rows = re.findall(
        r'<tr[^>]*data-name="[^"]+"[^>]*>(.*?)</tr>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for row in rows:
        team_match = re.search(
            r'"description":"([^"]+)"',
            row,
            flags=re.IGNORECASE,
        )
        if not team_match:
            continue

        team = team_match.group(1)
        if team not in FALLBACK_TOTALS:
            continue

        book_lines = [
            float(value)
            for value in re.findall(
                r'class="data-value"[^>]*>\s*[ou](\d+(?:\.5)?)',
                row,
                flags=re.IGNORECASE,
            )
        ]
        valid_lines = [value for value in book_lines if 2.5 <= value <= 14.5]
        if valid_lines:
            totals[team] = float(statistics.median(valid_lines))

    if len(totals) < 32:
        raise ValueError(
            f"VegasInsider returned only {len(totals)} readable team win totals"
        )
    return totals


def load_cache() -> dict | None:
    response = cache_table().get_item(Key={"cacheKey": CACHE_KEY})
    item = response.get("Item")
    if not item or len(item.get("totals", {})) != 32:
        return None

    return {
        "apiVersion": API_VERSION,
        "totals": {
            team: float(value) for team, value in item["totals"].items()
        },
        "source": item["source"],
        "sourceUrl": ODDS_URL,
        "status": "cached",
        "updatedAt": int(item["updatedAt"]),
    }


def save_cache(payload: dict) -> None:
    cache_table().put_item(
        Item={
            "cacheKey": CACHE_KEY,
            "totals": {
                team: Decimal(str(value))
                for team, value in payload["totals"].items()
            },
            "source": payload["source"],
            "updatedAt": payload["updatedAt"],
        }
    )


def get_win_totals() -> dict:
    cached = None
    try:
        cached = load_cache()
        if cached and int(time.time()) - cached["updatedAt"] < CACHE_TTL_SECONDS:
            return cached

        payload = {
            "apiVersion": API_VERSION,
            "totals": fetch_live_totals(),
            "source": "VegasInsider sportsbook consensus",
            "sourceUrl": ODDS_URL,
            "status": "live",
            "updatedAt": int(time.time()),
        }
        save_cache(payload)
        return payload
    except Exception as error:
        if cached:
            cached["message"] = str(error)
            return cached
        return {
            "apiVersion": API_VERSION,
            "totals": FALLBACK_TOTALS,
            "source": "bundled 2026 FanDuel/DraftKings market snapshot",
            "sourceUrl": ODDS_URL,
            "status": "fallback",
            "updatedAt": None,
            "message": str(error),
        }


def response(status_code: int, payload: dict) -> dict:
    def encode_decimal(value):
        if isinstance(value, Decimal):
            return int(value) if value % 1 == 0 else float(value)
        raise TypeError

    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload, default=encode_decimal),
    }


def parse_body(event) -> dict:
    try:
        body = json.loads(event.get("body") or "{}")
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("Request body must be valid JSON") from error
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return body


def validate_prediction(profile_key: str, prediction: dict) -> dict:
    display_name = prediction.get("displayName")
    division_winners = prediction.get("divisionWinners")
    seeds = prediction.get("seeds")
    picks = prediction.get("picks")

    if not profile_key or len(profile_key) > 80:
        raise ValueError("Invalid profile key")
    if not isinstance(display_name, str) or not 1 <= len(display_name.strip()) <= 40:
        raise ValueError("displayName must contain 1-40 characters")
    if not isinstance(division_winners, dict):
        raise ValueError("divisionWinners must be an object")
    if not isinstance(seeds, dict):
        raise ValueError("seeds must be an object")
    if not isinstance(picks, dict):
        raise ValueError("picks must be an object")

    for conference in ("AFC", "NFC"):
        if not isinstance(seeds.get(conference), list) or len(seeds[conference]) != 7:
            raise ValueError(f"{conference} seeds must contain seven teams")

    saved_at = int(time.time() * 1000)
    return {
        "profileKey": profile_key,
        "displayName": display_name.strip(),
        "divisionWinners": division_winners,
        "seeds": seeds,
        "picks": picks,
        "bracketBuilt": bool(prediction.get("bracketBuilt")),
        "savedAt": saved_at,
    }


def list_predictions() -> list[dict]:
    items = []
    scan_kwargs = {}
    while True:
        result = predictions_table().scan(**scan_kwargs)
        items.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    items.sort(key=lambda item: int(item.get("savedAt", 0)), reverse=True)
    return items


def get_prediction(profile_key: str) -> dict | None:
    result = predictions_table().get_item(Key={"profileKey": profile_key})
    return result.get("Item")


def put_prediction(profile_key: str, event: dict) -> dict:
    prediction = validate_prediction(profile_key, parse_body(event))
    predictions_table().put_item(Item=prediction)
    return prediction


def delete_prediction(profile_key: str) -> None:
    predictions_table().delete_item(Key={"profileKey": profile_key})


def handler(event, context):
    del context
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = event.get("rawPath")
    profile_key = event.get("pathParameters", {}).get("profileKey")
    if profile_key:
        profile_key = unquote(profile_key)

    if method == "GET" and path == "/api/win-totals":
        return response(200, get_win_totals())

    if method == "GET" and path == "/api/predictions":
        return response(200, {"predictions": list_predictions()})

    if profile_key and method == "GET":
        prediction = get_prediction(profile_key)
        if not prediction:
            return response(404, {"message": "Prediction not found"})
        return response(200, prediction)

    if profile_key and method == "PUT":
        try:
            return response(200, put_prediction(profile_key, event))
        except ValueError as error:
            return response(400, {"message": str(error)})

    if profile_key and method == "DELETE":
        delete_prediction(profile_key)
        return response(200, {"deleted": True})

    return response(404, {"message": "Not found"})
