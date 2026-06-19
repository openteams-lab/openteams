---
version: alpha-2
name: openteams-linear-design
description: "A dual-mode design system for openteams, adapted from Linear's marketing canvas. Dark mode is the default — a near-black product-focused canvas built around #010102 with a four-step surface ladder, light gray text, and the signature Linear lavender-blue (#5e6ad2) as the single chromatic accent. Light mode is the inverted counterpart — a near-white #fbfbfc canvas with the same surface ladder logic preserved (now stepping down in lightness), the same lavender accent (slightly darker on hover for contrast), and the same hairline philosophy. The system reads as software-craft documentation in both modes: dense, technical, quietly luxurious. Mode is user-toggled, not auto-detected — power users have opinions about this and we respect them."

colors:
  primary: "#5e6ad2"
  on-primary: "#ffffff"
  primary-hover-dark: "#828fff"
  primary-hover-light: "#4853c0"
  primary-focus: "#5e69d1"
  primary-tint-dark: "rgba(94, 106, 210, 0.12)"
  primary-tint-light: "rgba(94, 106, 210, 0.08)"

  dark-canvas: "#010102"
  dark-surface-1: "#0f1011"
  dark-surface-2: "#141516"
  dark-surface-3: "#18191a"
  dark-surface-4: "#191a1b"
  dark-hairline: "#23252a"
  dark-hairline-strong: "#34343a"
  dark-hairline-tertiary: "#3e3e44"
  dark-ink: "#f7f8f8"
  dark-ink-muted: "#d0d6e0"
  dark-ink-subtle: "#8a8f98"
  dark-ink-tertiary: "#62666d"
  dark-mono-bg: "#18191a"
  dark-mono-border: "#34343a"

  light-canvas: "#fbfbfc"
  light-surface-1: "#ffffff"
  light-surface-2: "#f5f6f8"
  light-surface-3: "#eef0f3"
  light-surface-4: "#e8eaee"
  light-hairline: "#e3e5ea"
  light-hairline-strong: "#d0d4dc"
  light-hairline-tertiary: "#b6bcc7"
  light-ink: "#0a0a0c"
  light-ink-muted: "#2b2d34"
  light-ink-subtle: "#62666d"
  light-ink-tertiary: "#8a8f98"
  light-mono-bg: "#f0f1f4"
  light-mono-border: "#d8dce3"

  semantic-success-dark: "#27a644"
  semantic-success-light: "#1b8c35"
  semantic-overlay: "#000000"

typography:
  display-xl:    { fontFamily: Inter, fontSize: 80px, fontWeight: 600, lineHeight: 1.05, letterSpacing: -3.0px }
  display-lg:    { fontFamily: Inter, fontSize: 56px, fontWeight: 600, lineHeight: 1.10, letterSpacing: -1.8px }
  display-md:    { fontFamily: Inter, fontSize: 40px, fontWeight: 600, lineHeight: 1.15, letterSpacing: -1.0px }
  headline:      { fontFamily: Inter, fontSize: 28px, fontWeight: 600, lineHeight: 1.20, letterSpacing: -0.6px }
  card-title:    { fontFamily: Inter, fontSize: 22px, fontWeight: 500, lineHeight: 1.25, letterSpacing: -0.4px }
  subhead:       { fontFamily: Inter, fontSize: 20px, fontWeight: 400, lineHeight: 1.40, letterSpacing: -0.2px }
  body-lg:       { fontFamily: Inter, fontSize: 18px, fontWeight: 400, lineHeight: 1.50, letterSpacing: -0.1px }
  body:          { fontFamily: Inter, fontSize: 16px, fontWeight: 400, lineHeight: 1.50, letterSpacing: -0.05px }
  body-sm:       { fontFamily: Inter, fontSize: 14px, fontWeight: 400, lineHeight: 1.50, letterSpacing: 0 }
  caption:       { fontFamily: Inter, fontSize: 12px, fontWeight: 400, lineHeight: 1.40, letterSpacing: 0 }
  button:        { fontFamily: Inter, fontSize: 14px, fontWeight: 500, lineHeight: 1.20, letterSpacing: 0 }
  eyebrow:       { fontFamily: Inter, fontSize: 13px, fontWeight: 500, lineHeight: 1.30, letterSpacing: 0.4px }
  mono:          { fontFamily: JetBrains Mono, fontSize: 13px, fontWeight: 400, lineHeight: 1.50, letterSpacing: 0 }

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px
---

# openteams Linear-style Design System

> **What this document is**
>
> Visual design specification for **openteams** — an open-source multi-agent collaboration workspace for indie developers. The system is adapted from Linear's marketing canvas with two changes:
>
> 1. **Two modes** instead of one (light mode added — Linear marketing site is dark-only)
> 2. **Monogram-based identity** for AI models (Linear's "no second chromatic accent" rule is honored — colors don't encode model identity; monograms do)
>
> Both modes share the same structural DNA: four-step surface ladder, hairline borders, lavender accent used scarcely, monospace for all numeric data.

---

## Table of Contents

1. [Overview](#overview)
2. [The two modes — when and how to choose](#the-two-modes)
3. [Colors](#colors)
4. [Typography](#typography)
5. [Layout & spacing](#layout-and-spacing)
6. [Elevation & depth](#elevation-and-depth)
7. [Shapes](#shapes)
8. [Components](#components)
9. [Mode-specific guidance](#mode-specific-guidance)
10. [Do's and don'ts](#dos-and-donts)
11. [Responsive behavior](#responsive-behavior)
12. [Iteration guide](#iteration-guide)

---

## Overview

openteams ships **two complete color modes** — dark (default) and light. Both share the same:

- Single chromatic accent: **Linear lavender** `#5e6ad2`
- Four-step surface ladder logic (canvas → surface-1 → surface-2 → surface-3)
- 1px hairline borders carrying hierarchy
- Aggressive negative letter-spacing on display type
- Monospace font in all numeric / path / status contexts
- Sentence case everywhere

### Mode philosophy

**Dark mode** is the deepest dark in this collection — `#010102` is near-pure black with a faint blue tint. On top sits a four-step ladder of dark surfaces. This is the canonical Linear feel — software-craft documentation, dense and quietly luxurious.

**Light mode** is the structural inversion: `#fbfbfc` canvas (near-white with a faint cool tint), with the surface ladder stepping **down** in lightness (surface-1 brighter than canvas via pure white, surface-2/3/4 progressively gray). Hairlines move from near-canvas-darker to mid-gray. Text inverts from `#f7f8f8` ink-on-dark to `#0a0a0c` ink-on-light.

**The accent stays the same** — `#5e6ad2` lavender works on both backgrounds, though it gets a *darker* hover state on light (`#4853c0` instead of `#828fff`) for contrast.

### Key characteristics

- **Dual-mode marketing + product system** — dark default, light opt-in
- **Lavender-blue accent** (`#5e6ad2`) used scarcely — brand mark, primary CTA, focus ring, link emphasis, run-state indicators
- **Four-step surface ladder** carries hierarchy without shadow in both modes
- **Display tracking** pulls aggressively negative (-3.0px at 80px); body holds at -0.05px
- **No second chromatic color** for categorical encoding — use monograms instead
- **No atmospheric gradients, no spotlight cards, no drop shadows**

---

## The two modes

### Why two modes (light mode rationale)

Linear's marketing site ships dark-only. openteams ships both because:

1. **Target users are indie devs** — they have strong opinions about dark vs light, and force-choosing one alienates the other camp
2. **Different contexts demand different modes** — coding at 11pm wants dark; reviewing a PR at 9am wants light
3. **System-level dark/light auto-detection is a baseline expectation** in modern dev tools (Linear, Raycast, Arc, Cursor all support both)

### When to choose which (recommendation, not enforcement)

- **Default to dark** on first install — matches Linear marketing canvas, matches the target user's "I'm in flow" mood
- **Surface the toggle prominently** — top-right of the app, in Settings, and on the marketing site
- **Remember user choice** — store in localStorage / config, don't reset on update
- **Don't auto-switch based on time of day or OS preference** — power users find this disorienting

### What stays consistent across modes

These are mode-invariant — never change them between dark and light:

- `primary` `#5e6ad2` lavender — same hex value
- All radius tokens (`xs` through `pill`)
- All spacing tokens (`xxs` through `section`)
- All typography tokens (sizes, weights, tracking)
- The four-step surface ladder *concept* (the values flip)
- Hairline-based depth model (no shadows)
- Mono usage in numeric/path/status contexts

### What changes between modes

- All surface values (canvas, surface-1/2/3/4)
- All ink values (ink, ink-muted, ink-subtle, ink-tertiary)
- All hairline values
- `primary-hover` (lighter on dark, darker on light)
- `primary-tint` opacity (0.12 on dark, 0.08 on light — light bg has less tolerance for translucent fills)
- `success` green (`#27a644` on dark, `#1b8c35` on light — darker for readability on white)
- Mono background and border tokens

---

## Colors

### Brand & accent

| Token | Value | Use |
|---|---|---|
| `primary` | `#5e6ad2` | Brand mark, primary CTA, focus ring, run-state indicator, @mention emphasis |
| `primary-hover-dark` | `#828fff` | Hover state on dark mode (lighter lavender) |
| `primary-hover-light` | `#4853c0` | Hover state on light mode (darker lavender) |
| `primary-focus` | `#5e69d1` | Focus ring tint (both modes) |
| `primary-tint-dark` | `rgba(94,106,210,0.12)` | Subtle background fill on dark (Pro badge etc.) |
| `primary-tint-light` | `rgba(94,106,210,0.08)` | Subtle background fill on light |

**Where lavender is allowed** (both modes):
- Brand wordmark + logo
- Primary CTA button background
- Run-state node left-bar indicator (the 2px stripe on a running workflow node)
- @mention in chat messages
- Focus ring on inputs and buttons
- Smart Routing card heading
- "Turn into workflow" / "Lock in $9" / other key conversion CTAs

**Where lavender is forbidden**:
- Section backgrounds (use surface ladder instead)
- Card fills (use surface ladder)
- Decorative borders
- Icons that aren't acting as primary CTAs
- Status indicators for things other than "in progress" (use success green for done)

### Dark mode surface ladder

| Token | Value | Use |
|---|---|---|
| `dark-canvas` | `#010102` | Default page background — near-pure black with faint blue tint |
| `dark-surface-1` | `#0f1011` | Default cards, panels, ship counter, workflow container |
| `dark-surface-2` | `#141516` | Featured / lifted cards (Pro tier card), workflow nodes |
| `dark-surface-3` | `#18191a` | Sub-nav, dropdown menus, running workflow node (lifted), pill toggles selected state |
| `dark-surface-4` | `#191a1b` | Deepest lift — rare, mostly nested surfaces |
| `dark-hairline` | `#23252a` | 1px borders on all cards and dividers (default) |
| `dark-hairline-strong` | `#34343a` | Emphasized borders — input focus, mono pill borders |
| `dark-hairline-tertiary` | `#3e3e44` | Tertiary borders, nested-surface separators |

### Light mode surface ladder

| Token | Value | Use |
|---|---|---|
| `light-canvas` | `#fbfbfc` | Default page background — near-white with faint cool tint, never pure white |
| `light-surface-1` | `#ffffff` | Default cards, panels — pure white provides the "lift" from canvas |
| `light-surface-2` | `#f5f6f8` | Featured / lifted cards — light gray |
| `light-surface-3` | `#eef0f3` | Sub-nav, dropdown menus, pill toggles selected state |
| `light-surface-4` | `#e8eaee` | Deepest light surface |
| `light-hairline` | `#e3e5ea` | 1px borders (default) |
| `light-hairline-strong` | `#d0d4dc` | Emphasized borders — input focus, mono pill borders |
| `light-hairline-tertiary` | `#b6bcc7` | Tertiary borders, dashed "Add member" borders |

### Critical light-mode design decision: surface-1 is `#ffffff`

In light mode the surface ladder works **inversely** from dark mode — but with a subtle twist:

- Dark mode: `canvas` is darkest, `surface-1+` step **lighter** (the surface lifts toward the eye)
- Light mode: `canvas` is light gray, `surface-1` is **pure white** (the surface lifts toward the eye)

This inversion preserves the "cards visually rise above the page" effect — they're not just darker borders on a white background, they're actual lifted surfaces. This is what makes the light mode feel **Linear** and not generic "macOS-light".

### Text on each mode

**Dark mode text:**
| Token | Value | Use |
|---|---|---|
| `dark-ink` | `#f7f8f8` | All headlines, primary body text |
| `dark-ink-muted` | `#d0d6e0` | Secondary text — meta info, hover state text |
| `dark-ink-subtle` | `#8a8f98` | Tertiary text — deselected tabs, captions, footer columns |
| `dark-ink-tertiary` | `#62666d` | Quaternary — disabled state, very subtle hints, footnotes |

**Light mode text:**
| Token | Value | Use |
|---|---|---|
| `light-ink` | `#0a0a0c` | All headlines, primary body text (near-black, not pure black — avoids harsh contrast) |
| `light-ink-muted` | `#2b2d34` | Secondary text |
| `light-ink-subtle` | `#62666d` | Tertiary text |
| `light-ink-tertiary` | `#8a8f98` | Quaternary — disabled, footnotes |

**Why near-black `#0a0a0c` and not `#000000`** — pure black on `#fbfbfc` is too high-contrast and creates "vibration" at body sizes. `#0a0a0c` still reads as "black" but rests on the eye.

### Semantic colors

| Token | Dark value | Light value | Use |
|---|---|---|---|
| `success` | `#27a644` | `#1b8c35` | Status pills, completed workflow node indicator, check-marks |
| `overlay` | `#000000` | `#000000` | Pure black overlay scrim for modals (both modes) |

**Why light-mode green is darker** — green on white has lower contrast than green on near-black. Stepping the green darker maintains readability without changing the perceived hue.

### Mono surface tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `mono-bg` | `#18191a` | `#f0f1f4` | Inline code backgrounds, mono pill backgrounds |
| `mono-border` | `#34343a` | `#d8dce3` | Mono pill borders (CL/CO/CU/GE avatars) |

---

## Typography

### Font family

- **Inter** — Primary display + text family. Open-source, available on Google Fonts. Closest free substitute to Linear's custom typeface. Weights used: 400 (regular), 500 (medium), 600 (semibold)
- **JetBrains Mono** — Mono family for code, numeric data, paths, status IDs, file names. Open-source, available on Google Fonts. Weights used: 400, 500
- **Fallback stack** — `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` for display/body; `ui-monospace, 'SF Mono', Menlo, monospace` for mono

The system treats Inter (display sizes) and Inter (text sizes) as one continuous voice. Family change between display and text is silent — same family, narrower weight range.

### Hierarchy

| Token | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `display-xl` | 80px | 600 | -3.0px | Largest hero headline (rare) |
| `display-lg` | 56px | 600 | -1.8px | Section opener headlines |
| `display-md` | 40px | 600 | -1.0px | Sub-section headlines, page titles |
| `headline` | 28px | 600 | -0.6px | Section titles, pricing tier titles |
| `card-title` | 22px | 500 | -0.4px | Onboarding h1, Pro page h1, feature card title |
| `subhead` | 20px | 400 | -0.2px | Lead body, intro paragraphs |
| `body-lg` | 18px | 400 | -0.1px | Hero subhead, lead paragraphs |
| `body` | 16px | 400 | -0.05px | Default body |
| `body-sm` | 14px | 400 | 0 | Card body, footer columns, primary UI text |
| `caption` | 12px | 400 | 0 | Captions, meta, status, sidebar items |
| `button` | 14px | 500 | 0 | All button labels |
| `eyebrow` | 13px | 500 | +0.4px | Section eyebrow (positive tracking — taxonomy marker) |
| `mono` | 13px | 400 | 0 | JetBrains Mono — paths, IDs, costs, timestamps |

### Mono usage rules

JetBrains Mono is reserved for these contexts and **only** these:

- **All cost numbers**: `$1.24 today`, `$0.34`, `$8.42 wk`
- **All token counts**: `1.2k tokens`
- **All time-relative tokens**: `2m ago`, `just now`, `12 min ago`
- **All file paths**: `AvatarLoader.tsx`, `src/pages/...`
- **All issue/PR numbers**: `#42`, `v0.3.2`
- **All status fragments**: `Claude · idle`, `Codex · coding`
- **Inline code spans**: `<span class="code">npm install</span>`
- **Monogram avatars**: `CL`, `CO`, `CU`, `GE`, `LD`, `BE`, `FE`, `QA`
- **Keyboard shortcuts**: `⌘K`
- **The "Recommended team for SaaS" preview pills** mini-monograms

### Principles

- **Aggressive negative tracking on display** — 4% of size at largest sizes
- **Single voice from display to body** — same family, narrower weights
- **Eyebrow uses positive tracking** (+0.4px) — marks it as taxonomy / metadata
- **Mono carries "machine precision"** — never decorative, always meaningful

---

## Layout and spacing

### Spacing system

Base unit: **4px**. Tokens scale on 4px grid.

| Token | Value | Use |
|---|---|---|
| `xxs` | 4px | Micro gaps between icon + text |
| `xs` | 8px | Default gap inside a card row |
| `sm` | 12px | Gap between cards in a tight grid |
| `md` | 16px | Standard card interior padding |
| `lg` | 24px | Card interior padding for feature/pricing cards |
| `xl` | 32px | Testimonial card padding |
| `xxl` | 48px | CTA banner padding, section spacing on mobile |
| `section` | 96px | Spacing between major page sections |

### Component-internal gap rules

- Sidebar items: 5px vertical, 7px horizontal — they're 12px font and need tight packing
- Workflow nodes: 6px gap between nodes (they're separate units, not a continuous list)
- Message gaps in chat: 16px between messages (more breathing room — reading-heavy)
- Pill button padding: 6px vertical, 14px horizontal — Linear's compact button spec

### Grid & container

- Max content width: 1280px
- Three-column app layout: 200px sidebar / flex main / 200px right sidebar
- Onboarding modal: ~480px wide, centered
- Pro page card grid: 2-up always (Free vs Pro), no third tier

### Whitespace philosophy

- **Dark mode**: the dark canvas IS the whitespace. Sections separate by surface lift, not by gaps
- **Light mode**: the near-white canvas IS the whitespace. Same logic — surface-1 (`#ffffff`) cards lift above the canvas (`#fbfbfc`) and create visual rhythm

Within a card, generous 24px gaps. Between sections, 96px.

---

## Elevation and depth

Linear's depth model is **surface ladder + hairlines** — no shadows. openteams follows the same model in both modes.

### Dark mode elevation

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No border, sits directly on canvas | Body text, footer |
| 1 (lift to surface-1) | `surface-1` bg, 1px `hairline` border | Default cards |
| 2 (lift to surface-2) | `surface-2` bg, 1px `hairline` border | Featured pricing card, workflow nodes |
| 3 (lift to surface-3) | `surface-3` bg, 1px `hairline-strong` border | Sub-nav, dropdowns, running workflow node |
| 4 (focus ring) | 2px `primary-focus` outline at 50% opacity | Focused input/button |

### Light mode elevation

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No border, sits directly on canvas | Body text, footer |
| 1 (lift to surface-1 white) | `surface-1` (`#ffffff`) bg, 1px `hairline` border | Default cards |
| 2 (lift to surface-2 light gray) | `surface-2` bg, 1px `hairline` border | Featured pricing card, workflow nodes |
| 3 (lift to surface-3) | `surface-3` bg, 1px `hairline-strong` border | Sub-nav, dropdowns, running workflow node |
| 4 (focus ring) | 2px `primary-focus` outline at 50% opacity | Focused input/button |

**Critical light-mode rule**: NEVER use drop shadows to indicate elevation. The light-mode temptation is strong — "shadows look natural on white" — but it breaks Linear's design DNA. Use the surface ladder.

### Decorative depth

- **Product UI screenshots** dominate marketing pages (when they exist)
- **No atmospheric gradients** in either mode
- **No spotlight cards**
- **Dark mode** can use a *very subtle* 1px top-edge highlight (`rgba(255,255,255,0.03)`) on lifted panels for "pixel-rendered" feel — optional
- **Light mode** does not need this — the surface lift is visible on its own

---

## Shapes

### Border radius

Identical across both modes:

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Status chips, small inline badges, mono code pills |
| `sm` | 6px | Inline tags, sidebar item active state |
| `md` | 8px | All buttons, inputs, primary CTAs, smaller cards |
| `lg` | 12px | Pricing cards, feature cards, workflow container, onboarding modal |
| `xl` | 16px | Product screenshot panels (marketing) |
| `xxl` | 24px | Oversized CTA banners (rare) |
| `pill` | 9999px | Mode switch, pricing tab toggles, status pills, message model tags, monogram avatars |

### Critical rule

**No rounded corners on single-sided borders.** If using `border-left` accent (e.g., on a workflow node), set `border-radius: 0` on that side. Rounded corners only work with full borders on all sides.

Example: A workflow node with `border-left: 2px solid var(--primary)` gets `border-radius: 0 6px 6px 0` — flat on the accent edge.

---

## Components

### Buttons (both modes)

**`button-primary`** — Lavender CTA. Default primary action.
- Background `primary`, text `#ffffff`, padding 8px 14px, rounded `md`
- Hover: shift to `primary-hover-dark` (dark mode) or `primary-hover-light` (light mode)
- Focus: 2px `primary-focus` outline at 50%

**`button-secondary`** — Surface button with hairline. Used for "Open PR", "Add member", etc.
- Background `surface-3`, text `ink-muted`, 1px `hairline-strong`, padding 5px 9px, rounded `xs`
- Hover: lift to next surface level

**`button-ghost`** — Transparent surface button. Used for "Already on Free".
- Background `surface-3` (subtle), text `ink-muted`, 1px `hairline-strong`, padding 8px 13px, rounded `md`

**`button-dashed`** — Add member / add to team CTAs.
- Background transparent, 1px dashed `hairline-strong`, text `ink-tertiary`, full width, rounded `md`

### Sidebar items (both modes)

**`sb-item-default`** — Inactive sidebar row.
- Background transparent, text `ink-subtle`, 12px font, 5px 8px padding, rounded `xs`

**`sb-item-active`** — Active row.
- Background `surface-1`, text `ink`, 1px `hairline` border, padding 4px 7px (compensating for added border), weight 500

### Workflow nodes (both modes)

**`node-done`** — Completed step.
- Background `surface-2`, 1px `hairline` border, 2px `success` left accent, rounded `0 6px 6px 0`

**`node-run`** — Currently executing.
- Background `surface-3` (lifted to next level — visually "alive"), 1px `hairline` border, 2px `primary` left accent

**`node-wait`** — Pending step.
- Same as `node-done` styling but `opacity: 0.45`

### Mono pill / monogram avatar (both modes)

The product-defining identity element. Replaces colored model badges.

- Size: 22px × 22px (workflow nodes), 28px × 28px (chat avatars), 20px × 20px (right sidebar), 16px × 16px (onboarding preview)
- Background `mono-bg`, 1px `mono-border`
- Text: JetBrains Mono 9px (small) to 10px (chat), weight 500, color `ink-muted`
- Border-radius: 50% (pill shape)
- Content: 2-letter monogram (`CL` = Claude, `CO` = Codex, `CU` = Cursor, `GE` = Gemini, `LD` = Lead, `BE` = Backend, `FE` = Frontend, `QA` = QA)

**The user avatar exception**: When showing the human user (vs an AI member), the avatar background is `primary` lavender with white text. This is the ONE place lavender appears as a fill in non-CTA context — it marks "you, the human, in a sea of AI".

### Pricing cards (both modes)

**`pricing-card-free`**
- Background `surface-1`, 1px `hairline`, rounded `lg`, padding 16px 14px

**`pricing-card-pro`** (featured)
- Background `surface-2`, 1px `primary` border (this is the rare 1px primary border use — featured emphasis), rounded `lg`, padding 16px 14px

### Input bar (both modes)

- Background `surface-1`, 1px `hairline`, rounded `md`, padding 10px 12px
- Placeholder text in `ink-tertiary`
- Actions (right): inline buttons with 6px gap

### Top bar / quick-ask (both modes)

- Background `canvas` (no lift — sits flush against page)
- 1px `hairline` bottom border (defines the boundary)
- Internal chips (repo, cost) sit on `surface-1` with `hairline` borders

---

## Mode-specific guidance

This section lives only in this two-mode system. If you're working in only one mode, ignore the other column.

### When designing a new component, check both modes simultaneously

The biggest failure mode is "looks great in dark, ugly in light" or vice versa. Test both before shipping.

### Light mode pitfalls (and how to avoid them)

| Pitfall | Why it happens | Fix |
|---|---|---|
| Pure white background looks sterile | Light mode tempts `#ffffff` everywhere | Use `#fbfbfc` canvas, reserve `#ffffff` for surface-1 (lifted cards) |
| Hairlines disappear | 1px `#e3e5ea` on `#ffffff` can be too subtle | Keep hairline at `#e3e5ea` — it's deliberately subtle, matches Linear's "quiet" feel. If a border MUST be more visible, use `hairline-strong` |
| Lavender CTA looks too "playful" | Saturated purple on white reads bouncy | Use `primary-hover-light` (`#4853c0`) for hover — darker than dark-mode hover. The default state stays `#5e6ad2` |
| Success green looks washed out | `#27a644` on `#ffffff` reads less assertive | Step to `#1b8c35` (light-mode success) — same hue, more depth |
| Mono code pills look bulky | Strong border + light bg = harsh | Light-mode mono-bg is `#f0f1f4` (subtle gray), mono-border is `#d8dce3` (slightly darker) — soft on the eye |
| Inline `@mention` color too light | `primary-hover-dark` (`#828fff`) is invisible on white | Use `primary` (`#5e6ad2`) for mentions in light mode — slightly darker than dark mode's mention color |

### Dark mode pitfalls (and how to avoid them)

| Pitfall | Why it happens | Fix |
|---|---|---|
| Pure black canvas (`#000000`) | Tempting because "Linear is black" | Use `#010102` — has a faint blue tint, more luxurious |
| Lavender feels "neon" | Saturated lavender on near-black can vibrate | Don't reduce saturation — instead reduce *area*. Use lavender on smaller surfaces only |
| Charcoal panels disappear | If surface-1 is too close to canvas, no lift | Keep `surface-1` at `#0f1011` — the 14-unit step is deliberate |
| Text reads "fuzzy" | Pure white (`#ffffff`) on near-black is too high-contrast | Use `#f7f8f8` ink — the slight gray softens it |
| Mono pills look gray-on-gray | `mono-bg` and `surface-3` are similar | Always pair mono-bg with mono-border — the border is what defines it |

---

## Do's and don'ts

### Do (both modes)

- Reserve `primary` lavender for the **5–6 designated locations**: brand mark, primary CTA, focus ring, run-state indicator, @mention, smart routing card heading
- Use the four-step surface ladder for hierarchy — never skip levels
- Pair display weight 600 with body weight 400 — resist 700+
- Apply negative letter-spacing aggressively on display
- Use mono in ALL numeric contexts — costs, paths, times, IDs, monograms
- Test components in both modes before declaring them done
- Default new install to dark mode
- Remember user's mode preference

### Don't (both modes)

- Don't use lavender as a section background or card fill
- Don't introduce a second chromatic accent (no orange / pink / cyan / etc.)
- Don't add atmospheric gradients
- Don't add drop shadows
- Don't pill-round buttons (CTAs are `md` 8px, not `pill`)
- Don't use `#000000` true black or `#ffffff` true white as canvas
- Don't auto-switch modes based on time or OS — let the user choose
- Don't encode model identity by color — use monograms

---

## Responsive behavior

### Breakpoints

| Name | Width | Key changes |
|---|---|---|
| Desktop-XL | 1440px+ | Default desktop layout |
| Desktop | 1280px | Three-column app layout, two-up Pro grid maintained |
| Tablet | 1024px | Right sidebar collapses to drawer toggle |
| Mobile-Lg | 768px | Left sidebar becomes hamburger overlay; pricing 2-up → 1-up |
| Mobile | 480px | Single-column app; display sizes scale ~50% |

### Touch targets

- CTAs ≥ 40px tap height across viewports
- Pill toggles ≥ 36px on desktop, ≥ 44px on touch viewports
- Form inputs ≥ 44px tap target on touch

### Collapsing strategy

- **Top bar**: Quick-ask shrinks to icon-only at <768px (preserves it)
- **Cost chip**: collapses to icon + today's number only at <768px
- **Sidebars**: left and right both collapse to drawer toggles at <1024px
- **Workflow DAG**: nodes stay full-width even on mobile (it's the protagonist)

---

## Iteration guide

1. **Focus on ONE component at a time** and reference it by its token name
2. **When introducing a section**, decide which surface lift it lives on first
3. **Default body to `body` at weight 400**
4. **Test new components in BOTH modes** — keep a side-by-side preview while iterating
5. **Add new variants as separate component entries** in this doc
6. **Treat lavender as scarce** — brand mark, primary CTA, focus, link emphasis, run-state indicator. Six locations total
7. **Lead every page with the actual product UI** when shipping marketing content
8. **Update tokens here, not in component CSS** — single source of truth

---

## Known gaps & future work

- **The four-step surface ladder values** are extracted from Linear's `--color-bg-level-*` CSS variables for dark mode. Light mode values are inferred from Linear's product app (which does have a light theme even though marketing doesn't ship one)
- **Form-field error/validation styling** is not yet documented. When added, use `red` semantic color, but stay scarce
- **Auto-switching by OS preference** is intentionally not supported — the toggle is user-controlled. May revisit if user research shows otherwise
- **High-contrast accessibility mode** is not specified. WCAG AA contrast should be verified for both modes before launch
- **Linear's actual product UI** uses a richer color-tag palette (red/orange/yellow/green/blue/purple) for issue priorities. openteams **deliberately does not** — monograms carry identity, lavender carries action, success green is the only other meaningful color

---

## Reference implementation

See `openteams-design-prototypes.html` for working examples of all three prototypes (Workflow mode, Free chat mode, Onboarding + Pro) in both dark and light modes. Toggle at the top-right.

The HTML is the executable spec — when this document and the HTML disagree, the HTML wins. Update both together.
