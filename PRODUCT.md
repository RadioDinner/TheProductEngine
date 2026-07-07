# Product

## Register

product

## Users

Three distinct users share one site:

1. **Buyers & browsers** — Holmes County area residents, a mix of Plain community members and their English neighbors. Some arrive on modern smartphones; many arrive on old shared hardware: library computers, a decade-old family PC, slow rural connections. They come to scan the latest ads, check whether something's still available, and get a seller's contact info (which requires creating an account — the site's core conversion).
2. **Sellers** — Plain-community members who post ads *by SMS from flip phones*, not through the site. They visit the website occasionally and purposefully: claim their account (SMS code + password), buy credit packs, save a card so `/BUYCREDIT` works by text, check their ads. Low digital exposure; every screen must be obvious on the first visit.
3. **The operator (admin)** — reviews every submitted ad before broadcast (with word-filter flags highlighted), edits ad text, manages credits/strikes/bans, tunes config (prices, packs, digest slots), and searches the full message audit log. Daily-driver efficiency matters here.

The website is the web face of an SMS-first classifieds marketplace: ads arrive and broadcast by text message; the site is the shop window, the cash register, and the operator's console.

## Product Purpose

ThePlainExchange.com serves a marketplace whose real product is SMS digests for people without smartphones. The site exists to:

- **Convert strangers into accounts**: anyone can browse ads publicly, but contact info is masked until login — browsing is the top of the funnel for subscribers and sellers.
- **Move money**: credit packs via Stripe, saved cards, balance history.
- **Give sellers self-service**: my ads, statuses, expiry dates.
- **Run the business**: the admin portal is where every ad is approved and every configuration lives.

Success looks like: a first-time visitor understands what this is in five seconds, finds ads instantly, and hits a clear, unintimidating path to sign up; a seller completes a credit purchase without help; the operator clears a review queue in under a minute an ad.

## Brand Personality

**Plain, honest, sturdy — with traditional print heritage.**

Like a well-built workbench or a trusted local paper: utilitarian trustworthiness, nothing flashy, everything dependable and legible. The design vocabulary draws on the community's real print tradition — classified sheets, sale bills, The Budget — expressed through typographic discipline (strong headline serifs, rules, columns, dense-but-ordered listings), not through decoration. Voice is plain-spoken and direct: short sentences, no marketing hype, no exclamation points, prices and facts up front.

Emotional goals: trust, familiarity, calm. A Plain-community seller should feel the site belongs to their world; an English buyer should find it refreshingly straightforward.

## Anti-references

- **Kitschy "Amish country" tourism** — no buggy silhouettes, quilt patterns, sepia filters, barn-wood textures, or "handcrafted" script fonts. That's the outsider's postcard view, patronizing to the people actually using it.
- **Startup SaaS gloss** — no gradients, mascot illustrations, hero-metric blocks, or growth-landing-page grammar.
- **Big-tech marketplace clone** — must not read as a Facebook Marketplace / OfferUp knockoff: no infinite-scroll photo-card masonry, no algorithmic-feed feel.
- **Craigslist chaos** — no link-dump density, inconsistent type, or cluttered sidebar noise. Print-classified *order*, not internet-classified *entropy*.

## Design Principles

1. **The listing is the interface.** Ads are the content and the marketing; chrome recedes. Every layout decision favors scannable listings over site furniture.
2. **Legibility is the luxury.** Craft shows through typography, spacing, and clarity — never through effects. If a flourish doesn't help someone read an ad or find a button, it goes.
3. **Works on the library computer.** Server-rendered, fast on slow connections, fully functional without JavaScript for browsing. Performance is a design feature, not an engineering afterthought.
4. **Print heritage, not print costume.** Earn the newspaper feel with typographic discipline — headline hierarchy, hairline rules, honest columns — not with parchment textures or antique pastiche.
5. **One obvious next step.** Low-digital-exposure users never face a fork: every page has a single clear primary action, forms are short, and error messages say what to do next in plain words.

## Accessibility & Inclusion

- **WCAG 2.2 AA** minimum across the site; body text ≥ 4.5:1 contrast.
- **Large, legible type**: body ≥ 18px; touch/click targets generous for older users and worn hardware.
- **Rural-reality hardening**: pages stay fast and functional on old devices, shared library computers, and slow connections; core flows (browse, ad detail, login, buy credits) degrade gracefully without JS.
- **Printable listings**: ad pages and the how-it-works command card print cleanly — paper is a first-class medium for this audience.
- **Reduced motion** honored everywhere; motion is sparse by design.
- Phone-number-first identity: forms assume a phone number (not email) as the primary identifier, matching how users know themselves in this system.
