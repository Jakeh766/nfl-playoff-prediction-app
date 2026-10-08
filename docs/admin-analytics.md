# Admin analytics

Open `/admin/analytics` in either environment with an existing Cognito user in
that environment's `admin` group. After explicitly approved production promotion,
production is at `https://predictplayoffs.com/admin/analytics`.
The unindexed static shell contains no reports, credentials or public tracking.
Every report requires API Gateway-verified Cognito claims and server-side admin
authorization. Authentication session format and storage are unchanged.

## Four sections

| Section | Source and coverage | Reports |
|---|---|---|
| Traffic | GoatCounter public pages in the signed-in environment; fixed production labels exclude dev traffic | Distinct visitors/sessions, raw pageviews, pageviews by page, daily sessions/pageviews, estimated session duration |
| PredictPlayoffs activity | The environment's AWS product events; dev also has active-time counters | Sign-ins, accounts created/deleted, brackets created/completed/saved by NFL/NBA type, groups created, direct joins and invite joins; each by day and selected-range total. Active time by day, page and sport is unavailable in production |
| Seasons | The environment's retained DynamoDB brackets and group competition records | Saved brackets, competing groups, unique people competing, group entries, average competitors per group and largest group, for each NFL/NBA season |
| Google Search | Separately configured Search Console property; production queries only production hosts | Clicks, impressions, CTR, average position, daily history, top query/page/country/device rows |

The default is 28 completed days. Today (UTC), 7/28/90 completed days and custom
ranges are available; the server accepts up to 93 inclusive days within the last
year. Traffic/activity dates are UTC; Search Console uses Pacific dates and final
web-search data, which can lag several days. Search Console measures the connected
configured property, not the dev CloudFront hostname. Production accepts
`sc-domain:predictplayoffs.com` or `https://predictplayoffs.com/`; every production
query, including totals, filters pages to HTTPS `predictplayoffs.com` and
`www.predictplayoffs.com`, excluding development or other subdomains.

Use the Traffic, Activity, Seasons, and Google Search tabs to switch sections without
reloading reports. Activity totals are grouped by accounts/access, brackets, and
groups. The Google Search breakdown selector switches among query, page, country,
and device tables.

The **Seasons** tab covers all retained seasons, independently of the date filter.
NFL seasons use the regular-season start year; NBA seasons display both years
(for example, 2026–27). A competing group has at least one member with a saved
bracket for that sport and season. People competing counts unique members with
brackets, including commissioners; group entries counts each person once per
group. Average and largest group sizes use these competitors, excluding members
without brackets. Empty groups do not compete. Completed seasons use archived
competition entries rather than today's memberships. Both-sport groups count
separately for NFL and NBA. Missing historical bracket totals show unavailable.

Saved bracket totals count retained records, excluding unsaved builds and deleted
brackets; they cannot reconstruct every bracket ever created. Legacy NFL records
without season metadata belong to the configured NFL season. New saves record
their sport and season explicitly. Historical competitions exist only where
archives were retained. The report uses two paginated, projected table scans with
a shared ten-second time budget and a 100-page limit per table; incomplete scans fail instead of returning partial
totals. The admin runtime policy grants `dynamodb:Scan` on only that environment's groups table; predictions already have Scan permission. Its private
15-minute cache is shared across date selections. No names, account IDs, group IDs,
passwords, invite codes or picks are included in the report.

Metric selectors show the full daily range; cumulative graph views are not shown.
Hover or tap a graph for its nearest day's exact value. Focus a graph
and use Left/Right, Home/End, or Escape to explore or dismiss the readout with a
keyboard. The selected section and metric survive date updates only in
memory, without analytics storage or extra provider calls. Pageviews by page use a
pie chart with exact counts and percentages in its keyboard-accessible legend;
hovering or tapping a slice also shows its values. Percentages cover returned
pages only. The fallback report labels its counts as unique visits by page.
Session duration displays hours, minutes and seconds (4,604 seconds becomes
1 hr 16 min 44 sec). Bracket and search breakdown tables are directly visible;
there are no View data disclosures or duplicate chart tables. Missing values
remain unavailable; blank days in Search Console are unreported, not zero.
Breakdowns can omit anonymized queries and lower-ranked rows and need not sum to
totals. CTR and position use provider aggregates, never averages of row percentages.
Providers measure different audiences; do not add their totals.

Shared picks, leaderboard and scoring pages record a fixed sport path, such as
`/nba/leaderboard` or `/nfl/leaderboard`, based only on the displayed sport.
These are analytics labels, not new website routes. No raw query string is sent.
The pie legend displays “NBA leaderboard” and “NFL leaderboard”. Older shared-page
counts say “sport not recorded”; their sport cannot be reconstructed. New labels
appear as GoatCounter receives views and refreshes its hourly session export.

## Collection and interpretation

There are no analytics cookies, localStorage/sessionStorage identifiers, consent
state, banners or opt-in controls. A targeted public-page migration expires legacy
analytics cookies and removes only the old analytics consent/visitor/session keys.
It creates no new storage. Cognito sign-in storage, preferences and drafts remain.
GPC/DNT disable GoatCounter and first-party collection, including signals enabled
after page load. The AWS endpoint honors `Sec-GPC: 1` and `DNT: 1` headers. No
account/email/IP/browser IDs, invite codes or picks enter product analytics logs.

First-party events are browser-reported successful actions, not database totals.
`bracket_created` means the first valid bracket build; completion is transition
to all winners selected; saves are successful save operations, including repeats.
Bracket events carry only `bracketType: nfl|nba`. Deletions are reported after
Cognito deletion succeeds. Direct group joins and invite joins are separate.
Historical `bracket_started` is counted as created; historical events without a
type are shown as historical / unknown. New deletion/type metrics cannot be
backfilled. One bounded CloudWatch query returns daily/event/type aggregates.
The old AWS traffic/daily visitor collector is removed; existing TTL items expire
under their existing settings. No new tables, schedules or IAM grants are needed.

### Active engagement time

Measurement starts automatically on public development pages. GPC/DNT prevent
collection and discard pending time if enabled later. There is no consent UI or
state, and Cognito is not used by the collector.

Time counts while the page is visible and focused, with a trusted click, key press,
scroll or touch within the preceding **60 seconds**. The initial foreground visit
and returning focus start an active interval. No input values or coordinates are
read. A five-second timer samples time; intervals are sent about every 30 seconds
and on blur/hidden/pagehide. Pagehide stops sampling; browser-history restoration
restarts it if privacy signals permit. Delivery is best effort, without retries,
visitor IDs, credentials or referrers; missing deliveries undercount.

The existing `POST /api/analytics` accepts exactly `event: active_time`, an allowlisted
public `page`, fixed `sport`, and integer `milliseconds: 1..60000`. Dev-only validation
and privacy headers apply before persistence. Public browser reports can be forged;
these are approximate product insights, not billing or security measurements.

Atomic DynamoDB increments reuse the existing report-cache table and its
GetItem/UpdateItem permissions. Monthly `engagement:v1:YYYY-MM` items contain bounded
day/page/sport counters, expiring 367 days after the month ends. No individual
measurements are stored or logged. Intervals are attributed to their UTC receipt
day. Reports need at most four small reads. The
existing 15-minute cache applies; a counter-read failure leaves product activity
available and marks only active time unavailable.

**Active engagement time** is the selected-range total across public page visits,
not an average per visitor or GoatCounter session duration. The daily chart selector
and **Active time by page** table show hours/minutes/seconds with hover, tap and
keyboard readouts. Missing days are unavailable, not zero. Choose **Today (UTC)**
for new measurements; the default completed-day range excludes today. Do not
divide this total by GoatCounter sessions to infer average engagement; coverage and
measurement methods differ. Earlier totals include only the former opt-in visits.

GoatCounter temporarily links a random cookieless session identifier in memory to
site + IP + User-Agent for up to eight hours. It estimates short-lived sessions,
not exact people or returning users. Shared networks/browser combinations can
merge people; network/browser changes can overcount. **Distinct visitors / sessions**
is one metric: each session counts once across all public pages and selected UTC
dates. Daily sessions deduplicate per day; they must not be summed for range uniques.

Raw pageviews include repeat page loads, unlike standard unique visits per page.
Session duration is mean elapsed time between first and last recorded public
pageview within selected dates, including single-page sessions as zero. It is
not engagement time: time after the last pageview is unknown and sessions at date
boundaries are clipped.

Enable **Sessions** and **Individual pageviews** in GoatCounter Settings > Data
collection. Record the actual uninterrupted collection start in `sessions_started_at`
(timezone-aware ISO 8601 UTC). If records are purged or collection disabled, update
this timestamp for the next uninterrupted start. Earlier historical ranges show
unavailable totals; measured days remain visible. First day and today are partial.
When exports are unavailable, standard per-page unique visits remain available
with an explicit fallback label; they are not raw pageviews.

## One-time development AWS setup

1. **Before the first dev deployment**, have your authorized bootstrap administrator apply `terraform/bootstrap` through the established bootstrap process. Its dev policy permits Cognito `CreateGroup`, `GetGroup`, `UpdateGroup`, and `DeleteGroup`, restricted to development-tagged pools. No local application Terraform apply is part of normal deployment.
2. Let GitHub Actions deploy `dev`, or rerun its deployment after the prerequisite is complete. Terraform manages the `admin` group and an on-demand DynamoDB report cache separately in each environment. If the dev pool already has an `admin` group, import it into `module.nfl_app.aws_cognito_user_group.admin[0]` through your established dev Terraform process (Cognito import ID: `<dev-pool-id>/admin`).
3. In the AWS console, select the **development** Cognito pool and add your existing verified user to `admin`. Terraform grants nobody membership automatically. The browser and backend cannot assign memberships. Existing JWTs can retain membership for their one-hour lifetime; the JWT authorizer does not perform a live group lookup or token revocation check on every request. Plan membership removals accordingly.
4. In Systems Manager → Parameter Store, create two **Standard SecureString** parameters in `us-east-1`, using the default AWS-managed `aws/ssm` encryption key. Enter credentials directly in the console, never in Git, frontend files, Terraform variables, deployment logs, or chat.

The existing dev group is adopted by the declarative import in `terraform/envs/dev/imports.tf`, using `us-east-1_aoY8qzW0r/admin`. GitHub Actions plans and applies the import with the existing dev OIDC role and remote dev state; no local apply is needed. The import preserves group membership and permissions. Its first plan may update the group's description in place, but must not create, replace, or delete the group. After applying, rerun the dev deployment and verify its plan refreshes the group from state without creating it. Keep the idempotent import block as a record of the adoption; it has no effect once the group is in state.

## Production setup and promotion

1. A separately authenticated bootstrap administrator must plan and apply
   `terraform/bootstrap` before production promotion; see
   [the bootstrap process](../terraform/bootstrap/README.md). The production
   OIDC role needs the four Cognito group lifecycle operations against pools
   tagged `Project=nfl-playoff-predictor`, `Environment=prod`, plus table
   lifecycle/read-metadata operations on exactly
   `nfl-playoff-predictor-admin-analytics-cache`. No group-membership, SSM-value,
   DynamoDB-data, or additional dev-resource permissions are added to it.
   Existing API, S3, Lambda-role and log permissions cover the other additions.
2. Review a refreshed production Terraform plan using the existing authorized
   deployment process and production remote state before applying. The constrained
   `codex-audit` role cannot read production state or inspect IAM policies; mocked
   test plans are configuration checks, not live plans. Stop if a plan destroys or
   replaces the Cognito pool, databases, API, distribution, or any unrelated
   resource. Expect the group, cache, runtime policy, two JWT routes, three
   admin frontend objects, Lambda configuration/code and related asset versions.
   The shared Lambda archive also updates the results-updater's code hash.
   Public HTML updates reflect the shared asset version without changing guards.
   If production already has an unmanaged `admin` group, adopt it with a
   production-specific declarative import using `<production-pool-id>/admin`;
   never copy the dev import or membership into production.
3. Promote only when explicitly authorized, using
   [production promotion](production-promotion.md). Production GitHub Actions
   packages the same Linux/Python 3.12 Google dependencies as dev and applies
   only the production root. Pushing `dev` does not deploy production.
4. Create/populate the two production parameters listed below privately.
   Terraform manages their names and read permissions, not secret values.
   Missing config/credentials shows Google Search as setup needed; AWS reports
   remain available. Do not copy dev service-account keys or provider tokens.
5. After deployment, in the AWS Console select **US East (N. Virginia)**, open
   **Amazon Cognito → User pools**, and select production pool
   `nfl-playoff-predictor-users` (confirm its ID against production Terraform's
   `cognito_user_pool_id` output). Choose **Groups → admin → Add users**,
   select your existing production user, and choose **Add**. Terraform creates
   an empty group and never assigns users. No IAM role needs to be attached to
   the group. Sign out and back in at `predictplayoffs.com` for new group claims,
   then open `/admin/analytics`. Do not select the `-dev-` pool.

Production reads `nfl-playoff-predictor-predictions`,
`nfl-playoff-predictor-groups`, `/aws/lambda/nfl-playoff-predictor-backend`, and
its own cache/pool/client/parameters. Dev retains the `nfl-playoff-predictor-dev`
prefix. GoatCounter traffic runs on allowlisted public pages in both environments,
respecting GPC/DNT without cookies, account identifiers, raw queries or invite codes.
The existing `predictplayoffs` site and read/export token are reused. Production
records fixed `/prod/...` virtual paths; exports and fallback stats filter exact
environment paths. Legacy unprefixed traffic remains dev-only. Production CSP
permits only the existing GoatCounter script and count origins. Active-time
collection remains dev-only.

The hourly export reservation and ID/time are shared in the existing dev cache.
Production has only GetItem/UpdateItem on `goatcounter-export:v1:predictplayoffs`
using a DynamoDB LeadingKeys condition; it cannot read dev reports or engagement
counters. Raw exports and session IDs stay in memory. Reports and application
records remain in their own environment. No additional site, table or schedule
is created.

Membership removal is not immediate revocation: existing JWT group claims can
last up to one hour. API Gateway validates JWTs; the backend rechecks the expected
environment's issuer/client, token times and exact `admin` claim before any
cache/provider access. It does not perform a live membership lookup.

## Server-side configuration

Use the existing Standard SecureString parameters in us-east-1:

| Parameter | Contents |
|---|---|
| `/nfl-playoff-predictor-dev/admin-analytics/config` | GoatCounter and Search Console settings |
| `/nfl-playoff-predictor-dev/admin-analytics/google-service-account` | Complete Google service account JSON key |
| `/nfl-playoff-predictor/admin-analytics/config` | GoatCounter and Search Console settings, with production collection start |
| `/nfl-playoff-predictor/admin-analytics/google-service-account` | Existing working Google service-account key reused as explicitly authorized |

Development configuration example (enter real credentials privately, never in Git or chat):

```json
{
  "goatcounter": {
    "site": "predictplayoffs",
    "token": "REPLACE_PRIVATELY",
    "sessions_started_at": "REPLACE_WITH_ACTUAL_COLLECTION_START_UTC"
  },
  "search_console": { "site_url": "sc-domain:predictplayoffs.com" }
}
```

For production, privately add the existing dev GoatCounter `site` and `token`
to the current config parameter, preserving `search_console` and other settings.
Record the production collector activation time in `sessions_started_at`, rather
than copying dev's historical start. Do not modify the Google credential parameter
or dev parameters. Production has no historical traffic before activation; use
Today (UTC) to verify new views. Full-range metrics require collection coverage.

Create both production parameters as **Standard SecureString** in `us-east-1`
with the default AWS-managed `aws/ssm` key. The Google parameter takes the complete
Google-generated JSON key, including its `client_email` and `private_key`, entered
directly in Parameter Store. The existing working service account is reused for
production as explicitly authorized; never put credentials in Terraform, deployment variables, Git, logs, tests, docs,
frontend configuration or chat. Customer-managed encryption keys would need a
separate scoped decrypt grant; this setup uses `aws/ssm`.

For production, enable **Google Search Console API** in the production service
account's Google Cloud project. In Search Console select the verified
**predictplayoffs.com** domain property, open **Settings → Users and permissions
→ Add user**, enter the production service-account email, and grant **Restricted**
access. The already-authorized shared account requires no new Google setup. The server uses
only `webmasters.readonly`; do not grant domain delegation or project Editor.
Alternatively configure the verified `https://predictplayoffs.com/` URL-prefix
property and grant the account access to that property.

GoatCounter's shared token needs **Read statistics** and **Export**, restricted to the
connected site, without record/site/user management permissions. Google uses
`google-auth` with only `webmasters.readonly`. Enable Search Console API and add
the service account to the already verified property with performance-report
read access (Restricted is sufficient). No domain delegation or project Editor
role is needed. Obsolete provider settings are ignored and can be removed
privately from the appropriate parameter. Preserve the existing working Google setup.

The existing DynamoDB cache lasts 15 minutes, with five-minute error/setup
cooldowns and conditional refresh leases. Config reloads after five minutes.
Traffic export preparation retries after 30 seconds; failed exports use 60 seconds.
An hourly export reservation is shared across environments, ranges and Lambda containers,
including uncertain failed creation. Four requests/second and one bounded GET
retry handle GoatCounter quotas; export creation is never retried.
Exports are bounded to 2 MB compressed, 10 MB decompressed and 100,000 rows;
version, fields, row count and completion are validated. Malformed or oversized
exports never show partial counts. Raw exports/session IDs stay in server memory;
only aggregates and the export ID/request time are cached. GoatCounter's
eight-hour identifying link does not delete historical random session IDs;
review its pageview retention settings separately.

Redirects are blocked, errors sanitized, responses private and no-store, and no
provider tokens reach the browser. Separate OIDC deployment, authorization
and narrowly scoped runtime permissions remain. Run `scripts/check.ps1 -Scope All`,
then push dev for GitHub Actions deployment. Verify both tabs in dev before an explicitly authorized dev → prod PR promotion; never apply locally.

References: [GoatCounter sessions](https://www.goatcounter.com/help/sessions),
[CSV exports](https://www.goatcounter.com/help/export),
[API schema](https://www.goatcounter.com/api.json),
[Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
