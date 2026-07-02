// Entry point for the deployed static site + /api/prints, using
// Cloudflare's "Workers with static assets" model. Static files come from
// the dist/ build via the ASSETS binding (see wrangler.toml); everything
// else is handled here. This is a different Cloudflare resource from
// worker/ (the daily cron manifest builder) — they're deployed separately
// but share the sharding/lookup logic in shared/manifest.js.

import { normalizeName, shardFor, liveFallback } from "./shared/manifest.js";

function jsonResponse(body, init) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/prints") {
      const name = url.searchParams.get("name");
      if (!name) {
        return jsonResponse({ error: "missing name" }, { status: 400 });
      }

      const key = normalizeName(name);
      const bucket = await env.MANIFEST_KV.get(`shard:${shardFor(key)}`, "json");
      let prints = bucket?.[key];

      if (!prints || prints.length === 0) {
        try {
          prints = await liveFallback(name);
        } catch (e) {
          return jsonResponse({ error: String(e) }, { status: 502 });
        }
      }

      return jsonResponse(prints, { headers: { "Cache-Control": "public, max-age=3600" } });
    }

    return env.ASSETS.fetch(request);
  },
};
