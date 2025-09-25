// api/trips.js
// Accepts /api/trips?ids=ID1,ID2 and fans out to GET {BASE}/{id} per id.
// Merges results into { data: [...] } that matches your frontend's expectations.

let cacheById = new Map();      // id -> { body: string, expiry: number }
let inflightById = new Map();   // id -> Promise<Response>
let blockUntil = 0;

const TTL_MS = 5000;            // cache each trip for 5 s
const CONCURRENCY = 6;          // limit parallel upstream calls

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const base = process.env.UPSTREAM_TRIPS_BASE;
  if (!base) return res.status(500).json({ error: "Missing UPSTREAM_TRIPS_BASE env var" });

  const now = Date.now();
  if (now < blockUntil) {
    const retry = Math.ceil((blockUntil - now) / 1000);
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Temporarily rate limited" });
  }

  const ids = getIds(req.url);
  if (!ids.length) {
    // predictable contract for the client
    return res.status(200).json({ data: [] });
  }

  try {
    const results = await fetchManyWithLimit(ids, CONCURRENCY, id => fetchTrip(id, base));

    // Normalize shapes to { data: [ ...objects... ] }
    const merged = [];
    for (const r of results) {
      if (!r) continue; // 404s or nulls
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

    // Return combined payload
    res.setHeader("Cache-Control", "public, max-age=2, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json({ data: merged });
  } catch (e) {
    // As a last resort, keep UI alive
    console.error("trips aggregation error", e);
    return res.status(200).json({ data: [] });
  }
};

// Fetch a single trip with per-id cache and coalescing
async function fetchTrip(id, base) {
  const now = Date.now();

  // cache hit
  const hit = cacheById.get(id);
  if (hit && hit.expiry > now) return hit.body;

  // coalesce concurrent calls
  if (inflightById.has(id)) {
    const r = await inflightById.get(id);
    return r;
  }

  const p = (async () => {
    try {
      const url = buildTripUrl(base, id);
      const upstream = await fetch(url, {
        cache: "no-store",
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY }
      });

      if (upstream.status === 429) {
        const ra = upstream.headers.get("Retry-After");
        const waitMs = parseRetryAfterMs(ra);
        if (waitMs) blockUntil = Date.now() + waitMs;
        const body = await upstream.text();
        // propagate 429 to caller to allow global backoff in the client if you choose to surface it
        throw new Response(body, { status: 429, headers: { "Retry-After": ra ?? "15" } });
      }

      if (upstream.status === 404) {
        // missing id is OK; just drop it
        return null;
      }

      if (!upstream.ok) {
        const text = await upstream.text();
        console.error("trip upstream error", upstream.status, upstream.statusText, "id:", id, "body:", text.slice(0, 200));
        // degrade by skipping this id
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

// Helpers

function buildTripUrl(base, id) {
  // allows either BASE with or without trailing slash
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
