"""NBA series results, with post-Play-In seeds and resumable daily ingestion."""
from __future__ import annotations

import copy
import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import boto3

CONFIG = json.loads(Path(__file__).with_name("nba_season.json").read_text(encoding="utf-8"))
SEASON = CONFIG["season"]
RESULTS_KEY = 100000 + SEASON
TEAM_CONFERENCE = {team: conference for conference, teams in CONFIG["teams"].items() for team in teams}
ROUNDS = {"RD16": "wildCard", "QTR": "divisional", "SEMI": "conferenceChampions", "FINAL": "superBowlChampion"}
BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
STANDINGS_URL = f"https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?season={SEASON}&seasontype=2"


def fetch_json(url):
    with urlopen(Request(url, headers={"User-Agent": "PredictPlayoffsResults/1.0", "Accept": "application/json"}), timeout=12) as response:
        return json.load(response)


def team_name(value):
    name = "Los Angeles Clippers" if value == "LA Clippers" else value
    if name not in TEAM_CONFERENCE:
        raise ValueError("Unknown NBA team in provider response")
    return name


def parse_games(payload):
    if not isinstance(payload.get("events"), list):
        raise ValueError("NBA scoreboard has no events list")
    games = {}
    for event in payload["events"]:
        season = event.get("season", {})
        if season.get("year") != SEASON or season.get("type") != 3:
            continue
        for competition in event.get("competitions", []):
            round_name = ROUNDS.get(competition.get("type", {}).get("abbreviation"))
            if not round_name:
                # Play-In and regular-season games do not award playoff points.
                continue
            competitors = competition.get("competitors", [])
            if len(competitors) != 2:
                raise ValueError("NBA series needs exactly two teams")
            names = [team_name(team["team"]["displayName"]) for team in competitors]
            if len(set(names)) != 2:
                raise ValueError("Duplicate NBA opponent")
            same_conference = TEAM_CONFERENCE[names[0]] == TEAM_CONFERENCE[names[1]]
            if same_conference == (round_name == "superBowlChampion"):
                raise ValueError("NBA series conference mismatch")
            completed = competition.get("status", {}).get("type", {}).get("completed") is True
            winners = [names[index] for index, team in enumerate(competitors) if team.get("winner") is True]
            if completed and len(winners) != 1:
                raise ValueError("Final NBA game needs one winner")
            if completed:
                scores = [int(team["score"]) for team in competitors]
                if scores[0] == scores[1] or names[scores.index(max(scores))] != winners[0]:
                    raise ValueError("NBA winner conflicts with final score")
            games[str(competition["id"])] = {
                "round": round_name, "teams": names, "winner": winners[0] if completed else "",
            }
    return games


def final_regular_seeds(standings):
    seeds = {}
    for group in standings.get("children", []):
        conference = group.get("abbreviation")
        if conference not in CONFIG["teams"]:
            continue
        entries = group.get("standings", {}).get("entries", [])
        if len(entries) != 15 or group.get("standings", {}).get("season") != SEASON:
            raise ValueError("Incomplete or wrong-season NBA standings")
        ranked = {}
        names = set()
        for entry in entries:
            name = team_name(entry["team"]["displayName"])
            if TEAM_CONFERENCE[name] != conference or name in names:
                raise ValueError("Invalid NBA conference standings")
            names.add(name)
            stats = {stat["name"]: stat.get("value") for stat in entry.get("stats", [])}
            if stats.get("wins", 0) + stats.get("losses", 0) != 82:
                return None  # Never score projected or unfinished regular-season seeds.
            rank = int(stats.get("playoffSeed", 0))
            if rank not in range(1, 16) or rank in ranked:
                raise ValueError("Invalid NBA seed rankings")
            ranked[rank] = name
        seeds[conference] = [ranked[index] for index in range(1, 7)] + ["", ""]
    if set(seeds) != set(CONFIG["teams"]):
        raise ValueError("Missing NBA conference")
    return seeds


def build_results(current, games, standings, now):
    stored = {**(current or {}).get("processedGames", {}), **games}
    seeds = final_regular_seeds(standings)
    if seeds is None:
        seeds = copy.deepcopy((current or {}).get("seeds", {c: [""] * 8 for c in CONFIG["teams"]}))
    series = {}
    for game in stored.values():
        teams = game["teams"]
        conference = TEAM_CONFERENCE[teams[0]]
        if game["round"] == "wildCard" and all(seeds[conference][:6]):
            # Derive Play-In qualifiers from their published first-round opponents.
            for top_seed, qualifier_slot in ((0, 7), (1, 6)):
                if seeds[conference][top_seed] in teams:
                    seeds[conference][qualifier_slot] = next(team for team in teams if team != seeds[conference][top_seed])
        key = (game["round"], tuple(sorted(teams)))
        wins = series.setdefault(key, Counter())
        if game["winner"]:
            wins[game["winner"]] += 1
    winners = {"wildCard": [], "divisional": [], "conferenceChampions": {}, "superBowlChampion": ""}
    for (round_name, teams), wins in series.items():
        if any(count > 4 for count in wins.values()) or sum(wins.values()) > 7:
            raise ValueError("Invalid best-of-seven series results")
        finished = [team for team, count in wins.items() if count == 4]
        if not finished:
            continue
        winner = finished[0]
        if round_name in ("wildCard", "divisional"):
            winners[round_name].append(winner)
        elif round_name == "conferenceChampions":
            conference = TEAM_CONFERENCE[winner]
            if conference in winners[round_name]:
                raise ValueError("Multiple NBA conference champions")
            winners[round_name][conference] = winner
        else:
            if winners[round_name]:
                raise ValueError("Multiple NBA champions")
            winners[round_name] = winner
    for conference, selected in seeds.items():
        known = [team for team in selected if team]
        if len(set(known)) != len(known) or any(TEAM_CONFERENCE[team] != conference for team in known):
            raise ValueError("Invalid finalized NBA seeds")
    if len(winners["wildCard"]) > 8 or len(winners["divisional"]) > 4:
        raise ValueError("Too many NBA series winners")
    return {"season": RESULTS_KEY, "sport": "nba", "updatedAt": now,
            "status": "Final" if winners["superBowlChampion"] else "Season in progress",
            "seeds": seeds, "playoffTeams": {c: [t for t in teams if t] for c, teams in seeds.items()},
            "divisionWinners": {}, "roundWinners": winners, "processedGames": stored,
            "source": {"provider": "ESPN public site API", "standingsUrl": STANDINGS_URL}}


def handler(event, context):
    del event, context
    today = datetime.now(timezone.utc).date()
    start = date(SEASON, 4, 1)
    if today < start:
        return {"sport": "nba", "skipped": True, "reason": "Playoffs have not started"}
    table = boto3.resource("dynamodb").Table(os.environ["RESULTS_TABLE"])
    current = table.get_item(Key={"season": RESULTS_KEY}, ConsistentRead=True).get("Item") or {}
    # Bound requests and resume after downtime; re-read three days for corrections.
    cursor = date.fromisoformat(current.get("syncedThrough", start.isoformat()))
    first = max(start, cursor - timedelta(days=2))
    last = min(today, date(SEASON, 6, 30), first + timedelta(days=13))
    if first > last:
        return {"sport": "nba", "skipped": True, "reason": "Season ingestion complete"}
    dates = [first + timedelta(days=i) for i in range((last-first).days + 1)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        payloads = list(pool.map(lambda day: fetch_json(f"{BASE_URL}?dates={day:%Y%m%d}"), dates))
    games = {}
    for payload in payloads:
        games.update(parse_games(payload))
    now = datetime.now(timezone.utc).isoformat()
    updated = build_results(current, games, fetch_json(STANDINGS_URL), now)
    updated["syncedThrough"] = last.isoformat()
    revision = int(current.get("revision", 0))
    updated["revision"] = revision + 1
    table.put_item(Item=updated,
                   ConditionExpression="attribute_not_exists(#revision) OR #revision = :revision",
                   ExpressionAttributeNames={"#revision": "revision"},
                   ExpressionAttributeValues={":revision": revision})
    return {"sport": "nba", "status": updated["status"], "syncedThrough": last.isoformat()}
