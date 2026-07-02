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
Built in `worker/`:
- A Cloudflare Worker (`worker/src/index.js`) with a Cron Trigger that downloads Scryfall's `default_cards` bulk data file, filters to paper printings, and writes a lean index into Workers KV — sharded into 64 buckets (hashed by normalized card name) to stay within per-invocation subrequest limits.
- `/api/prints?name=X` on the same Worker, reading from KV, falling back to a live (rate-limited) Scryfall search only on a zero-hit name.
- `fetchPrints()` in `App.jsx` now calls this endpoint (`VITE_API_BASE` + `/api/prints`) instead of `api.scryfall.com` directly.
- Verified locally end-to-end with `wrangler dev` (local KV simulation) + the Vite dev server — confirmed the KV-hit path, the missing-name 400, and the live-fallback error path all behave correctly. Could not verify against Scryfall's real bulk data or a live Cloudflare deployment from this sandbox (no outbound network access to Scryfall, no Cloudflare account credentials here).

### 3. Deploy — not started, needs your Cloudflare account
This step needs your Cloudflare login/credentials, which aren't available in this environment. See `worker/README.md` for the exact commands (`wrangler login`, `wrangler kv namespace create`, `wrangler deploy`) and for wiring the Worker onto the same route as the Pages site. Once you've run those, ping me if anything needs adjusting.

## Notes on constraints already agreed with the user
- Must stay within Scryfall's API guidelines: no cropping/distorting card images, no watermarks, don't imply another game, don't paywall.
- Hosting choice (Cloudflare over Netlify/Vercel) was deliberate, driven by bandwidth-billing risk — don't second-guess back to Netlify.
- User is a hobbyist sharing this with a friend group, not planning heavy commercial traffic, but wants a real ceiling on worst-case cost.
