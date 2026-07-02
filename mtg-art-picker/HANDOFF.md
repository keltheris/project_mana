# MTG Art Picker — Handoff to Claude Code

## What this is
A React tool for picking exact card printings/art for an MTG decklist, using Scryfall's API. Built as a Vite + React project (see `mtg-art-picker/` folder — source included alongside this brief).

## Status so far
- Core app works: paste a decklist → page through printings for each card → pick art → export a formatted list.
- Verified against Scryfall's API guidelines (rate limiting, image handling, no paywalling) — compliant.
- Decided on hosting: **Cloudflare Pages**, not Netlify/Vercel, specifically because Cloudflare's free tier has unlimited bandwidth under a fair-use policy rather than metered overage billing. The owner is a hobbyist worried about a surprise bill if the tool gets popular among friends.

## Outstanding work (in priority order)

### 1. Attribution / Scryfall credit — done
- Credit footer on the input screen ("Card data and images via Scryfall" → https://scryfall.com).
- Per-printing link to that print's Scryfall page on the review slide, using `scryfall_uri` (now captured in `fetchPrints`'s returned shape).

### 2. Daily manifest architecture — built, not yet deployed
- A Cloudflare Worker (`worker/src/index.js`) with a Cron Trigger that downloads Scryfall's `default_cards` bulk data file, filters to paper printings, and writes a lean index into Workers KV — sharded into 64 buckets (hashed by normalized card name) to stay within per-invocation subrequest limits.
- `/api/prints?name=X` is a Cloudflare Pages Function (`functions/api/prints.js`), co-located with the static frontend so it serves from whatever domain the Pages project is on (no custom Worker route or separate domain needed). Reads from KV, falling back to a live (rate-limited) Scryfall search only on a zero-hit name.
- Sharding/lookup logic lives once in `shared/manifest.js`, imported by both the Worker (writer) and the Pages Function (reader), so they can't disagree about where a card lives in KV.
- `fetchPrints()` in `App.jsx` calls `/api/prints` (via `VITE_API_BASE` for local dev) instead of `api.scryfall.com` directly.
- Verified locally end-to-end with `wrangler pages dev` (local KV simulation) — confirmed the KV-hit path returns the right shape, the missing-name case 400s, and the live-fallback error path is handled cleanly. Could not verify against Scryfall's real bulk data or a live Cloudflare deployment from this sandbox (no outbound network access to Scryfall, no Cloudflare account credentials here).

### 3. Deploy — needs your Cloudflare account, steps documented
Full step-by-step commands are in `DEPLOY.md`, including wiring up the custom domain **project-mana.com** (root domain → this Pages project, per your call). Ping me once you've gone through it if anything needs adjusting.

### 4. Price display — done
Each printing thumbnail shows normal/foil/etched-foil prices independently (whichever apply to that printing), sourced from Scryfall's `prices.usd` / `usd_foil` / `usd_etched`. Note: Scryfall does not provide condition-based pricing (NM/LP/MP/HP/DMG) — their price data is one aggregate market price per finish, not per listing/condition. A condition filter was considered and dropped for that reason; getting real condition pricing would require a separate marketplace API integration (e.g. TCGplayer's own API), which is out of scope for now.

## Notes on constraints already agreed with the user
- Must stay within Scryfall's API guidelines: no cropping/distorting card images, no watermarks, don't imply another game, don't paywall.
- Hosting choice (Cloudflare over Netlify/Vercel) was deliberate, driven by bandwidth-billing risk — don't second-guess back to Netlify.
- User is a hobbyist sharing this with a friend group, not planning heavy commercial traffic, but wants a real ceiling on worst-case cost.
- Custom domain: project-mana.com, root domain pointed directly at this app.
