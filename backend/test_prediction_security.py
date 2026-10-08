"""Untrusted API submissions must never persist invalid bracket state."""
import copy
import importlib.util
import itertools
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from test_auth import event, valid_prediction
from test_nba import prediction as nba_prediction

spec = importlib.util.spec_from_file_location("bracket_security_app", Path(__file__).parent / "lambda/app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class PredictionSecurityTests(unittest.TestCase):
    def submit(self, candidate, sport="nfl", raw=False):
        request = event("PUT", body=candidate, sport=sport)
        if raw:
            request["body"] = candidate
        table = Mock()
        with patch.object(app, "predictions_table", return_value=table), \
                patch.object(app, "get_profile", return_value={"leaderboardName": "Player"}), \
                patch.object(app, "prediction_window", return_value={"locked": False}), \
                patch.object(app, "score_prediction", return_value={}):
            result = app.handler(request, None)
        return result, table

    def test_legitimate_nfl_and_nba_save_and_reopen(self):
        for sport, candidate in (("nfl", valid_prediction()), ("nba", nba_prediction())):
            with self.subTest(sport=sport):
                result, table = self.submit(candidate, sport)
                self.assertEqual(result["statusCode"], 200, result)
                saved = table.put_item.call_args.kwargs["Item"]
                for key, value in candidate.items():
                    self.assertEqual(saved[key], value)
                with patch.object(app, "predictions_table", return_value=table), \
                        patch.object(app, "score_prediction", return_value={}):
                    table.get_item.return_value = {"Item": saved}
                    reopened = app.handler(event("GET", sport=sport), None)
                self.assertEqual(reopened["statusCode"], 200)
                self.assertEqual(json.loads(reopened["body"])["picks"], candidate["picks"])

    def test_new_nba_bracket_uses_actual_frontend_division_initializer(self):
        # Exercise the frontend's wire shape, not only the canonical saved record.
        script = r'''
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("frontend/teams.js", "utf8");
const context = vm.createContext({ IS_NBA: true });
vm.runInContext(source.slice(source.indexOf("function createEmptyDivisionWinners()"),
  source.indexOf("function getTeamNickname(")), context);
process.stdout.write(JSON.stringify(context.createEmptyDivisionWinners()));
'''
        result = subprocess.run(["node", "-e", script], cwd=Path(__file__).resolve().parent.parent,
                                capture_output=True, text=True, timeout=10, check=True)
        candidate = nba_prediction()
        candidate["divisionWinners"] = json.loads(result.stdout)
        response, table = self.submit(candidate, "nba")
        self.assertEqual(response["statusCode"], 200, response)
        self.assertEqual(table.put_item.call_args.kwargs["Item"]["divisionWinners"], {})
        for invalid in ({"East": {}}, {"East": {}, "West": {}, "extra": {}},
                        {"East": {"North": "Boston Celtics"}, "West": {}},
                        {"East": [], "West": {}}):
            candidate["divisionWinners"] = invalid
            response, table = self.submit(candidate, "nba")
            self.assertEqual(response["statusCode"], 400)
            table.put_item.assert_not_called()

    def test_manipulated_nfl_requests_return_400_without_writing(self):
        mutations = {
            "fake team": lambda p: p["seeds"]["AFC"].__setitem__(6, "Fake Team"),
            "duplicate": lambda p: p["seeds"]["AFC"].__setitem__(6, p["seeds"]["AFC"][0]),
            "conference mismatch": lambda p: p["seeds"]["AFC"].__setitem__(6, p["seeds"]["NFC"][6]),
            "wrong division winner": lambda p: p["divisionWinners"]["AFC"].__setitem__("North", "Buffalo Bills"),
            "unseeded division winner": lambda p: p["divisionWinners"]["AFC"].__setitem__("North", "Pittsburgh Steelers"),
            "wildcard in top four": lambda p: p["seeds"]["AFC"].__setitem__(slice(3, 5), list(reversed(p["seeds"]["AFC"][3:5]))),
            "winner outside game": lambda p: p["picks"]["AFC"].__setitem__("wc-2-7", p["seeds"]["AFC"][2]),
            "bye in wildcard": lambda p: p["picks"]["AFC"].__setitem__("wc-2-7", p["seeds"]["AFC"][0]),
            "skipping wildcard": lambda p: p["picks"]["AFC"].__setitem__("div-1", p["seeds"]["AFC"][6]),
            "wrong reseeding": lambda p: p["picks"]["AFC"].__setitem__("div-1", p["seeds"]["AFC"][1]),
            "first seed in second divisional": lambda p: p["picks"]["AFC"].__setitem__("div-2", p["seeds"]["AFC"][0]),
            "invalid conference champion": lambda p: p["picks"]["AFC"].__setitem__("conf", p["seeds"]["AFC"][3]),
            "wrong conference champion": lambda p: p["picks"]["AFC"].__setitem__("conf", p["seeds"]["NFC"][0]),
            "invalid super bowl champion": lambda p: p["picks"].__setitem__("superBowl", p["seeds"]["AFC"][1]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                candidate = valid_prediction()
                mutate(candidate)
                result, table = self.submit(candidate)
                self.assertEqual(result["statusCode"], 400, result)
                table.put_item.assert_not_called()

    def test_malformed_and_unexpected_properties_at_every_level(self):
        paths = [(), ("seeds",), ("seeds", "AFC"), ("picks",), ("picks", "AFC"),
                 ("picks", "superBowl"), ("picks", "AFC", "conf"),
                 ("divisionWinners",), ("divisionWinners", "AFC"),
                 ("divisionWinners", "AFC", "North"), ("bracketBuilt",)]
        for path, value in itertools.product(paths, [None, [], {}, 1, False, "<script>alert(1)</script>"]):
            with self.subTest(path=path, value=value):
                candidate = valid_prediction()
                parent = candidate
                for key in path[:-1]:
                    parent = parent[key]
                if path:
                    parent[path[-1]] = value
                else:
                    candidate = value
                result, table = self.submit(candidate)
                self.assertEqual(result["statusCode"], 400, result)
                table.put_item.assert_not_called()
        for path in [(), ("seeds",), ("picks",), ("picks", "AFC"),
                     ("divisionWinners",), ("divisionWinners", "AFC")]:
            for operation in ("extra", "missing"):
                candidate = valid_prediction()
                node = candidate
                for key in path:
                    node = node[key]
                if operation == "extra":
                    node["unexpected"] = "<img src=x onerror=alert(1)>"
                else:
                    del node[next(iter(node))]
                result, table = self.submit(candidate)
                self.assertEqual(result["statusCode"], 400, (path, operation, result))
                table.put_item.assert_not_called()

    def test_team_values_and_seed_shapes_are_strict(self):
        for value in ["", "<img src=x onerror=alert(1)>", "<script>steal()</script>",
                      "Buffalo Bills<script>", {}, [], None, True, 7]:
            candidate = valid_prediction()
            candidate["seeds"]["AFC"][6] = value
            result, table = self.submit(candidate)
            self.assertEqual(result["statusCode"], 400)
            table.put_item.assert_not_called()
        for length in (0, 6, 8):
            candidate = valid_prediction()
            candidate["seeds"]["AFC"] = (candidate["seeds"]["AFC"] * 2)[:length]
            self.assertEqual(self.submit(candidate)[0]["statusCode"], 400)
        for body in ("{", "null", "[]", '"bracket"',
                     '{"divisionWinners":' + '[' * 2000 + ']' * 2000 + '}'):
            result, table = self.submit(body, raw=True)
            self.assertEqual(result["statusCode"], 400)
            table.put_item.assert_not_called()

    def test_all_wildcard_outcomes_reseed_and_advance_legitimately(self):
        for conference in ("AFC", "NFC"):
            for wc_bits in itertools.product((0, 1), repeat=3):
                base = valid_prediction()
                selected = base["seeds"][conference]
                choices = base["picks"][conference]
                advanced = [selected[0]]
                for game, participants, bit in zip(("wc-2-7", "wc-3-6", "wc-4-5"),
                                                   ((1, 6), (2, 5), (3, 4)), wc_bits):
                    choices[game] = selected[participants[bit]]
                    advanced.append(choices[game])
                advanced.sort(key=selected.index)
                for div_bits in itertools.product((0, 1), repeat=2):
                    for conf_bit in (0, 1):
                        candidate = copy.deepcopy(base)
                        choices = candidate["picks"][conference]
                        choices["div-1"] = (advanced[0], advanced[3])[div_bits[0]]
                        choices["div-2"] = (advanced[1], advanced[2])[div_bits[1]]
                        choices["conf"] = (choices["div-1"], choices["div-2"])[conf_bit]
                        candidate["picks"]["superBowl"] = choices["conf"]
                        with self.subTest(conference=conference, wc=wc_bits, div=div_bits, conf=conf_bit):
                            self.assertEqual(self.submit(candidate)[0]["statusCode"], 200)
