# Deploying

The app is live at **project-mana.com**. This doc is the reference for
setting it up from scratch (e.g. a fresh Cloudflare account, or recovering
from a deleted project) — everything below requires Cloudflare account
credentials and (for the domain step) registrar access, so none of it can be
run by an AI session; it needs to be done by hand.

## 1. Create the shared KV namespace

The daily cron job (`worker/`) writes to this; the frontend Worker
(`worker-entry.js`) reads from it. Same namespace, both places.

```bash
cd mtg-art-picker/worker
npm install
npx wrangler login
npx wrangler kv namespace create MANIFEST_KV
```

Copy the printed `id` — you'll use it twice, in steps 2 and 4.

## 2. Deploy the manifest worker

Paste the `id` from step 1 into `worker/wrangler.toml`'s `kv_namespaces`
entry (replacing `REPLACE_ME`), then:

```bash
npm run deploy
```

This deploys the Cron Trigger only (see `worker/README.md`). Once deployed,
populate KV right away instead of waiting for the next scheduled run using
the `/trigger` route — see `worker/README.md` for the exact commands (set a
`TRIGGER_SECRET`, then `curl` it). The dashboard's own "trigger cron now"
button has moved around across Cloudflare UI versions and hasn't been a
reliable way to do this. This run downloads and processes Scryfall's full
card database, so give it a few minutes and check the Worker's Logs tab if
`/api/prints` comes back empty afterward.

## 3. Create the frontend Worker

Cloudflare's dashboard now funnels git-connected deploys through a unified
"Create a Worker → Connect to Git" flow. Despite the name, this creates a
genuine Worker (not a classic separate "Pages" project) — there's no
`wrangler pages deploy` target here, only `wrangler deploy`. The static
frontend is served via a `[assets]` binding, and `/api/prints` is handled
directly in `worker-entry.js`, both declared in the committed
`mtg-art-picker/wrangler.toml` (which also has the `MANIFEST_KV` binding,
pointing at the same namespace id from step 1).

**Workers & Pages → Create → Connect to Git**, select `keltheris/project_mana`,
and on the setup screen:

- **Project name**: something dash/lowercase-only (Cloudflare rejects
  underscores) — this becomes part of the deploy command below, so know
  what you picked.
- **Build command**: `npm run build`
- Expand **Advanced settings** → **Path**: `mtg-art-picker` (this is the
  monorepo-subdirectory equivalent of "root directory" — the app isn't at
  the repo root)
- **Deploy command** / **Version command**: leave as the default
  `npx wrangler deploy` / `npx wrangler versions upload` — do **not** change
  these to `wrangler pages deploy`, that only works for classic Pages
  projects and will fail with "Project not found" here.

Deploy. If the branch you're deploying isn't the repo's default branch,
Cloudflare treats it as non-production and gives you a preview URL rather
than a "production" one — that's fine for beta testing.

If the deploy fails with an authentication/permission error on the
auto-generated build API token, go to **dash.cloudflare.com/profile/api-tokens**,
find the token this project created, and make sure it has **Account →
Workers Scripts → Edit** permission (edit the token or create a new one with
that scope, then update it in the project's Build configuration settings).

## 4. KV binding

No separate dashboard step needed here — the binding lives in the committed
`wrangler.toml` from step 3, so it's already wired up once that first
successful build completes.

## 5. Attach project-mana.com

**Worker project → Settings → Domains & Routes** (or **Custom domains**,
wording may vary) → add `project-mana.com` (root/apex, pointing directly at
this project, per your call). If the domain isn't already on Cloudflare,
you'll be prompted to add it as a zone and update your nameservers at your
registrar first. DNS propagation and SSL cert issuance are usually done
within minutes, occasionally longer depending on registrar/nameserver
timing.

## 6. Smoke test

Visit `https://project-mana.com`, paste a decklist (the "Use sample list"
button works), and confirm:
- Printings load per card (KV-backed, should be fast)
- Prices show for normal/foil/etched as applicable
- The Scryfall credit footer and per-print Scryfall links work
- Export/copy at the end produces the expected list

If printings come back empty for known cards, check that step 2's manual
cron trigger actually completed successfully (Worker Logs) and that the KV
binding name in step 4 is exactly `MANIFEST_KV`.

## Making changes later

- **Frontend / `worker-entry.js` / `shared/manifest.js`**: git-connected —
  pushing to this repo's branch auto-deploys. No manual step needed.
- **`worker/` (the cron manifest builder)**: deliberately *not*
  git-connected (see `worker/README.md`) — a push here does **not**
  redeploy it. If you change `worker/src/index.js` or
  `shared/manifest.js` and need the cron job to pick it up, you must
  manually `cd worker && npm run deploy` before re-triggering, or the
  rebuild will run stale code. This has bitten us before — the data
  changed but the manifest still had the old shape until the worker was
  redeployed by hand.
