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

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect
to Git**, select the `keltheris/project_mana` repo, and set:

- **Root directory**: `mtg-art-picker`
- **Build command**: `npm run build`
- **Build output directory**: `dist`

Deploy. The site will build and serve, but `/api/prints` won't work yet —
that's the next step.

## 4. Bind KV to the Pages project

**Pages project → Settings → Functions → KV namespace bindings → Add
binding**:

- Variable name: `MANIFEST_KV`
- KV namespace: the same one from step 1

Save, then retry/redeploy so the binding takes effect.

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
