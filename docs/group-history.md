# Group history

Open **Groups**, select a group, then choose **History**. History
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

Sport edits record `sportEligibility` activation intervals in milliseconds.
An archive includes a sport only when it was enabled at the pinned final cutoff;
adding or re-enabling a sport later cannot inherit a finished season. Removing a
sport after the cutoff does not erase that season's eligibility or existing
snapshots. Legacy groups without timing metadata retain their recorded sports
from `createdAt`; their first edit persists that baseline. Activation times from
edits made before this change cannot be recovered from the old schema.

Live rankings use the same total/field/playoff comparison as champions. Equal
results share competition ranks (`1, 1, 3`); zero scores and missing predictions
remain unranked. Standings shows only members with a saved prediction for the
selected sport. Members shows the full roster, including **No prediction**,
**You**, and **Commissioner** labels; the header also identifies the commissioner.

## Data access and commissioner controls

Three additive indexes on existing attributes replace Groups scans:
`user-groups` (`userId`, `groupKey`) finds a user's memberships;
`group-records` (`groupId`, `groupKey`) finds members and sport history;
`record-types` (`recordType`, `groupKey`) enumerates groups for scheduled archives.
DynamoDB backfills existing records. The pinned AWS provider creates indexes
sequentially and waits for them to become active; the API depends on the updated
table. [DynamoDB backfill behavior](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.OnlineOps.html)
and the [pinned provider's sequential index updates](https://github.com/hashicorp/terraform-provider-aws/blob/v6.62.0/internal/service/dynamodb/table.go)
support this rollout. Table identity, primary key, existing records, and protection settings
remain unchanged. Review the dev Actions plan for in-place index additions.
No local AWS changes or production deployment are needed.

Group/profile/prediction reads use consistent BatchGet requests of at most 100
unique keys, with bounded backoff for unprocessed keys. Queries paginate. GSI
membership candidates are rechecked against the base table because indexes are
eventually consistent; newly joined members may take a short time to appear.

Commissioners can remove another member from **Members** or regenerate the invite
with `POST /api/groups/{id}/invite`. The UI has no separate revoke action; the
legacy `DELETE` endpoint remains commissioner-only for older clients.
Removal uses `DELETE /api/groups/{id}/members/{userId}` and an atomic commissioner
check plus a `removedMembership` tombstone. Joins atomically check the group and
the invite/password against a new membership write. Removed accounts cannot
rejoin using any invite or the password; there is no unblock control currently.
Voluntary departures can still rejoin. Revoked invites remain disabled when
read, including by older clients, until the commissioner regenerates one.
Existing memberships and archived results survive invite changes and removal.
The dev deployment seeder skips existing demo groups and their membership
records, so repeated deployments preserve commissioner edits, kicked members,
and voluntary departures. It continues initializing new demo groups normally.

Competition settings use the existing `PATCH /api/groups/{id}` route. Only the
current commissioner may change sports, set a new password, or change the selected
sport's `scoringOption`. Passwords are salted and hashed; public responses never
return the password, salt, or hash. A password change invalidates the old password
without removing existing members or rotating invites. Scoring is locked at that
sport's real prediction deadline, even when dev NFL picks are reopened for testing.
The server returns `scoringLock` with group standings for the UI's disabled state.

Additive `scoringOptions` stores sport-specific overrides. Legacy groups continue
using their shared `scoringOption` as the fallback. Changing NBA scoring cannot
change NFL scoring, and immutable season snapshots retain their captured mode.
Writes check the current commissioner and previous sports/scoring values so
concurrent edits or commissioner transfers cannot overwrite another change.
Regular members can view competition info, share the current invite, and leave.
Commissioners must transfer to another current member before leaving; only the
commissioner can delete the group.

**Groups** in primary navigation and **View groups** on the homepage open
`/groups` directly, retaining the NBA query parameter when selected. Old
`/leaderboard#groups` links redirect to this page. The public leaderboard remains
on `/leaderboard` and does not load private memberships.
Signed-out visitors see a sign-in prompt and can start the existing create/join
authentication flows. Commissioner identity appears in standings and Members.

The directory merges the existing NFL and NBA membership responses by group ID.
Cards show sports, scoring mode, commissioner role, member count, and personal
rank for the selected sport (or the group's supported sport). Up to three board
reads run concurrently to fill in counts and ranks using the existing API;
failed summaries keep their cards visible with a retry prompt. No new backend
endpoint or stored group field is required.

Group details use `?group=<id>` and optional `&view=members|history|settings`.
The default view is Standings. Browser Back restores the directory, and tabs
support arrow keys, Home, and End. Closing or signing out of a group prevents
late requests from restoring private content. Leaving or deleting returns to
the directory. Settings retains invites, sport edits, departure/commissioner
transfer, and confirmed deletion; member removal stays in Members.

## UI maintenance

Keep this feature consistent with the site: inherit DM Sans body
type, use the `--display` Oswald stack for history headings and years, and reuse
`--line`, `--link`, `--muted`, `--surface-soft`, and `--focus-outline` so light
and dark themes remain consistent. There is no separate approved visual comp.

History lives in its own tab beside Standings, Members, and Settings.
Preserve tab keyboard operation, visible focus, and the polite live
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
