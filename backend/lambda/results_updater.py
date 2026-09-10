"""Scheduled ingestion of finalized 2026 NFL results.

Provider-specific ESPN parsing is kept in this module so the API/scoring code only
depends on the durable season-results document stored in DynamoDB.
"""

from __future__ import annotations

import copy
import json
import logging
import os
from datetime import datetime, timezone
from urllib.request import Request, urlopen

import boto3


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

SEASON = int(os.environ.get("RESULTS_SEASON", "2026"))
EXPECTED_REGULAR_SEASON_GAMES = 272
PROVIDER_NAME = "ESPN public site API"
PROVIDER_BASE_URL = "https://site.api.espn.com/apis"
SCOREBOARD_URL = (
    PROVIDER_BASE_URL
    + "/site/v2/sports/football/nfl/scoreboard"
    + f"?dates={SEASON}0901-{SEASON + 1}0301&limit=500"
)
STANDINGS_URL = (
    PROVIDER_BASE_URL
    + f"/v2/sports/football/nfl/standings?season={SEASON}"
)

TEAM_INFO = {
    "Arizona Cardinals": ("NFC", "West"),
    "Atlanta Falcons": ("NFC", "South"),
    "Baltimore Ravens": ("AFC", "North"),
    "Buffalo Bills": ("AFC", "East"),
    "Carolina Panthers": ("NFC", "South"),
    "Chicago Bears": ("NFC", "North"),
    "Cincinnati Bengals": ("AFC", "North"),
    "Cleveland Browns": ("AFC", "North"),
    "Dallas Cowboys": ("NFC", "East"),
    "Denver Broncos": ("AFC", "West"),
    "Detroit Lions": ("NFC", "North"),
    "Green Bay Packers": ("NFC", "North"),
    "Houston Texans": ("AFC", "South"),
    "Indianapolis Colts": ("AFC", "South"),
    "Jacksonville Jaguars": ("AFC", "South"),
    "Kansas City Chiefs": ("AFC", "West"),
    "Las Vegas Raiders": ("AFC", "West"),
    "Los Angeles Chargers": ("AFC", "West"),
    "Los Angeles Rams": ("NFC", "West"),
    "Miami Dolphins": ("AFC", "East"),
    "Minnesota Vikings": ("NFC", "North"),
    "New England Patriots": ("AFC", "East"),
    "New Orleans Saints": ("NFC", "South"),
    "New York Giants": ("NFC", "East"),
    "New York Jets": ("AFC", "East"),
    "Philadelphia Eagles": ("NFC", "East"),
    "Pittsburgh Steelers": ("AFC", "North"),
    "San Francisco 49ers": ("NFC", "West"),
    "Seattle Seahawks": ("NFC", "West"),
    "Tampa Bay Buccaneers": ("NFC", "South"),
    "Tennessee Titans": ("AFC", "South"),
    "Washington Commanders": ("NFC", "East"),
}

TEAM_ALIASES = {
    **{name.casefold(): name for name in TEAM_INFO},
    "jacksonville jaguars": "Jacksonville Jaguars",
    "la chargers": "Los Angeles Chargers",
    "la rams": "Los Angeles Rams",
    "oakland raiders": "Las Vegas Raiders",
    "san diego chargers": "Los Angeles Chargers",
    "st. louis rams": "Los Angeles Rams",
    "washington": "Washington Commanders",
    "washington football team": "Washington Commanders",
    "washington redskins": "Washington Commanders",
}

ROUND_BY_WEEK = {
    1: "wildCard",
    2: "divisional",
    3: "conferenceChampions",
    4: "superBowlChampion",
}
ROUND_LIMITS = {
    "wildCard": 6,
    "divisional": 4,
    "conferenceChampions": 2,
    "superBowlChampion": 1,
}


class ProviderDataError(ValueError):
    """The provider returned a response that is unsafe to persist."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def results_table():
    return boto3.resource("dynamodb").Table(os.environ["RESULTS_TABLE"])


def empty_results(season: int = SEASON) -> dict:
    return {
        "season": season,
        "status": "Preseason — scoring has not started",
        "updatedAt": None,
        "divisionWinners": {"AFC": {}, "NFC": {}},
        "seeds": {"AFC": [], "NFC": []},
        "roundWinners": {
            "wildCard": [],
            "divisional": [],
            "conferenceChampions": {},
            "superBowlChampion": "",
        },
        "source": {
            "provider": PROVIDER_NAME,
            "scoreboardUrl": SCOREBOARD_URL,
            "standingsUrl": STANDINGS_URL,
        },
        "lastSuccessfulSync": None,
        "processedGames": {},
    }


def normalize_team(value) -> str:
    if not isinstance(value, str):
        raise ProviderDataError("Provider game is missing a team name")
    normalized = TEAM_ALIASES.get(" ".join(value.split()).casefold())
    if not normalized:
        raise ProviderDataError(f"Unknown NFL team from provider: {value!r}")
    return normalized


def fetch_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "PredictPlayoffsResults/1.0 (+https://predictplayoffs.com)",
        },
    )
    with urlopen(request, timeout=15) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"Provider returned HTTP {response.status}")
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ProviderDataError("Provider response must be a JSON object")
    return payload


def _score(competitor: dict) -> int:
    try:
        value = competitor["score"]
        if isinstance(value, dict):
            value = value.get("value", value.get("displayValue"))
        return int(float(value))
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderDataError("Final provider game has an invalid score") from error


def parse_scoreboard(payload: dict, season: int = SEASON) -> tuple[dict, int, int]:
    events = payload.get("events")
    if not isinstance(events, list):
        raise ProviderDataError("Provider scoreboard is missing its events list")

    games = {}
    regular_event_ids = set()
    for event in events:
        if not isinstance(event, dict):
            raise ProviderDataError("Provider scoreboard contains a malformed event")
        event_season = event.get("season") or {}
        if int(event_season.get("year", season)) != season:
            continue
        season_type = int(event_season.get("type", 0))
        if season_type not in (2, 3):
            continue
        event_id = str(event.get("id") or "").strip()
        if not event_id:
            raise ProviderDataError("Provider event is missing an id")
        if season_type == 2:
            regular_event_ids.add(event_id)

        completed = (event.get("status") or {}).get("type", {}).get("completed") is True
        if not completed:
            continue
        competitions = event.get("competitions")
        if not isinstance(competitions, list) or len(competitions) != 1:
            raise ProviderDataError(f"Final event {event_id} has invalid competitions")
        competitors = competitions[0].get("competitors")
        if not isinstance(competitors, list) or len(competitors) != 2:
            raise ProviderDataError(f"Final event {event_id} does not have two teams")

        teams = []
        for competitor in competitors:
            team = normalize_team((competitor.get("team") or {}).get("displayName"))
            teams.append((team, _score(competitor)))
        if teams[0][0] == teams[1][0]:
            raise ProviderDataError(f"Final event {event_id} repeats the same team")
        tied = teams[0][1] == teams[1][1]
        if tied and season_type == 3:
            raise ProviderDataError(f"Postseason event {event_id} cannot end in a tie")
        winner = "" if tied else max(teams, key=lambda item: item[1])[0]
        week = int((event.get("week") or {}).get("number", 0))
        round_name = "regularSeason" if season_type == 2 else ROUND_BY_WEEK.get(week)
        if season_type == 3 and not round_name:
            # Pro Bowl and other non-championship postseason events are not scored.
            continue
        record = {
            "winner": winner,
            "teams": sorted(team for team, _score_value in teams),
            "scores": {team: score for team, score in teams},
            "round": round_name,
            "date": event.get("date", ""),
            "tied": tied,
        }
        previous = games.get(event_id)
        if previous is not None and previous != record:
            raise ProviderDataError(f"Provider returned conflicting duplicates for {event_id}")
        games[event_id] = record
    regular_final = sum(
        game.get("round") == "regularSeason" for game in games.values()
    )
    return games, len(regular_event_ids), regular_final


def parse_standings(payload: dict, season: int = SEASON) -> tuple[dict, dict]:
    children = payload.get("children")
    if not isinstance(children, list):
        raise ProviderDataError("Provider standings are missing conference children")
    seeds = {"AFC": [None] * 7, "NFC": [None] * 7}
    for child in children:
        conference = str(child.get("abbreviation", "")).upper()
        if conference not in seeds:
            continue
        entries = (child.get("standings") or {}).get("entries")
        if not isinstance(entries, list):
            raise ProviderDataError(f"Provider standings are missing {conference} entries")
        for entry in entries:
            team = normalize_team((entry.get("team") or {}).get("displayName"))
            stats = {
                str(stat.get("name") or stat.get("type") or "").casefold(): stat
                for stat in entry.get("stats", [])
                if isinstance(stat, dict)
            }
            seed_stat = stats.get("playoffseed")
            if not seed_stat:
                continue
            try:
                seed = int(float(seed_stat.get("value", seed_stat.get("displayValue"))))
            except (TypeError, ValueError) as error:
                raise ProviderDataError(f"Invalid playoff seed for {team}") from error
            if not 1 <= seed <= 7:
                continue
            if seeds[conference][seed - 1] is not None:
                raise ProviderDataError(f"Duplicate {conference} playoff seed {seed}")
            if TEAM_INFO[team][0] != conference:
                raise ProviderDataError(f"{team} is listed in the wrong conference")
            seeds[conference][seed - 1] = team

    if any(team is None for conference in seeds.values() for team in conference):
        raise ProviderDataError("Provider standings do not contain all 14 playoff seeds")
    final_seeds = {conference: list(teams) for conference, teams in seeds.items()}
    divisions = {"AFC": {}, "NFC": {}}
    for conference, teams in final_seeds.items():
        for team in teams[:4]:
            division = TEAM_INFO[team][1]
            if division in divisions[conference]:
                raise ProviderDataError(
                    f"Two {conference} playoff seeds claim the {division} division"
                )
            divisions[conference][division] = team
        if set(divisions[conference]) != {"North", "South", "East", "West"}:
            raise ProviderDataError(f"Provider seeds do not identify all {conference} divisions")
    return final_seeds, divisions


def derive_round_winners(processed_games: dict) -> dict:
    by_round = {name: [] for name in ROUND_LIMITS}
    for event_id, game in sorted(
        processed_games.items(), key=lambda item: (item[1].get("date", ""), item[0])
    ):
        round_name = game.get("round")
        winner = game.get("winner")
        if round_name in by_round and winner:
            normalize_team(winner)
            by_round[round_name].append(winner)
    for round_name, winners in by_round.items():
        if len(winners) > ROUND_LIMITS[round_name]:
            raise ProviderDataError(f"Too many finalized {round_name} games")
        if len(winners) != len(set(winners)):
            raise ProviderDataError(f"Duplicate winner in {round_name}")

    conference_champions = {}
    for team in by_round["conferenceChampions"]:
        conference = TEAM_INFO[team][0]
        if conference in conference_champions:
            raise ProviderDataError(f"Two {conference} conference champions")
        conference_champions[conference] = team
    super_bowl = by_round["superBowlChampion"]
    return {
        "wildCard": by_round["wildCard"],
        "divisional": by_round["divisional"],
        "conferenceChampions": conference_champions,
        "superBowlChampion": super_bowl[0] if super_bowl else "",
    }


def _overlay(base, override):
    if isinstance(base, dict) and isinstance(override, dict):
        merged = copy.deepcopy(base)
        for key, value in override.items():
            if key not in base:
                raise ValueError(f"Unknown manual override field: {key}")
            merged[key] = _overlay(base[key], value)
        return merged
    return copy.deepcopy(override)


def _merge_sparse(existing: dict, addition: dict, schema: dict) -> dict:
    merged = copy.deepcopy(existing)
    for key, value in addition.items():
        if key not in schema:
            raise ValueError(f"Unknown manual override field: {key}")
        if isinstance(value, dict):
            if not isinstance(schema[key], dict):
                raise ValueError(f"Manual override field {key} must not be an object")
            merged[key] = _merge_sparse(merged.get(key, {}), value, schema[key])
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def validate_results(results: dict) -> None:
    if int(results.get("season", 0)) != SEASON:
        raise ValueError(f"Results must target the {SEASON} season")
    divisions = results.get("divisionWinners") or {}
    seeds = results.get("seeds") or {}
    rounds = results.get("roundWinners") or {}
    for conference in ("AFC", "NFC"):
        conference_seeds = seeds.get(conference, [])
        if not isinstance(conference_seeds, list) or len(conference_seeds) > 7:
            raise ValueError(f"{conference} seeds must be a list of at most seven teams")
        for team in conference_seeds:
            if normalize_team(team) != team or TEAM_INFO[team][0] != conference:
                raise ValueError(f"Invalid {conference} seed: {team}")
        for division, team in (divisions.get(conference) or {}).items():
            if division not in ("North", "South", "East", "West"):
                raise ValueError(f"Invalid {conference} division: {division}")
            if normalize_team(team) != team or TEAM_INFO[team] != (conference, division):
                raise ValueError(f"Invalid {conference} {division} winner: {team}")
    for category, limit in (("wildCard", 6), ("divisional", 4)):
        winners = rounds.get(category, [])
        if not isinstance(winners, list) or len(winners) > limit:
            raise ValueError(f"Invalid {category} winners")
        if len(winners) != len(set(winners)):
            raise ValueError(f"Duplicate {category} winner")
        for team in winners:
            if normalize_team(team) != team:
                raise ValueError(f"Invalid {category} winner: {team}")
    champions = rounds.get("conferenceChampions", {})
    for conference, team in champions.items():
        if conference not in ("AFC", "NFC") or TEAM_INFO.get(team, (None,))[0] != conference:
            raise ValueError(f"Invalid {conference} champion: {team}")
    champion = rounds.get("superBowlChampion", "")
    if champion and normalize_team(champion) != champion:
        raise ValueError(f"Invalid Super Bowl champion: {champion}")


def status_for(results: dict) -> str:
    rounds = results["roundWinners"]
    if rounds.get("superBowlChampion"):
        return "Final"
    if rounds.get("conferenceChampions"):
        return "Conference championships final"
    if rounds.get("divisional"):
        return "Divisional round in progress"
    if rounds.get("wildCard"):
        return "Wild Card round in progress"
    if any(results.get("seeds", {}).get(conference) for conference in ("AFC", "NFC")):
        return "Regular season final"
    if any(
        game.get("round") == "regularSeason"
        for game in results.get("processedGames", {}).values()
    ):
        return "Regular season in progress — final standings not yet scored"
    return "Preseason — scoring has not started"


def sync_results(current: dict, scoreboard: dict, standings: dict | None, now: str) -> dict:
    parsed_games, regular_scheduled, regular_final = parse_scoreboard(scoreboard)
    current = current or empty_results()
    saved_overrides = copy.deepcopy(current.get("manualOverrides"))
    saved_override_metadata = copy.deepcopy(current.get("manualOverride"))
    merged = copy.deepcopy(current.get("providerResults") or current)
    merged.pop("manualOverrides", None)
    merged.pop("manualOverride", None)
    merged.pop("providerResults", None)
    merged["season"] = SEASON
    stored_games = merged.get("processedGames")
    if not isinstance(stored_games, dict):
        stored_games = {}
    corrected = sum(
        1 for event_id, game in parsed_games.items()
        if event_id in stored_games and stored_games[event_id] != game
    )
    stored_games.update(parsed_games)
    merged["processedGames"] = stored_games
    merged["roundWinners"] = derive_round_winners(stored_games)

    if regular_scheduled >= EXPECTED_REGULAR_SEASON_GAMES and regular_final >= regular_scheduled:
        if standings is None:
            raise ProviderDataError("Final regular season requires standings data")
        merged["seeds"], merged["divisionWinners"] = parse_standings(standings)

    merged["status"] = status_for(merged)
    merged["updatedAt"] = now
    merged["lastSuccessfulSync"] = now
    merged["source"] = {
        "provider": PROVIDER_NAME,
        "scoreboardUrl": SCOREBOARD_URL,
        "standingsUrl": STANDINGS_URL,
        "finalGamesObserved": len(parsed_games),
        "retainedGames": len(stored_games),
    }
    provider_results = copy.deepcopy(merged)
    if saved_overrides:
        merged = _overlay(merged, saved_overrides)
        merged["manualOverrides"] = saved_overrides
        merged["manualOverride"] = saved_override_metadata
        merged["providerResults"] = provider_results
        merged["status"] = status_for(merged)
    validate_results(merged)
    LOGGER.info(
        "Results sync accepted: new_or_seen=%d retained=%d corrected=%d regular_final=%d/%d",
        len(parsed_games), len(stored_games), corrected, regular_final, regular_scheduled,
    )
    return merged


def apply_manual_override(current: dict, override: dict, reason: str, now: str) -> dict:
    if not isinstance(override, dict) or not override:
        raise ValueError("manualOverride must be a non-empty object")
    allowed = {"divisionWinners", "seeds", "roundWinners"}
    unknown = set(override) - allowed
    if unknown:
        raise ValueError(f"Manual override cannot change: {', '.join(sorted(unknown))}")
    stored = copy.deepcopy(current or empty_results())
    schema = {
        key: empty_results()[key] for key in allowed
    }
    candidate_overrides = _merge_sparse(
        stored.get("manualOverrides", {}), override, schema
    )
    candidate = _overlay(stored, candidate_overrides)
    validate_results(candidate)
    if "providerResults" not in stored:
        provider_results = copy.deepcopy(stored)
        provider_results.pop("manualOverrides", None)
        provider_results.pop("manualOverride", None)
        stored["providerResults"] = provider_results
    stored["manualOverrides"] = candidate_overrides
    stored = _overlay(stored, candidate_overrides)
    stored["status"] = status_for(stored)
    stored["updatedAt"] = now
    stored["manualOverride"] = {"updatedAt": now, "reason": reason or "Emergency correction"}
    stored.setdefault("lastSuccessfulSync", None)
    stored.setdefault("source", empty_results()["source"])
    LOGGER.warning("Manual NFL results override applied; reason=%s", reason or "not supplied")
    return stored


def handler(event, _context):
    table = results_table()
    current = table.get_item(Key={"season": SEASON}, ConsistentRead=True).get("Item")
    current_revision = int((current or {}).get("revision", 0))
    now = utc_now()
    event = event if isinstance(event, dict) else {}
    if "manualOverride" in event:
        updated = apply_manual_override(
            current or empty_results(), event["manualOverride"], str(event.get("reason", "")), now
        )
    elif event.get("clearManualOverride") is True:
        current = current or empty_results()
        updated = copy.deepcopy(current.get("providerResults") or current)
        updated.pop("manualOverrides", None)
        updated.pop("manualOverride", None)
        updated.pop("providerResults", None)
        updated["updatedAt"] = now
        updated["status"] = status_for(updated)
        validate_results(updated)
        LOGGER.warning("Manual NFL results overrides cleared")
    else:
        try:
            scoreboard = fetch_json(SCOREBOARD_URL)
            _games, scheduled, final = parse_scoreboard(scoreboard)
            standings = (
                fetch_json(STANDINGS_URL)
                if scheduled >= EXPECTED_REGULAR_SEASON_GAMES and final >= scheduled
                else None
            )
            updated = sync_results(current or empty_results(), scoreboard, standings, now)
        except Exception:
            LOGGER.exception("NFL results provider sync failed; last known good results retained")
            raise
    updated["revision"] = current_revision + 1
    table.put_item(
        Item=updated,
        ConditionExpression=(
            "attribute_not_exists(#season) OR attribute_not_exists(#revision) "
            "OR #revision = :current_revision"
        ),
        ExpressionAttributeNames={"#season": "season", "#revision": "revision"},
        ExpressionAttributeValues={":current_revision": current_revision},
    )
    return {
        "season": SEASON,
        "status": updated["status"],
        "updatedAt": updated["updatedAt"],
        "finalGamesRetained": len(updated.get("processedGames", {})),
        "manualOverride": bool(updated.get("manualOverrides")),
    }
