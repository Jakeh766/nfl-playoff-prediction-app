# Admin analytics

Open `/admin/analytics` on dev with an existing Cognito user in the `admin` group.
The unindexed static shell contains no reports, credentials or public tracking.
Every report requires API Gateway-verified Cognito claims and server-side admin
authorization. Authentication session format and storage are unchanged.

## Three sections

| Section | Source and coverage | Reports |
|---|---|---|
| Traffic | GoatCounter public dev pages | Distinct visitors/sessions, raw pageviews, pageviews by page, daily sessions/pageviews, estimated session duration |
| PredictPlayoffs activity | Dev AWS product events and aggregate active-time counters | Sign-ins, accounts created/deleted, brackets created/completed/saved by NFL/NBA type, groups created, direct joins and invite joins; each by day and selected-range total. Opt-in active time by day, page and sport |
| Google Search | Search Console `sc-domain:predictplayoffs.com`, including subdomains | Clicks, impressions, CTR, average position, daily history, top query/page/country/device rows |

The default is 28 completed days. Today (UTC), 7/28/90 completed days and custom
ranges are available; the server accepts up to 93 inclusive days within the last
year. Traffic/activity dates are UTC; Search Console uses Pacific dates and final
web-search data, which can lag several days. Search Console measures the connected
production domain, not the dev CloudFront hostname. This does not deploy production.

Use the Traffic, Activity, and Google Search tabs to switch sections without
reloading reports. Activity totals are grouped by accounts/access, brackets, and
groups. The Google Search breakdown selector switches among query, page, country,
and device tables.

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

There are no analytics cookies, localStorage/sessionStorage identifiers or persistent
consent state. The former GA4/Clarity banner remains removed. The optional active-time
control holds permission only in memory for the current page. A targeted public-page
migration expires legacy analytics cookies and removes only the old analytics
consent/visitor/session keys. It creates no new storage. Cognito sign-in storage,
preferences and drafts remain.
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

### Optional active engagement time

Development public-page footers offer **Allow active-time measurement for this page**
and **Stop active-time measurement**. Collection defaults off; opt-in expires on
pagehide, including browser-history restoration. This conservative opt-in design
does not assume a consent exemption. GPC/DNT prevent opt-in and discard pending
time if enabled later. There is no banner or stored choice, and Cognito is not used.

Time counts while the page is visible and focused, with a trusted click, key press,
scroll or touch within the preceding **60 seconds**. Returning focus resumes the
estimate. No input values or coordinates are read. A five-second timer samples time;
intervals are sent about every 30 seconds and on blur/hidden/pagehide. Withdrawal
drops pending time. Delivery is best effort, without retries, visitor IDs,
credentials or referrers; missing deliveries undercount.

The existing `POST /api/analytics` accepts exactly `event: active_time`, an allowlisted
public `page`, fixed `sport`, integer `milliseconds: 1..60000`, and the permission
marker `consent: active-time-v1`. The marker is a client assertion, not an identity
or server-verifiable consent record. Dev-only validation and privacy headers apply
before persistence. Public browser reports can be forged; these are approximate
product insights, not billing or security measurements.

Atomic DynamoDB increments reuse the existing report-cache table and its
GetItem/UpdateItem permissions. Monthly `engagement:v1:YYYY-MM` items contain bounded
day/page/sport counters, expiring 367 days after the month ends. No individual
measurements are stored or logged. Intervals are attributed to their UTC receipt
day. Reports need at most four small reads. The
existing 15-minute cache applies; a counter-read failure leaves product activity
available and marks only active time unavailable.

**Active engagement time** is the selected-range total across opted-in page visits,
not an average per visitor or GoatCounter session duration. The daily chart selector
and **Active time by page** table show hours/minutes/seconds with hover, tap and
keyboard readouts. Missing days are unavailable, not zero. Choose **Today (UTC)**
for new measurements; the default completed-day range excludes today. Do not
divide this opt-in total by GoatCounter's broader audience.

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

## One-time AWS setup

1. **Before the first deployment**, have your authorized bootstrap administrator apply the change in `terraform/bootstrap/main.tf` through the established bootstrap process. It adds only Cognito `CreateGroup`, `GetGroup`, `UpdateGroup`, and `DeleteGroup` permissions to the **dev** deployment role, restricted to development-tagged pools. The production deployment policy is unchanged. Until this is done, dev deployment cannot create/read the group. No local Terraform apply is part of the application's normal deployment flow.
2. Let GitHub Actions deploy `dev`, or rerun its deployment after the prerequisite is complete. Terraform manages the `admin` group and an on-demand DynamoDB report cache. If the dev pool already has an `admin` group, import it into `module.nfl_app.aws_cognito_user_group.admin[0]` through your established dev Terraform process (Cognito import ID: `<dev-pool-id>/admin`). Admin routes, assets, environment variables, and runtime permissions exist only in dev.
3. In the AWS console, select the **development** Cognito pool and add your existing verified user to `admin`. Terraform grants nobody membership automatically. The browser and backend cannot assign memberships. Existing JWTs can retain membership for their one-hour lifetime; the JWT authorizer does not perform a live group lookup or token revocation check on every request. Plan membership removals accordingly.
4. In Systems Manager → Parameter Store, create two **Standard SecureString** parameters in `us-east-1`, using the default AWS-managed `aws/ssm` encryption key. Enter credentials directly in the console, never in Git, frontend files, Terraform variables, deployment logs, or chat.

The existing dev group is adopted by the declarative import in `terraform/envs/dev/imports.tf`, using `us-east-1_aoY8qzW0r/admin`. GitHub Actions plans and applies the import with the existing dev OIDC role and remote dev state; no local apply is needed. The import preserves group membership and permissions. Its first plan may update the group's description in place, but must not create, replace, or delete the group. After applying, rerun the dev deployment and verify its plan refreshes the group from state without creating it. Keep the idempotent import block as a record of the adoption; it has no effect once the group is in state.

## Server-side configuration

Use the existing Standard SecureString parameters in us-east-1:

| Parameter | Contents |
|---|---|
| `/nfl-playoff-predictor-dev/admin-analytics/config` | GoatCounter and Search Console settings |
| `/nfl-playoff-predictor-dev/admin-analytics/google-service-account` | Complete Google service account JSON key |

Configuration example (enter real credentials privately, never in Git or chat):

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

GoatCounter's token needs **Read statistics** and **Export**, restricted to the
connected site, without record/site/user management permissions. Google uses
`google-auth` with only `webmasters.readonly`. Enable Search Console API and add
the service account to the already verified property with performance-report
read access (Restricted is sufficient). No domain delegation or project Editor
role is needed. Obsolete provider settings are ignored and can be removed
privately from the dev parameter. No secret rotation or AWS mutation is needed
for this code deployment.

The existing DynamoDB cache lasts 15 minutes, with five-minute error/setup
cooldowns and conditional refresh leases. Config reloads after five minutes.
Traffic export preparation retries after 30 seconds; failed exports use 60 seconds.
An hourly export reservation is shared across ranges and Lambda containers,
including uncertain failed creation. Four requests/second and one bounded GET
retry handle GoatCounter quotas; export creation is never retried.
Exports are bounded to 2 MB compressed, 10 MB decompressed and 100,000 rows;
version, fields, row count and completion are validated. Malformed or oversized
exports never show partial counts. Raw exports/session IDs stay in server memory;
only aggregates and the export ID/request time are cached. GoatCounter's
eight-hour identifying link does not delete historical random session IDs;
review its pageview retention settings separately.

Redirects are blocked, errors sanitized, responses private and no-store, and no
provider tokens reach the browser. Existing dev OIDC deployment, authorization
and narrowly scoped runtime permissions remain. Run `scripts/check.ps1 -Scope All`,
then push dev for GitHub Actions deployment. Do not apply locally or promote prod.

References: [GoatCounter sessions](https://www.goatcounter.com/help/sessions),
[CSV exports](https://www.goatcounter.com/help/export),
[API schema](https://www.goatcounter.com/api.json),
[Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
