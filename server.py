"""Serve the NFL predictor and refresh projected win totals from DraftKings."""

from __future__ import annotations

import json
import re
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8000
DRAFTKINGS_URL = "https://sportsbook.draftkings.com/page/nfl-futures"
CACHE_FILE = ROOT / ".win-totals-cache.json"

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


def fetch_draftkings_totals() -> dict[str, float]:
    request = Request(
        DRAFTKINGS_URL,
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
    for team in FALLBACK_TOTALS:
        escaped_team = re.escape(team)
        patterns = [
            rf"{escaped_team}.{{0,450}}?(?:Regular Season Wins|Team Wins|Wins).{{0,160}}?(\d{{1,2}}\.5)",
            rf"(?:Regular Season Wins|Team Wins|Wins).{{0,160}}?{escaped_team}.{{0,250}}?(\d{{1,2}}\.5)",
        ]
        for pattern in patterns:
            match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
            if match:
                value = float(match.group(1))
                if 2.5 <= value <= 14.5:
                    totals[team] = value
                    break

    if len(totals) < 32:
        raise ValueError(
            f"DraftKings returned only {len(totals)} readable team win totals"
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
        totals = fetch_draftkings_totals()
        payload = {
            "totals": totals,
            "source": "DraftKings Sportsbook NFL Futures",
            "sourceUrl": DRAFTKINGS_URL,
            "status": "live",
            "updatedAt": int(time.time()),
        }
        CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return payload
    except Exception as error:
        cached = load_cached_totals()
        if cached:
            cached["status"] = "cached"
            cached["message"] = str(error)
            return cached
        return {
            "totals": FALLBACK_TOTALS,
            "source": "bundled 2026 FanDuel/DraftKings market snapshot",
            "sourceUrl": DRAFTKINGS_URL,
            "status": "fallback",
            "updatedAt": None,
            "message": str(error),
        }


class PredictorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/win-totals":
            payload = json.dumps(get_win_totals()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


if __name__ == "__main__":
    print(f"Road to the Bowl: http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), PredictorHandler).serve_forever()
