# Admin analytics product contract

This document covers only the private `/admin/analytics` surface in the development environment. It records implemented behavior, not a new roadmap. The deployment, provider configuration, and security setup guide remains [admin-analytics.md](../admin-analytics.md).

## Audience and access

The dashboard serves the developer with existing Cognito `admin` membership. Ordinary users cannot view its reports. The browser's group check is a navigation hint; the API verifies the authenticated token and admin membership before serving aggregate data. Missing access, sign-out, or lost admin membership clears rendered reports and returns to the public home page. Restoring the page from browser history triggers another access check and report load.

## Reports and interpretation

Three independently loaded sections show Traffic (GoatCounter), PredictPlayoffs activity (AWS), and Google Search (Search Console), in that order. Traffic/activity cover dev; search covers the configured production domain. Selected-range totals, daily selectors, running totals for additive counts, and expandable tables answer the main questions. Sessions and rates are not additive. Provider dates, timezone, freshness and missing coverage remain explicit.

Only aggregates reach the browser. Public tracking is cookieless, honors GPC/DNT and has no consent UI/state; authentication storage is unchanged.

## Range and refresh behavior

The initial range is the last 28 completed UTC days. Presets offer 7, 28, or 90 days; editing either date selects custom dates. The server accepts both bounds together, ordered and within the past year, for at most 93 inclusive days and no later than today. Provider labels communicate the actual report timezone.

Submitting **Update reports** disables the button, clears the previous reports immediately, announces loading, and marks the report region busy. The provider requests then resolve independently. Available reports remain useful when another provider is unavailable or needs setup. Each section distinguishes ready, cached, unavailable, and setup-needed states; a final status gives the number of available providers and explains retry/cache behavior. Missing metric values display **Unavailable**, never a fabricated zero; empty tables explain that no data was reported.

## Surface commitments

Retain the Predict Playoffs header, branding, shared fonts, colors, and controls. Organize semantic metric definition lists and captioned tables by provider. Keep range controls keyboard accessible, loading updates politely announced, and table overflow local to each table. There is no separate admin visual identity.

## Ground truth

Primary UI evidence: `frontend/admin-analytics.html`, `frontend/admin-analytics.css`, `frontend/admin-analytics.js`, and shared `frontend/styles.css`. Range/security and provider constraints are corroborated by `backend/lambda/admin_analytics.py` and `backend/lambda/analytics_providers.py`. These documents do not authorize production deployment or broaden access.
