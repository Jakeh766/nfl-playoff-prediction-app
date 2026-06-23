# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Enter a name or reopen an existing profile.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Save, reopen, update, and delete predictions by name.

Predictions are stored in the browser's `localStorage`. The included local server
also refreshes projected season win totals whenever the app loads. It reads all
available sportsbook lines from VegasInsider and uses the median as a consensus
projection for each team.

## Run locally

Run the included server:

```powershell
python server.py
```

Then visit `http://localhost:8000`.

After updating `server.py`, stop any copy already running with `Ctrl+C`, start it
again, and refresh the browser. A running Python process does not reload changed
server code automatically.

If the live table cannot be reached, the server uses the most recent successful
cache, then a bundled 2026 market snapshot as a final fallback. The app labels
which source is active.
