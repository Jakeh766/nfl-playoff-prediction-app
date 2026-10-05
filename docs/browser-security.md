# Bracket and browser security

The API validates submissions independently of the browser. NFL team and division
membership lives in `backend/lambda/app.py`; seeds 1–4 must be the four division
winners, with three distinct wild cards at seeds 5–7. Each winner must belong to
its reconstructed game. The Divisional round reseeds surviving teams, pairing
the first seed with the lowest surviving seed. Conference champions determine
the two Super Bowl participants; only one of those champions may win it. The
wire format has no separate participant fields that a client could override.

Only the documented `divisionWinners`, `seeds`, `picks`, and `bracketBuilt: true`
properties are accepted. Missing/extra properties and malformed or incomplete
brackets receive HTTP 400 before a DynamoDB write. NBA keeps its fixed bracket
and now shares the strict shape checks. Existing saved records are not migrated;
an invalid old prediction must be corrected before it can be saved again.

## Sessions

The static browser app retains persistent Cognito bearer tokens in localStorage
to preserve sign-in across tabs and browser restarts. Moving them to sessionStorage
would not prevent XSS from reading them. The Cognito browser client now issues
refresh tokens valid for **7 days**, instead of 30 days. Access/ID tokens remain
valid for one hour and refresh silently during those seven days. Weekly sign-in
is a deliberate compromise between the lifetime of stolen credentials and normal
use. Existing refresh tokens can retain their originally issued validity until
expiry or revocation; changing the client setting is not an immediate purge.

Sign-out clears both current and legacy local storage before network calls,
preserves GlobalSignOut, and also attempts RevokeToken with the refresh token.
The latter works when the access token has expired. Revocation stays enabled on
the app client. Remote revocation can fail offline; local sign-out still completes.
GlobalSignOut runs first so revoking the current grant cannot invalidate the
access token needed to sign out other sessions.

Cognito credentials and tokens are sent only to the configured Cognito HTTPS
endpoint in POST bodies; API bearer tokens remain in Authorization headers.
Cognito requests omit cookies and referrers and disable caching. Parser and auth
error logs use fixed messages, and provider response messages are not rendered.
Tokens are never passed to the application's analytics event payloads or URLs.

## CSP and response headers

The shared Terraform application module attaches an overriding CloudFront
response headers policy to both static assets/pages and `/api/*`. The existing
dev policy is moved in Terraform state, preserving its identity. Dev keeps
`X-Robots-Tag: noindex, nofollow`; production omits that header. Committing this
configuration to dev does not apply it to production.

The CSP uses `default-src 'self'`, prohibits inline script handlers and eval,
blocks objects and frames, limits base URLs and forms to self, and disallows
framing through `frame-ancestors 'none'`. Inline JSON-LD uses SHA-256 hashes
calculated from the exact published HTML. Styles come from self and Google
Fonts; fonts come from self and fonts.gstatic.com. There is no `unsafe-inline`,
`unsafe-eval`, or hostname wildcard. Existing dynamic visual styles use individual
DOM style properties, which work with this policy.

Resource sources are first-party assets/API, the regional Cognito API,
a.espncdn.com team logos, Google Fonts, Google Analytics' explicitly listed
non-advertising endpoints, and Microsoft's Clarity script/collection endpoints.
The 26 Clarity collector hosts are listed individually without a scheme: host
sources inherit HTTPS from the document, which CloudFront enforces. This keeps
the policy within CloudFront's 1783-character limit without a wildcard. GoatCounter
script and collection endpoints are allowed only on dev. The policy does not
enable advertising, tag-manager preview, or arbitrary third-party scripts.

Other headers are `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and Permissions-Policy denying camera, microphone,
geolocation, payment, and USB. HSTS with max-age 31536000 is configured only for a
production custom domain, without includeSubDomains or preload. No production
deployment is part of this change.

GA4 and Clarity retain the existing explicit-consent, DNT, and GPC behavior.
First-party events are allowlisted; optional identifiers are random and created
only after consent. GA4 receives sanitized page URLs/referrers and fixed event
fields, without account or bracket data. Clarity masks the page and skips URLs
or referrers with fragments or unapproved query parameters. GoatCounter remains
independent of optional consent on dev, respects DNT/GPC, and sends only sanitized
aggregate page data. No error-reporting SDK is present. Provider JavaScript still
has the origin's privileges: masking and sanitized events are not an isolation
boundary against a compromised provider.

## Residual architectural risk

An XSS flaw in allowed first-party code, a compromised allowed third-party script,
or a malicious browser extension can still read bearer tokens in memory/storage
and act as the user. CSP reduces injection paths and exfiltration destinations;
it does not eliminate that risk. Fully isolating the refresh token from JavaScript
requires a server/BFF that holds tokens and uses Secure HttpOnly cookies, including
an appropriate CSRF design. That redesign is intentionally outside this task.

API Gateway's JWT authorizer validates signatures and expiration rather than
checking Cognito revocation on every API request. A stolen access token can
therefore remain usable at the API until its one-hour expiry, even after Cognito
revocation. Immediate API revocation would require additional server-side checks
or a different authorizer. See [AWS token revocation documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html).

The domain allowlist follows [Google's non-advertising CSP guidance](https://developers.google.com/tag-platform/security/guides/csp)
and [Microsoft's Clarity collector guidance](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp).
Recheck it if either provider changes resource hosts or if advertising features
are deliberately enabled in the future.

## Verification

Run `scripts/check.ps1 -Scope All`. The tests exercise manipulated submissions
without writes, valid NFL/NBA saves and reopen, all NFL Wild Card outcomes with
reseeding, token persistence/refresh/revocation, token-sensitive errors, existing
analytics consent, and real Terraform-rendered CSP hashes/domain lists for both
environments. Terraform format/validate cover bootstrap, dev, and prod without
applying infrastructure. Dev's GitHub Actions OIDC workflow supplies the live
Terraform plan/apply; never run a local apply or broaden the audit role for it.
