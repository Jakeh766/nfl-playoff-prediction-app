"""Tests for the deterministic dev demo-data seed."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import seed_dev


class DevSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = seed_dev.build_seed_data(now_ms=1_800_000_000_000)

    def test_seeds_seven_unique_profiles_and_complete_predictions(self):
        public_profiles = [
            item
            for item in self.data["profiles"]
            if item["recordType"] == "profile"
        ]

        self.assertEqual(len(public_profiles), 7)
        self.assertEqual(len(self.data["predictions"]), 7)
        self.assertEqual(
            len({profile["leaderboardName"] for profile in public_profiles}),
            7,
        )
        for prediction in self.data["predictions"]:
            self.assertEqual(len(prediction["seeds"]["AFC"]), 7)
            self.assertEqual(len(prediction["seeds"]["NFC"]), 7)
            self.assertTrue(prediction["bracketBuilt"])
            self.assertTrue(prediction["picks"]["superBowl"])

    def test_seeds_two_password_hashed_groups_with_overlapping_members(self):
        group_records = [
            item for item in self.data["groups"] if item["recordType"] == "group"
        ]
        memberships = [
            item
            for item in self.data["groups"]
            if item["recordType"] == "membership"
        ]

        self.assertEqual(len(group_records), 2)
        self.assertEqual(len(memberships), 8)
        self.assertEqual(len({item["userId"] for item in memberships}), 7)
        for group in group_records:
            self.assertNotIn("password", group)
            self.assertEqual(len(group["passwordSalt"]), 32)
            self.assertEqual(len(group["passwordHash"]), 64)

    def test_demo_downstream_picks_follow_their_generated_matchups(self):
        for prediction in self.data["predictions"]:
            conference_champions = []
            for conference in ("AFC", "NFC"):
                seeds = prediction["seeds"][conference]
                picks = prediction["picks"][conference]
                wild_card_games = {
                    "wc-2-7": (seeds[1], seeds[6]),
                    "wc-3-6": (seeds[2], seeds[5]),
                    "wc-4-5": (seeds[3], seeds[4]),
                }
                wild_card_winners = []
                for game_id, teams in wild_card_games.items():
                    self.assertIn(picks[game_id], teams)
                    wild_card_winners.append(picks[game_id])

                remaining = sorted(
                    [seeds[0], *wild_card_winners],
                    key=seeds.index,
                )
                divisional_games = {
                    "div-1": (remaining[0], remaining[3]),
                    "div-2": (remaining[1], remaining[2]),
                }
                divisional_winners = []
                for game_id, teams in divisional_games.items():
                    self.assertIn(picks[game_id], teams)
                    divisional_winners.append(picks[game_id])

                self.assertIn(picks["conf"], divisional_winners)
                conference_champions.append(picks["conf"])

            self.assertIn(prediction["picks"]["superBowl"], conference_champions)

    def test_all_seed_values_convert_to_dynamodb_attribute_values(self):
        for items in self.data.values():
            for item in items:
                encoded = seed_dev.dynamodb_item(item)
                self.assertEqual(set(encoded), set(item))

    def test_batch_writer_passes_the_request_map_to_aws_cli(self):
        observed_request = None

        def fake_run(arguments, **_options):
            nonlocal observed_request
            request_argument = arguments[arguments.index("--request-items") + 1]
            observed_request = json.loads(
                Path(request_argument.removeprefix("file://")).read_text(
                    encoding="utf-8"
                )
            )
            return SimpleNamespace(stdout='{"UnprocessedItems": {}}')

        requests = {"demo-profiles": [{"PutRequest": {"Item": {}}}]}
        with mock.patch("seed_dev.subprocess.run", side_effect=fake_run):
            seed_dev.write_batch(requests, "us-east-1")

        self.assertEqual(observed_request, requests)


if __name__ == "__main__":
    unittest.main()
