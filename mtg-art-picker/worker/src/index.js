// Daily manifest builder for MTG Art Picker.
//
// A Cron Trigger runs this once a day, downloads Scryfall's `default_cards`
// bulk data file (https://scryfall.com/docs/api/bulk-data — their own
// recommended mechanism for this kind of bulk lookup), and writes a lean
// index into Workers KV. The read side (`/api/prints`) lives in
// functions/api/prints.js as a Cloudflare Pages Function, co-located with
// the static frontend so both serve from the same *.pages.dev origin
// without needing a custom domain. Both sides share the sharding logic in
// ../../shared/manifest.js.
//
// The `/trigger` route below lets you force a rebuild on demand (e.g. to
// populate KV for the first time, or after a code change) without needing
// to find the dashboard's Cron Trigger test button. Protected by a secret
// set via `wrangler secret put TRIGGER_SECRET` — never put that value in
// wrangler.toml or git.

import { buildManifest } from "../../shared/manifest.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildManifest(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/trigger") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Authorization") !== `Bearer ${env.TRIGGER_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      await buildManifest(env);
      return new Response("Manifest rebuilt", { status: 200 });
    } catch (e) {
      return new Response(`Failed: ${e}`, { status: 500 });
    }
  },
};
