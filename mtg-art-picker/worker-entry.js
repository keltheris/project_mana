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

const FEEDBACK_REPO = "keltheris/project_mana";
const FEEDBACK_TYPE_LABELS = { bug: "Bug", feature: "Feature idea", other: "Feedback" };
const FEEDBACK_MAX_LENGTH = 3000;
const FEEDBACK_RATE_LIMIT = 5; // submissions per IP per hour

// Reuses the MANIFEST_KV binding as a lightweight per-IP counter — this
// endpoint is public, so without it a single caller could spam issues onto
// the repo directly via curl, bypassing the in-app form entirely.
async function checkFeedbackRateLimit(env, ip) {
  const key = `feedback:rl:${ip}`;
  const current = await env.MANIFEST_KV.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= FEEDBACK_RATE_LIMIT) return false;
  await env.MANIFEST_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

async function handleFeedback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "invalid JSON" }, { status: 400 });
  }

  // Honeypot: a hidden field real visitors never see or fill. Bots that
  // fill in every form field trip it; report fake success so they move on
  // rather than retrying.
  if (body.website) {
    return jsonResponse({ ok: true });
  }

  const type = FEEDBACK_TYPE_LABELS[body.type] ? body.type : "other";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 3 || message.length > FEEDBACK_MAX_LENGTH) {
    return jsonResponse({ error: "message must be between 3 and 3000 characters" }, { status: 400 });
  }
  const stage = typeof body.stage === "string" ? body.stage.slice(0, 40) : "unknown";

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await checkFeedbackRateLimit(env, ip))) {
    return jsonResponse({ error: "Too many submissions — try again later" }, { status: 429 });
  }

  if (!env.GITHUB_FEEDBACK_TOKEN) {
    return jsonResponse({ error: "Feedback is not configured" }, { status: 503 });
  }

  const typeLabel = FEEDBACK_TYPE_LABELS[type];
  const titleSnippet = message.slice(0, 60).replace(/\s+/g, " ");
  const title = `[Beta feedback] ${typeLabel}: ${titleSnippet}${message.length > 60 ? "…" : ""}`;
  const issueBody = [
    message,
    "",
    "---",
    `Type: ${typeLabel}`,
    `App stage: ${stage}`,
    `Submitted: ${new Date().toISOString()}`,
    "_Submitted via the in-app feedback form._",
  ].join("\n");

  const ghRes = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "project-mana-feedback-worker",
    },
    body: JSON.stringify({ title, body: issueBody, labels: ["beta-feedback", type] }),
  });

  if (!ghRes.ok) {
    return jsonResponse({ error: "Failed to submit feedback" }, { status: 502 });
  }

  return jsonResponse({ ok: true });
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

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      return handleFeedback(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
