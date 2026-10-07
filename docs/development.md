# Development guide

Start with the [README](../README.md) for what the app does. This guide explains
where to make changes and how to check them.

## Setup and checks

The supported toolchain is Windows, Node.js 24, Python 3.13, and Terraform 1.15.7.
Run setup once in each checkout or worktree:

```powershell
.\scripts\setup.ps1
```

Setup creates the local Python environment, installs email and analytics
provider dependencies, and initializes Terraform for validation without a
remote backend. Use `.venv\Scripts\python.exe` for Python commands; the Windows
Store launcher is not supported.

Choose checks based on the files you changed:

```powershell
.\scripts\check.ps1 -Scope All
.\scripts\check.ps1 -Scope Backend
.\scripts\check.ps1 -Scope Frontend,Terraform
```

| Scope | Checks |
| --- | --- |
| `Frontend` | Syntax of every top-level frontend JavaScript file and all `backend/test_*.cjs` tests |
| `Backend` | Syntax of every top-level Lambda Python file and all `backend/test_*.py` tests |
| `Email` | Custom email sender tests |
| `Terraform` | Formatting and validation of bootstrap, dev, and prod configurations |
| `All` | Everything above |

`scripts/check-frontend.cjs` is shared by local checks and both deployment
workflows. Add browser regression tests as `backend/test_*.cjs`; they are
picked up automatically. Email tests remain a separate scope because they
require the email sender's dependencies. Python tests also discover new
`test_*.py` files automatically.

Some Python tests create temporary Terraform fixtures to evaluate the actual
security headers and asset versions. These tests need a writable temporary
folder and the Terraform executable. Tests do not require live AWS access.

## Frontend code map

Pages load ordinary scripts in order, without a build step or module bundler.
They share globals such as `state`, `elements`, and sport configuration, so
check the script tags in the relevant HTML before moving a function.

| File | Responsibility |
| --- | --- |
| `sports.js` | Sport selection, conferences, NBA preview data, and sport-aware links |
| `app.js` | Shared state, account forms, Cognito sessions, and API requests |
| `shell.js` | Navigation and shared page layout behavior |
| `picks.js` | Bracket building, team selection, saved picks, and win projections |
| `leaderboard.js` | Public standings, private groups, invites, and group management |
| `scoring.js` | Scoring-page content |
| `bootstrap.js` | Connects controls to handlers and starts the relevant page |
| `monitoring.js`, `goatcounter.js`, `engagement.js` | Guarded analytics collection |
| `admin-analytics.js` | Private admin reports |

When adding a frontend asset, check the explicit upload manifest in
`terraform/modules/app/main.tf`. The deployment regression test verifies that
local scripts referenced by HTML are published. `auth-config.js` is generated
for each deployed environment; the checked-in copy supports local previews.

To preview the public-name dialog locally, open
`http://localhost:8000/?preview=leaderboard-name` after starting the README's
static server.

## Backend code map

| File | Responsibility |
| --- | --- |
| `app.py` | API routes, request validation, profiles, groups, scoring, and win-total caching |
| `results_dispatcher.py` | Runs scheduled NFL and NBA ingestion independently |
| `results_updater.py` | NFL results ingestion and guarded manual corrections |
| `nba_results_updater.py` | NBA daily game ingestion, Play-In qualifiers, and series results |
| `admin_analytics.py` | Admin authorization and report caching |
| `analytics_providers.py` | CloudWatch, GoatCounter, and Search Console reports |
| `goatcounter_sessions.py` | Sanitizes provider exports and estimates sessions |
| `engagement.py` | Anonymous aggregate active-time counters |

API Gateway validates Cognito JWTs. The API takes the user identity from those
verified claims, never from a submitted user ID. Brackets are validated on the
server before storage. See [browser and bracket security](browser-security.md)
for request shapes, token handling, and response headers.

`?sport=nba` selects NBA; a missing sport selects NFL. The backend's `SPORT`
context variable is reset after each request so a warm Lambda cannot carry a
sport choice into another request. Shared scoring fields retain legacy names
such as `wildCard` and `superBowl`; NBA labels are translated for display.

Cognito handles sign-in directly. Verification and password recovery stay in
the app. The Node email Lambda decrypts Cognito messages and sends them through
Resend.

## Saved data and history

DynamoDB holds predictions, public profiles, groups, results, and caches.
Account names and group memberships are shared across sports; predictions and
results are separated. NBA uses season-specific prediction keys and a numeric
results-key namespace. See [NBA ingestion](nba-results-ingestion.md) for the
exact formats.

Group writes use conditional expressions to protect names, memberships, and
commissioner changes. `commissioner_condition()` centralizes current and legacy
ownership checks. Check ownership before deleting related group records.
Duplicate join requests keep the original membership timestamp.

Deletion still uses several DynamoDB writes. If storage fails after removing
the group record, cleanup may leave orphaned memberships or history. A durable
cleanup job or transaction would be a separate improvement; keep this failure
case in mind when changing group storage.

Group history is an immutable snapshot taken after final results, rather than
an estimate from current standings. See [group history](group-history.md).

## Analytics

The development-only page `/admin/analytics` combines GoatCounter traffic,
first-party AWS activity, and Google Search Console reports. Its credentials
stay on the server, and access requires Cognito admin membership. See
[admin analytics](admin-analytics.md) for setup and metric definitions.

Analytics uses no cookies, browser analytics storage, consent banner, or optional
provider scripts. GPC and DNT suppress GoatCounter and first-party collection;
private admin pages do not collect it. Essential Cognito sign-in storage remains.
Product events retain coarse action and sport labels, without account IDs,
emails, visitor/session IDs, queries, invite codes, or picks. CloudWatch reports
aggregates. GoatCounter exports support traffic and estimated session duration;
missing coverage is reported as unavailable. Search Console is server-only.

## Deployment and demo data

Follow [AGENTS.md](../AGENTS.md) for Git and AWS rules. Development changes go to
`dev`, whose GitHub Actions workflow checks and deploys the development
infrastructure. Production uses `prod` and requires explicit promotion.
Routine deployments use GitHub Actions' temporary OIDC credentials.

The [production promotion checklist](production-promotion.md) tracks dev-only
behavior, including randomize picks and the reopened NFL testing window, and
the checks that keep those behaviors out of production.

Each environment serves static files from a private S3 bucket through
CloudFront, with API Gateway in front of the Python Lambda. Terraform manages
these resources and a CloudWatch analytics dashboard. See the
[infrastructure guide](../terraform/README.md) for bootstrap, state migration,
Resend configuration, and required GitHub environment settings.

Dev deployment seeds sixteen demo participants and two private groups:

| Group | Demo password |
| --- | --- |
| Demo Sunday Huddle | `HuddleDemo26!` |
| Demo Gridiron Rivals | `RivalsDemo26!` |

These are DynamoDB demo records, not Cognito accounts. Production is never
seeded. Local screenshots are ignored and should stay out of commits.
