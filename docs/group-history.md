# Group history

Expand **Group history** beneath a private group's season leaderboard. History
is visible only to current group members and is scoped to the selected sport.
New groups show an empty state until a season has ended and been archived.

The existing results-update EventBridge schedule also invokes the API Lambda
using its existing DynamoDB permissions. The deployment role already manages
this rule, so archiving requires no additional schedule-management permissions.
Ingestion and archiving run independently; if archiving runs before the final
results are saved, it captures them on the next scheduled invocation.
A confirmed championship winner triggers a
conditional `groupSeason` snapshot in the groups table, keyed by group, sport,
and season. Retries cannot replace an existing snapshot. Groups and memberships
created after the first observed final result's `updatedAt` are excluded. A
`historyFinal` record pins that cutoff despite later ingestion refreshes. The snapshot captures
members with saved predictions at the time the archive job runs. It therefore
should run before any season rollover; monitor the backend Lambda's errors.

Champions follow total points, then field/seeding points, then playoff points.
Exact ties share the title; zero-point seasons have no champion. Career rankings
sort by titles then total points, with equal records sharing a rank. Stable
internal member IDs combine renamed players, while the response exposes only
leaderboard names. NFL and NBA totals are never combined. Deleting a group
also removes its archives; leaving a group preserves past results.

Snapshots are immutable, including names and scores. Later results corrections
do not rewrite awarded titles automatically. Any necessary historical correction
requires a deliberate operator procedure. No historical data is backfilled for
groups created after a season ends.

## UI maintenance

Keep this feature within the existing leaderboard design: inherit DM Sans body
type, use the `--display` Oswald stack for history headings and years, and reuse
`--line`, `--link`, `--muted`, `--surface-soft`, and `--focus-outline` so light
and dark themes remain consistent. There is no separate approved visual comp.

The native `details`/`summary` disclosure belongs beneath private season
standings. Preserve keyboard operation, visible focus, and the polite live
region for content updates. Label the selected NFL or NBA scope explicitly;
only completed seasons populate champions and all-time standings.

Preserve distinct loading, failed-request, unavailable-history, and empty
states. New groups explain when their history will appear, with empty copy for
both champions and all-time standings; do not substitute sample winners or
scores. Error copy directs the member to refresh.

On mobile, champions scroll horizontally and the all-time table retains its
560px minimum width inside the focusable, labeled scrolling region. Keep every
column available: Rank, Player, Titles, Seasons, and Total points. The scoped
`.group-history .group-history-table` cell-visibility and header-padding rules
intentionally override inherited leaderboard mobile rules; preserve that
specificity when changing shared table styles. Long names wrap, and numeric
cells use tabular figures.
