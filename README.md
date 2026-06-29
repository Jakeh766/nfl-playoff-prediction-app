# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Enter a name or reopen an existing profile.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Save, reopen, update, and delete predictions by name.

In the AWS deployment, predictions are stored in DynamoDB and are available
across devices. The included local server stores development predictions in an
ignored `backend/.data` directory. It also refreshes projected season win totals
whenever the app loads, reading available sportsbook lines from VegasInsider
and using the median as a consensus projection for each team.

## Run locally

Run the included server:

```powershell
python backend/server.py
```

Then visit `http://localhost:8000`.

After updating `backend/server.py`, stop any copy already running with `Ctrl+C`, start it
again, and refresh the browser. A running Python process does not reload changed
server code automatically.

If the live table cannot be reached, the server uses the most recent successful
cache, then a bundled 2026 market snapshot as a final fallback. The app labels
which source is active.

## Repository layout

```text
frontend/          Browser application
backend/           Local development server and Lambda handler
terraform/         AWS infrastructure, state, and deployment guide
README.md          Project overview and local setup
```

See `terraform/README.md` for AWS deployment instructions.
