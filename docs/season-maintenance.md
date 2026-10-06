# Scoring and season maintenance

The app's scoring page is the player-facing explanation. This guide records the
underlying rules and where maintainers update season data.

## Classic scoring

Both sports have a maximum of 300 points.

| Scoring item | NFL | NBA |
| --- | --- | --- |
| Correct playoff team | 5 per team | 5 per team |
| Correct division winner | 5 per division | Not scored |
| Exact #1 seed | 5 | 6 |
| Exact #2–#4 seed | 3 per team | 4 per team |
| Exact lower seed | 2 for #5–#7 | 3 for #5–#8 |
| Wild Card / First Round winner | 5 per team | 5 per team |
| Divisional / Conference Semifinal winner | 10 per team | 10 per team |
| Conference champion | 20 per team | 20 per team |
| Super Bowl / NBA Finals champion | 40 | 40 |

Playoff credit depends on a team advancing, rather than matching the exact
opponent. An incorrect earlier pick does not block credit in later rounds.

## Upset Edge scoring

Apply these multipliers to each team's Classic scoring items:

```text
NFL: Classic points × [1 + 0.10 × (8.5 − preseason win total)]
NBA: Classic points × [1 + 0.02 × (41 − preseason win total)]
```

Round half up to hundredths. The public leaderboard can switch between modes;
a private group keeps its creation-time mode. Live win projections are cached
separately and cannot change the frozen preseason scoring weights.

## Season files

| File or setting | Purpose |
| --- | --- |
| `backend/lambda/season_results.json` | NFL preseason fallback when live results are unavailable |
| `backend/lambda/scoring_odds.json` | Frozen NFL Upset Edge snapshot |
| `backend/lambda/nba_season.json` | NBA season, teams, deadline, and frozen snapshot |
| `frontend/sports.js` | Matching NBA static-preview configuration, checked by a regression test |
| `terraform/envs/dev/terraform.tfvars` and `terraform/envs/prod/terraform.tfvars` | NFL `prediction_lock_at` settings for each environment |

The repository currently configures the 2026 NFL season and the 2026–27 NBA
season. NBA identifies that season by its ending year, `2027`. Its configured
prediction deadline is October 20, 2026 at 19:00 UTC. This is the checked-in
configuration; the live `/api/prediction-window` response controls the app's
countdown and save restrictions. Dev intentionally leaves NFL predictions
unlocked for testing.

## Results and annual updates

Normal results come from scheduled ingestion into DynamoDB. Update the bundled
NFL fallback with published facts only; do not treat it as the primary live
results store. Read the [NFL ingestion guide](results-ingestion.md) and
[NBA ingestion guide](nba-results-ingestion.md) before changing ingestion or
applying a manual correction.

When preparing a new season:

1. Update the season configuration and preseason fallback.
2. Create a complete, sourced preseason win-total snapshot. Keep it frozen once
   that season starts.
3. Update the NFL deadline in both environment configurations. Update NBA's
   deadline and preview copy together, after verifying the official schedule.
4. Run backend and frontend checks, then validate Terraform if settings changed.
5. Deploy and verify the development app before explicitly promoting production.

Do not discard saved group history when rolling over a season. Its snapshots
use the original season and scoring mode; see [group history](group-history.md).
