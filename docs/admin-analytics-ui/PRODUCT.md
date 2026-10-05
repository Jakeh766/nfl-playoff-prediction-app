# Admin analytics product contract

This document covers only the private `/admin/analytics` surface in the development environment. It records implemented behavior, not a new roadmap. The deployment, provider configuration, and security setup guide remains [admin-analytics.md](../admin-analytics.md).

## Audience and access

The dashboard serves the developer with existing Cognito `admin` membership. Ordinary users cannot view its reports. The browser's group check is a navigation hint; the API verifies the authenticated token and admin membership before serving aggregate data. Missing access, sign-out, or lost admin membership clears rendered reports and returns to the public home page. Restoring the page from browser history triggers another access check and report load.

## Reports and interpretation

Five independently loaded, source-labelled sections show CloudWatch / custom analytics, GoatCounter, Google Analytics 4, Google Search Console, and Microsoft Clarity, in that order. Custom prediction activity leads the page. Each source retains its own metric definitions, notes, report dates, timezone, and retrieval time. Different audience definitions mean counts can be compared, but must not be added into a combined audience total.

The dashboard presents aggregate metrics and tables only. It has no user-level drill-down, replay viewer, or provider credentials in the browser. Public consent and tracking behavior are outside this surface and remain untouched.

## Range and refresh behavior

The initial range is the last 28 completed UTC days. Presets offer 7, 28, or 90 days; editing either date selects custom dates. The server accepts both bounds together, ordered and within the past year, for at most 93 inclusive days and no later than today. Provider labels communicate the actual report timezone. Clarity always reports the latest 72 hours at retrieval, independently of the selected dates; its note explains the six-hour summary cache.

Submitting **Update reports** disables the button, clears the previous reports immediately, announces loading, and marks the report region busy. The provider requests then resolve independently. Available reports remain useful when another provider is unavailable or needs setup. Each section distinguishes ready, cached, unavailable, and setup-needed states; a final status gives the number of available providers and explains retry/cache behavior. Missing metric values display **Unavailable**, never a fabricated zero; empty tables explain that no data was reported.

## Surface commitments

Retain the Predict Playoffs header, branding, shared fonts, colors, and controls. Organize semantic metric definition lists and captioned tables by provider. Keep range controls keyboard accessible, loading updates politely announced, and table overflow local to each table. There is no separate admin visual identity.

## Ground truth

Primary UI evidence: `frontend/admin-analytics.html`, `frontend/admin-analytics.css`, `frontend/admin-analytics.js`, and shared `frontend/styles.css`. Range/security and Clarity constraints are corroborated by `backend/lambda/admin_analytics.py` and `backend/lambda/analytics_providers.py`. These documents do not authorize production deployment or broaden access.
