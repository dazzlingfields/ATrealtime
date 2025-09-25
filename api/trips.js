// api/trips.js
let cache = new Map();
let inflight = new Map();
let blockUntil = 0;

const TTL_MS = 5000; // 5s per unique query

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const upstreamBase = process.env.UPSTREAM_TRIPS;
  if (!upstreamBase) {
    return res.status(500).json({ error: "Missing UPSTREAM_TRIPS env var" });
  }

  const now = Date.now();
  if (now < blockUntil) {
    const retry = Math.ceil((blockUntil - now) / 1000);
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Temporarily rate limited" });
  }

  // Parse client query: expect ?ids=csv
  const ids = getIds(req.url);
  if (!ids.length) {
    return res.status(400).json({ error: "ids query param required, e.g. ?ids=TRIP1,TRIP2" });
  }

  // Strategy A: base?ids=csv (some APIs)
  const urlA = upstreamBase + "?ids=" + encodeURIComponent(ids.join(","));
  // Strategy B: base?trip_id=...&trip_id=... (common GTFS shape)
  const urlB = upstreamBase + "?" + ids.map(id => "trip_id=" + encodeURIComponent(id)).join("&");

  // Use A as cache key first; if we fall back to B we cache under B
  const cacheKey = urlA;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiry > now) {
    res.setHeader("Cache-Control", "public, max-age=2, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).type("application/json").send(hit.body);
  }

  if (inflight.has(cacheKey)) {
    try { const r = await inflight.get(cacheKey); return pipe(r, res); }
    catch (e) { console.error("trips coalesce", e); return res.status(502).json({ error: "Coalesced fetch failed" }); }
  }

  const p = (async () => {
    try {
      // Try A
      let upstream = await fetch(urlA, {
        cache: "no-store",
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
      });
      if (upstream.status === 404) {
        console.error("trips upstream 404 on", urlA, "retrying", urlB);
        // Try B
        upstream = await fetch(urlB, {
          cache: "no-store",
          headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
        });
      } else if (upstream.status === 429) {
        const ra = upstream.headers.get("Retry-After");
        const waitMs = parseRetryAfterMs(ra);
        if (waitMs) blockUntil = Date.now() + waitMs;
        const body = await upstream.text();
        return new Response(body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": ra ?? "15" } });
      }

      if (upstream.status === 429) {
        const ra = upstream.headers.get("Retry-After");
        const waitMs = parseRetryAfterMs(ra);
        if (waitMs) blockUntil = Date.now() + waitMs;
        const body = await upstream.text();
        return new Response(body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": ra ?? "15" } });
      }

      if (!upstream.ok) {
        const text = await upstream.text();
        console.error("trips upstream error", upstream.status, upstream.statusText, "url:", upstream.url, "body:", text.slice(0, 200));
        return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}`, body: text.slice(0, 500) }), {
          status: 502, headers: { "Content-Type": "application/json" }
        });
      }

      const body = await upstream.text();
      cache.set(upstream.url, { body, expiry: Date.now() + TTL_MS }); // cache under the actually used URL
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=2, s-maxage=2, stale-while-revalidate=30" }
      });
    } catch (e) {
      console.error("trips function threw", e);
      return new Response(JSON.stringify({ error: "Function threw" }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  const resp = await p;
  return pipe(resp, res);
};

// helpers
function getIds(u) {
  try {
    const i = typeof u === "string" ? u.indexOf("?") : -1;
    if (i < 0) return [];
    const qs = new URLSearchParams(u.slice(i));
    const v = qs.get("ids");
    if (!v) return [];
    return v.split(",").map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}
function pipe(r, res){ for (const [k,v] of r.headers.entries()) res.setHeader(k,v); res.status(r.status); return r.text().then(t=>res.send(t)); }
function parseRetryAfterMs(v){ if(!v) return 0; const n = Number(v); if(!Number.isNaN(n)) return Math.max(0, Math.floor(n*1000)); const t = Date.parse(v); return Number.isNaN(t)?0:Math.max(0, t - Date.now()); }
function cors(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization"); return res; }
