// Daily manifest builder + read API for MTG Art Picker.
//
// Instead of every visitor hitting Scryfall's live search API, a Cron
// Trigger runs once a day, downloads Scryfall's `default_cards` bulk data
// file (https://scryfall.com/docs/api/bulk-data — their own recommended
// mechanism for this kind of bulk lookup), and writes a lean index into
// Workers KV. The `/api/prints` endpoint below serves from that index,
// falling back to a live Scryfall search only for names with zero KV hits
// (e.g. a card released after today's snapshot).

const SHARD_COUNT = 64;
const SCRYFALL_BULK_DATA_URL = "https://api.scryfall.com/bulk-data";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
// Scryfall asks API consumers to identify themselves with a descriptive UA.
const USER_AGENT = "mtg-art-picker (https://scryfall.com/docs/api bulk-data consumer)";

function normalizeName(name) {
  return name.trim().toLowerCase();
}

// FNV-1a: cheap, deterministic, no dependency on Node/Workers crypto APIs.
function shardFor(normalizedName) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalizedName.length; i++) {
    hash ^= normalizedName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SHARD_COUNT;
}

function leanPrinting(card) {
  const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null;
  if (!img) return null;
  const priceUsd = card.prices?.usd
    ? parseFloat(card.prices.usd)
    : card.prices?.usd_foil
    ? parseFloat(card.prices.usd_foil)
    : null;
  return {
    id: card.id,
    set: (card.set || "").toUpperCase(),
    setName: card.set_name,
    cn: card.collector_number,
    image: img,
    priceUsd,
    tcgplayerId: card.tcgplayer_id || null,
    scryfallUri: card.scryfall_uri || null,
    releasedAt: card.released_at || "",
  };
}

async function buildManifest(env) {
  const bulkRes = await fetch(SCRYFALL_BULK_DATA_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!bulkRes.ok) throw new Error(`bulk-data listing failed: ${bulkRes.status}`);
  const bulkJson = await bulkRes.json();
  const entry = (bulkJson.data || []).find((d) => d.type === "default_cards");
  if (!entry) throw new Error("default_cards bulk entry not found");

  const dataRes = await fetch(entry.download_uri, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!dataRes.ok) throw new Error(`bulk data download failed: ${dataRes.status}`);

  // NOTE: default_cards is a large file (hundreds of MB). Buffering it whole
  // via .json() is the simplest correct option and fits comfortably within
  // Workers' limits at today's file size. If Scryfall's dataset grows enough
  // to trip memory or CPU limits on your plan, replace this with an
  // incremental/streaming JSON parser instead of loading it all at once.
  const cards = await dataRes.json();

  const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
  let cardCount = 0;

  for (const card of cards) {
    if (!card.games?.includes("paper")) continue;
    const printing = leanPrinting(card);
    if (!printing) continue;

    const key = normalizeName(card.name);
    const bucket = shards[shardFor(key)];
    (bucket[key] ??= []).push(printing);
    cardCount++;
  }

  for (const bucket of shards) {
    for (const key of Object.keys(bucket)) {
      bucket[key].sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : -1));
      for (const p of bucket[key]) delete p.releasedAt;
    }
  }

  await Promise.all(
    shards.map((bucket, i) => env.MANIFEST_KV.put(`shard:${i}`, JSON.stringify(bucket)))
  );
  await env.MANIFEST_KV.put(
    "manifest:info",
    JSON.stringify({ updatedAt: new Date().toISOString(), shardCount: SHARD_COUNT, cardCount })
  );
}

async function liveFallback(name) {
  // Scryfall's rate-limit guidance is ~50-100ms between requests; this path
  // only runs for the rare zero-KV-hit case (e.g. a brand new card), never
  // per-visitor in bulk.
  await new Promise((r) => setTimeout(r, 100));
  const q = `!"${name.replace(/"/g, '\\"')}" unique:prints game:paper`;
  const url = `${SCRYFALL_SEARCH_URL}?order=released&dir=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Scryfall returned ${res.status} for "${name}"`);
  }
  const json = await res.json();
  return (json.data || []).map(leanPrinting).filter(Boolean);
}

function jsonResponse(body, init) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/prints") {
      return new Response("Not found", { status: 404 });
    }

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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildManifest(env));
  },
};
