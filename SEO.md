# Search indexing and verification

Predict Playoffs uses static HTML uploaded directly by Terraform, without a frontend
build step. The production canonical origin is https://predictplayoffs.com.

## Public pages

- `/`: challenge introduction, instructions, and links are in the initial HTML.
- `/scoring`: standalone scoring rules are in the initial HTML.
- `/leaderboard`: public standings, with rows loaded from the public API. Private
  groups still require authentication and are not separate sitemap URLs.

These three canonical URLs are in `frontend/sitemap.xml`. `/picks` has a static
`noindex,follow` directive and is excluded from the sitemap. Account dialogs,
invitation query strings, and API/auth endpoints are not sitemap entries.

The initial audit found no homepage authentication gate, no production noindex,
and no SPA custom-error fallback. Canonical/social metadata, crawl files, and dev
noindex protection were missing. The public leaderboard depends on JavaScript/API
data, but the homepage introduction and scoring rules do not.

## Deployment and environments

`terraform/modules/app/main.tf` publishes every asset explicitly, including
`robots.txt` as text/plain, `sitemap.xml` as application/xml, and the social logo
PNG as image/png. Clean routes are actual S3 object keys, not SPA rewrites.
Unknown paths retain their error responses. The existing root object serves `/`.

For every non-production module deployment, a CloudFront response headers policy
sets `X-Robots-Tag: noindex, nofollow` on frontend and API responses. Production
does not attach that policy and uses each page's robots metadata. Dev intentionally
remains crawlable so crawlers can see the restrictive header, which takes precedence
over the shared HTML's index directive. Canonicals always point to production.

The existing CloudFront cache policy has min/default/max TTL zero, and S3 objects
have no-store/no-cache headers. No new invalidation step is needed. Wait for the
CloudFront distribution update to finish before checking response headers.

The favicon, 180px Apple touch icon, and 1200x630 social preview all reuse the
existing trophy SVG and site palette. The editable social-card source is
`frontend/assets/predict-playoffs-social.svg`; its PNG export is the file used by
Open Graph and Twitter metadata. Raster derivatives can be regenerated with Sharp,
and the multi-size ICO can be regenerated from the mark with Pillow.
JSON-LD describes a WebApplication; pricing, reviews, and ratings are omitted.
Update the homepage title, descriptions, visible year, schema, and corresponding
tests together for future seasons.

## Google Search Console (manual, after production deployment)

1. Add a Domain property for `predictplayoffs.com` in Search Console. Copy the real
   DNS TXT verification value provided by Google.
2. Repository DNS notes identify Cloudflare, not Route 53, as the DNS provider.
   Add Google's TXT value at the root (`@`) in that DNS zone. No Route 53 zone or
   verification token is managed by this repository. If DNS ownership has changed,
   use the current authoritative provider instead.
3. Alternatively, for a URL-prefix property, put Google's actual verification meta
   tag in the static `<head>` of `frontend/index.html` and deploy it. Do not use a
   placeholder token. DNS verification avoids changing application files.
4. Submit `https://predictplayoffs.com/sitemap.xml`. Inspect the homepage, scoring,
   and leaderboard URLs with URL Inspection and request indexing as appropriate.
   Confirm Google's selected canonical and monitor indexing reports. These changes
   make pages eligible for indexing; Google decides whether and when to index them.

Check these production URLs after the changes are explicitly promoted to `prod`:

- https://predictplayoffs.com/ — HTTP 200, HTML metadata, no noindex response header.
- https://predictplayoffs.com/robots.txt — HTTP 200, text/plain, actual robots rules.
- https://predictplayoffs.com/sitemap.xml — HTTP 200, application/xml, three URLs.
- https://predictplayoffs.com/scoring — HTTP 200, self-canonical.
- https://predictplayoffs.com/leaderboard — HTTP 200, self-canonical, public data.

Also check the dev CloudFront homepage and API for the noindex response header.
The implementation session verified the existing production homepage returned
HTTP 200 without a noindex header. The missing robots.txt and sitemap.xml both
returned HTTP 403 from S3. Repeat these checks after production promotion to verify
the new files and metadata. No production deployment was run.

## Regression checks

Run `python -m unittest discover -s backend -p "test_*.py"`. Both deployment
workflows already run this command, which includes `backend/test_seo.py`.
It checks static metadata, canonical URLs, JSON-LD, XML, sitemap scope, real social
assets, S3 publication, and environment header-policy wiring. It does not replace
post-deployment HTTP checks. Run Terraform formatting and validate both environments
as well; no Terraform apply is needed for local validation.
