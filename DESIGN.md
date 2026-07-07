<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: The Plain Exchange
description: SMS-first classifieds for the Plain community — the web face of a text-message marketplace.
---

# Design System: The Plain Exchange

## 1. Overview

**Creative North Star: "The Plain Ledger"**

A well-kept ledger on a general-store counter: ruled lines, ordered entries, two inks, nothing wasted. This system takes its cues from three printed objects — **The Budget** weekly paper (dense, orderly classified columns trusted *because* they're plain), **Lehman's hardware catalog** (practical goods presented plainly yet generously — plain is not the same as sparse), and **Field Notes memo books** (utilitarian print discipline executed with modern precision). The result should feel like a trusted local institution that happens to be a website: quiet, legible, and orderly, with warmth carried by generous type and honest structure rather than by tint or texture.

What this system explicitly rejects (from PRODUCT.md): kitschy "Amish country" tourism, startup SaaS gloss, big-tech marketplace grammar, and Craigslist entropy. Its own named trap, one tier deeper, is **hipster letterpress cosplay** — distressed textures, ornate badges, crossed arrows, "EST." crests. Print heritage here is structural (hierarchy, rules, columns), never nostalgic costume.

Motion is **responsive, not choreographed**: interactions acknowledge the user (hover, focus, form feedback, gentle page/list transitions) but nothing performs. All motion has a reduced-motion fallback, and no content ever depends on an animation to become visible.

**Key Characteristics:**
- Paper-and-ink restraint: true off-white ground, near-black text, one working accent
- Newspaper information density: listings are the interface; chrome recedes
- Serif headlines over a plainspoken sans — heritage via typography, not decoration
- Ruled structure: hairlines and columns do the organizing work shadows would do elsewhere
- Big, legible, unhurried: 18px+ body, generous targets, fast on old hardware

## 2. Colors

Two inks on honest paper: near-black carries the words, deep ink blue carries meaning, and the paper stays out of the way. All exact values `[to be resolved during implementation]` in OKLCH.

### Primary
- **Ink Blue** (deep fountain-pen / ledger blue — `[to be resolved]`): the second ink. Primary buttons, links, focus rings, "NEW" markers, active states. Banking-adjacent trust, never decorative.

### Neutral
- **Paper** (true off-white, chroma ≈ 0 — `[to be resolved]`): the body background. Deliberately *not* cream, sand, or parchment — a warm-tinted ground is the tourist-shop move this system bans.
- **Ink** (near-black — `[to be resolved]`): body and headline text. Full-strength; no feather-gray "elegance".
- **Rule** (light neutral gray — `[to be resolved]`): hairline rules, table lines, dividers — the ledger's ruling.

### Named Rules
**The Second Ink Rule.** Ink Blue appears on at most ~10% of any screen, and only where it *means* something: an action, a link, a status. If blue is ever decoration, it's wrong.

**The No-Parchment Rule.** The paper is a true off-white with no warm tint. Heritage is carried by typography and rules, never by tinted or textured backgrounds.

## 3. Typography

**Display Font:** `[serif — to be chosen at implementation]` — a newspaper-headline serif with real presence at large sizes.
**Body Font:** `[sans — to be chosen at implementation]` — a plainspoken, highly legible humanist sans for UI, forms, and running text.

**Character:** The serif speaks (mastheads, page titles, ad headlines); the sans works (navigation, forms, buttons, metadata). Confident but never shouting — closer to a broadsheet's news pages than to a wood-type poster.

### Hierarchy
- **Display** (serif, large but disciplined): masthead and page titles only.
- **Headline** (serif, medium weight): ad titles in listings and detail pages — the most-repeated typographic element on the site; it must scan beautifully in a dense column.
- **Body** (sans, ≥18px, comfortable line-height): running text, forms, descriptions. 65–75ch max line length.
- **Label** (sans, small, medium weight): metadata — ad numbers, dates, statuses, prices. Set in the sans, not in fussy small caps.

### Named Rules
**The Working Sans Rule.** Everything interactive (buttons, inputs, nav) is set in the sans. The serif never labors on a form.

## 4. Elevation

Flat by default. Depth is conveyed the way a newspaper conveys it: hairline rules, column structure, and tonal steps between paper and a slightly deeper surface — not shadows. Shadows are reserved exclusively for true overlays (menus, dialogs), where a single modest ambient shadow signals "this sits above the page."

### Named Rules
**The Ruled-Not-Raised Rule.** If a container needs separation, reach for a hairline rule or a tonal step first. A shadow on a resting surface is prohibited.

## 6. Do's and Don'ts

### Do:
- **Do** let listings carry the page — density with order is the brand ("the listing is the interface").
- **Do** set body text at full-contrast ink on paper, ≥18px, ≥4.5:1.
- **Do** use Ink Blue only for meaning: actions, links, statuses (**The Second Ink Rule**).
- **Do** keep every page fast and functional on old hardware and without JavaScript for browsing ("works on the library computer").
- **Do** make ad pages and the command cheat-sheet print cleanly — paper is a first-class medium.

### Don't:
- **Don't** drift toward *hipster letterpress cosplay*: no distressed textures, ornate badges, crossed arrows, ribbons, or "EST." crests.
- **Don't** use kitschy "Amish country" tourism imagery: no buggy silhouettes, quilt patterns, sepia filters, barn-wood textures, or handcrafted script fonts (PRODUCT.md, verbatim).
- **Don't** use startup SaaS gloss: no gradients, gradient text, mascot illustrations, or hero-metric blocks (PRODUCT.md).
- **Don't** imitate big-tech marketplaces: no infinite-scroll photo-card masonry, no algorithmic-feed feel (PRODUCT.md).
- **Don't** recreate Craigslist chaos: no link-dump density or inconsistent type — print-classified *order*, not internet-classified *entropy* (PRODUCT.md).
- **Don't** tint the background warm ("cream", "parchment", "linen") — see **The No-Parchment Rule**.
- **Don't** use side-stripe borders, glassmorphism, or identical icon-heading-text card grids anywhere.
