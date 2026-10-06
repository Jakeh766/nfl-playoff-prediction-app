"""Private season summaries of retained predictions and group participation."""
from collections import defaultdict
import json
import os
from pathlib import Path
import time

import boto3


def reporting_resource():
    # botocore ships with boto3 in Lambda. Keep network retries inside the report
    # budget rather than allowing a stalled scan to outlive the browser request.
    from botocore.config import Config
    return boto3.resource("dynamodb", config=Config(connect_timeout=2, read_timeout=2,
                                                    retries={"total_max_attempts": 1}))


def scan_records(table, fields, deadline):
    # Read only reporting fields: no picks, passwords, invite codes or profiles.
    names = {f"#f{index}": field for index, field in enumerate(fields)}
    arguments = {"ProjectionExpression": ", ".join(names), "ExpressionAttributeNames": names}
    for _ in range(100):
        if time.monotonic() >= deadline:
            raise RuntimeError("Season report scan exceeded its budget")
        page = table.scan(**arguments)
        if time.monotonic() >= deadline:
            raise RuntimeError("Season report scan exceeded its budget")
        yield from page.get("Items", [])
        if not page.get("LastEvaluatedKey"):
            return
        arguments["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    raise RuntimeError("Season report scan exceeded its page limit")


def season_key(sport, year):
    if sport not in {"nfl", "nba"}:
        return None
    try:
        year = int(year)
    except (ValueError, TypeError):
        return None
    return (sport, year) if 2000 <= year <= 2200 else None


def report(_config, _start, _end):
    root = Path(__file__).parent
    nfl = int(os.environ.get("RESULTS_SEASON") or json.loads((root / "season_results.json").read_text())["season"])
    nba = int(json.loads((root / "nba_season.json").read_text())["season"])
    current = {("nfl", nfl), ("nba", nba)}
    brackets = defaultdict(set)
    competitions = defaultdict(dict)
    for key in current:
        brackets[key]  # Show current seasons even before the first saved bracket.
    resource = reporting_resource()
    deadline = time.monotonic() + 10
    predictions = scan_records(resource.Table(os.environ["PREDICTIONS_TABLE"]),
                               ["profileKey", "ownerId", "sport", "season", "bracketBuilt"], deadline)
    for item in predictions:
        if item.get("bracketBuilt") is not True:
            continue
        profile = str(item.get("profileKey", ""))
        if profile.startswith("nba#"):
            parts = profile.split("#", 2)
            key = season_key("nba", item.get("season", parts[1]))
            owner = item.get("ownerId") or (parts[2] if len(parts) == 3 else None)
        else:
            # Legacy NFL records belong to the configured NFL season, not save year.
            key = season_key(item.get("sport", "nfl"), item.get("season", nfl))
            owner = item.get("ownerId") or profile
        if key and owner:
            brackets[key].add(owner)

    memberships = defaultdict(set)
    groups = {}
    records = scan_records(resource.Table(os.environ["GROUPS_TABLE"]),
                           ["recordType", "groupId", "sports", "userId", "sport", "season", "entries"], deadline)
    for item in records:
        group = item.get("groupId")
        if not group:
            continue
        kind = item.get("recordType")
        if kind == "group":
            groups[group] = item.get("sports", ["nfl"])
        elif kind == "membership" and item.get("userId"):
            memberships[group].add(item["userId"])
        elif kind == "groupSeason":
            key = season_key(item.get("sport"), item.get("season"))
            people = {entry["memberId"] for entry in item.get("entries", []) if entry.get("memberId")}
            if key and people:
                competitions[key][group] = people
    # A group competes when at least one member has a saved bracket for its sport.
    # Final snapshots take precedence over live rosters, including the current year.
    for key in current:
        sport, _year = key
        for group, sports in groups.items():
            if sport in sports and group not in competitions[key]:
                people = memberships[group] & brackets[key]
                if people:
                    competitions[key][group] = people

    rows = []
    for key in sorted(brackets.keys() | competitions.keys(), key=lambda key: (-key[1], key[0])):
        sport, year = key
        groups = competitions[key]
        people = set().union(*groups.values()) if groups else set()
        entries = sum(len(members) for members in groups.values())
        rows.append({"season": f"NFL {year}" if sport == "nfl" else f"NBA {year - 1}\u2013{str(year)[-2:]}",
                     "brackets": len(brackets[key]) if key in brackets else None,
                     "competitions": len(groups), "people": len(people), "entries": entries,
                     "average": round(entries / len(groups), 1) if groups else None,
                     "largest": max((len(members) for members in groups.values()), default=0)})
    return {"metrics": [], "range": {"window": "All retained seasons", "timezone": "Season totals"},
            "note": "Saved brackets count retained brackets, not unsaved builds or deleted brackets. Legacy NFL brackets use the configured NFL season. A group competes when at least one member has a saved bracket for that sport and season. People counts unique competitors with brackets; group entries counts a person once in each group they compete in. Average and largest group sizes count those competitors, including commissioners with brackets. Completed seasons use archived competition entries; historical bracket totals without retained records are unavailable. Groups without saved brackets are excluded. Date filters do not change this report. Refreshes are cached for up to 15 minutes.",
            "tables": [{"title": "Activity by season", "emptyMessage": "No season activity is available yet.",
                        "columns": [{"key": key, "label": label, "format": fmt} for key, label, fmt in [
                            ("season", "Season", "text"), ("brackets", "Saved brackets", "number"),
                            ("competitions", "Competing groups", "number"), ("people", "People competing", "number"),
                            ("entries", "Group entries", "number"), ("average", "Avg. people / group", "decimal"),
                            ("largest", "Largest group", "number")]], "rows": rows}]}
