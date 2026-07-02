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

### 2. Daily manifest architecture — built and populated
- A Cloudflare Worker (`worker/src/index.js`) with a Cron Trigger that downloads Scryfall's `default_cards` bulk data file, filters to paper printings, and writes a lean index into Workers KV — sharded into 64 buckets (hashed by normalized card name) to stay within per-invocation subrequest limits. Stream-parses the bulk file (see the big comment in `shared/manifest.js`) rather than buffering it whole — the first real deploy hit a memory-limit error doing that, since the file is hundreds of MB.
- `/api/prints?name=X` is handled directly in `worker-entry.js`, the entry point for the deployed "projectmana" Worker (falls through to `env.ASSETS.fetch()` for everything else, serving the built frontend). **Note:** this started out built as a Cloudflare Pages Function (`functions/api/prints.js`) on the assumption of a classic separate Pages project, but the dashboard's "Create a Worker → Connect to Git" flow actually creates a genuine Worker using the newer "Workers with static assets" model — no such thing as a Pages project existed for it to attach to. Reworked into `worker-entry.js` + `[assets]` binding in `wrangler.toml` once that became clear; `functions/` was deleted.
- Sharding/lookup logic lives once in `shared/manifest.js`, imported by both `worker/` (the cron writer) and `worker-entry.js` (the reader), so they can't disagree about where a card lives in KV.
- `fetchPrints()` in `App.jsx` calls `/api/prints` (via `VITE_API_BASE` for local dev) instead of `api.scryfall.com` directly.
- Manually triggered once via the temporary `/trigger` endpoint (see the TODO below) — confirmed **106,351 printings** loaded into KV from real Scryfall data.

### 3. Deploy — in progress
Full step-by-step commands are in `DEPLOY.md`, including wiring up the custom domain **project-mana.com** (root domain → this Worker, per your call). Deploy has been a longer back-and-forth than expected because Cloudflare's dashboard flow didn't match what `DEPLOY.md` originally assumed (see the note in item 2 above) — docs have been corrected as we've gone.

**TODO — remove after beta:** `worker/src/index.js` currently has a `/trigger` HTTP route (gated on a `TRIGGER_SECRET`) added to bootstrap KV manually since a dashboard "trigger cron now" button wasn't easy to find. This was explicitly agreed to be temporary — once beta testing confirms the daily Cron Trigger is running on its own, remove the `fetch` handler from that file (keep only `scheduled`) and delete the `TRIGGER_SECRET` secret (`wrangler secret delete TRIGGER_SECRET`), so there's no standing HTTP-triggerable endpoint on the account.

### 4. Price display — done
Each printing thumbnail shows normal/foil/etched-foil prices independently (whichever apply to that printing), sourced from Scryfall's `prices.usd` / `usd_foil` / `usd_etched`. Note: Scryfall does not provide condition-based pricing (NM/LP/MP/HP/DMG) — their price data is one aggregate market price per finish, not per listing/condition. A condition filter was considered and dropped for that reason; getting real condition pricing would require a separate marketplace API integration (e.g. TCGplayer's own API), which is out of scope for now.

## Notes on constraints already agreed with the user
- Must stay within Scryfall's API guidelines: no cropping/distorting card images, no watermarks, don't imply another game, don't paywall.
- Hosting choice (Cloudflare over Netlify/Vercel) was deliberate, driven by bandwidth-billing risk — don't second-guess back to Netlify.
- User is a hobbyist sharing this with a friend group, not planning heavy commercial traffic, but wants a real ceiling on worst-case cost.
- Custom domain: project-mana.com, root domain pointed directly at this app.
