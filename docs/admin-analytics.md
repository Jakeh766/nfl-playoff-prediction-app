# Private analytics dashboard (dev)

Sign in through the existing Predict Playoffs Account dialog, then open `/admin/analytics` on the development deployment. Only members of the dev Cognito pool's `admin` group can read reports. Sign out and back in after a membership change to obtain fresh group claims. Non-admin visitors redirect to `/`; authenticated non-admin API callers receive `403`, and missing/invalid tokens receive `401`.

The unindexed static page is only a shell: it contains no report data or provider credentials. It does not load public tracking scripts. Existing public analytics, consent and privacy behavior remain unchanged.

## Reading the reports

The dashboard is hosted on dev, but that does not determine every report's audience:

| Report | Coverage |
|---|---|
| CloudWatch / custom analytics | Dev only: development logs filtered to development events. Account, sign-in, bracket and group counts are browser-reported dev activity, not production database totals. |
| GoatCounter | Dev only: the public-page loader requires the dev environment. The connected site is `predictplayoffs`. |
| Google Analytics 4 | Entire connected property. Dev tracking is configured; any production or other-host traffic collected in that property is also included. No hostname filter is applied. |
| Google Search Console | `sc-domain:predictplayoffs.com`: the production domain and its subdomains. The dev CloudFront hostname is outside that property. These are Google Search impressions/clicks, not app visits. |
| Microsoft Clarity | Entire connected project. Dev tracking is configured; any production or other-host traffic collected there is also included. Saved filters in Clarity's browser dashboard do not filter Data Export reports. |

Charts visualize the existing report responses without additional provider requests. Ranked charts show up to five returned rows; expand **View data** for all returned rows and columns. Bar lengths compare counts within one chart. Engagement percentages use a fixed 0–100% scale and have separate denominators. Activity bars are independent event counts, not a conversion funnel. The selected dates apply to ordinary reports; Clarity always uses its latest 72-hour window. Missing values remain unavailable and empty reports contain no sample traffic.

**GoatCounter page visits:** with Sessions enabled in GoatCounter, the same session visiting the same page repeatedly counts once; visiting another page increments the total again. One visitor loading home three times and the leaderboard once in a session yields two page visits, not one site-wide unique visitor or four raw pageviews. Turning off Sessions makes each load count. GoatCounter temporarily maps site + IP + User-Agent to a random session ID in memory for up to eight hours; it does not persist an IP hash as a visitor identifier. See [Sessions and visitors](https://www.goatcounter.com/help/sessions).

Our dev loader runs regardless of whether optional analytics are accepted or declined, while honoring GPC and Do Not Track. It sends neither the consent choice nor a visitor ID, so this report cannot isolate visitors who declined. The current API totals are deduplicated page visits with event counts excluded; they do not provide a distinct-person count across all pages or the whole selected date range. Production tracking is unchanged.

## One-time AWS setup

1. **Before the first deployment**, have your authorized bootstrap administrator apply the change in `terraform/bootstrap/main.tf` through the established bootstrap process. It adds only Cognito `CreateGroup`, `GetGroup`, `UpdateGroup`, and `DeleteGroup` permissions to the **dev** deployment role, restricted to development-tagged pools. The production deployment policy is unchanged. Until this is done, dev deployment cannot create/read the group. No local Terraform apply is part of the application's normal deployment flow.
2. Let GitHub Actions deploy `dev`, or rerun its deployment after the prerequisite is complete. Terraform manages the `admin` group and an on-demand DynamoDB report cache. If the dev pool already has an `admin` group, import it into `module.nfl_app.aws_cognito_user_group.admin[0]` through your established dev Terraform process (Cognito import ID: `<dev-pool-id>/admin`). Admin routes, assets, environment variables, and runtime permissions exist only in dev.
3. In the AWS console, select the **development** Cognito pool and add your existing verified user to `admin`. Terraform grants nobody membership automatically. The browser and backend cannot assign memberships. Existing JWTs can retain membership for their one-hour lifetime; the JWT authorizer does not perform a live group lookup or token revocation check on every request. Plan membership removals accordingly.
4. In Systems Manager → Parameter Store, create two **Standard SecureString** parameters in `us-east-1`, using the default AWS-managed `aws/ssm` encryption key. Enter credentials directly in the console, never in Git, frontend files, Terraform variables, deployment logs, or chat.

The existing dev group is adopted by the declarative import in `terraform/envs/dev/imports.tf`, using `us-east-1_aoY8qzW0r/admin`. GitHub Actions plans and applies the import with the existing dev OIDC role and remote dev state; no local apply is needed. The import preserves group membership and permissions. Its first plan may update the group's description in place, but must not create, replace, or delete the group. After applying, rerun the dev deployment and verify its plan refreshes the group from state without creating it. Keep the idempotent import block as a record of the adoption; it has no effect once the group is in state.

| Parameter | Contents |
|---|---|
| `/nfl-playoff-predictor-dev/admin-analytics/config` | Provider configuration JSON, including GoatCounter and Clarity tokens |
| `/nfl-playoff-predictor-dev/admin-analytics/google-service-account` | Complete Google service account JSON key |

These parameters are intentionally not Terraform resources: secret values cannot enter Terraform state or be overwritten during deployment. Each must fit the Standard tier's 4 KB limit. For a different resource prefix, use the dev outputs `admin_analytics_config_parameter` and `admin_google_credentials_parameter`. A customer-managed KMS key requires an additional scoped decrypt permission; the default setup uses `aws/ssm`.

Example configuration **shape**; replace placeholders privately in Parameter Store:

```json
{
  "goatcounter": { "site": "predictplayoffs", "token": "REPLACE_PRIVATELY" },
  "ga4": { "property_id": "123456789" },
  "search_console": { "site_url": "sc-domain:predictplayoffs.com" },
  "clarity": { "token": "REPLACE_PRIVATELY" }
}
```

Omit providers you have not connected. They show “Setup needed” while other reports continue working. Choose external properties/projects containing the intended traffic; an external property can contain production traffic even though this dashboard runs only in dev. Reading it does not deploy or change that site.

## Provider credentials and permissions

**CloudWatch/custom analytics:** no provider credential is needed. The runtime reads its existing development log group using two bounded Logs Insights queries. It returns aggregate counts, never raw events, visitor IDs, IP addresses, email addresses or brackets. Account and bracket actions are browser-reported event counts, not authoritative database totals. Visitors/visits with consent are approximate distinct IDs from consented events; cookieless pageviews are counted separately.

**Daily distinct visitors (dev only):** validated public `page_view` requests also feed a first-party daily counter, independently of optional analytics consent. An HMAC of the UTC date, canonical viewer IP and User-Agent uses a random server-side secret shared across Lambdas for that day. It counts the same IP/browser combination once across all public pages per UTC day, including visitors who decline cookies. GPC/DNT suppress it, and no raw IP/UA, URL, account ID, cookie or browser identifier is stored for this counter. CloudFront viewer addresses exclude source ports; forwarded IP handling ignores spoofable leftmost entries. This is an estimate of visitors, not exact people: shared IP/browser combinations can merge users and network/browser changes can overcount. It cannot deduplicate people across days.

The existing dev admin cache table stores short-lived HMAC markers and daily secrets (TTL at 01:00 UTC the following day; DynamoDB cleanup is asynchronous), daily aggregate counts (400-day TTL), and a collection start date. Conditional transactions atomically create a marker and increment its day, so concurrent pageviews/retries count once. Only aggregate counts reach the authenticated admin API. No new table, scheduled task, credential, IAM permission or production resource is needed. Collection failure does not interrupt the public app; a fixed diagnostic contains no request metadata. The daily chart preserves UTC order, shows the latest 14 selected days, and its data table covers the full range. The headline is the final selected day, not a sum of days. Historical dates before collection began display unavailable; they cannot be backfilled from GoatCounter. Counts are cached for 15 minutes with the custom report; today is incomplete. Bots or synthetic requests may also affect estimates.

**GoatCounter:** open Settings → API at `predictplayoffs.goatcounter.com` and create a token with read/statistics permissions only. Put it in `goatcounter.token`. The adapter reads totals, top paths and referrers for the top three returned paths. Its deduplicated totals are labelled **Page visits**, not site-wide unique visitors or raw pageviews. See the [API guide](https://www.goatcounter.com/help/api) and [schemas](https://www.goatcounter.com/api.json).

**Google authentication:** create a Google Cloud service account and enable the **Google Analytics Data API** and **Google Search Console API**. Generate a JSON service account key and save the complete key only in the Google SecureString parameter. The server uses Google's maintained `google-auth` library with `analytics.readonly` and `webmasters.readonly` scopes. No domain-wide delegation or broad project Editor role is needed. Rotate exposed keys and delete superseded keys after updating the parameter. See Google's [service account quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart).

**GA4:** add the service account email as **Viewer** in the relevant property's Access Management. Set the numeric property ID in `ga4.property_id`; the `G-...` measurement ID is different. Mark desired existing events as **key events** in GA4 to populate conversions, such as `sign_up`, `bracket_completed` or `bracket_saved`. Reporting access adds no tracking. The [Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema) defines the visitor, session, pageview, engagement and key-event metrics.

**Search Console:** an owner must already have verified the property. Add the service account email under Settings → Users and permissions with performance-report read access (Restricted access is sufficient; Full access also works). Use the exact property identifier: `sc-domain:predictplayoffs.com` or the full `https://.../` URL-prefix property. The adapter reads final web-search performance and top pages through [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query). Final data can lag several days, and an unindexed development property may have no results. Aggregate CTR and position come from the provider's totals, not averages of page percentages.

**Clarity:** a project administrator generates a token in Settings → Data Export. Put it in `clarity.token`. The [Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api) permits ten requests per project per day and only the latest 24–72 hours. This dashboard always requests and labels **latest 72 hours at retrieval**, independently of selected dates. Supported traffic, engagement, scroll-depth, rage-click and dead-click percentages are displayed without breakdown dimensions. Missing fields are omitted rather than reported as zero. Visits include reported bots; no recordings or unsupported historical exports are requested.

## Security, caching and cost

`GET /api/admin/analytics` and `GET /api/admin/analytics/{provider}` both use the existing API Gateway Cognito JWT authorizer, which verifies signature, issuer, audience/client and token times. Lambda accepts only verified authorizer claims, rechecks the expected dev issuer/client and token times, and requires an exact `admin` group match **before** cache/config/provider access. Raw headers and decoded browser JWTs are not trusted for authorization. No function URL bypass is created.

Responses use `Cache-Control: private, no-store` and `Vary: Authorization`. Existing `/api/*` CloudFront behavior disables caching and forwards Authorization. Server-side HTTP redirects are rejected to protect provider tokens. Errors expose no upstream bodies or exception details. Provider strings render as text, and URLs are reduced to paths/origins. Signing out or clearing the session in another tab clears rendered private reports.

Default dates cover the last 28 completed days; presets offer Today (UTC) or 7, 28 or 90 completed days, plus up to 93 custom days within the past year. Current-day and initial collection-day data can be incomplete. CloudWatch/GoatCounter use UTC; GA4 uses its property's timezone; Search Console uses Pacific dates; Clarity has its own recent window. Providers measure different audiences: compare counts, do not add them together.

The shared DynamoDB cache lasts 15 minutes for ordinary reports and six hours for Clarity. Ordinary errors/unconfigured providers have a five-minute cooldown; Clarity API failures also have a six-hour cooldown. Conditional leases prevent simultaneous refreshes, and clients cannot bypass the cache. Items expire using DynamoDB TTL after two days. Configuration reloads after five minutes; report caches can delay visible credential changes, especially Clarity's six-hour cache.

No scheduled polling, provisioned capacity, extra Lambda functions, NAT gateway, or paid Secrets Manager secret is added. Reports run only when an admin visits/updates the page. At current traffic, on-demand cache operations, small Logs Insights scans and existing Lambda execution should have incidental cost. Actual charges depend on scanned bytes and free-tier eligibility; date bounds and caching limit repeat scans.

Run `scripts/setup.ps1` and `scripts/check.ps1 -Scope All`. Dev deployment packages Linux/Python 3.12-compatible Google dependencies into the existing Lambda ZIP. After configuration, verify non-admin API requests return `403`, admins load reports, and a revoked external token affects only its provider. Tests use fixtures/mocks and do not call live provider accounts.
