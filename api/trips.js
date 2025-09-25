// api/trips.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const idsParam = String(req.query.ids || "").trim();
  if (!idsParam) return res.status(400).json({ error: "Missing ?ids=trip_id1,trip_id2" });

  const inputIds = dedupe(idsParam.split(",").map(s => s.trim()).filter(Boolean));
  if (inputIds.length === 0) return res.status(400).json({ error: "No valid trip ids" });

  const BASE = "https://api.at.govt.nz/gtfs/v3/trips";
  const PER_TRIP_TTL_MS = 60 * 1000;           // 60 s cache per trip
  const STALE_FALLBACK_MAX_MS = 5 * 60 * 1000; // can serve stale for up to 5 min on errors
  const MAX_CONCURRENCY = 6;

  const now = Date.now();
  globalThis.__AT_TRIPS__ ||= new Map();       // Map<tripId, { data, ts }>
  globalThis.__AT_TRIPS_INFLIGHT__ ||= new Map(); // Map<tripId, Promise>
  const cache = globalThis.__AT_TRIPS__;
  const inflight = globalThis.__AT_TRIPS_INFLIGHT__;

  const results = [];
  const toFetch = [];

  for (const id of inputIds) {
    const cached = cache.get(id);
    if (cached && now - cached.ts < PER_TRIP_TTL_MS) {
      results.push(cached.data);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length) {
    // simple concurrency limiter
    const chunks = chunk(toFetch, MAX_CONCURRENCY);
    for (const group of chunks) {
      const promises = group.map(id => getTripWithCache(id, {
        base: BASE, cache, inflight, now,
        ttlMs: PER_TRIP_TTL_MS, staleMaxMs: STALE_FALLBACK_MAX_MS
      }));
      const groupResults = await Promise.all(promises);
      results.push(...groupResults.filter(Boolean));
    }
  }

  // Keep output order loosely by the input ids
  const byId = new Map(results.map(obj => [obj?.id || obj?.attributes?.trip_id, obj]));
  const ordered = inputIds
    .map(id => byId.get(id))
    .filter(Boolean);

  setSWRHeaders(res, PER_TRIP_TTL_MS, 30);
  res.setHeader("x-cache", `trips items=${ordered.length}/${inputIds.length}`);
  return res.status(200).json({ data: ordered });
}

async function getTripWithCache(id, ctx) {
  const { base, cache, inflight, now, ttlMs, staleMaxMs } = ctx;

  // reuse in-flight fetch if present
  if (inflight.has(id)) {
    try { return await inflight.get(id); } finally { inflight.delete(id); }
  }

  const cached = cache.get(id);
  const fresh = cached && now - cached.ts < ttlMs;

  if (fresh) return cached.data;

  const p = (async () => {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(id)}`, {
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
        cache: "no-store"
      });

      if (r.status === 404) return null; // skip unknown
      if (r.status === 403 || r.status === 429) {
        if (cached && now - cached.ts <= staleMaxMs) return cached.data;
        return null;
      }
      if (!r.ok) {
        if (cached && now - cached.ts <= staleMaxMs) return cached.data;
        return null;
      }

      const data = await r.json(); // expected to be { data: { id, attributes: {...} } } or { data: [...] }
      // Normalize to a single object with attributes, matching your client parser
      let node = null;
      if (data && Array.isArray(data.data)) node = data.data[0] || null;
      else if (data && data.data) node = data.data;
      else node = data; // in case API returns the object directly

      if (!node) return null;

      // Ensure attributes keys used by the client exist
      // trip_id, trip_headsign, route_id, bikes_allowed
      // We pass through whatever upstream provides.
      cache.set(id, { data: node, ts: Date.now() });
      return node;
    } catch {
      if (cached && now - cached.ts <= staleMaxMs) return cached.data;
      return null;
    }
  })();

  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function dedupe(arr) { return Array.from(new Set(arr)); }
function setSWRHeaders(res, ttlMs, swrSeconds) {
  const sMaxAge = Math.max(1, Math.floor(ttlMs / 1000));
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=${swrSeconds}`);
}
