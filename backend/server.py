"""Serve the NFL predictor and refresh consensus NFL win totals."""

from __future__ import annotations

import json
import os
import re
import statistics
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
DATA_DIR = BACKEND_DIR / ".data"
DATA_DIR.mkdir(exist_ok=True)
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))
API_VERSION = 2
ODDS_URL = "https://www.vegasinsider.com/nfl/odds/win-totals/"
CACHE_FILE = DATA_DIR / "win-totals-cache.json"
PREDICTIONS_FILE = DATA_DIR / "predictions.json"
PREDICTIONS_LOCK = threading.RLock()

FALLBACK_TOTALS = {
    "Arizona Cardinals": 4.5, "Atlanta Falcons": 7.5,
    "Baltimore Ravens": 11.5, "Buffalo Bills": 10.5,
    "Carolina Panthers": 7.5, "Chicago Bears": 9.5,
    "Cincinnati Bengals": 8.5, "Cleveland Browns": 6.5,
    "Dallas Cowboys": 8.5, "Denver Broncos": 9.5,
    "Detroit Lions": 10.5, "Green Bay Packers": 10.5,
    "Houston Texans": 9.5, "Indianapolis Colts": 7.5,
    "Jacksonville Jaguars": 8.5, "Kansas City Chiefs": 10.5,
    "Las Vegas Raiders": 6.5, "Los Angeles Chargers": 10.5,
    "Los Angeles Rams": 11.5, "Miami Dolphins": 4.5,
    "Minnesota Vikings": 7.5, "New England Patriots": 9.5,
    "New Orleans Saints": 6.5, "New York Giants": 7.5,
    "New York Jets": 5.5, "Philadelphia Eagles": 10.5,
    "Pittsburgh Steelers": 8.5, "San Francisco 49ers": 10.5,
    "Seattle Seahawks": 11.5, "Tampa Bay Buccaneers": 8.5,
    "Tennessee Titans": 6.5, "Washington Commanders": 7.5,
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


def load_cached_totals() -> dict | None:
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if len(data.get("totals", {})) == 32:
            return data
    except (OSError, ValueError):
        return None
    return None


def get_win_totals() -> dict:
    try:
        totals = fetch_live_totals()
        payload = {
            "apiVersion": API_VERSION,
            "totals": totals,
            "source": "VegasInsider sportsbook consensus",
            "sourceUrl": ODDS_URL,
            "status": "live",
            "updatedAt": int(time.time()),
        }
        CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return payload
    except Exception as error:
        cached = load_cached_totals()
        if cached:
            cached["apiVersion"] = API_VERSION
            cached["status"] = "cached"
            cached.pop("message", None)
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


def load_predictions() -> dict:
    with PREDICTIONS_LOCK:
        try:
            data = json.loads(PREDICTIONS_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}


def save_predictions(predictions: dict) -> None:
    with PREDICTIONS_LOCK:
        PREDICTIONS_FILE.write_text(
            json.dumps(predictions, indent=2),
            encoding="utf-8",
        )


class PredictorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/win-totals":
            self.send_json(200, get_win_totals())
            return
        if path == "/api/predictions":
            predictions = sorted(
                load_predictions().values(),
                key=lambda prediction: prediction.get("savedAt", 0),
                reverse=True,
            )
            self.send_json(200, {"predictions": predictions})
            return
        if path.startswith("/api/predictions/"):
            profile_key = unquote(path.removeprefix("/api/predictions/"))
            prediction = load_predictions().get(profile_key)
            if prediction:
                self.send_json(200, prediction)
            else:
                self.send_json(404, {"message": "Prediction not found"})
            return
        super().do_GET()

    def do_PUT(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/predictions/"):
            self.send_json(404, {"message": "Not found"})
            return

        profile_key = unquote(path.removeprefix("/api/predictions/"))
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            prediction = json.loads(self.rfile.read(content_length) or b"{}")
            display_name = prediction.get("displayName", "").strip()
            if not profile_key or not 1 <= len(display_name) <= 40:
                raise ValueError("Invalid profile")
        except (TypeError, ValueError, json.JSONDecodeError):
            self.send_json(400, {"message": "Invalid prediction"})
            return

        saved = {
            "profileKey": profile_key,
            "displayName": display_name,
            "divisionWinners": prediction.get("divisionWinners", {}),
            "seeds": prediction.get("seeds", {}),
            "picks": prediction.get("picks", {}),
            "bracketBuilt": bool(prediction.get("bracketBuilt")),
            "savedAt": int(time.time() * 1000),
        }
        with PREDICTIONS_LOCK:
            predictions = load_predictions()
            predictions[profile_key] = saved
            save_predictions(predictions)
        self.send_json(200, saved)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/predictions/"):
            self.send_json(404, {"message": "Not found"})
            return

        profile_key = unquote(path.removeprefix("/api/predictions/"))
        with PREDICTIONS_LOCK:
            predictions = load_predictions()
            predictions.pop(profile_key, None)
            save_predictions(predictions)
        self.send_json(200, {"deleted": True})

    def send_json(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    print(f"Road to the Bowl: http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), PredictorHandler).serve_forever()
