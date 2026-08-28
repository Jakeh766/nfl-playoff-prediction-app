"""AWS Lambda API for NFL win totals and saved playoff predictions."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import statistics
import time
import uuid
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


def profiles_table():
    return boto3.resource("dynamodb").Table(os.environ["PROFILES_TABLE"])


def groups_table():
    return boto3.resource("dynamodb").Table(os.environ["GROUPS_TABLE"])


def normalize_leaderboard_name(value) -> tuple[str, str]:
    if not isinstance(value, str):
        raise ValueError("leaderboardName must be a string")

    display_name = re.sub(r"\s+", " ", value.strip())
    if not 3 <= len(display_name) <= 24:
        raise ValueError("Leaderboard name must be between 3 and 24 characters")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]", display_name):
        raise ValueError(
            "Leaderboard name may use letters, numbers, spaces, periods, underscores, and hyphens"
        )
    return display_name, display_name.casefold()


def profile_item_key(user_id: str) -> str:
    return f"user#{user_id}"


def name_item_key(normalized_name: str) -> str:
    return f"name#{normalized_name}"


def get_profile(user_id: str) -> dict | None:
    result = profiles_table().get_item(Key={"profileKey": profile_item_key(user_id)})
    return result.get("Item")


def is_conditional_failure(error: Exception) -> bool:
    return (
        getattr(error, "response", {}).get("Error", {}).get("Code")
        == "ConditionalCheckFailedException"
    )


def delete_name_reservation(table, user_id: str, normalized_name: str) -> None:
    try:
        table.delete_item(
            Key={"profileKey": name_item_key(normalized_name)},
            ConditionExpression="ownerId = :owner",
            ExpressionAttributeValues={":owner": user_id},
        )
    except Exception as error:
        if not is_conditional_failure(error):
            raise


def put_profile(user_id: str, event: dict) -> dict:
    display_name, normalized_name = normalize_leaderboard_name(
        parse_body(event).get("leaderboardName")
    )
    table = profiles_table()
    existing = get_profile(user_id)
    previous_name = existing.get("normalizedName") if existing else None

    try:
        table.put_item(
            Item={
                "profileKey": name_item_key(normalized_name),
                "recordType": "leaderboardName",
                "normalizedName": normalized_name,
                "displayName": display_name,
                "ownerId": user_id,
            },
            ConditionExpression="attribute_not_exists(profileKey) OR ownerId = :owner",
            ExpressionAttributeValues={":owner": user_id},
        )
    except Exception as error:
        if is_conditional_failure(error):
            raise ValueError("That leaderboard name is already taken") from error
        raise

    profile = {
        "profileKey": profile_item_key(user_id),
        "recordType": "profile",
        "leaderboardName": display_name,
        "normalizedName": normalized_name,
        "updatedAt": int(time.time() * 1000),
    }
    try:
        table.put_item(Item=profile)
    except Exception:
        if previous_name != normalized_name:
            delete_name_reservation(table, user_id, normalized_name)
        raise

    if previous_name and previous_name != normalized_name:
        delete_name_reservation(table, user_id, previous_name)
    return profile


def delete_profile(user_id: str) -> None:
    table = profiles_table()
    existing = get_profile(user_id)
    table.delete_item(Key={"profileKey": profile_item_key(user_id)})
    if existing and existing.get("normalizedName"):
        delete_name_reservation(table, user_id, existing["normalizedName"])


def public_profile(profile: dict) -> dict:
    return {
        "leaderboardName": profile["leaderboardName"],
        "updatedAt": profile["updatedAt"],
    }


def scan_all(table) -> list[dict]:
    items = []
    scan_arguments = {}
    while True:
        result = table.scan(**scan_arguments)
        items.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            return items
        scan_arguments["ExclusiveStartKey"] = last_key


def build_leaderboard(member_ids: set[str] | None = None) -> dict:
    results = load_season_results()
    profiles = {
        item["profileKey"].removeprefix("user#"): item
        for item in scan_all(profiles_table())
        if item.get("recordType") == "profile"
        and item.get("profileKey", "").startswith("user#")
    }
    entries = []
    for prediction in scan_all(predictions_table()):
        if member_ids is not None and prediction.get("profileKey") not in member_ids:
            continue
        profile = profiles.get(prediction.get("profileKey"))
        if not profile:
            continue
        score = score_prediction(prediction, results)
        entries.append(
            {
                "leaderboardName": profile["leaderboardName"],
                "regularSeason": score["regularSeason"],
                "playoffs": score["playoffs"],
                "total": score["total"],
            }
        )

    entries.sort(
        key=lambda entry: (
            -entry["total"],
            -entry["regularSeason"],
            -entry["playoffs"],
            entry["leaderboardName"].casefold(),
        )
    )
    previous_score = None
    current_rank = 0
    for position, entry in enumerate(entries, start=1):
        if entry["total"] != previous_score:
            current_rank = position
            previous_score = entry["total"]
        entry["rank"] = current_rank

    return {
        "season": results.get("season"),
        "status": results.get("status", "Results unavailable"),
        "updatedAt": results.get("updatedAt"),
        "maximum": MAX_SCORE,
        "entries": entries,
    }


def get_leaderboard() -> dict:
    return build_leaderboard()


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


GROUP_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._-]*[A-Za-z0-9]")
GROUP_PASSWORD_ITERATIONS = 310_000


def normalize_group_name(value) -> tuple[str, str]:
    if not isinstance(value, str):
        raise ValueError("groupName must be a string")

    display_name = re.sub(r"\s+", " ", value.strip())
    if not 3 <= len(display_name) <= 40:
        raise ValueError("Group name must be between 3 and 40 characters")
    if not GROUP_NAME_PATTERN.fullmatch(display_name):
        raise ValueError(
            "Group name may use letters, numbers, spaces, periods, underscores, and hyphens"
        )
    return display_name, display_name.casefold()


def validate_group_password(value) -> str:
    if not isinstance(value, str):
        raise ValueError("password must be a string")
    if not 6 <= len(value) <= 128:
        raise ValueError("Group password must be between 6 and 128 characters")
    return value


def hash_group_password(
    password: str,
    salt: str | None = None,
    iterations: int | None = None,
) -> tuple[str, str]:
    iteration_count = iterations or GROUP_PASSWORD_ITERATIONS
    password_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(password_salt),
        iteration_count,
    ).hex()
    return password_salt, digest


def group_item_key(group_id: str) -> str:
    return f"group#{group_id}"


def group_name_item_key(normalized_name: str) -> str:
    return f"name#{normalized_name}"


def membership_item_key(group_id: str, user_id: str) -> str:
    return f"membership#{group_id}#user#{user_id}"


def public_group(group: dict) -> dict:
    return {
        "groupId": group["groupId"],
        "groupName": group["groupName"],
        "createdAt": group["createdAt"],
    }


def get_group(group_id: str) -> dict | None:
    result = groups_table().get_item(Key={"groupKey": group_item_key(group_id)})
    item = result.get("Item")
    return item if item and item.get("recordType") == "group" else None


def is_group_member(group_id: str, user_id: str) -> bool:
    result = groups_table().get_item(
        Key={"groupKey": membership_item_key(group_id, user_id)}
    )
    return bool(result.get("Item"))


def list_groups(user_id: str) -> dict:
    table = groups_table()
    memberships = [
        item
        for item in scan_all(table)
        if item.get("recordType") == "membership" and item.get("userId") == user_id
    ]
    groups = []
    for membership in memberships:
        group = table.get_item(
            Key={"groupKey": group_item_key(membership["groupId"])}
        ).get("Item")
        if group and group.get("recordType") == "group":
            groups.append(public_group(group))
    groups.sort(key=lambda group: group["groupName"].casefold())
    return {"groups": groups}


def create_group(user_id: str, event: dict) -> dict:
    body = parse_body(event)
    group_name, normalized_name = normalize_group_name(body.get("groupName"))
    password = validate_group_password(body.get("password"))
    group_id = str(uuid.uuid4())
    created_at = int(time.time() * 1000)
    salt, digest = hash_group_password(password)
    table = groups_table()
    name_key = group_name_item_key(normalized_name)
    group_key = group_item_key(group_id)

    try:
        table.put_item(
            Item={
                "groupKey": name_key,
                "recordType": "groupName",
                "normalizedName": normalized_name,
                "groupId": group_id,
            },
            ConditionExpression="attribute_not_exists(groupKey)",
        )
    except Exception as error:
        if is_conditional_failure(error):
            raise ValueError("That group name is already taken") from error
        raise

    group = {
        "groupKey": group_key,
        "recordType": "group",
        "groupId": group_id,
        "groupName": group_name,
        "normalizedName": normalized_name,
        "passwordSalt": salt,
        "passwordHash": digest,
        "passwordIterations": GROUP_PASSWORD_ITERATIONS,
        "createdAt": created_at,
    }
    try:
        table.put_item(Item=group, ConditionExpression="attribute_not_exists(groupKey)")
        table.put_item(
            Item={
                "groupKey": membership_item_key(group_id, user_id),
                "recordType": "membership",
                "groupId": group_id,
                "userId": user_id,
                "joinedAt": created_at,
            },
            ConditionExpression="attribute_not_exists(groupKey)",
        )
    except Exception:
        table.delete_item(Key={"groupKey": group_key})
        table.delete_item(Key={"groupKey": name_key})
        raise
    return public_group(group)


def join_group(user_id: str, event: dict) -> dict:
    body = parse_body(event)
    _group_name, normalized_name = normalize_group_name(body.get("groupName"))
    password = validate_group_password(body.get("password"))
    table = groups_table()
    reservation = table.get_item(
        Key={"groupKey": group_name_item_key(normalized_name)}
    ).get("Item")
    group = get_group(reservation.get("groupId")) if reservation else None
    if not group:
        raise ValueError("Group name or password is incorrect")

    _salt, digest = hash_group_password(
        password,
        group["passwordSalt"],
        int(group.get("passwordIterations", GROUP_PASSWORD_ITERATIONS)),
    )
    if not hmac.compare_digest(digest, group["passwordHash"]):
        raise ValueError("Group name or password is incorrect")

    if is_group_member(group["groupId"], user_id):
        return public_group(group)

    table.put_item(
        Item={
            "groupKey": membership_item_key(group["groupId"], user_id),
            "recordType": "membership",
            "groupId": group["groupId"],
            "userId": user_id,
            "joinedAt": int(time.time() * 1000),
        },
        ConditionExpression="attribute_not_exists(groupKey)",
    )
    return public_group(group)


def get_group_leaderboard(group_id: str, user_id: str) -> dict:
    group = get_group(group_id)
    if not group or not is_group_member(group_id, user_id):
        raise PermissionError("Group membership required")
    member_ids = {
        item["userId"]
        for item in scan_all(groups_table())
        if item.get("recordType") == "membership"
        and item.get("groupId") == group_id
    }
    return {
        **build_leaderboard(member_ids),
        "groupId": group_id,
        "groupName": group["groupName"],
    }


def delete_group_memberships(user_id: str) -> None:
    table = groups_table()
    for item in scan_all(table):
        if item.get("recordType") == "membership" and item.get("userId") == user_id:
            table.delete_item(Key={"groupKey": item["groupKey"]})


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

    if method == "GET" and path == "/api/leaderboard":
        return response(200, get_leaderboard())

    group_leaderboard_match = re.fullmatch(
        r"/api/groups/([0-9a-f-]{36})/leaderboard", path or ""
    )
    if path not in (
        "/api/prediction",
        "/api/profile",
        "/api/groups",
        "/api/groups/join",
    ) and not group_leaderboard_match:
        return response(404, {"message": "Not found"})

    user_id = authenticated_user_id(event)
    if not user_id:
        return response(401, {"message": "Authentication required"})

    if path == "/api/groups":
        if method == "GET":
            return response(200, list_groups(user_id))
        if method == "POST":
            try:
                return response(201, create_group(user_id, event))
            except ValueError as error:
                return response(400, {"message": str(error)})
        return response(404, {"message": "Not found"})

    if path == "/api/groups/join":
        if method == "POST":
            try:
                return response(200, join_group(user_id, event))
            except ValueError as error:
                return response(400, {"message": str(error)})
        return response(404, {"message": "Not found"})

    if group_leaderboard_match:
        if method != "GET":
            return response(404, {"message": "Not found"})
        try:
            return response(
                200,
                get_group_leaderboard(group_leaderboard_match.group(1), user_id),
            )
        except PermissionError as error:
            return response(403, {"message": str(error)})

    if path == "/api/profile":
        if method == "GET":
            profile = get_profile(user_id)
            if not profile:
                return response(404, {"message": "Leaderboard name not found"})
            return response(200, public_profile(profile))

        if method == "PUT":
            try:
                return response(200, public_profile(put_profile(user_id, event)))
            except ValueError as error:
                return response(400, {"message": str(error)})

        if method == "DELETE":
            delete_group_memberships(user_id)
            delete_profile(user_id)
            return response(200, {"deleted": True})

        return response(404, {"message": "Not found"})

    if method == "GET":
        prediction = get_prediction(user_id)
        if not prediction:
            return response(404, {"message": "Prediction not found"})
        return response(200, {**prediction, "score": score_prediction(prediction)})

    if method == "PUT":
        try:
            if not get_profile(user_id):
                raise ValueError("Choose a leaderboard name before saving a prediction")
            prediction = put_prediction(user_id, event)
            return response(200, {**prediction, "score": score_prediction(prediction)})
        except ValueError as error:
            return response(400, {"message": str(error)})

    if method == "DELETE":
        delete_prediction(user_id)
        return response(200, {"deleted": True})

    return response(404, {"message": "Not found"})
