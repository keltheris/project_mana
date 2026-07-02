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

import { buildManifest } from "../../shared/manifest.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildManifest(env));
  },
};
