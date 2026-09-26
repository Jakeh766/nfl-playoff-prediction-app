"""AWS Lambda API for NFL win totals and saved playoff predictions."""

from __future__ import annotations

import calendar
from contextvars import ContextVar
import hashlib
import hmac
from html import unescape
import json
import os
import re
import secrets
import statistics
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import unquote
from urllib.request import Request, urlopen

import boto3

API_VERSION = 2
ODDS_URL = "https://www.vegasinsider.com/nfl/odds/win-totals/"
CACHE_KEY = "current"
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "21600"))
PREDICTION_LOCK_AT = os.environ.get(
    "PREDICTION_LOCK_AT", "2099-12-31T23:59:59Z"
)
RESULTS_PATH = Path(__file__).with_name("season_results.json")
NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._'’-]*[A-Za-z0-9]")
ANALYTICS_ID_PATTERN = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    re.IGNORECASE,
)
ANALYTICS_EVENTS = {
    "account_created",
    "group_created",
    "group_invite_joined",
    "group_joined",
    "page_view",
    "prediction_saved",
    "sign_in",
}
ANALYTICS_PAGES = {"/", "/leaderboard", "/picks", "/scoring"}

EXACT_SEED_POINTS = (5, 3, 3, 3, 2, 2, 2)
NBA_EXACT_SEED_POINTS = (6, 4, 4, 4, 3, 3, 3, 3)

SCORING_RULES = {
    "playoffField": {"label": "Correct playoff team", "points": 5, "maximum": 70},
    "divisionWinners": {"label": "Correct division winner", "points": 5, "maximum": 40},
    "exactSeeds": {
        "label": "Exact playoff seed",
        "maximum": sum(EXACT_SEED_POINTS) * 2,
    },
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


# Request-local league selection prevents warm Lambda invocations leaking sports.
SPORT = ContextVar("sport", default="nfl")
NBA = json.loads(Path(__file__).with_name("nba_season.json").read_text(encoding="utf-8"))


def conferences():
    return ("East", "West") if SPORT.get() == "nba" else ("AFC", "NFC")


def exact_seed_values():
    return NBA_EXACT_SEED_POINTS if SPORT.get() == "nba" else EXACT_SEED_POINTS


def first_round_games():
    return ("r1-1-8", "r1-4-5", "r1-2-7", "r1-3-6") if SPORT.get() == "nba" else ("wc-2-7", "wc-3-6", "wc-4-5")


def scoring_rules():
    if SPORT.get() != "nba":
        return SCORING_RULES
    return {
        **SCORING_RULES,
        "playoffField": {"label": "Correct playoff team", "points": 5, "maximum": 80},
        "divisionWinners": {"label": "Not scored in NBA", "points": 0, "maximum": 0},
        "exactSeeds": {"label": "Exact playoff seed", "maximum": sum(NBA_EXACT_SEED_POINTS) * 2},
        "wildCard": {"label": "Correct first-round winner", "points": 5, "maximum": 40},
        "divisional": {"label": "Correct conference semifinal winner", "points": 10, "maximum": 40},
        "superBowlChampion": {"label": "Correct NBA Finals champion", "points": 40, "maximum": 40},
    }


def maximum_score():
    return sum(rule["maximum"] for rule in scoring_rules().values())


def prediction_key(user_id):
    return f"nba#{NBA['season']}#{user_id}" if SPORT.get() == "nba" else user_id


def validate_nba_bracket(prediction):
    seeds, picks = prediction.get("seeds"), prediction.get("picks")
    if not isinstance(seeds, dict) or not isinstance(picks, dict):
        raise ValueError("Seeds and picks must be objects")
    finalists = []
    for conference, teams in NBA["teams"].items():
        selected = seeds.get(conference)
        if (not isinstance(selected, list) or len(selected) != 8
                or any(not isinstance(team, str) or team not in teams for team in selected)
                or len(set(selected)) != 8):
            raise ValueError(f"Choose eight different {conference} teams")
        choices = picks.get(conference)
        if not isinstance(choices, dict):
            raise ValueError(f"Complete the {conference} bracket")
        winners = []
        for game, (a, b) in zip(first_round_games(), ((1, 8), (4, 5), (2, 7), (3, 6))):
            winner = choices.get(game)
            if winner not in (selected[a-1], selected[b-1]):
                raise ValueError("First-round winner must be in its series")
            winners.append(winner)
        semifinalists = []
        for index, game in enumerate(("div-1", "div-2")):
            winner = choices.get(game)
            if winner not in winners[index*2:index*2+2]:
                raise ValueError("Semifinal winner must advance from its fixed bracket")
            semifinalists.append(winner)
        if choices.get("conf") not in semifinalists:
            raise ValueError("Conference champion must win its semifinal")
        finalists.append(choices["conf"])
    if picks.get("superBowl") not in finalists:
        raise ValueError("NBA champion must be a conference champion")


def cache_table():
    return boto3.resource("dynamodb").Table(os.environ["CACHE_TABLE"])


def predictions_table():
    return boto3.resource("dynamodb").Table(os.environ["PREDICTIONS_TABLE"])


def profiles_table():
    return boto3.resource("dynamodb").Table(os.environ["PROFILES_TABLE"])


def groups_table():
    return boto3.resource("dynamodb").Table(os.environ["GROUPS_TABLE"])


def results_table():
    return boto3.resource("dynamodb").Table(os.environ["RESULTS_TABLE"])


def normalize_name(
    value,
    field_name: str,
    label: str,
    maximum_length: int,
) -> tuple[str, str]:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")

    display_name = re.sub(r"\s+", " ", value.strip())
    if not 3 <= len(display_name) <= maximum_length:
        raise ValueError(
            f"{label} name must be between 3 and {maximum_length} characters"
        )
    if not NAME_PATTERN.fullmatch(display_name):
        raise ValueError(
            f"{label} name may use letters, numbers, spaces, periods, apostrophes, underscores, and hyphens"
        )
    normalized_name = display_name.casefold().replace("’", "'")
    return display_name, normalized_name


def normalize_leaderboard_name(value) -> tuple[str, str]:
    return normalize_name(value, "leaderboardName", "Leaderboard", 24)


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


def build_leaderboard(member_ids: set[str] | None = None, scoring_option: str = "classic") -> dict:
    results = load_season_results()
    profiles = {
        item["profileKey"].removeprefix("user#"): item
        for item in scan_all(profiles_table())
        if item.get("recordType") == "profile"
        and item.get("profileKey", "").startswith("user#")
    }
    entries = []
    for prediction in scan_all(predictions_table()):
        if prediction.get("sport", "nfl") != SPORT.get():
            continue
        if SPORT.get() == "nba" and prediction.get("season") != NBA["season"]:
            continue
        prediction = {**prediction, "profileKey": prediction.get("ownerId", prediction.get("profileKey"))}
        if member_ids is not None and prediction.get("profileKey") not in member_ids:
            continue
        profile = profiles.get(prediction.get("profileKey"))
        if not profile:
            continue
        predicted_picks = prediction.get("picks") or {}
        scoring_modes = ("classic", "vegas") if member_ids is None else (scoring_option,)
        scores = {mode: score_prediction(prediction, results, mode)
                  for mode in scoring_modes}
        score = scores[scoring_option]
        entries.append(
            {
                "leaderboardName": profile["leaderboardName"],
                "superBowl": predicted_picks.get("superBowl", ""),
                "scores": {mode: {key: value.get(key, 0) for key in ("regularSeason", "playoffs", "total")}
                           for mode, value in scores.items()},
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
    for position, entry in enumerate(entries, start=1):
        entry["rank"] = position if entry["total"] > 0 else None

    return {
        "season": results.get("season"),
        "status": results.get("status", "Results unavailable"),
        "updatedAt": results.get("updatedAt"),
        "maximum": maximum_score() if scoring_option == "classic" else None,
        "classicMaximum": maximum_score(),
        "entries": entries,
        "scoringOption": scoring_option,
    }


def get_leaderboard() -> dict:
    return build_leaderboard()


def public_bracket(profile: dict, prediction: dict) -> dict:
    division_winners = prediction.get("divisionWinners", {})
    seeds = prediction.get("seeds", {})
    picks = prediction.get("picks", {})
    score = score_prediction(prediction, load_season_results())

    return {
        "leaderboardName": profile["leaderboardName"],
        "savedAt": prediction.get("savedAt"),
        "vegasScore": score_prediction(prediction, load_season_results(), "vegas"),
        "divisionWinners": {
            conference: {
                division: division_winners.get(conference, {}).get(division, "")
                for division in ("North", "South", "East", "West")
            }
            for conference in conferences()
        },
        "seeds": {
            conference: list(seeds.get(conference, []))[:len(exact_seed_values())]
            for conference in conferences()
        },
        "picks": {
            conference: {
                game_id: picks.get(conference, {}).get(game_id, "")
                for game_id in (*first_round_games(), "div-1", "div-2", "conf")
            }
            for conference in conferences()
        }
        | {"superBowl": picks.get("superBowl", "")},
        "bracketBuilt": bool(prediction.get("bracketBuilt")),
        "score": {
            "status": score["status"],
            "regularSeason": score["regularSeason"],
            "playoffs": score["playoffs"],
            "total": score["total"],
            "possible": score["possible"],
            "maximum": score["maximum"],
        },
    }


def get_public_bracket(leaderboard_name: str) -> dict | None:
    try:
        _, normalized_name = normalize_leaderboard_name(leaderboard_name)
    except ValueError:
        return None

    reservation = profiles_table().get_item(
        Key={"profileKey": name_item_key(normalized_name)}
    ).get("Item")
    if not reservation or reservation.get("recordType") != "leaderboardName":
        return None

    owner_id = reservation.get("ownerId")
    profile = get_profile(owner_id) if isinstance(owner_id, str) else None
    prediction = get_prediction(owner_id) if isinstance(owner_id, str) else None
    if not profile or not prediction:
        return None
    if profile.get("leaderboardName", "").casefold() != normalized_name:
        return None
    return public_bracket(profile, prediction)


def load_season_results() -> dict:
    if SPORT.get() == "nba":
        return load_nba_results()
    if os.environ.get("RESULTS_TABLE"):
        try:
            item = results_table().get_item(
                Key={"season": int(os.environ.get("RESULTS_SEASON", "2026"))},
                ConsistentRead=True,
            ).get("Item")
            if item:
                item["season"] = int(item["season"])
                return item
        except Exception as error:
            print(
                json.dumps(
                    {
                        "type": "results_read_failed",
                        "message": str(error),
                        "fallback": "bundled_preseason_results",
                    }
                )
            )
    with RESULTS_PATH.open(encoding="utf-8") as results_file:
        return json.load(results_file)


def score_prediction(prediction: dict, results: dict | None = None, scoring_option: str = "classic") -> dict:
    results = results or load_season_results()
    if scoring_option == "vegas":
        return score_vegas_prediction(prediction, results)
    if scoring_option != "classic":
        raise ValueError("Unknown scoring option")
    actual_seeds = results.get("seeds", {})
    actual_divisions = results.get("divisionWinners", {})
    round_winners = results.get("roundWinners", {})
    predicted_seeds = prediction.get("seeds", {})
    predicted_divisions = prediction.get("divisionWinners", {})
    predicted_picks = prediction.get("picks", {})

    actual_playoff_teams = {
        team
        for conference in conferences()
        for team in [
            *results.get("playoffTeams", {}).get(conference, []),
            *actual_seeds.get(conference, []),
        ]
        if team
    }
    predicted_playoff_teams = {
        team
        for conference in conferences()
        for team in predicted_seeds.get(conference, [])
        if team
    }
    playoff_field_hits = len(actual_playoff_teams & predicted_playoff_teams)

    division_hits = 0
    for conference in conferences():
        for division in ("North", "South", "East", "West"):
            actual = actual_divisions.get(conference, {}).get(division)
            predicted = predicted_divisions.get(conference, {}).get(division)
            division_hits += int(bool(actual) and actual == predicted)

    seed_hits = 0
    seed_points = 0
    possible_seed_points = 0
    settled_seed_slots = 0
    for conference in conferences():
        actual_conference_seeds = actual_seeds.get(conference, [])
        predicted_conference_seeds = predicted_seeds.get(conference, [])
        for index, actual in enumerate(actual_conference_seeds):
            if not actual:
                continue
            if index >= len(exact_seed_values()):
                continue
            point_value = exact_seed_values()[index]
            settled_seed_slots += 1
            possible_seed_points += point_value
            if index < len(predicted_conference_seeds):
                if actual == predicted_conference_seeds[index]:
                    seed_hits += 1
                    seed_points += point_value

    predicted_wild_card = {
        predicted_picks.get(conference, {}).get(game_id)
        for conference in conferences()
        for game_id in first_round_games()
    } - {None, ""}
    actual_wild_card = {team for team in round_winners.get("wildCard", []) if team}

    predicted_divisional = {
        predicted_picks.get(conference, {}).get(game_id)
        for conference in conferences()
        for game_id in ("div-1", "div-2")
    } - {None, ""}
    actual_divisional = {
        team for team in round_winners.get("divisional", []) if team
    }

    predicted_conference_champions = {
        conference: predicted_picks.get(conference, {}).get("conf")
        for conference in conferences()
    }
    actual_conference_champions = round_winners.get("conferenceChampions", {})
    conference_hits = sum(
        1
        for conference in conferences()
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
            for conference in conferences()
            for team in actual_divisions.get(conference, {}).values()
        ),
        "exactSeeds": settled_seed_slots,
        "wildCard": len(actual_wild_card),
        "divisional": len(actual_divisional),
        "conferenceChampions": sum(
            bool(actual_conference_champions.get(conference))
            for conference in conferences()
        ),
        "superBowlChampion": int(bool(actual_super_bowl_champion)),
    }

    breakdown = {}
    for key, rule in scoring_rules().items():
        points = seed_points if key == "exactSeeds" else hit_counts[key] * rule["points"]
        possible = (
            possible_seed_points
            if key == "exactSeeds"
            else settled_counts[key] * rule["points"]
        )
        breakdown[key] = {
            "label": rule["label"],
            "hits": hit_counts[key],
            "settled": settled_counts[key],
            "points": points,
            "possible": possible,
            "maximum": rule["maximum"],
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
        "maximum": maximum_score(),
    }


def score_vegas_prediction(prediction: dict, results: dict) -> dict:
    """Weight each correct pick by its team's frozen preseason win total."""
    classic = score_prediction(prediction, results)
    if SPORT.get() == "nba":
        snapshot = NBA
    else:
        with Path(__file__).with_name("scoring_odds.json").open(encoding="utf-8") as file:
            snapshot = json.load(file)
    if snapshot["season"] != results.get("season"):
        raise ValueError("Upset Edge scoring needs a market snapshot for this season")
    totals = snapshot["totals"]
    earned = {key: Decimal("0.00") for key in scoring_rules()}
    available = {key: Decimal("0.00") for key in scoring_rules()}

    def rounded(value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def add(category, team, correct, base):
        if not team:
            return
        if team not in totals:
            raise ValueError(f"Missing frozen Vegas win total for {team}")
        multiplier = Decimal("1") + Decimal("0.02" if SPORT.get() == "nba" else "0.10") * (
            Decimal("41" if SPORT.get() == "nba" else "8.5") - Decimal(str(totals[team]))
        )
        points = rounded(Decimal(base) * multiplier)
        available[category] += points
        if correct:
            earned[category] += points

    predicted_seeds = prediction.get("seeds", {})
    actual_seeds = results.get("seeds", {})
    predicted_field = {team for conference in conferences()
                       for team in predicted_seeds.get(conference, []) if team}
    actual_field = {team for conference in conferences()
                    for team in [
                        *results.get("playoffTeams", {}).get(conference, []),
                        *actual_seeds.get(conference, []),
                    ] if team}
    for team in actual_field:
        add("playoffField", team, team in predicted_field, 5)
    for conference in conferences():
        seeds = predicted_seeds.get(conference, [])
        for index, team in enumerate(actual_seeds.get(conference, [])[:len(exact_seed_values())]):
            add("exactSeeds", team, index < len(seeds) and seeds[index] == team,
                exact_seed_values()[index])
        for division in ("North", "South", "East", "West"):
            team = results.get("divisionWinners", {}).get(conference, {}).get(division)
            selected = prediction.get("divisionWinners", {}).get(conference, {}).get(division)
            add("divisionWinners", team, selected == team, 5)

    picks = prediction.get("picks", {})
    winners = results.get("roundWinners", {})
    for category, games, base in (
        ("wildCard", first_round_games(), 5),
        ("divisional", ("div-1", "div-2"), 10),
    ):
        selected = {picks.get(conference, {}).get(game)
                    for conference in conferences() for game in games}
        for team in set(winners.get(category, [])):
            add(category, team, team in selected, base)
    for conference in conferences():
        team = winners.get("conferenceChampions", {}).get(conference)
        add("conferenceChampions", team, picks.get(conference, {}).get("conf") == team, 20)
    team = winners.get("superBowlChampion")
    add("superBowlChampion", team, picks.get("superBowl") == team, 40)

    breakdown = {}
    for category, item in classic["breakdown"].items():
        breakdown[category] = {
            **item,
            "points": float(rounded(earned[category])),
            "possible": float(rounded(available[category])),
            "classicMaximum": item["maximum"], "maximum": None,
        }
    regular_season = rounded(sum(
        (earned[key] for key in ("playoffField", "divisionWinners", "exactSeeds")),
        Decimal("0.00"),
    ))
    playoffs = rounded(sum(
        (earned[key] for key in (
            "wildCard", "divisional", "conferenceChampions", "superBowlChampion",
        )),
        Decimal("0.00"),
    ))
    total = rounded(regular_season + playoffs)
    possible = rounded(sum(available.values(), Decimal("0.00")))
    return {
        **classic, "scoringOption": "vegas", "oddsSource": snapshot["source"],
        "breakdown": breakdown,
        "regularSeason": float(regular_season),
        "playoffs": float(playoffs),
        "total": float(total),
        "possible": float(possible),
        "classicMaximum": maximum_score(), "maximum": None,
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
    if SPORT.get() == "nba":
        return get_nba_win_totals()
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


def record_analytics_event(event: dict) -> None:
    if len(event.get("body") or "") > 2048:
        raise ValueError("Analytics payload is too large")

    payload = parse_body(event)
    event_name = payload.get("event")
    page = payload.get("page")
    session_id = payload.get("sessionId")
    visitor_id = payload.get("visitorId")

    if not isinstance(event_name, str) or event_name not in ANALYTICS_EVENTS:
        raise ValueError("Unknown analytics event")
    if not isinstance(page, str) or page not in ANALYTICS_PAGES:
        raise ValueError("Unknown analytics page")
    if not isinstance(session_id, str) or not ANALYTICS_ID_PATTERN.fullmatch(
        session_id
    ):
        raise ValueError("Invalid analytics session")
    if not isinstance(visitor_id, str) or not ANALYTICS_ID_PATTERN.fullmatch(
        visitor_id
    ):
        raise ValueError("Invalid analytics visitor")

    print(
        json.dumps(
            {
                "type": "site_analytics",
                "environment": os.environ.get("ENVIRONMENT"),
                "event": event_name,
                "page": page,
                "sessionId": session_id,
                "visitorId": visitor_id,
            },
            separators=(",", ":"),
        )
    )


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

    if SPORT.get() == "nba":
        validate_nba_bracket(prediction)
        seeds = {conference: seeds[conference] for conference in conferences()}
        picks = {conference: {game: picks[conference][game]
                              for game in (*first_round_games(), "div-1", "div-2", "conf")}
                 for conference in conferences()} | {"superBowl": picks["superBowl"]}
    for conference in conferences():
        if not isinstance(seeds.get(conference), list) or len(seeds[conference]) != len(exact_seed_values()):
            raise ValueError(f"{conference} seeds must contain seven teams")

    saved_at = int(time.time() * 1000)
    return {
        "profileKey": prediction_key(user_id),
        **({"ownerId": user_id, "sport": "nba", "season": NBA["season"]} if SPORT.get() == "nba" else {}),
        "divisionWinners": {} if SPORT.get() == "nba" else division_winners,
        "seeds": seeds,
        "picks": picks,
        "bracketBuilt": bool(prediction.get("bracketBuilt")),
        "savedAt": saved_at,
    }


def get_prediction(user_id: str) -> dict | None:
    result = predictions_table().get_item(Key={"profileKey": prediction_key(user_id)})
    return result.get("Item")


def put_prediction(user_id: str, event: dict) -> dict:
    prediction = validate_prediction(user_id, parse_body(event))
    predictions_table().put_item(Item=prediction)
    return prediction


def delete_prediction(user_id: str) -> None:
    predictions_table().delete_item(Key={"profileKey": prediction_key(user_id)})


GROUP_PASSWORD_ITERATIONS = 310_000
GROUP_INVITE_CODE_PATTERN = re.compile(r"[A-Za-z0-9_-]{32}")
GROUP_ID_PATTERN = re.compile(r"[0-9a-f-]{36}")


def normalize_group_name(value) -> tuple[str, str]:
    return normalize_name(value, "groupName", "Group", 40)


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


def new_group_invite_code() -> str:
    return secrets.token_urlsafe(24)


def legacy_group_creator(group: dict, memberships: list[dict]) -> str | None:
    """Recover the creator for groups created before createdBy was stored."""
    created_at = group.get("createdAt")
    if created_at is None:
        return None
    creator_ids = {
        item.get("userId")
        for item in memberships
        if item.get("recordType") == "membership"
        and item.get("groupId") == group.get("groupId")
        and item.get("joinedAt") == created_at
        and isinstance(item.get("userId"), str)
    }
    return next(iter(creator_ids)) if len(creator_ids) == 1 else None


def group_commissioner_id(
    group: dict,
    memberships: list[dict] | None = None,
) -> str | None:
    """Return the current commissioner, including legacy creator fallbacks."""
    commissioner_id = group.get("commissionerId") or group.get("createdBy")
    if commissioner_id:
        return commissioner_id
    return legacy_group_creator(group, memberships or [])


def public_group(
    group: dict,
    user_id: str | None = None,
    creator_id: str | None = None,
) -> dict:
    commissioner_id = creator_id or group_commissioner_id(group)
    return {
        "groupId": group["groupId"],
        "groupName": group["groupName"],
        "createdAt": group["createdAt"],
        "scoringOption": group.get("scoringOption", "classic"),
        "isCommissioner": bool(user_id and commissioner_id == user_id),
        # Kept for older deployed clients while commissioner terminology rolls out.
        "isCreator": bool(user_id and commissioner_id == user_id),
    }


def prediction_window(now_seconds: float | None = None) -> dict:
    lock_at = NBA["lockAt"] if SPORT.get() == "nba" else PREDICTION_LOCK_AT
    dev_nfl_unlocked = os.environ.get("ENVIRONMENT") == "dev" and SPORT.get() == "nfl"
    try:
        lock_seconds = calendar.timegm(
            time.strptime(lock_at, "%Y-%m-%dT%H:%M:%SZ")
        )
    except ValueError as error:
        raise RuntimeError("PREDICTION_LOCK_AT must be an ISO-8601 UTC timestamp") from error

    server_seconds = time.time() if now_seconds is None else now_seconds
    return {
        "lockAt": lock_at,
        "locked": server_seconds >= lock_seconds and not dev_nfl_unlocked,
        "devNflUnlocked": dev_nfl_unlocked,
        "serverTime": int(server_seconds * 1000),
        "season": NBA["season"] if SPORT.get() == "nba" else int(PREDICTION_LOCK_AT[:4]),
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
    items = scan_all(table)
    memberships = [
        item
        for item in items
        if item.get("recordType") == "membership" and item.get("userId") == user_id
    ]
    groups = []
    for membership in memberships:
        group = table.get_item(
            Key={"groupKey": group_item_key(membership["groupId"])}
        ).get("Item")
        if group and group.get("recordType") == "group":
            groups.append(
                public_group(
                    group,
                    user_id,
                    group_commissioner_id(group, items),
                )
            )
    groups.sort(key=lambda group: group["groupName"].casefold())
    return {"groups": groups}


def create_group(user_id: str, event: dict) -> dict:
    body = parse_body(event)
    group_name, normalized_name = normalize_group_name(body.get("groupName"))
    password = validate_group_password(body.get("password"))
    scoring_option = body.get("scoringOption", "classic")
    if scoring_option not in ("classic", "vegas"):
        raise ValueError("Choose Classic or Upset Edge scoring")
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
        "createdBy": user_id,
        "commissionerId": user_id,
        "scoringOption": scoring_option,
        "passwordSalt": salt,
        "passwordHash": digest,
        "passwordIterations": GROUP_PASSWORD_ITERATIONS,
        "inviteCode": new_group_invite_code(),
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
    return public_group(group, user_id)


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

    add_group_membership(group["groupId"], user_id)
    return public_group(group, user_id)


def add_group_membership(group_id: str, user_id: str) -> None:
    if is_group_member(group_id, user_id):
        return

    groups_table().put_item(
        Item={
            "groupKey": membership_item_key(group_id, user_id),
            "recordType": "membership",
            "groupId": group_id,
            "userId": user_id,
            "joinedAt": int(time.time() * 1000),
        },
        ConditionExpression="attribute_not_exists(groupKey)",
    )


def get_group_invite(group_id: str, user_id: str) -> dict:
    group = get_group(group_id)
    if not group or not is_group_member(group_id, user_id):
        raise PermissionError("Group membership required")

    invite_code = group.get("inviteCode")
    if not isinstance(invite_code, str) or not GROUP_INVITE_CODE_PATTERN.fullmatch(
        invite_code
    ):
        invite_code = new_group_invite_code()
        try:
            updated = groups_table().update_item(
                Key={"groupKey": group_item_key(group_id)},
                UpdateExpression="SET inviteCode = :inviteCode",
                ConditionExpression="attribute_not_exists(inviteCode)",
                ExpressionAttributeValues={":inviteCode": invite_code},
                ReturnValues="ALL_NEW",
            )
            group = updated.get("Attributes", {**group, "inviteCode": invite_code})
        except Exception as error:
            if not is_conditional_failure(error):
                raise
            group = get_group(group_id)
            invite_code = group.get("inviteCode") if group else None

    if not isinstance(invite_code, str) or not GROUP_INVITE_CODE_PATTERN.fullmatch(
        invite_code
    ):
        raise RuntimeError("Group invite link could not be created")
    return {
        "groupId": group_id,
        "groupName": group["groupName"],
        "inviteCode": invite_code,
    }


def join_group_by_invite(user_id: str, event: dict) -> dict:
    body = parse_body(event)
    group_id = body.get("groupId")
    invite_code = body.get("inviteCode")
    if not isinstance(group_id, str) or not GROUP_ID_PATTERN.fullmatch(group_id):
        raise ValueError("That group invite link is invalid")
    if not isinstance(invite_code, str) or not GROUP_INVITE_CODE_PATTERN.fullmatch(
        invite_code
    ):
        raise ValueError("That group invite link is invalid")

    group = get_group(group_id)
    stored_code = group.get("inviteCode") if group else None
    if not isinstance(stored_code, str) or not hmac.compare_digest(
        invite_code, stored_code
    ):
        raise ValueError("That group invite link is invalid")

    add_group_membership(group_id, user_id)
    return public_group(group, user_id)


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
        **build_leaderboard(member_ids, group.get("scoringOption", "classic")),
        "groupId": group_id,
        "groupName": group["groupName"],
    }


def list_group_members(group_id: str, user_id: str) -> dict:
    group = get_group(group_id)
    if not group or not is_group_member(group_id, user_id):
        raise PermissionError("Group membership required")

    memberships = sorted(
        (
            item
            for item in scan_all(groups_table())
            if item.get("recordType") == "membership"
            and item.get("groupId") == group_id
        ),
        key=lambda item: (item.get("joinedAt", 0), item.get("userId", "")),
    )
    commissioner_id = group_commissioner_id(group, memberships)
    members = []
    unnamed_number = 0
    for membership in memberships:
        member_id = membership.get("userId")
        if not isinstance(member_id, str):
            continue
        profile = get_profile(member_id)
        if profile and profile.get("leaderboardName"):
            display_name = profile["leaderboardName"]
        else:
            unnamed_number += 1
            display_name = f"Member {unnamed_number}"
        members.append(
            {
                "userId": member_id,
                "displayName": display_name,
                "isCurrentUser": member_id == user_id,
                "isCommissioner": member_id == commissioner_id,
            }
        )
    return {"groupId": group_id, "members": members}


def leave_group(group_id: str, user_id: str, event: dict) -> dict:
    group = get_group(group_id)
    if not group:
        raise ValueError("Group not found")
    table = groups_table()
    items = scan_all(table)
    memberships = [
        item
        for item in items
        if item.get("recordType") == "membership"
        and item.get("groupId") == group_id
    ]
    if not any(item.get("userId") == user_id for item in memberships):
        raise PermissionError("Group membership required")

    commissioner_id = group_commissioner_id(group, memberships)
    new_commissioner_id = parse_body(event).get("newCommissionerId")
    if commissioner_id == user_id:
        if not isinstance(new_commissioner_id, str) or not new_commissioner_id:
            raise ValueError("Choose a new commissioner before leaving this group")
        if new_commissioner_id == user_id or not any(
            item.get("userId") == new_commissioner_id for item in memberships
        ):
            raise ValueError("The new commissioner must be another current group member")

        condition = "commissionerId = :currentCommissioner"
        values = {
            ":newCommissioner": new_commissioner_id,
            ":currentCommissioner": user_id,
        }
        if not group.get("commissionerId"):
            if group.get("createdBy"):
                condition = (
                    "attribute_not_exists(commissionerId) AND "
                    "createdBy = :currentCommissioner"
                )
            else:
                condition = (
                    "attribute_not_exists(commissionerId) AND "
                    "attribute_not_exists(createdBy)"
                )
        try:
            table.update_item(
                Key={"groupKey": group_item_key(group_id)},
                UpdateExpression="SET commissionerId = :newCommissioner",
                ConditionExpression=condition,
                ExpressionAttributeValues=values,
            )
        except Exception as error:
            if is_conditional_failure(error):
                raise ValueError(
                    "The group commissioner changed. Refresh and try again"
                ) from error
            raise
    elif new_commissioner_id is not None:
        raise ValueError("Only the current commissioner can appoint a replacement")

    table.delete_item(Key={"groupKey": membership_item_key(group_id, user_id)})
    return {"left": True, "commissionerTransferred": commissioner_id == user_id}


def delete_group(group_id: str, user_id: str) -> None:
    group = get_group(group_id)
    if not group:
        raise ValueError("Group not found")
    table = groups_table()
    items = scan_all(table)
    commissioner_id = group_commissioner_id(group, items)
    if commissioner_id != user_id:
        raise PermissionError("Only the group commissioner can delete this group")

    for item in items:
        if item.get("recordType") == "membership" and item.get("groupId") == group_id:
            table.delete_item(Key={"groupKey": item["groupKey"]})

    try:
        table.delete_item(
            Key={"groupKey": group_name_item_key(group["normalizedName"])},
            ConditionExpression="groupId = :groupId",
            ExpressionAttributeValues={":groupId": group_id},
        )
    except Exception as error:
        if not is_conditional_failure(error):
            raise

    group_delete = {"Key": {"groupKey": group_item_key(group_id)}}
    if group.get("commissionerId"):
        group_delete.update(
            ConditionExpression="commissionerId = :commissioner",
            ExpressionAttributeValues={":commissioner": user_id},
        )
    elif group.get("createdBy"):
        group_delete.update(
            ConditionExpression="createdBy = :creator",
            ExpressionAttributeValues={":creator": user_id},
        )
    table.delete_item(**group_delete)


def delete_group_memberships(user_id: str) -> None:
    table = groups_table()
    items = scan_all(table)
    owned_groups = [
        item.get("groupName", "a group")
        for item in items
        if item.get("recordType") == "group"
        and group_commissioner_id(item, items) == user_id
    ]
    if owned_groups:
        raise ValueError(
            "Before deleting your account, leave each group you manage and appoint a new commissioner: "
            + ", ".join(sorted(owned_groups, key=str.casefold))
        )
    for item in items:
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
    sport = (event.get("queryStringParameters") or {}).get("sport", "nfl")
    if sport not in ("nfl", "nba"):
        return response(400, {"message": "Unknown sport"})
    token = SPORT.set(sport)
    try:
        return handle_request(event, context)
    finally:
        SPORT.reset(token)


def handle_request(event, context):
    del context
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = event.get("rawPath")

    if method == "POST" and path == "/api/analytics":
        if os.environ.get("ENVIRONMENT") not in {"dev", "prod"}:
            return response(404, {"message": "Not found"})
        try:
            record_analytics_event(event)
            return response(202, {"accepted": True})
        except ValueError as error:
            return response(400, {"message": str(error)})

    if method == "GET" and path == "/api/win-totals":
        return response(200, get_win_totals())

    if method == "GET" and path == "/api/prediction-window":
        return response(200, prediction_window())

    if method == "GET" and path == "/api/leaderboard":
        return response(200, get_leaderboard())

    public_bracket_match = re.fullmatch(
        r"/api/leaderboard/(.+)/bracket", path or ""
    )
    if public_bracket_match:
        if method != "GET":
            return response(404, {"message": "Not found"})
        bracket = get_public_bracket(unquote(public_bracket_match.group(1)))
        if not bracket:
            return response(404, {"message": "Bracket not found"})
        return response(200, bracket)

    group_leaderboard_match = re.fullmatch(
        r"/api/groups/([0-9a-f-]{36})/leaderboard", path or ""
    )
    group_invite_match = re.fullmatch(
        r"/api/groups/([0-9a-f-]{36})/invite", path or ""
    )
    group_members_match = re.fullmatch(
        r"/api/groups/([0-9a-f-]{36})/members", path or ""
    )
    group_membership_match = re.fullmatch(
        r"/api/groups/([0-9a-f-]{36})/membership", path or ""
    )
    group_delete_match = re.fullmatch(r"/api/groups/([0-9a-f-]{36})", path or "")
    if path not in (
        "/api/prediction",
        "/api/profile",
        "/api/groups",
        "/api/groups/join",
        "/api/groups/join-invite",
    ) and not any(
        (
            group_leaderboard_match,
            group_invite_match,
            group_members_match,
            group_membership_match,
            group_delete_match,
        )
    ):
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

    if path == "/api/groups/join-invite":
        if method == "POST":
            try:
                return response(200, join_group_by_invite(user_id, event))
            except ValueError as error:
                return response(400, {"message": str(error)})
        return response(404, {"message": "Not found"})

    if group_delete_match:
        if method != "DELETE":
            return response(404, {"message": "Not found"})
        try:
            delete_group(group_delete_match.group(1), user_id)
            return response(200, {"deleted": True})
        except ValueError as error:
            return response(404, {"message": str(error)})
        except PermissionError as error:
            return response(403, {"message": str(error)})

    if group_members_match:
        if method != "GET":
            return response(404, {"message": "Not found"})
        try:
            return response(
                200,
                list_group_members(group_members_match.group(1), user_id),
            )
        except PermissionError as error:
            return response(403, {"message": str(error)})

    if group_membership_match:
        if method != "DELETE":
            return response(404, {"message": "Not found"})
        try:
            return response(
                200,
                leave_group(group_membership_match.group(1), user_id, event),
            )
        except ValueError as error:
            return response(400, {"message": str(error)})
        except PermissionError as error:
            return response(403, {"message": str(error)})

    if group_invite_match:
        if method != "GET":
            return response(404, {"message": "Not found"})
        try:
            return response(
                200,
                get_group_invite(group_invite_match.group(1), user_id),
            )
        except PermissionError as error:
            return response(403, {"message": str(error)})

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
            try:
                delete_group_memberships(user_id)
                table = predictions_table()
                for prediction in scan_all(table):
                    if prediction.get("profileKey") == user_id or prediction.get("ownerId") == user_id:
                        table.delete_item(Key={"profileKey": prediction["profileKey"]})
                delete_profile(user_id)
                return response(200, {"deleted": True})
            except ValueError as error:
                return response(409, {"message": str(error)})

        return response(404, {"message": "Not found"})

    if method == "GET":
        prediction = get_prediction(user_id)
        if not prediction:
            return response(404, {"message": "Prediction not found"})
        return response(200, {**prediction, "score": score_prediction(prediction)})

    if method == "PUT":
        try:
            window = prediction_window()
            if window["locked"]:
                return response(
                    423,
                    {
                        **window,
                        "message": (
                            "Brackets locked at the start of the regular season "
                            "and can no longer be created or changed."
                        ),
                    },
                )
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


def load_nba_results():
    # Numeric namespace preserves the existing DynamoDB key schema and NFL rows.
    if os.environ.get("RESULTS_TABLE"):
        item = results_table().get_item(Key={"season": 100000 + NBA["season"]}, ConsistentRead=True).get("Item")
        if item:
            return {**item, "season": NBA["season"]}
    return {"season": NBA["season"], "status": "Preseason — scoring has not started",
            "updatedAt": None, "playoffTeams": {}, "seeds": {}, "divisionWinners": {},
            "roundWinners": {}}


def parse_nba_win_totals(html):
    if "2026-27" not in html and "2026–27" not in html:
        raise ValueError("NBA win-total source is for a different season")
    totals = {}
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
        cells = [unescape(re.sub(r"<[^>]+>", "", cell)).strip()
                 for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S | re.I)]
        if len(cells) >= 2 and cells[0] in NBA["totals"]:
            total = float(cells[1])
            if not 0 < total < 82:
                raise ValueError("NBA win total is out of range")
            totals[cells[0]] = total
    if set(totals) != set(NBA["totals"]):
        raise ValueError("Incomplete NBA win-total source")
    return totals


def get_nba_win_totals():
    key = f"nba#{NBA['season']}"
    base = {"apiVersion": API_VERSION, "sourceUrl": NBA["sourceUrl"]}
    cached = None
    try:
        cached = cache_table().get_item(Key={"cacheKey": key}).get("Item")
        if cached and set(cached.get("totals", {})) != set(NBA["totals"]):
            cached = None
        if cached and time.time() - int(cached["updatedAt"]) < CACHE_TTL_SECONDS:
            return {**base, **cached, "status": "cached"}
        request = Request(NBA["sourceUrl"], headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=12) as result:
            totals = parse_nba_win_totals(result.read().decode("utf-8"))
        payload = {"cacheKey": key, "totals": {team: Decimal(str(value)) for team, value in totals.items()},
                   "source": "BetMGM season win totals", "updatedAt": int(time.time())}
        cache_table().put_item(Item=payload)
        return {**base, **payload, "status": "live"}
    except Exception:
        if cached:
            return {**base, **cached, "status": "cached"}
        return {**base, "totals": NBA["totals"], "source": NBA["source"], "status": "fallback", "updatedAt": None}
