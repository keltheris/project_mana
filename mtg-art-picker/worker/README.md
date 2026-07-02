# Manifest worker

Builds a daily lean index of Scryfall printings into Workers KV, and serves
it at `/api/prints?name=X` so the frontend stops hitting Scryfall's live
search API on every page load. See the top-level `HANDOFF.md` for why this
exists.

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

The Cron Trigger in `wrangler.toml` will run the manifest build automatically
once a day. To populate KV immediately instead of waiting for the first
scheduled run, trigger it manually:

```bash
npx wrangler dev --test-scheduled
# in another shell:
curl "http://localhost:8787/__scheduled"
```

or, against the deployed Worker, from the Cloudflare dashboard's Cron
Triggers panel ("Trigger event" button).

## Wiring the frontend to this Worker

The app calls a relative `/api/prints` path, so in production it needs to be
reachable on the same origin as the deployed frontend — either:

- deploy this Worker on a route under the same zone/domain as the Cloudflare
  Pages site (e.g. `yoursite.pages.dev/api/*` → this Worker), or
- rewrite the calls to an absolute URL if you host the Worker elsewhere.

For local development, run this Worker with `wrangler dev` (default port
8787) alongside the Vite dev server, and set `VITE_API_BASE` in the frontend's
`.env` to `http://localhost:8787` (see `mtg-art-picker/.env.example`).

## Notes

- KV data is sharded into 64 buckets (hashed by normalized card name) rather
  than one key per card, to stay well under Workers' per-invocation
  subrequest limits during the daily rebuild.
- Names with zero KV hits (e.g. a card released after the day's snapshot)
  fall back to a live Scryfall search, respecting their rate-limit guidance.
