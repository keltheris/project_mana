// Shared between worker/src/index.js (the daily cron builder) and
// functions/api/prints.js (the Pages Function that reads what the cron
// job wrote). Keeping the sharding/normalization logic in one place is
// load-bearing: if the writer and reader ever computed shard indexes
// differently, every lookup would silently miss.

export const SHARD_COUNT = 64;
const SCRYFALL_BULK_DATA_URL = "https://api.scryfall.com/bulk-data";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
// Scryfall asks API consumers to identify themselves with a descriptive UA.
const USER_AGENT = "mtg-art-picker (https://scryfall.com/docs/api bulk-data consumer)";

export function normalizeName(name) {
  return name.trim().toLowerCase();
}

// FNV-1a: cheap, deterministic, no dependency on Node/Workers crypto APIs.
export function shardFor(normalizedName) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalizedName.length; i++) {
    hash ^= normalizedName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SHARD_COUNT;
}

function parsePrice(v) {
  return v ? parseFloat(v) : null;
}

export function leanPrinting(card) {
  const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null;
  if (!img) return null;
  return {
    id: card.id,
    set: (card.set || "").toUpperCase(),
    setName: card.set_name,
    cn: card.collector_number,
    image: img,
    prices: {
      usd: parsePrice(card.prices?.usd),
      usdFoil: parsePrice(card.prices?.usd_foil),
      usdEtched: parsePrice(card.prices?.usd_etched),
    },
    tcgplayerId: card.tcgplayer_id || null,
    scryfallUri: card.scryfall_uri || null,
    releasedAt: card.released_at || "",
  };
}

export async function buildManifest(env) {
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

export async function liveFallback(name) {
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
