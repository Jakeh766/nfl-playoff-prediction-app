# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Enter a name or reopen an existing profile.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Save, reopen, update, and delete predictions by name.

Predictions are stored in the browser's `localStorage`. The included local server
also refreshes projected season win totals from DraftKings whenever the app loads.

## Run locally

Run the included server:

```powershell
python server.py
```

Then visit `http://localhost:8000`.

If the sportsbook withholds its market because of location or login requirements,
the server uses the most recent successful cache, then a bundled 2026 market
snapshot as a final fallback. The app labels which source is active.
