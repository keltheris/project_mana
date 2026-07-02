# Deploying the beta

Everything below requires your own Cloudflare account and (for the last
step) registrar access to `project-mana.com` — none of this can be run for
you, since it needs your credentials.

## 1. Create the shared KV namespace

The daily cron job (Worker) writes to this; the read API (Pages Function)
reads from it. Same namespace, both places.

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
trigger it manually from the Cloudflare dashboard (Workers & Pages →
`mtg-art-picker-manifest` → Triggers → Cron Triggers → "Trigger event") so
KV is populated right away instead of waiting for the next scheduled run.
This run downloads and processes Scryfall's full card database, so give it
a few minutes and check the Logs tab if `/api/prints` comes back empty
afterward.

## 3. Create the Pages project

Cloudflare's dashboard now funnels this through a unified "Create a Worker →
Connect to Git" flow rather than a separate classic "Pages" product. It
expects config declared in a `wrangler.toml` rather than pure dashboard
clicks, which is why `mtg-art-picker/wrangler.toml` is committed to the repo
with `pages_build_output_dir = "dist"` and the `MANIFEST_KV` binding
(pointing at the same namespace id from step 1) already in it.

**Workers & Pages → Create → Connect to Git**, select `keltheris/project_mana`,
and on the setup screen:

- **Build command**: `npm run build`
- Expand **Advanced settings** → **Path**: `mtg-art-picker` (this is the
  monorepo-subdirectory equivalent of "root directory" — the app isn't at
  the repo root)
- Leave **Deploy command** / **Non-production branch deploy command** as
  whatever it defaults to (`wrangler deploy` / `wrangler versions upload`) —
  the committed `wrangler.toml` tells it to build this as a static site +
  Pages Functions rather than a plain Worker.

Deploy. If the branch you're deploying isn't the repo's default branch,
Cloudflare treats it as non-production and gives you a preview URL rather
than a "production" one — that's fine for beta testing.

## 4. KV binding

No separate dashboard step needed here anymore — the binding lives in the
committed `wrangler.toml` from step 3, so it's already wired up once that
first build completes.

## 5. Attach project-mana.com

**Pages project → Custom domains → Set up a custom domain** → enter
`project-mana.com` (root/apex, pointing directly at this project, per your
call). If the domain isn't already on Cloudflare, you'll be prompted to add
it as a zone and update your nameservers at your registrar first — Cloudflare
flattens apex-domain records automatically for Pages, so pointing the bare
root domain at a Pages project is supported (no need for a `www` redirect
workaround). DNS propagation and SSL cert issuance are usually done within
minutes, occasionally longer depending on registrar/nameserver timing.

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
