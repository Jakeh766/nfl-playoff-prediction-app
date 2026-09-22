# NBA results ingestion

`results_dispatcher.handler` runs NFL and NBA ingestion on the existing results
schedule and Lambda, using the existing constrained results-writer role. NBA
ingestion never writes NFL results. Each sport runs even if the other fails; a
failure is then surfaced for normal Lambda retry and monitoring. Manual NFL
invocations retain their existing behavior; specify `{"sport": "nba"}` to invoke
NBA ingestion alone. Deployments remain on GitHub Actions; no local AWS changes are needed.

NBA uses season-ending years: 2026–27 is `2027`. Its DynamoDB results key is
`100000 + season` (currently `102027`), preserving the existing numeric table
schema. Prediction keys are `nba#2027#<authenticated user id>` with a separate
owner field. Existing NFL prediction keys and result rows retain their format.
The API selects NBA with `?sport=nba`; missing sport means NFL and unknown
sports are rejected. Shared groups expose separate standings for each sport.

The updater starts April 1 of the season-ending year. ESPN daily scoreboards
are read in batches of at most 14 days, with four concurrent requests and a
three-day overlap. `syncedThrough` allows subsequent invocations to catch up
after downtime. Scheduled games can establish published first-round pairings;
only completed games with a consistent winner and score count toward a series.
Four wins are required to award a series winner. The importer explicitly maps
ESPN `RD16`, `QTR`, `SEMI`, and `FINAL` rounds and excludes Play-In games.

Regular-season seeds 1–6 are published only after all 30 teams have completed
82 games. Seeds 7 and 8 come from the published first-round opponents of the
2 and 1 seeds, respectively, so regular-season ranks 7 and 8 are never mistaken
for Play-In qualifiers. Stored games survive empty responses; known game IDs
are replaced on correction, and scores are recomputed from the retained games.
Malformed responses abort before writing. Optimistic revisions prevent a stale
invocation from overwriting a newer result. Failed invocations retain the last
successful data and use normal Lambda failure reporting.

Historical validation replayed all 84 games of the 2025 playoffs and recovered
all eight first-round winners, four semifinal winners, both conference champions,
Oklahoma City as champion, and the correct post-Play-In seeds in both conferences.

The shared scoring response retains legacy field names (`wildCard`, `divisional`,
and `superBowl`) internally; NBA screens label these First Round, Conference
Semifinals, and NBA Finals. NBA division winners are not scored.

For a new season, update `nba_season.json` and its frontend copy together,
verify the tip-off timestamp against the official NBA schedule, and freeze a
complete sourced 30-team preseason snapshot before opening predictions. Do not
change the snapshot once that season starts. Historical prediction rows are
excluded from current-season standings and removed on account deletion.

Sources: [NBA 2026–27 schedule](https://www.nba.com/news/2026-27-nba-regular-season-schedule),
[BetMGM season win totals](https://sports.betmgm.com/en/blog/nba/nba-odds-predictions-season-win-totals-bm23/).
