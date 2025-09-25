// api/trips.js
// Accepts /api/trips?ids=ID1,ID2 and fans out to GET {BASE}/{id} per id.
// Merges results into { data: [...] }. Respects Retry-After exactly (with small jitter)
// and does NOT do exponential doubling server-side.

let cacheById = new Map();      // id -> { body: string, expiry: number }
let inflightById = new Map();   // id -> Promise<string|null>
let blockUntilTs = 0;           // circuit breaker until this timestamp

const TTL_MS = 5000;            // cache each trip for 5 s
const CONCURRENCY = 6;          // parallel upstream calls
const DEFAULT_RETRY_MS = 30000; // if upstream gives no Retry-After
const JITTER_PCT = 0.10;        // up to +10% jitter

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const base = process.env.UPSTREAM_TRIPS_BASE; // e.g. https://api.at.govt.nz/gtfs/v3/trips
  if (!base) return res.status(500).json({ error: "Missing UPSTREAM_TRIPS_BASE env var" });

  const now = Date.now();
  if (now < blockUntilTs) {
    const retry = Math.max(1, Math.ceil((blockUntilTs - now) / 1000));
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Temporarily rate limited" });
  }

  const ids = getIds(req.url);
  if (!ids.length) {
    res.setHeader("Cache-Control", "public, max-age=2, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json({ data: [] });
  }

  try {
    // fetch with a global rate-limit trap that stops all workers if any sees 429
    let rateErr = null;
    const results = await fetchManyWithLimit(ids, CONCURRENCY, async (id) => {
      if (rateErr) return null; // short-circuit once a 429 has been seen
      try {
        return await fetchTrip(id, base);
      } catch (e) {
        if (e && e.__rateLimit) {
          rateErr = e;
          return null;
        }
        return null; // drop failed id
      }
    });

    if (rateErr && rateErr.retryAfterMs) {
      // respect upstream Retry-After exactly with small jitter
      const jitter = Math.floor(rateErr.retryAfterMs * JITTER_PCT * Math.random());
      const waitMs = rateErr.retryAfterMs + jitter;
      blockUntilTs = Date.now() + waitMs;
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(waitMs / 1000))));
      return res.status(429).json({ error: "Temporarily rate limited" });
    }

    // Merge successful items
    const merged = [];
    for (const r of results) {
      if (!r) continue; // null means 404/failed
      try {
        const json = JSON.parse(r);
        if (Array.isArray(json?.data)) merged.push(...json.data);
        else if (json?.data) merged.push(json.data);
        else if (Array.isArray(json)) merged.push(...json);
        else merged.push(json);
      } catch {
        // ignore malformed item
      }
    }

    res.setHeader("Cache-Control", "public, max-age=2, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json({ data: merged });
  } catch (e) {
    // last-resort degradation to keep UI alive
    console.error("trips aggregation error", e);
    res.setHeader("Cache-Control", "public, max-age=2, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json({ data: [] });
  }
};

// Fetch a single trip with per-id cache and coalescing.
// Throws an object { __rateLimit: true, retryAfterMs } on 429 so the caller can propagate it.
async function fetchTrip(id, base) {
  const now = Date.now();

  // serve from per-id cache
  const hit = cacheById.get(id);
  if (hit && hit.expiry > now) return hit.body;

  // coalesce concurrent requests for the same id
  if (inflightById.has(id)) return inflightById.get(id);

  const p = (async () => {
    try {
      const url = buildTripUrl(base, id);
      const upstream = await fetch(url, {
        cache: "no-store",
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY }
      });

      if (upstream.status === 429) {
        const ra = upstream.headers.get("Retry-After");
        const retryAfterMs = parseRetryAfterMs(ra) || DEFAULT_RETRY_MS;
        throw { __rateLimit: true, retryAfterMs };
      }

      if (upstream.status === 404) return null; // drop missing ids quietly

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        console.error("trip upstream error", upstream.status, upstream.statusText, "id:", id, "body:", text?.slice(0, 200));
        return null;
      }

      const body = await upstream.text();
      cacheById.set(id, { body, expiry: Date.now() + TTL_MS });
      return body;
    } finally {
      inflightById.delete(id);
    }
  })();

  inflightById.set(id, p);
  return p;
}

// helpers

function buildTripUrl(base, id) {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${b}/${encodeURIComponent(id)}`;
}

function getIds(u) {
  try {
    const i = typeof u === "string" ? u.indexOf("?") : -1;
    if (i < 0) return [];
    const qs = new URLSearchParams(u.slice(i));
    const v = qs.get("ids");
    if (!v) return [];
    return v.split(",").map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseRetryAfterMs(v) {
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isNaN(n)) return Math.max(0, Math.floor(n * 1000));
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : Math.max(0, t - Date.now());
}

async function fetchManyWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  const workers = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}
