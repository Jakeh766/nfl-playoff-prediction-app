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
