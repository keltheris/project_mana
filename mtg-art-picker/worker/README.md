# Manifest worker (cron only)

Runs once a day, downloads Scryfall's `default_cards` bulk data file, and
writes a lean index into Workers KV. This Worker has no HTTP-facing role —
reads happen through `functions/api/prints.js`, a Cloudflare Pages Function
co-located with the frontend (see `../DEPLOY.md` for the full picture).
Both sides share their sharding/lookup logic from `../shared/manifest.js` so
they can never disagree about where a card's data lives in KV.

## One-time setup (requires your own Cloudflare account)

```bash
cd worker
npm install
npx wrangler login

# Creates the KV namespace and prints its id.
npx wrangler kv namespace create MANIFEST_KV
```

Paste the printed `id` into `wrangler.toml`'s `kv_namespaces` entry (replacing
`REPLACE_ME`), then deploy:

```bash
npm run deploy
```

**Use this same namespace id** when adding the KV binding to the Pages
project (see `../DEPLOY.md`) — the Worker writes to it, the Pages Function
reads from it.

The Cron Trigger in `wrangler.toml` will run the manifest build automatically
once a day. To populate KV immediately instead of waiting for the first
scheduled run, trigger it manually from the Cloudflare dashboard's Worker →
Triggers → Cron Triggers panel ("Trigger event" button), or locally:

```bash
npx wrangler dev --test-scheduled
# in another shell:
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

(Local runs write to local simulated KV only, not your real remote
namespace — this is just for checking `buildManifest()` doesn't throw.)

## Notes

- KV data is sharded into 64 buckets (hashed by normalized card name) rather
  than one key per card, to stay well under Workers' per-invocation
  subrequest limits during the daily rebuild.
- Names with zero KV hits (e.g. a card released after the day's snapshot)
  fall back to a live Scryfall search, respecting their rate-limit guidance.
