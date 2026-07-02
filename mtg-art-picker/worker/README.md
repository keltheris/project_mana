# Manifest worker (cron only)

Runs once a day, downloads Scryfall's `default_cards` bulk data file, and
writes a lean index into Workers KV. This Worker has no HTTP-facing role
other than the `/trigger` bootstrap route described below — reads happen
through `../worker-entry.js`, the entry point for the *separate* frontend
Worker (see `../DEPLOY.md` for the full picture). Both sides share their
sharding/lookup logic from `../shared/manifest.js` so they can never
disagree about where a card's data lives in KV.

This Worker is deployed manually via `npm run deploy` from this directory —
it is **not** git-connected, so pushing to GitHub does not redeploy it.
Always redeploy manually after changing `src/index.js` or
`../shared/manifest.js` before re-triggering a manifest rebuild, or the
rebuild will run stale code.

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

**Use this same namespace id** in the frontend Worker's `wrangler.toml` (see
`../DEPLOY.md`) — this Worker writes to it, `worker-entry.js` reads from it.

The Cron Trigger in `wrangler.toml` will run the manifest build automatically
once a day. To populate KV immediately instead of waiting for the next
scheduled run — e.g. right after deploying a data-shape change — use the
`/trigger` route (in practice this has been far more reliable than hunting
for a "trigger cron now" button in the dashboard, which moves around
between Cloudflare UI versions):

```bash
npx wrangler secret put TRIGGER_SECRET   # one-time, pick any random string
npm run deploy

curl -H "Authorization: Bearer YOUR_SECRET" \
  https://mtg-art-picker-manifest.<your-subdomain>.workers.dev/trigger
```

It responds `Manifest rebuilt` on success. Verify with:

```bash
npx wrangler kv key get --binding=MANIFEST_KV --remote "manifest:info"
```

which should show a fresh `updatedAt` timestamp and a `cardCount` in the
hundreds of thousands.

For a purely local sanity check that `buildManifest()` doesn't throw
(writes to local simulated KV only, not the real remote namespace):

```bash
npx wrangler dev --test-scheduled
# in another shell:
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Notes

- KV data is sharded into 64 buckets (hashed by normalized card name) rather
  than one key per card, to stay well under Workers' per-invocation
  subrequest limits during the daily rebuild.
- Names with zero KV hits (e.g. a card released after the day's snapshot)
  fall back to a live Scryfall search, respecting their rate-limit guidance.
- **`/trigger` is meant to be temporary.** Once the daily Cron Trigger has
  been confirmed running on its own for a while, remove the `fetch` handler
  from `src/index.js` (keep only `scheduled`) and delete the secret
  (`wrangler secret delete TRIGGER_SECRET`), so there's no standing
  HTTP-triggerable endpoint left on the account.
