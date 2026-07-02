// Cloudflare Pages Function serving GET /api/prints?name=X. Reads the
// manifest written daily by worker/src/index.js's cron job. Requires a
// MANIFEST_KV binding configured in the Pages project (Settings > Functions
// > KV namespace bindings), pointing at the same namespace the worker
// writes to.

import { normalizeName, shardFor, liveFallback } from "../../shared/manifest.js";

function jsonResponse(body, init) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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
