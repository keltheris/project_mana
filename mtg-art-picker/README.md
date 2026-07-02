# MTG Art Picker

A tool for picking exact card printings/art for your Magic: The Gathering decklist, using card data from Scryfall.

## Architecture

- **Frontend**: this Vite/React app (`src/`), deployed on **Cloudflare Pages**.
- **`/api/prints?name=X`**: a Cloudflare Pages Function (`functions/`) that reads from a daily-refreshed KV index instead of calling Scryfall live on every visitor's page load.
- **`worker/`**: a separate Cloudflare Worker with a Cron Trigger that rebuilds that KV index once a day from Scryfall's bulk data.

See `HANDOFF.md` for the full history/rationale and `DEPLOY.md` for step-by-step deploy instructions.

## Local development

```bash
npm install
npm run dev      # Vite dev server for the frontend
npm run build    # builds dist/ for deployment
```

`/api/prints` needs the Pages Function + KV running alongside it locally — see `DEPLOY.md` and `.env.example` for pointing the dev server at a local `wrangler pages dev` instance.
