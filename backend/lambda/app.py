"""AWS Lambda API for NFL win totals and saved playoff predictions."""

from __future__ import annotations

import json
import os
import re
import statistics
import time
from decimal import Decimal
from pathlib import Path
from urllib.request import Request, urlopen

import boto3

API_VERSION = 2
ODDS_URL = "https://www.vegasinsider.com/nfl/odds/win-totals/"
CACHE_KEY = "current"
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "21600"))
RESULTS_PATH = Path(__file__).with_name("season_results.json")

SCORING_RULES = {
    "playoffField": {"label": "Correct playoff team", "points": 5, "maximum": 70},
    "divisionWinners": {"label": "Correct division winner", "points": 5, "maximum": 40},
    "exactSeeds": {"label": "Exact playoff seed", "points": 3, "maximum": 42},
    "wildCard": {"label": "Correct Wild Card winner", "points": 5, "maximum": 30},
    "divisional": {"label": "Correct Divisional winner", "points": 10, "maximum": 40},
    "conferenceChampions": {
        "label": "Correct conference champion",
        "points": 20,
        "maximum": 40,
    },
    "superBowlChampion": {
        "label": "Correct Super Bowl champion",
        "points": 40,
        "maximum": 40,
    },
}
MAX_SCORE = sum(rule["maximum"] for rule in SCORING_RULES.values())

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


def load_season_results() -> dict:
    with RESULTS_PATH.open(encoding="utf-8") as results_file:
        return json.load(results_file)


def score_prediction(prediction: dict, results: dict | None = None) -> dict:
    results = results or load_season_results()
    actual_seeds = results.get("seeds", {})
    actual_divisions = results.get("divisionWinners", {})
    round_winners = results.get("roundWinners", {})
    predicted_seeds = prediction.get("seeds", {})
    predicted_divisions = prediction.get("divisionWinners", {})
    predicted_picks = prediction.get("picks", {})

    actual_playoff_teams = {
        team
        for conference in ("AFC", "NFC")
        for team in actual_seeds.get(conference, [])
        if team
    }
    predicted_playoff_teams = {
        team
        for conference in ("AFC", "NFC")
        for team in predicted_seeds.get(conference, [])
        if team
    }
    playoff_field_hits = len(actual_playoff_teams & predicted_playoff_teams)

    division_hits = 0
    for conference in ("AFC", "NFC"):
        for division in ("North", "South", "East", "West"):
            actual = actual_divisions.get(conference, {}).get(division)
            predicted = predicted_divisions.get(conference, {}).get(division)
            division_hits += int(bool(actual) and actual == predicted)

    seed_hits = 0
    settled_seed_slots = 0
    for conference in ("AFC", "NFC"):
        actual_conference_seeds = actual_seeds.get(conference, [])
        predicted_conference_seeds = predicted_seeds.get(conference, [])
        for index, actual in enumerate(actual_conference_seeds):
            if not actual:
                continue
            settled_seed_slots += 1
            if index < len(predicted_conference_seeds):
                seed_hits += int(actual == predicted_conference_seeds[index])

    predicted_wild_card = {
        predicted_picks.get(conference, {}).get(game_id)
        for conference in ("AFC", "NFC")
        for game_id in ("wc-2-7", "wc-3-6", "wc-4-5")
    } - {None, ""}
    actual_wild_card = {team for team in round_winners.get("wildCard", []) if team}

    predicted_divisional = {
        predicted_picks.get(conference, {}).get(game_id)
        for conference in ("AFC", "NFC")
        for game_id in ("div-1", "div-2")
    } - {None, ""}
    actual_divisional = {
        team for team in round_winners.get("divisional", []) if team
    }

    predicted_conference_champions = {
        conference: predicted_picks.get(conference, {}).get("conf")
        for conference in ("AFC", "NFC")
    }
    actual_conference_champions = round_winners.get("conferenceChampions", {})
    conference_hits = sum(
        1
        for conference in ("AFC", "NFC")
        if actual_conference_champions.get(conference)
        and actual_conference_champions[conference]
        == predicted_conference_champions[conference]
    )

    actual_super_bowl_champion = round_winners.get("superBowlChampion")
    predicted_super_bowl_champion = predicted_picks.get("superBowl")

    hit_counts = {
        "playoffField": playoff_field_hits,
        "divisionWinners": division_hits,
        "exactSeeds": seed_hits,
        "wildCard": len(actual_wild_card & predicted_wild_card),
        "divisional": len(actual_divisional & predicted_divisional),
        "conferenceChampions": conference_hits,
        "superBowlChampion": int(
            bool(actual_super_bowl_champion)
            and actual_super_bowl_champion == predicted_super_bowl_champion
        ),
    }
    settled_counts = {
        "playoffField": len(actual_playoff_teams),
        "divisionWinners": sum(
            bool(team)
            for conference in ("AFC", "NFC")
            for team in actual_divisions.get(conference, {}).values()
        ),
        "exactSeeds": settled_seed_slots,
        "wildCard": len(actual_wild_card),
        "divisional": len(actual_divisional),
        "conferenceChampions": sum(
            bool(actual_conference_champions.get(conference))
            for conference in ("AFC", "NFC")
        ),
        "superBowlChampion": int(bool(actual_super_bowl_champion)),
    }

    breakdown = {
        key: {
            "label": rule["label"],
            "hits": hit_counts[key],
            "settled": settled_counts[key],
            "points": hit_counts[key] * rule["points"],
            "possible": settled_counts[key] * rule["points"],
            "maximum": rule["maximum"],
        }
        for key, rule in SCORING_RULES.items()
    }
    regular_season = sum(
        breakdown[key]["points"]
        for key in ("playoffField", "divisionWinners", "exactSeeds")
    )
    playoffs = sum(
        breakdown[key]["points"]
        for key in (
            "wildCard",
            "divisional",
            "conferenceChampions",
            "superBowlChampion",
        )
    )

    return {
        "season": results.get("season"),
        "status": results.get("status", "Results unavailable"),
        "updatedAt": results.get("updatedAt"),
        "breakdown": breakdown,
        "regularSeason": regular_season,
        "playoffs": playoffs,
        "total": regular_season + playoffs,
        "possible": sum(category["possible"] for category in breakdown.values()),
        "maximum": MAX_SCORE,
    }


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


def validate_prediction(user_id: str, prediction: dict) -> dict:
    division_winners = prediction.get("divisionWinners")
    seeds = prediction.get("seeds")
    picks = prediction.get("picks")

    if not user_id or len(user_id) > 128:
        raise ValueError("Invalid authenticated user")
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
        "profileKey": user_id,
        "divisionWinners": division_winners,
        "seeds": seeds,
        "picks": picks,
        "bracketBuilt": bool(prediction.get("bracketBuilt")),
        "savedAt": saved_at,
    }


def get_prediction(user_id: str) -> dict | None:
    result = predictions_table().get_item(Key={"profileKey": user_id})
    return result.get("Item")


def put_prediction(user_id: str, event: dict) -> dict:
    prediction = validate_prediction(user_id, parse_body(event))
    predictions_table().put_item(Item=prediction)
    return prediction


def delete_prediction(user_id: str) -> None:
    predictions_table().delete_item(Key={"profileKey": user_id})


def authenticated_user_id(event: dict) -> str | None:
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    user_id = claims.get("sub")
    return user_id if isinstance(user_id, str) and user_id else None


def handler(event, context):
    del context
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = event.get("rawPath")

    if method == "GET" and path == "/api/win-totals":
        return response(200, get_win_totals())

    if path != "/api/prediction":
        return response(404, {"message": "Not found"})

    user_id = authenticated_user_id(event)
    if not user_id:
        return response(401, {"message": "Authentication required"})

    if method == "GET":
        prediction = get_prediction(user_id)
        if not prediction:
            return response(404, {"message": "Prediction not found"})
        return response(200, {**prediction, "score": score_prediction(prediction)})

    if method == "PUT":
        try:
            prediction = put_prediction(user_id, event)
            return response(200, {**prediction, "score": score_prediction(prediction)})
        except ValueError as error:
            return response(400, {"message": str(error)})

    if method == "DELETE":
        delete_prediction(user_id)
        return response(200, {"deleted": True})

    return response(404, {"message": "Not found"})
