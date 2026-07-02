# MTG Art Picker

A tool for picking exact card printings/art for your Magic: The Gathering decklist, using card data from Scryfall. Live at **[project-mana.com](https://project-mana.com)**.

## Architecture

- **Frontend**: this Vite/React app (`src/`), built to `dist/`.
- **`worker-entry.js`**: the Cloudflare Worker (deployed as the "projectmana" Worker) that serves the built frontend as static assets and handles `/api/prints?name=X` directly, reading from a daily-refreshed KV index instead of calling Scryfall live on every visitor's page load. Config is in the root `wrangler.toml` (uses Cloudflare's "Workers with static assets" model, not a separate classic Pages project).
- **`worker/`**: a *separate* Cloudflare Worker with a Cron Trigger that rebuilds that KV index once a day from Scryfall's bulk data, deployed independently — see `worker/README.md`.

See `DEPLOY.md` for setup-from-scratch instructions and notes on redeploying each piece.

## Local development

```bash
npm install
npm run dev      # Vite dev server for the frontend
npm run build    # builds dist/ for deployment
```

`/api/prints` needs `worker-entry.js` + KV running alongside it locally — see `DEPLOY.md` and `.env.example` for pointing the dev server at a local `wrangler dev` instance.
