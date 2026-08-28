"""Seed deterministic demo participants and private groups into the dev tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


PASSWORD_ITERATIONS = 310_000
DEMO_GROUPS = (
    {
        "name": "Demo Sunday Huddle",
        "password": "HuddleDemo26!",
        "members": (0, 1, 2, 3),
    },
    {
        "name": "Demo Gridiron Rivals",
        "password": "RivalsDemo26!",
        "members": (3, 4, 5, 6),
    },
)

DEMO_PLAYERS = (
    "Demo Player Ava",
    "Demo Player Blake",
    "Demo Player Casey",
    "Demo Player Devon",
    "Demo Player Emery",
    "Demo Player Finley",
    "Demo Player Gray",
)

AFC_SEEDS = (
    "Kansas City Chiefs",
    "Buffalo Bills",
    "Baltimore Ravens",
    "Houston Texans",
    "Los Angeles Chargers",
    "Cincinnati Bengals",
    "Miami Dolphins",
)
NFC_SEEDS = (
    "Philadelphia Eagles",
    "Detroit Lions",
    "Los Angeles Rams",
    "Tampa Bay Buccaneers",
    "Green Bay Packers",
    "Minnesota Vikings",
    "Seattle Seahawks",
)


def rotated(values: tuple[str, ...], amount: int) -> list[str]:
    shift = amount % len(values)
    return list(values[shift:] + values[:shift])


def demo_prediction(player_index: int, saved_at: int) -> dict:
    afc = rotated(AFC_SEEDS, player_index % 4)
    nfc = rotated(NFC_SEEDS, (player_index * 2) % 4)
    afc_champion = afc[player_index % 3]
    nfc_champion = nfc[(player_index + 1) % 3]
    champion = afc_champion if player_index % 2 == 0 else nfc_champion

    return {
        "profileKey": f"demo-user-{player_index + 1:02d}",
        "divisionWinners": {
            "AFC": {
                "North": "Baltimore Ravens",
                "South": "Houston Texans",
                "East": "Buffalo Bills",
                "West": "Kansas City Chiefs",
            },
            "NFC": {
                "North": "Detroit Lions",
                "South": "Tampa Bay Buccaneers",
                "East": "Philadelphia Eagles",
                "West": "Los Angeles Rams",
            },
        },
        "seeds": {"AFC": afc, "NFC": nfc},
        "picks": {
            "AFC": {
                "wc-2-7": afc[1],
                "wc-3-6": afc[2],
                "wc-4-5": afc[4],
                "div-1": afc[0],
                "div-2": afc_champion,
                "conf": afc_champion,
            },
            "NFC": {
                "wc-2-7": nfc[1],
                "wc-3-6": nfc[2],
                "wc-4-5": nfc[4],
                "div-1": nfc[0],
                "div-2": nfc_champion,
                "conf": nfc_champion,
            },
            "superBowl": champion,
        },
        "bracketBuilt": True,
        "savedAt": saved_at - player_index * 60_000,
    }


def password_fields(group_name: str, password: str) -> dict:
    salt = hashlib.sha256(f"nfl-dev-demo:{group_name}".encode()).hexdigest()[:32]
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        bytes.fromhex(salt),
        PASSWORD_ITERATIONS,
    ).hex()
    return {
        "passwordSalt": salt,
        "passwordHash": digest,
        "passwordIterations": PASSWORD_ITERATIONS,
    }


def build_seed_data(now_ms: int | None = None) -> dict[str, list[dict]]:
    seeded_at = now_ms or int(time.time() * 1000)
    profiles = []
    predictions = []
    groups = []

    for index, leaderboard_name in enumerate(DEMO_PLAYERS):
        user_id = f"demo-user-{index + 1:02d}"
        normalized_name = leaderboard_name.casefold()
        profiles.extend(
            (
                {
                    "profileKey": f"user#{user_id}",
                    "recordType": "profile",
                    "leaderboardName": leaderboard_name,
                    "normalizedName": normalized_name,
                    "updatedAt": seeded_at,
                },
                {
                    "profileKey": f"name#{normalized_name}",
                    "recordType": "leaderboardName",
                    "normalizedName": normalized_name,
                    "displayName": leaderboard_name,
                    "ownerId": user_id,
                },
            )
        )
        predictions.append(demo_prediction(index, seeded_at))

    for group_config in DEMO_GROUPS:
        group_name = group_config["name"]
        normalized_name = group_name.casefold()
        group_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"road-to-the-bowl-dev:{normalized_name}")
        )
        groups.extend(
            (
                {
                    "groupKey": f"name#{normalized_name}",
                    "recordType": "groupName",
                    "normalizedName": normalized_name,
                    "groupId": group_id,
                },
                {
                    "groupKey": f"group#{group_id}",
                    "recordType": "group",
                    "groupId": group_id,
                    "groupName": group_name,
                    "normalizedName": normalized_name,
                    "createdAt": seeded_at,
                    **password_fields(group_name, group_config["password"]),
                },
            )
        )
        for player_index in group_config["members"]:
            user_id = f"demo-user-{player_index + 1:02d}"
            groups.append(
                {
                    "groupKey": f"membership#{group_id}#user#{user_id}",
                    "recordType": "membership",
                    "groupId": group_id,
                    "userId": user_id,
                    "joinedAt": seeded_at,
                }
            )

    return {"profiles": profiles, "predictions": predictions, "groups": groups}


def dynamodb_value(value) -> dict:
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, str):
        return {"S": value}
    if isinstance(value, int):
        return {"N": str(value)}
    if isinstance(value, list):
        return {"L": [dynamodb_value(item) for item in value]}
    if isinstance(value, dict):
        return {"M": {key: dynamodb_value(item) for key, item in value.items()}}
    raise TypeError(f"Unsupported DynamoDB value: {type(value).__name__}")


def dynamodb_item(item: dict) -> dict:
    return {key: dynamodb_value(value) for key, value in item.items()}


def write_batch(request_items: dict, region: str) -> None:
    pending = request_items
    for attempt in range(1, 6):
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", delete=False
        ) as request_file:
            json.dump(pending, request_file)
            request_path = Path(request_file.name)
        try:
            result = subprocess.run(
                [
                    "aws",
                    "dynamodb",
                    "batch-write-item",
                    "--region",
                    region,
                    "--request-items",
                    f"file://{request_path}",
                    "--output",
                    "json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        finally:
            request_path.unlink(missing_ok=True)

        pending = json.loads(result.stdout).get("UnprocessedItems", {})
        if not any(pending.values()):
            return
        time.sleep(attempt)
    raise RuntimeError("DynamoDB still had unprocessed demo records after five attempts")


def seed_tables(
    profiles_table: str,
    predictions_table: str,
    groups_table: str,
    region: str,
) -> None:
    data = build_seed_data()
    writes = (
        [(profiles_table, item) for item in data["profiles"]]
        + [(predictions_table, item) for item in data["predictions"]]
        + [(groups_table, item) for item in data["groups"]]
    )

    for offset in range(0, len(writes), 25):
        request_items: dict[str, list[dict]] = {}
        for table_name, item in writes[offset : offset + 25]:
            request_items.setdefault(table_name, []).append(
                {"PutRequest": {"Item": dynamodb_item(item)}}
            )
        write_batch(request_items, region)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profiles-table", required=True)
    parser.add_argument("--predictions-table", required=True)
    parser.add_argument("--groups-table", required=True)
    parser.add_argument("--region", default="us-east-1")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    seed_tables(
        profiles_table=arguments.profiles_table,
        predictions_table=arguments.predictions_table,
        groups_table=arguments.groups_table,
        region=arguments.region,
    )
    print("Seeded 7 demo participants and 2 private groups.")


if __name__ == "__main__":
    main()
