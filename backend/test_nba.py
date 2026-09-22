"""NBA parity and cross-sport isolation regressions."""
import copy
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / "lambda" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


app = load("app")
updater = load("nba_results_updater")


def prediction():
    seeds = {c: teams[:8] for c, teams in app.NBA["teams"].items()}
    picks = {}
    for c, teams in seeds.items():
        picks[c] = {"r1-1-8": teams[0], "r1-4-5": teams[3], "r1-2-7": teams[1],
                    "r1-3-6": teams[2], "div-1": teams[0], "div-2": teams[1], "conf": teams[0]}
    picks["superBowl"] = seeds["East"][0]
    return {"seeds": seeds, "picks": picks, "divisionWinners": {}, "bracketBuilt": True}


def final_results():
    p = prediction()
    return {"season": app.NBA["season"], "seeds": p["seeds"], "playoffTeams": p["seeds"],
            "roundWinners": {
                "wildCard": [p["picks"][c][g] for c in app.conferences() for g in app.first_round_games()],
                "divisional": [p["picks"][c][g] for c in app.conferences() for g in ("div-1", "div-2")],
                "conferenceChampions": {c: p["picks"][c]["conf"] for c in app.conferences()},
                "superBowlChampion": p["picks"]["superBowl"]}}


def standings():
    return {"children": [{"abbreviation": c, "standings": {"season": app.NBA["season"],
            "entries": [{"team": {"displayName": team}, "stats": [
                {"name": "wins", "value": 41}, {"name": "losses", "value": 41},
                {"name": "playoffSeed", "value": i + 1}]} for i, team in enumerate(teams)]}}
            for c, teams in app.NBA["teams"].items()]}


class NbaTests(unittest.TestCase):
    def setUp(self):
        self.token = app.SPORT.set("nba")

    def tearDown(self):
        app.SPORT.reset(self.token)

    def test_perfect_classic_and_frozen_upset_edge(self):
        result = app.score_prediction(prediction(), final_results())
        self.assertEqual(result["total"], 284)
        self.assertEqual(result["maximum"], 284)
        weighted = app.score_prediction(prediction(), final_results(), "vegas")
        self.assertGreater(weighted["total"], 0)
        self.assertEqual(weighted["total"], weighted["possible"])
        self.assertEqual(weighted["breakdown"]["divisionWinners"]["points"], 0)

    def test_duplicate_wrong_conference_and_impossible_advancement_rejected(self):
        app.validate_prediction("user", prediction())
        for mutate in (
            lambda p: p["seeds"]["East"].__setitem__(7, p["seeds"]["East"][0]),
            lambda p: p["seeds"]["East"].__setitem__(7, p["seeds"]["West"][0]),
            lambda p: p["picks"]["East"].__setitem__("div-1", p["seeds"]["East"][1]),
            lambda p: p["picks"].__setitem__("superBowl", "Boston Celtics"),
        ):
            candidate = prediction()
            mutate(candidate)
            with self.assertRaises(ValueError):
                app.validate_prediction("user", candidate)

    def test_separate_storage_and_public_leaderboards(self):
        nba = app.validate_prediction("user", prediction())
        self.assertEqual(nba["profileKey"], "nba#2027#user")
        nfl = {"profileKey": "user", "picks": {"superBowl": "Buffalo Bills"}}
        profiles = Mock()
        profiles.scan.return_value = {"Items": [{"recordType": "profile", "profileKey": "user#user", "leaderboardName": "Player"}]}
        predictions = Mock()
        predictions.scan.return_value = {"Items": [nfl, nba]}
        with patch.object(app, "profiles_table", return_value=profiles), patch.object(app, "predictions_table", return_value=predictions), patch.object(app, "load_season_results", return_value=final_results()):
            entries = app.build_leaderboard({"user"})["entries"]
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["total"], 284)
            app.delete_prediction("user")
            predictions.delete_item.assert_called_once_with(Key={"profileKey": "nba#2027#user"})

    def test_public_bracket_keeps_eight_seeds_and_all_series(self):
        with patch.object(app, "load_season_results", return_value=final_results()):
            public = app.public_bracket({"leaderboardName": "Player"}, prediction())
        self.assertEqual(len(public["seeds"]["East"]), 8)
        self.assertEqual(len(public["picks"]["West"]), 7)
        self.assertNotIn("profileKey", public)

    def test_nba_lock_boundary_and_request_context_reset(self):
        from datetime import datetime
        deadline = datetime.fromisoformat(app.NBA["lockAt"].replace("Z", "+00:00")).timestamp()
        self.assertFalse(app.prediction_window(deadline - 1)["locked"])
        self.assertTrue(app.prediction_window(deadline)["locked"])
        token = app.SPORT.set("nfl")
        try:
            event = {"rawPath": "/api/prediction-window", "requestContext": {"http": {"method": "GET"}}, "queryStringParameters": {"sport": "nba"}}
            self.assertEqual(json.loads(app.handler(event, None)["body"])["lockAt"], app.NBA["lockAt"])
            self.assertEqual(app.SPORT.get(), "nfl")
            event["queryStringParameters"]["sport"] = "unknown"
            self.assertEqual(app.handler(event, None)["statusCode"], 400)
        finally:
            app.SPORT.reset(token)

    def test_live_odds_requires_all_30_teams_and_correct_season(self):
        html = "2026-27<table>" + "".join(f"<tr><td>{team}</td><td>{value}</td></tr>" for team, value in app.NBA["totals"].items()) + "</table>"
        self.assertEqual(app.parse_nba_win_totals(html), app.NBA["totals"])
        with self.assertRaises(ValueError):
            app.parse_nba_win_totals(html.replace("2026-27", "2025-26"))
        with self.assertRaises(ValueError):
            app.parse_nba_win_totals("2026-27<table></table>")

    def test_frontend_snapshot_matches_backend(self):
        source = (Path(__file__).parent.parent / "frontend" / "sports.js").read_text(encoding="utf-8")
        blob = source.split("const NBA_SEASON = ")[1].split(";\nconst NBA_LOGOS")[0]
        self.assertEqual(json.loads(blob), app.NBA)

    def test_save_reopen_delete_and_server_lock_preserve_nfl(self):
        items = {"user": {"profileKey": "user", "picks": {"superBowl": "Buffalo Bills"}}}
        table = Mock()
        table.get_item.side_effect = lambda Key: {"Item": items.get(Key["profileKey"])}
        table.put_item.side_effect = lambda Item: items.__setitem__(Item["profileKey"], Item)
        table.delete_item.side_effect = lambda Key: items.pop(Key["profileKey"], None)
        event = {"rawPath": "/api/prediction", "queryStringParameters": {"sport": "nba"},
                 "requestContext": {"http": {"method": "PUT"}, "authorizer": {"jwt": {"claims": {"sub": "user"}}}},
                 "body": json.dumps({**prediction(), "profileKey": "someone-else", "ownerId": "someone-else"})}
        with patch.object(app, "predictions_table", return_value=table), patch.object(app, "get_profile", return_value={"leaderboardName": "Player"}), patch.object(app, "load_season_results", return_value=final_results()), patch.object(app.time, "time", return_value=0):
            self.assertEqual(app.handler(event, None)["statusCode"], 200)
            self.assertEqual(items["nba#2027#user"]["ownerId"], "user")
            event["requestContext"]["http"]["method"] = "GET"
            saved = json.loads(app.handler(event, None)["body"])
            self.assertEqual(saved["seeds"], prediction()["seeds"])
            event["requestContext"]["http"]["method"] = "PUT"
            with patch.object(app.time, "time", return_value=2000000000):
                self.assertEqual(app.handler(event, None)["statusCode"], 423)
            event["requestContext"]["http"]["method"] = "DELETE"
            self.assertEqual(app.handler(event, None)["statusCode"], 200)
            self.assertEqual(list(items), ["user"])

    def test_account_deletion_cleans_both_sports_and_past_nba_seasons(self):
        table = Mock()
        table.scan.return_value = {"Items": [
            {"profileKey": "user"}, {"profileKey": "nba#2027#user", "ownerId": "user"},
            {"profileKey": "nba#2026#user", "ownerId": "user"}, {"profileKey": "other"}]}
        event = {"rawPath": "/api/profile", "queryStringParameters": {"sport": "nba"},
                 "requestContext": {"http": {"method": "DELETE"}, "authorizer": {"jwt": {"claims": {"sub": "user"}}}}}
        with patch.object(app, "predictions_table", return_value=table), patch.object(app, "delete_group_memberships"), patch.object(app, "delete_profile"):
            self.assertEqual(app.handler(event, None)["statusCode"], 200)
        self.assertEqual({call.kwargs["Key"]["profileKey"] for call in table.delete_item.call_args_list}, {"user", "nba#2027#user", "nba#2026#user"})


class NbaResultsTests(unittest.TestCase):
    def test_dispatcher_runs_both_sports_even_when_one_fails(self):
        dispatcher = load("results_dispatcher")
        nfl, nba = Mock(), Mock()
        nfl.handler.side_effect = ValueError("provider unavailable")
        nba.handler.return_value = {"skipped": True}
        with patch.dict(sys.modules, {"results_updater": nfl, "nba_results_updater": nba}):
            with self.assertRaises(RuntimeError), self.assertLogs(level="ERROR"):
                dispatcher.handler({"source": "aws.events"}, None)
            nba.handler.assert_called_once()
            nfl.handler.reset_mock()
            nba.handler.reset_mock()
            dispatcher.handler({"sport": "nba"}, None)
            nba.handler.assert_called_once()
            nfl.handler.assert_not_called()

    def test_series_requires_four_wins_and_post_playin_seeds(self):
        teams = app.NBA["teams"]["East"]
        game = {"round": "wildCard", "teams": [teams[0], teams[9]], "winner": teams[0]}
        games = {str(i): game for i in range(3)}
        result = updater.build_results({}, games, standings(), "now")
        self.assertEqual(result["roundWinners"]["wildCard"], [])
        self.assertEqual(result["seeds"]["East"][7], teams[9])
        result = updater.build_results(result, {"four": game}, standings(), "later")
        self.assertEqual(result["roundWinners"]["wildCard"], [teams[0]])
        self.assertEqual(len(result["processedGames"]), 4)
        self.assertEqual(updater.build_results(result, {"four": game}, standings(), "again")["roundWinners"], result["roundWinners"])

    def test_unfinished_regular_season_never_scores_projected_seeds(self):
        data = standings()
        data["children"][0]["standings"]["entries"][0]["stats"][0]["value"] = 40
        self.assertIsNone(updater.final_regular_seeds(data))

    def test_series_results_survive_empty_provider_day(self):
        game = {"round": "wildCard", "teams": app.NBA["teams"]["East"][3:5], "winner": app.NBA["teams"]["East"][3]}
        current = {"processedGames": {"one": game}}
        self.assertIn("one", updater.build_results(current, {}, standings(), "now")["processedGames"])

    def test_invalid_feed_is_rejected(self):
        with self.assertRaises(ValueError):
            updater.parse_games({})
        self.assertEqual(updater.parse_games({"events": [{"season": {"year": 2026, "type": 3}}]}), {})


if __name__ == "__main__":
    unittest.main()
