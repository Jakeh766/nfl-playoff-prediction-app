# Frontend modules and sharing

The frontend keeps its plain HTML/CSS/JavaScript architecture and clean routes.
`app.js` now owns the shared state and DOM references. Existing deferred scripts
retain their global interfaces for an incremental migration; the new sharing
implementation uses native ES modules loaded only when someone opens a card.

## Responsibilities and loading

| File | Responsibility | Pages |
| --- | --- | --- |
| `sports.js`, `shell.js` | Sport context, routes, navigation, shared dialog markup | Main pages |
| `teams.js` | Team data, colors, logos, empty division selections, environment flags | Main pages |
| `app.js` | Shared state and DOM references | Main pages |
| `ui.js` | Account modal focus, password visibility, toast, field validation | Main pages |
| `auth.js` | Cognito sessions, account flows, public profile | Main pages |
| `api.js` | Public/protected requests, sport overrides, expired-session handling | Main pages |
| `group-navigation.js` | Membership count and Groups navigation | Main pages |
| `group-actions.js` | Create/join group and private invitations | Home, Groups |
| `groups.js` | Group directory, standings/history, commissioner settings and membership | Groups |
| `prediction-window.js` | Lock state and season countdown | Home, My Picks |
| `bracket.js` | NFL reseeding and NBA fixed bracket rules shared by editable/public brackets | Home, My Picks, Leaderboard, Groups |
| `standings.js` | Shared ranking, sorting, score formatting and season status | Home, My Picks, Leaderboard, Groups |
| `leaderboard-table.js` | Shared public/private standings table | Home, Leaderboard, Groups |
| `public-bracket.js` | Read-only bracket rendering and public links | Home, Leaderboard, Groups |
| `leaderboard.js` | Public leaderboard fetching, page rendering and local fixtures | Home, Leaderboard |
| `picks.js` | Editable seeds/bracket and saved predictions | My Picks |
| `share-entry.js` | Small adapter that fetches public data and lazily loads sharing | Home, My Picks, Leaderboard, Groups |
| `sharing.js` | Accessible preview dialog, native sharing, download, link copy | On demand |
| `share-model.js` | Public-field allowlist, shared bracket-rule adapter, public URL, share capability fallback | On demand |
| `share-card.js` | Full bracket 1200×630 canvas/PNG renderer | On demand |
| `monitoring.js`, `goatcounter.js`, `engagement.js` | Existing guarded analytics | Existing page placement |
| `bootstrap.js` | Page-aware event binding and initialization | Main pages |

Admin analytics keeps its separate authentication and page entry point. No
framework, bundler, dependency installation, or build step was added.

## Sharing and privacy

Saving a prediction exposes **Share my picks** in the saved bracket card.
**Share my results** appears when the score's `possible` field indicates that
results have settled (including a player with zero earned points). Read-only
public brackets offer both actions as applicable; results respect the selected
Classic or Upset Edge mode and use its overall rank and score.

The image is generated locally as a PNG, with the site's trophy, colors, and
Oswald/DM Sans fonts. Both picks and results exports show the complete saved
bracket: every seeded team, matchup, chosen winner, conference champion, final,
and champion pick. Results add a compact overall-rank/score line. NFL byes and
divisional reseeding use the same `buildConferenceGames` rules as the page; NBA
keeps its fixed bracket. Winning paths connect the rounds and selected winners
are highlighted. Compact franchise names and consistently sized team logos make
the bracket easier to scan, with logos repeated in the final and champion area.
Logos reuse `teamLogoUrl` and the existing ESPN CDN, with anonymous CORS,
no referrer, sport-specific allowlisted paths, deduplication, and a four-second
timeout. Failed or unavailable logos leave the team name and seed visible and
the PNG downloadable. No credentials or share parameters reach logo requests.
The image footer contains only the brand and `predictplayoffs.com`; it has no
legend, structure explanation, or public prediction URL. Supported browsers share the
image via Web Share; browsers without file sharing share the link. Download and
copy-link actions remain available. Image export failure leaves the public link
usable. Native-share cancellation leaves the preview open without a success event.

Links use the current deployment's origin and `/leaderboard?player=PublicName`
(plus `sport=nba` for NBA). Viewing needs no account. They reference the player's
current saved prediction: edits change what the link opens, while a downloaded
image stays a snapshot. Renaming/deleting the profile or prediction can invalidate
an old link. Social link previews retain existing site Open Graph metadata;
attach the generated PNG for a personalized platform preview.

Sharing always refetches the anonymous public bracket and public leaderboard.
Neither private group data nor group URLs pass to the sharing module. Sharing
from Groups exposes public picks/overall performance only, with no group rank,
group name, member identifier, password, or invite code. Email, Cognito IDs,
tokens, and internal database keys are excluded from the share model and URL.

The existing public bracket API gains additive `season` and `championStatus`
fields. Champion status uses finalized playoff qualification, NFL losses, NBA
completed series, and completed rounds. Unknown status is omitted from the card.
The existing system `maximum` is deliberately not presented as a player's
maximum possible remaining score. There are no new endpoints or database changes.

Five fixed events (`share_card_opened`, `share_image_generated`,
`share_native_used`, `share_image_downloaded`, `share_link_copied`) use the
existing first-party analytics endpoint and admin activity report. They carry
only event and fixed page names, honor DNT/GPC, and never contain the card,
player, share URL, or group information. `/groups` permits those same coarse
product events; its private data is never logged.

Terraform publishes every extracted file and native import. Relative ES imports
use revalidation to avoid stale dependencies after deployment; deferred page
scripts retain the existing content-derived versioning. No local Terraform apply
or production change is part of this work.

## Validation

Run `scripts/check.ps1 -Scope All`. Sharing unit tests run with the normal suite.
`backend/frontend-source.cjs` composes relocated files for existing source-section
tests; separate manifest and browser checks exercise actual page loading.

For browser checks, supply an installed Playwright package through
`PP_PLAYWRIGHT_MODULE` (or install it outside the deployment), then run
`node scripts/test-frontend-browser.cjs`. The script starts a local server, uses
headless Edge by default (`PP_BROWSER_CHANNEL` can override it), mocks API/Cognito
responses, and writes ignored screenshots under `frontend/screenshots`. It never
uses real accounts or AWS. No manual production configuration is required.
