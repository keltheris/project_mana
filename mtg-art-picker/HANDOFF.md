# MTG Art Picker — Handoff to Claude Code

## What this is
A React tool for picking exact card printings/art for an MTG decklist, using Scryfall's API. Built as a Vite + React project (see `mtg-art-picker/` folder — source included alongside this brief).

## Status so far
- Core app works: paste a decklist → page through printings for each card → pick art → export a formatted list.
- Verified against Scryfall's API guidelines (rate limiting, image handling, no paywalling) — compliant.
- Decided on hosting: **Cloudflare Pages**, not Netlify/Vercel, specifically because Cloudflare's free tier has unlimited bandwidth under a fair-use policy rather than metered overage billing. The owner is a hobbyist worried about a surprise bill if the tool gets popular among friends.

## Outstanding work (in priority order)

### 1. Attribution / Scryfall credit (confirmed, not yet built)
- Add a credit footer on the landing/input screen: "Card data and images via Scryfall" linking to https://scryfall.com.
- On each review "slide" (the per-card art-picking screen), add a small credit/link per printing that goes to that specific card's Scryfall page. Scryfall's card objects include a `scryfall_uri` field (not currently captured in `fetchPrints` — needs to be added to the returned object) that should be used for this link.

### 2. Daily manifest architecture (the big piece)
Goal: stop hitting Scryfall's live search API on every visitor's page load. Build:
- A **Cloudflare Worker** with a **Cron Trigger** that runs once daily, downloads Scryfall's `default_cards` **Bulk Data** file (this is Scryfall's own recommended mechanism for exactly this use case — see https://scryfall.com/docs/api/bulk-data), filters it down to a lean index (card name → array of printings: set, collector number, image URL, price, scryfall_uri), and writes it into **Workers KV**.
- A small API endpoint (`/api/prints?name=X`) on the same Worker (or a Pages Function) that the frontend calls instead of hitting Scryfall directly. Should read from KV, not call Scryfall live, except possibly as a fallback for a name with zero KV hits (very new card not yet in the daily snapshot) — in that fallback case, still respect Scryfall's rate-limit guidance (~100ms between calls).
- Update `fetchPrints()` in `App.jsx` to call this new endpoint instead of `api.scryfall.com` directly.

### 3. Deploy
- Cloudflare Pages hosting the static frontend, git-connected (owner wants a GitHub repo — was about to set this up manually via `git`/GitHub CLI when we switched to handing this off to you for native GitHub integration).
- Cloudflare Worker + KV namespace + Cron Trigger for the manifest job, deployed via `wrangler`.

## Notes on constraints already agreed with the user
- Must stay within Scryfall's API guidelines: no cropping/distorting card images, no watermarks, don't imply another game, don't paywall.
- Hosting choice (Cloudflare over Netlify/Vercel) was deliberate, driven by bandwidth-billing risk — don't second-guess back to Netlify.
- User is a hobbyist sharing this with a friend group, not planning heavy commercial traffic, but wants a real ceiling on worst-case cost.
