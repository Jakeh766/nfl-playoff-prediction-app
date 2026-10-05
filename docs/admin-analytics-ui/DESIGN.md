---
name: Predict Playoffs admin analytics
description: The incumbent Predict Playoffs visual system applied to private aggregate reporting.
colors:
  ink: "#10223a"
  muted: "#647084"
  paper: "#f5f3ee"
  line: "#dcd9d1"
  surface: "#ffffff"
  field-border: "#c9c8c2"
  red: "#e33b3f"
  red-dark: "#b7202d"
  blue: "#1859a9"
  blue-dark: "#0d3972"
  danger-text: "#b7202d"
  warning-text: "#73520d"
  table-header-tint: "rgba(16, 34, 58, 0.035)"
  row-hover: "rgba(24, 89, 169, 0.04)"
typography:
  display:
    fontFamily: '"Oswald", Impact, sans-serif'
    fontSize: "clamp(36px, 5vw, 54px)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Oswald", Impact, sans-serif'
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.25
  metric:
    fontFamily: '"Oswald", Impact, sans-serif'
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: '"DM Sans", system-ui, sans-serif'
  note:
    fontFamily: '"DM Sans", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: '"DM Sans", system-ui, sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
rounded:
  button: "6px"
  field: "8px"
spacing:
  small: "8px"
  control-gap: "16px"
  section: "24px"
  heading: "32px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "white"
    rounded: "{rounded.button}"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.red-dark}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 18px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
---

# Design System: Predict Playoffs admin analytics

## Overview

**Creative North Star: "Predict Playoffs incumbent system"**

This bounded record describes the completed admin surface, not a replacement identity. The page inherits the public application's cream grid, ink text, red action emphasis, condensed headings, and shared header/button primitives. Provider reports use flat sections, definition lists, and tables to keep dense information legible.

**Key Characteristics:**
- Incumbent branding and controls.
- Provider-labelled information hierarchy.
- Flat report sections and tabular numbers.
- Responsive local table overflow.

## Colors

### Primary
Red emphasizes the update action and the active navigation underline. Its darker variant supplies the primary button hover state.

### Neutral
Paper forms the page background; ink carries primary text; muted carries definitions, ranges, and status. Lines divide provider sections and table rows. White surfaces and field-border strokes define editable controls. Table-header-tint and row-hover provide restrained table feedback.

The inherited `prefers-color-scheme: dark` overrides remain authoritative: text becomes light, paper dark, and fields, borders, and status colors adapt. The frontmatter records default light values; retain shared CSS variables for theme-aware rendering rather than hard-coding these defaults.

Blue provides inherited focus treatment and selection; danger and warning text distinguish unavailable and setup-needed states without replacing their explicit labels.

**The Shared Palette Rule.** Use the shared theme variables for this surface; do not introduce a separate provider palette.

## Typography

**Display Font:** Oswald, with Impact and sans-serif fallbacks.
**Body Font:** DM Sans, with system-ui and sans-serif fallbacks.

The page title uses the shared uppercase treatment. Provider headings and prominent metric values use condensed Oswald; controls, explanations, and tables use DM Sans. Definitions and provider ranges are small but explicitly separate from the larger metric values. Metrics and tables use tabular numerals. Explanation text is bounded to 75 characters; metric notes to 28 characters.

**The Definition Beside Value Rule.** Keep metric definitions and provider notes adjacent to the values they qualify.

## Layout

The report container caps at 1200px with 32px side gutters and a 48px top margin. Reports form two equal desktop columns with 48px row and 40px column gaps. Custom analytics and Search Console span both columns. Standard metrics use three columns; custom metrics use five.

At 850px and below, reports become one column and custom metrics become three columns. At 540px and below, gutters shrink to 16px, the top margin to 32px, and all metric lists use two columns. Range controls use two columns on small screens, with the preset and submit action spanning both. Tables scroll within their own wrappers. Shared navigation wraps below 760px.

**The Provider Boundary Rule.** Preserve separate provider sections and their range/state labels at every viewport size.

## Elevation & Depth

Report sections stay flat and use top borders, whitespace, and table tints for separation. The page background inherits a subtle red radial glow and a 28px grid. Shared primary buttons carry soft red shadows and a one-pixel hover lift. This surface does not use raised report cards.

## Shapes

Controls have gently rounded corners: buttons use the shared button radius; date/select fields and the development marker use the field radius. Provider sections and tables remain open, rectangular structures separated by rules.

## Components

### Buttons
The update action uses the shared red primary button; sign-out uses the shared outlined ghost button. Both inherit compact bold DM Sans, state transitions, hover lift, and disabled opacity. The update button disables during loading. Inside the main region, the local two-pixel focus outline overrides the shared button outline; the header button retains the shared focus ring.

### Inputs / Fields
Visible labels sit above the date/select fields. Fields have a 44px minimum height and inherited blue focus border/halo, plus the local visible-focus outline. Their colors adapt to the shared theme.

### Navigation
The shared brand and uppercase navigation anchor the surface. Hover/current links use ink text and a red underline. Mobile navigation wraps using the existing header rules; the wordmark is hidden below 760px.

### Provider reports
Each section pairs its heading with an explicit state, followed by actual range, timezone, and retrieval time where available. Semantic definition lists carry metric labels, values, and notes. Table captions identify reports; the first column is left aligned and may wrap, while numeric columns align right. Table rows use inherited hover tint. Loading, unavailable, and setup-needed messages occupy the same provider boundary.

## Do's and Don'ts

### Do:
- **Do** retain shared theme variables, fonts, branding, and button states.
- **Do** preserve source labels, definitions, and tabular numeric alignment.
- **Do** keep horizontal table overflow local and metric grids responsive.

### Don't:
- **Don't** introduce a separate admin visual identity or colored provider cards.
- **Don't** replace metric definitions with decorative icons or unlabeled numbers.
- **Don't** treat the default light palette as a reason to remove inherited dark mode.

Evidence: `frontend/admin-analytics.html`, `frontend/admin-analytics.css`, `frontend/admin-analytics.js`, and `frontend/styles.css`. Scope is this surface only. One-off typography overrides and unrelated public-page components are deliberately excluded from the reusable vocabulary.
