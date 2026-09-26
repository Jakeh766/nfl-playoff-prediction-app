# Search and AI discovery

Predict Playoffs serves static HTML from S3 through CloudFront. The canonical
production origin is https://predictplayoffs.com. Development stays excluded from
indexing with CloudFront's overriding X-Robots-Tag: noindex, nofollow header on
both frontend and API responses. This work is on dev only.

## September 2026 audit and changes

The audit found four canonical public pages, useful homepage metadata and social
images, and an existing dev indexing guard. Remaining gaps were zero caching,
generic scoring/leaderboard metadata, navigation and the affiliation disclosure
created only by JavaScript, and limited static explanation of both sports.

- / and /nba: separate NFL and NBA introductions, visible explanatory sections,
  real season deadlines, scoring summaries, private-group guidance, and links.
- /scoring: descriptive metadata and initial-HTML rules for both sports, including
  the formulas and actual preseason source snapshots. The interactive detailed
  table still defaults to NFL and can switch to NBA.
- /leaderboard: descriptive metadata and a static explanation of the two modes,
  public brackets, and private groups. Ranking rows still require JavaScript/API
  data. They are participants' prediction scores, not editorial forecasts.
- Every page includes a static footer with normal links to all primary routes and
  the independent-app / no-league-affiliation disclosure.
- All four indexable pages have unique titles/descriptions, production canonicals,
  index,follow, OG and Twitter metadata, and the existing 1200x630 social card.
- /picks retains noindex,follow and is excluded from the sitemap.
- Logo and conference images have explicit dimensions; generated team logos also
  retain lazy loading and now have dimensions and asynchronous decoding. Existing
  assets are modest in size (the social card is about 44 KB; conference logos are
  500x500), so no new image format pipeline or additional imagery was introduced.

## Structured data and factual content

The two homepages use a JSON-LD graph with stable shared WebSite and WebApplication
IDs and a page-specific WebPage. The graph links the application to the website,
identifies NFL and NBA coverage, and references the actual trophy logo image.
It matches visible copy. An Organization node is deliberately omitted: the
repository provides a product identity but no verified organization details.
There are no invented ratings, reviews, awards, founders, social accounts, or
league affiliations, and no FAQ rich-result markup.

Static deadlines are checked against the repository's NFL configuration and NBA
season data. Update content and configuration together for a new season. Runtime
dev testing overrides still apply to the app's countdown and lock enforcement.

## Cache behavior and deployment

- HTML: public, max-age=0, s-maxage=60, must-revalidate. Browsers revalidate;
  CloudFront can retain a public page for at most 60 seconds.
- CSS, JS and images/icons: public, max-age=86400, must-revalidate.
- robots.txt and sitemap.xml: public, max-age=300, must-revalidate.
- auth-config.js: no-store, no-cache, must-revalidate, max-age=0.
- API: the existing zero-TTL cache policy and origin request policy are retained,
  including forwarding authentication and sport query parameters.
- Frontend CloudFront caching varies on v and negotiated Brotli/Gzip, has minimum
  TTL zero, and honors the origin's no-store on auth-config.js. Tracking, sport
  and invite query parameters do not fragment the static S3 object cache.

During Terraform evaluation, one release hash is derived from every published
JS/CSS file. Numeric ?v= tokens in each HTML page are replaced with that hash.
This applies consistently across all pages and automatically changes when code
or styles change; it does not require a frontend build or manual version bumps.
Unversioned auth-config.js is intentionally excluded. The regression suite
evaluates the real Terraform rendering expressions without AWS credentials.

HTML uploads depend on completed asset uploads, preventing new HTML from asking
CloudFront to cache the previous release under the new version. Moved blocks
preserve the five existing HTML S3 objects while separating their Terraform
resource from the assets. No object deletion/recreation is intended.

The asset paths at S3 remain mutable, so they are not falsely marked immutable.
Use a new filename for changed long-lived social images (as with the existing
social-v2.png). Cached old HTML can remain for up to a minute; no additional
invalidation permissions or deployment step is necessary.

## Crawling and AI search

robots.txt explicitly permits OAI-SearchBot and ordinary public crawling. Public
leaderboard, prediction-window and win-total API reads remain available for page
rendering; other API paths are disallowed. /picks remains crawlable so its noindex
can be read. Robots rules are not security controls: authenticated API operations
still enforce authorization. GPTBot remains under the general policy; its
training purpose is separate from OAI-SearchBot's search discovery purpose.

The sitemap still contains exactly these four production canonical URLs:

- https://predictplayoffs.com/
- https://predictplayoffs.com/nba
- https://predictplayoffs.com/scoring
- https://predictplayoffs.com/leaderboard

NBA query views and legacy /?sport=nba links remain supported. The legacy homepage
updates its canonical to /nba after rendering. Query states, groups, invitations,
API routes and /picks are not sitemap entries.

No lastmod is emitted: HTML uploads, template changes and live standings do not
currently have a shared, reliable content timestamp. Deployment time would be
misleading, and a new timestamp pipeline is disproportionate for four pages.

No llms.txt is added: the short public HTML pages already supply the information,
and no consumer-specific need was found. Google explicitly says these files are
not used for ranking or AI-search eligibility. No llms-full.txt or speculative
AI-specific markup is included.

IndexNow is deferred. For four stable public URLs, managing a verification key
and accurate production change submissions is more machinery than justified.
The sitemap and existing webmaster-tool submission are sufficient discovery
mechanisms for this scope; neither submission method guarantees indexing.
Revisit if the site starts publishing many frequently updated public articles.

Research used for these decisions:

- [Google's generative AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI crawler purposes and controls](https://developers.openai.com/api/docs/bots)
- [CloudFront cache policy behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html)
- [IndexNow submission protocol](https://www.indexnow.org/documentation)

## Verification and operations

Run .\scripts\check.ps1 -Scope All. Python unittest discovery includes the SEO
regression tests in GitHub Actions. Checks cover titles/descriptions, canonical
URLs, one real H1, social metadata/assets, JSON-LD relationships, static links,
deadlines, robots access, sitemap scope, dev header guards, authentication cache
isolation and actual Terraform asset-version rendering. The dev workflow also
runs the NFL/NBA leaderboard and account-modal frontend tests.

A local live dev plan requires read access to the remote Terraform state and
application resources. The constrained codex-audit role cannot read the state
bucket (403), so do not broaden that role to obtain a plan. The existing dev
GitHub Actions OIDC deployment runs and records the real plan before apply.
Review that run's plan; local Terraform validate is not a live plan.

After an explicitly authorized production promotion, inspect the four pages,
robots.txt, sitemap.xml, social image and response cache headers. Confirm no dev
noindex header on production and continued noindex on dev. Check the selected
canonical in Search Console, submit the existing sitemap, and inspect /nba.
Search engines decide whether and when to index or cite the content.
