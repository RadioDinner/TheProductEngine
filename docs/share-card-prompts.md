# The forwardable share card — prompts for ChatGPT and Claude Design

One image about the service that a member can forward to a friend by text.
Mostly seen on small screens, so it is built tall and read at arm's length.

## Read this first: the two tools are not equally good at this

A share card is mostly **words** — nine prices and commands and a phone
number, all of which have to be exactly right. That matters for which tool you
reach for:

- **Claude Design builds the card out of real text** (it writes a web page and
  the letters are actual letters). Prices, the phone number and the commands
  come out perfect and stay editable. This is the one to use for the real
  thing.
- **ChatGPT's image generator draws a picture *of* text.** It is very good at
  look and feel and unreliable at spelling — expect "ThePlainExchang", a
  mangled phone number, or a price that quietly changes. Use it for the
  artwork and the border, and plan on the text needing a fix.

The prompt below for ChatGPT is therefore written to keep the wording short
and repeat the must-be-exact facts, which is the best any image model does.
**Proofread every number before you send it to anybody.**

Suggested output: **1080 × 1920** (a phone screen, 9:16). Export the final
file **under 600 KB** — carriers compress or reject bigger MMS attachments,
and a card nobody can forward is not a card.

---

## Prompt 1 — for ChatGPT (image generation)

> Create a single vertical image, 1080 × 1920 pixels, designed to be
> forwarded by text message and read on a small phone screen. It is an
> announcement card for a rural classifieds service.
>
> **Style:** a clean printed broadside — the look of an old country
> newspaper's classified page or a hand-set letterpress notice. Cream or
> off-white paper background with a subtle paper texture. Deep ink-black text.
> One single restrained accent color, a muted barn red or forest green, used
> only for the headline rule and the date banner. A simple thin double-rule
> border around the whole card.
>
> **Important content rules:** No photographs of people and no faces
> anywhere — this is for a Plain (Amish and Mennonite) community, where
> photographs of people are not welcome. No modern smartphone imagery, no app
> screenshots, no logos of other companies, no glossy marketing photography,
> no stock-photo look. Any decoration should be small, simple line-drawn
> engravings in the style of an old catalog: a horse, a buggy wheel, a hand
> bell, a sheaf of wheat, a fence post. Keep decoration sparse — the words are
> the point.
>
> **Typography:** a strong condensed serif for the headline, a clean readable
> serif for the body. Type must be LARGE — this will be viewed as a small
> image on a flip phone or an older smartphone, so favor few words at big
> sizes over many words at small sizes. Generous margins. Clear space between
> sections, with thin horizontal rules separating them.
>
> **Lay the card out in this order, top to bottom:**
>
> 1. Headline: **THE PLAIN EXCHANGE**
> 2. Under it, smaller: *Classifieds by text*
> 3. A banner strip, in the accent color: **ADS START MONDAY, AUGUST 31**
> 4. A short line: *Text your ad. It goes out to the whole list the same day.*
> 5. A section headed **WHAT IT COSTS**, as four short lines:
>    Text ad — $20 · 1 picture — $30 · 2 pictures — $40 · 3 pictures — $50
> 6. A short highlighted line: **First 200 members get $40 in free ad credit**
> 7. A section headed **HOW IT WORKS**, three short lines:
>    Text AD and your ad · Ads send 7am–6pm, Monday–Saturday ·
>    Reply PIC and the ad number to see the pictures
> 8. At the bottom, largest element after the headline, the call to action:
>    **TEXT START TO (330) 960-7170**
> 9. Under it, small: *ThePlainExchange.com — every ad, every picture, free by
>    email*
>
> Render every number and every word above EXACTLY as written, with correct
> spelling — especially the phone number **(330) 960-7170**, the four dollar
> amounts, the date **August 31**, and the web address
> **ThePlainExchange.com**. Do not invent additional text, taglines, or fine
> print. Do not add a company logo mark.

**After it generates:** zoom in and check the phone number digit by digit, the
four prices, and the web address. If any are wrong, ask it to regenerate with
"keep the exact layout and style, fix only the text" — and if it keeps
mangling them, use the Claude Design version instead.

---

## Prompt 2 — for Claude Design

> Design a single vertical share card for **The Plain Exchange**, a
> classifieds-by-text service for Ohio's Plain (Amish and Mennonite)
> communities. It is meant to be forwarded person-to-person by text message,
> so it will mostly be seen on small and older phone screens. Build it as a
> tall page at a 9:16 ratio (1080 × 1920) that I can screenshot as one image.
>
> **Audience and tone.** Plain readers. Understated, plainspoken, and
> practical — no hype, no exclamation marks, no marketing voice, no emoji.
> Think a well-set printed notice, not an app landing page. Do not include
> photographs or illustrations of people or faces. Any ornament should be
> simple line work, sparse, and secondary to the words.
>
> **Design direction.** A printed broadside: cream paper background, deep ink
> text, one muted accent color (barn red or forest green) used sparingly for
> rules and the date banner. Thin double-rule border. Strong condensed serif
> headline, readable serif body, thin horizontal rules between sections.
> Type must run LARGE — this is read as a small forwarded image, so prefer
> fewer words at bigger sizes, with real breathing room between blocks. The
> phone number at the bottom should be the second-loudest thing on the card
> after the name.
>
> **Content — use these exact words and numbers:**
>
> - Name: **The Plain Exchange**
> - Subtitle: Classifieds by text
> - Banner: **Ads start Monday, August 31**
> - Line: Text your ad. It goes out to the whole list the same day.
> - **What it costs** — Text ad $20 · 1 picture $30 · 2 pictures $40 ·
>   3 pictures $50
> - Callout: **The first 200 members get $40 in free ad credit**
> - **How it works** — Text `AD` and your ad · Ads send 7am–6pm, Monday
>   through Saturday · Reply `PIC` and the ad number to get the pictures ·
>   Reply `BAL` for your balance, `SOLD` and the number when it sells
> - **What you can get ads for** (set small, as one tidy run-on line or a
>   two-column list): buggies & bikes, dogs & puppies, lawn & garden, horses &
>   tack, household & furniture, hunting & fishing, livestock, machinery,
>   wanted & everything else — or all of them
> - Call to action, large: **Text START to (330) 960-7170**
> - Footer, small: ThePlainExchange.com — every ad and every picture, and free
>   by email if you'd rather
>
> Every price, the date, and the phone number must appear exactly as written
> above. Don't add taglines, fine print, or a logo mark I didn't give you.
>
> Then show me a second version with the same content in a slightly warmer,
> less formal layout, so I can pick between them.

**Why this one asks for two versions:** it costs you nothing and the second
draft is usually the one you keep.

---

## Facts on the card, and where they come from

Everything above is drawn from what the system actually does today, so the
card and the welcome texts agree:

| On the card | Source |
| --- | --- |
| $20 / $30 / $40 / $50 | `lib/config.ts` — `costTextCents`, `photoPricesCents` |
| $40 credit, first 200 | `starterCreditCents`, `starterCreditLimit` |
| 7am–6pm, Mon–Sat | `smsWindowStartHour`, `smsWindowEndHour`, `smsQuietDays` |
| AD / PIC / BAL / SOLD | the welcome package, `lib/categories.ts` |
| The nine categories | `CATEGORIES` in `lib/categories.ts` |
| (330) 960-7170 | `site.smsNumber` |
| ThePlainExchange.com | `site.webHost` |

If any of those change in Settings, the card is out of date — it's a printed
thing, not a live page.

**One thing to decide before sending:** August 31, 2026 is a Monday, which is
the first day of a send week. Good day to launch on.
