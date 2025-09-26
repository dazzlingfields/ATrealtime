// api/trips.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = (s) => (s || "").trim();
  const idsParam = (req.query.ids || "").toString();
  const ids = [...new Set(idsParam.split(",").map((x) => key(x)).filter(Boolean))];

  if (ids.length === 0) {
    // Nothing to do; return empty list in same shape your client expects
    return ok(res, { data: [] }, 5);
  }

  const now = Date.now();
  const PER_ID_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const STALE_FALLBACK_MS = 20 * 60 * 1000; // 20 minutes
  const MAX_CONCURRENCY = 4;

  // Global per-id cache + per-id in-flight map
  globalThis.__AT_TRIPS_CACHE__ ||= new Map();    // id -> { data, ts }
  globalThis.__AT_TRIPS_PENDING__ ||= new Map();  // id -> Promise
  const cache = globalThis.__AT_TRIPS_CACHE__;
  const pending = globalThis.__AT_TRIPS_PENDING__;

  // Helper to get one trip (with cache + dedupe)
  const fetchOne = async (id) => {
    // fresh cache?
    const c = cache.get(id);
    if (c && now - c.ts < PER_ID_TTL_MS) return c.data;

    // in-flight?
    if (pending.has(id)) return pending.get(id);

    const p = (async () => {
      const url = `https://api.at.govt.nz/gtfs/v3/trips/${encodeURIComponent(id)}`;
      const r = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
        cache: "no-store",
      });

      // 403/429: serve stale for this id if available
      if (r.status === 403 || r.status === 429) {
        const body = await safeBody(r);
        const old = cache.get(id);
        if (old && now - old.ts <= STALE_FALLBACK_MS) return old.data;
        const err = new Error(`Upstream error: ${r.status}`);
        err.status = r.status; err.body = body;
        throw err;
      }

      if (!r.ok) {
        const body = await safeBody(r);
        // 404 -> treat as missing; do not fail whole batch
        if (r.status === 404) return null;
        const err = new Error(`Upstream error: ${r.status}`);
        err.status = r.status; err.body = body;
        throw err;
      }

      const data = await r.json(); // keep original GTFS v3 shape
      cache.set(id, { data, ts: Date.now() });
      return data;
    })().finally(() => pending.delete(id));

    pending.set(id, p);
    return p;
  };

  // Small concurrency pool
  const results = [];
  let i = 0;
  const runNext = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const tripObj = await fetchOne(id);
        if (tripObj && tripObj.data) {
          // upstream responds { data: {...} } for single id; wrap to object
          results.push(tripObj.data);
        } else if (tripObj && Array.isArray(tripObj.data)) {
          // if ever returns array shape
          results.push(...tripObj.data);
        } else if (tripObj && tripObj.attributes) {
          // raw object with attributes
          results.push({ attributes: tripObj.attributes, id: tripObj.id });
        }
        // null (404) -> skip
      } catch (e) {
        // non-fatal per-id; skip but expose one header for visibility
        res.setHeader("x-trip-error", (e?.message || "").slice(0, 120));
      }
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, ids.length) }, runNext);
  await Promise.all(workers);

  // Return in the shape your client expects: { data: [ {attributes...} ] }
  return ok(res, { data: results.filter(Boolean) }, 10);
}

function ok(res, payload, ttlSeconds) {
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${Math.max(1, ttlSeconds)}, stale-while-revalidate=60`
  );
  return res.status(200).json(payload);
}

async function safeBody(r) { try { return await r.text(); } catch { return ""; } }
