# 2026 NFL results ingestion

## Architecture

The 2026 contest reads scoring facts from one item in the environment's
`*-season-results` DynamoDB table. The API Lambda performs a consistent read of
that item whenever it scores a prediction or builds a leaderboard; the bundled
`season_results.json` is only a safe preseason fallback if the item does not yet
exist or DynamoDB is temporarily unavailable.

An EventBridge scheduled rule invokes the dedicated results-updater Lambda every
Tuesday at 16:00 UTC (10:00 a.m. Central Standard Time). The updater exits before
calling ESPN until December 1, 2026, the Tuesday after the final Week 12 game.
It also exits after a Super Bowl champion is stored. The updater fetches ESPN's
season scoreboard, accepts only events for which `status.type.completed` is
exactly `true`, normalizes every team name, and merges those games into the
stored item by ESPN event ID. On each active weekly run it also fetches ESPN's
conference standings and reads the explicit NFL `clincher` marker. An `x`
playoff-berth or `y` Wild Card clinch settles playoff-team points, a `z` division
clinch settles both the playoff team and division winner, and `*` settles those
categories plus the exact No. 1 seed because it denotes the conference's lone
first-round bye. After all 272 scheduled regular-season games are final, all 14
seeds settle.

The current `playoffseed` values alone never settle points. ESPN does not expose
a separate clincher marker for exact seeds 2–7, so the updater proves those only
when the clinched teams' minimum and maximum possible final records are strictly
separated from every possible competing division winner or Wild Card. If any
possible records tie or overlap, the slot remains unsettled rather than trying to
reproduce the NFL's multi-level tiebreakers from a standings snapshot. All slots
settle after the full regular season is final. An IAM-only manual override remains
available for an officially confirmed seed that depends on a tiebreaker. Previously
stored clinches are merged monotonically and cannot disappear merely because a
later provider response omits a marker.

The durable item contains:

- season, human-readable status, `updatedAt`, and `lastSuccessfulSync`;
- AFC/NFC clinched playoff teams, division winners, and settled exact seeds;
- Wild Card, Divisional, conference, and Super Bowl winners;
- source URLs and provider metadata;
- normalized final games keyed by provider event ID, used for idempotency and
  later provider corrections;
- optional IAM-only manual overrides.

Provider failures and malformed responses fail the Lambda invocation before any
write. A partial but valid response is merged with, rather than substituted for,
known final games. If ESPN later corrects a final game's score, its stable event
ID lets the updater replace that game's winner and rebuild the affected round
without duplicate credit.

## Data source and limitations

The provider adapter uses ESPN's public site JSON endpoints:

- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- `https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings`

They are free and require no secret or API key. The scoreboard includes an
explicit final-state flag and identifies postseason weeks 1–4 as Wild Card,
Divisional, conference championship, and Super Bowl. The standings response
contains ESPN's explicit clincher markers and its ordered playoff seeds.

These are public ESPN site endpoints, not a contracted data product: ESPN does
not publish an availability SLA or compatibility guarantee. The adapter is
isolated in `backend/lambda/results_updater.py` so it can be replaced without
touching scoring. Durable merging and the manual override below mitigate an
outage or schema change, but a long outage can delay new points.

## Frozen Upset Edge inputs

The updater never reads or writes `scoring_odds.json`. Upset Edge continues to
load that bundled 2026 preseason snapshot inside `score_vegas_prediction()`.
Only actual settled results come from DynamoDB. Tests hash the snapshot before
and after an updater run and verify that weighted scoring is unchanged.

## Manual runs and emergency corrections

There is no HTTP mutation route. Manual actions require AWS IAM permission to
invoke the updater Lambda. Get its environment-specific name with:

```powershell
$functionName = terraform -chdir=terraform/envs/dev output -raw results_updater_function
```

Run a normal provider refresh:

```powershell
aws lambda invoke --function-name $functionName --cli-binary-format raw-in-base64-out --payload '{}' results-update-response.json
```

Apply a validated emergency correction (this example replaces the Super Bowl
champion):

```powershell
$payload = '{"manualOverride":{"roundWinners":{"superBowlChampion":"Buffalo Bills"}},"reason":"ESPN event was corrected"}'
aws lambda invoke --function-name $functionName --cli-binary-format raw-in-base64-out --payload $payload results-override-response.json
```

The same payload shape can override `playoffTeams`, `divisionWinners`, `seeds`,
or any field under `roundWinners`. Overrides are sparse and remain in force
across scheduled provider refreshes. Team names and conference/division
relationships are validated before the write. A partially settled exact-seed
list uses empty strings for unknown earlier slots; for example, an officially
locked NFC No. 5 can be represented as
`{"seeds":{"NFC":["","","","","Minnesota Vikings"]}}`.

After ESPN is correct again, clear all manual overrides and restore the last
provider-derived facts:

```powershell
aws lambda invoke --function-name $functionName --cli-binary-format raw-in-base64-out --payload '{"clearManualOverride":true}' results-clear-response.json
```

Inspect the response file and the updater's CloudWatch log stream after any
manual action. Do not edit `scoring_odds.json` as part of a results correction.

## Resources and cost

Terraform adds one on-demand DynamoDB table with point-in-time recovery when
stateful protection is enabled, one 256 MB Lambda, one execution role/policy,
and one EventBridge scheduled rule/target. One scheduled update per week is
about four Lambda invocations and DynamoDB writes per month during the scoring
window. At this scale the incremental
cost should normally round to $0 under the standard Lambda/EventBridge free
tiers, with only negligible DynamoDB request/storage and CloudWatch Logs usage
if account-wide free allowances are already exhausted. Always use the current
AWS pricing pages for billing decisions.

The bootstrap deployment policy must be applied once before the first dev
app-stack deployment because the dev GitHub Actions role needs permission for
the new Lambda, IAM role, EventBridge rule, and results table. This does not
deploy the app or modify NFL results by itself. The analogous production deploy
permissions must be deliberately added and bootstrapped later as part of an
explicit production release; this change does not grant or deploy them.
