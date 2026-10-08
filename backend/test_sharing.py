"""Public sharing adds no private fields, and only final results settle a pick."""
import copy
import json
import unittest
from unittest.mock import patch

from test_auth import lambda_app as app, event, valid_prediction
from test_nba import prediction as nba_prediction


class SharingTests(unittest.TestCase):
    def status(self, prediction, results, sport="nfl"):
        token = app.SPORT.set(sport)
        try:
            return app.prediction_champion_status(prediction, results)
        finally:
            app.SPORT.reset(token)

    def test_champion_status_requires_finalized_evidence_for_both_sports(self):
        for sport, prediction in (("nfl", valid_prediction()), ("nba", nba_prediction())):
            with self.subTest(sport=sport):
                champion = prediction["picks"]["superBowl"]
                results = {"seeds": copy.deepcopy(prediction["seeds"]), "roundWinners": {}}
                self.assertIsNone(self.status(prediction, {}, sport))
                self.assertEqual(self.status(prediction, results, sport), "alive")
                results["roundWinners"]["superBowlChampion"] = champion
                self.assertEqual(self.status(prediction, results, sport), "won")
                results["roundWinners"]["superBowlChampion"] = "Someone Else"
                self.assertEqual(self.status(prediction, results, sport), "eliminated")

    def test_nfl_game_loss_eliminates_but_nba_game_loss_does_not(self):
        for sport, prediction in (("nfl", valid_prediction()), ("nba", nba_prediction())):
            champion = prediction["picks"]["superBowl"]
            results = {"seeds": prediction["seeds"], "processedGames": {}}
            for index in range(4):
                results["processedGames"][str(index)] = {"round": "wildCard", "teams": [champion, "Opponent"], "winner": "Opponent"}
                expected = "eliminated" if sport == "nfl" or index == 3 else "alive"
                self.assertEqual(self.status(prediction, results, sport), expected)
            results["processedGames"] = {"regular": {"round": "regularSeason", "teams": [champion, "Opponent"], "winner": "Opponent"}}
            self.assertEqual(self.status(prediction, results, sport), "alive")

    def test_nfl_first_seed_bye_and_partial_field_are_not_elimination(self):
        prediction = valid_prediction()
        champion = prediction["seeds"]["AFC"][0]
        prediction["picks"]["superBowl"] = champion
        results = {"seeds": prediction["seeds"], "roundWinners": {"wildCard": prediction["seeds"]["AFC"][1:4]}}
        self.assertEqual(self.status(prediction, results), "alive")
        results = {"seeds": {"AFC": ["Buffalo Bills"]}}
        self.assertIsNone(self.status(prediction, results))
        results = {"seeds": prediction["seeds"], "roundWinners": {"divisional": prediction["seeds"]["AFC"][1:3]}}
        self.assertEqual(self.status(prediction, results), "eliminated")

    def test_existing_public_endpoint_is_anonymous_and_allowlists_all_fields(self):
        prediction = valid_prediction()
        prediction.update(ownerId="PRIVATE", profileKey="PRIVATE", email="PRIVATE", inviteCode="PRIVATE", groupName="PRIVATE")
        profile = {"leaderboardName": "JakeH", "email": "PRIVATE", "profileKey": "PRIVATE"}
        with patch.object(app, "load_season_results", return_value={"season": 2026}), \
                patch.object(app, "score_prediction", return_value={"status": "Results unavailable", "regularSeason": 0, "playoffs": 0, "total": 0, "possible": 0, "maximum": 300}):
            bracket = app.public_bracket(profile, prediction)
        self.assertNotIn("PRIVATE", json.dumps(bracket))
        self.assertEqual(bracket["season"], 2026)
        self.assertIsNone(bracket["championStatus"])
        with patch.object(app, "get_public_bracket", return_value=bracket):
            response = app.handler(event("GET", user_id=None, path="/api/leaderboard/JakeH/bracket"), None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), bracket)

    def test_sparse_manual_rounds_do_not_claim_an_unverified_champion_is_alive(self):
        prediction = nba_prediction()
        conference = next(c for c in ("East", "West") if prediction["picks"]["superBowl"] in prediction["seeds"][c])
        other = next(t for t in prediction["seeds"][conference] if t != prediction["picks"]["superBowl"])
        results = {"seeds": prediction["seeds"], "roundWinners": {"wildCard": [other]}}
        self.assertIsNone(self.status(prediction, results, "nba"))

    def test_share_events_discard_private_metadata_on_the_server(self):
        from test_analytics import AnalyticsTests
        for name in ("share_card_opened", "share_image_generated", "share_native_used", "share_image_downloaded", "share_link_copied"):
            response, output = AnalyticsTests().call({"event": name, "page": "/groups", "groupId": "PRIVATE", "player": "PRIVATE", "url": "PRIVATE"})
            self.assertEqual(response["statusCode"], 202)
            self.assertNotIn("PRIVATE", output)
            self.assertEqual(set(json.loads(output)), {"type", "environment", "event", "page"})


if __name__ == "__main__":
    unittest.main()
