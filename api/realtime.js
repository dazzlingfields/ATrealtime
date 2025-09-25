// api/realtime.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ---------- tunables ----------
  const MIN_REFRESH_MS = 5000;           // upstream at most once every 5s
  const STALE_FALLBACK_MAX_MS = 120000;  // serve stale for up to 2 min on errors
  const UPSTREAM_URL = "https://api.at.govt.nz/realtime/legacy";

  // ---------- in-memory cache (persists on warm lambda) ----------
  const now = Date.now();
  globalThis.__AT_CACHE__ ||= { data: null, ts: 0, etag: null, errorTs: 0 };
  const cache = globalThis.__AT_CACHE__;

  // If we refreshed recently, serve cache immediately
  if (cache.data && now - cache.ts < MIN_REFRESH_MS) {
    setSWRHeaders(res, MIN_REFRESH_MS);
    res.setHeader("x-cache", "hit");
    return res.status(200).json(cache.data);
  }

  // Try upstream
  try {
    const upstreamRes = await fetch(UPSTREAM_URL, {
      headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
      cache: "no-store"
    });

    // Quota or rate limiting: serve stale if we have it
    if (upstreamRes.status === 403 || upstreamRes.status === 429) {
      const body = await safeBody(upstreamRes);
      res.setHeader("x-upstream-status", upstreamRes.status.toString());
      res.setHeader("x-upstream-body", truncate(body, 160));
      if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
        setSWRHeaders(res, MIN_REFRESH_MS);
        res.setHeader("x-cache", "stale-hit");
        return res.status(200).json(cache.data);
      }
      return res
        .status(502)
        .json({ error: `Upstream error: ${upstreamRes.status}`, body });
    }

    if (!upstreamRes.ok) {
      const body = await safeBody(upstreamRes);
      res.setHeader("x-upstream-status", upstreamRes.status.toString());
      res.setHeader("x-upstream-body", truncate(body, 160));
      if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
        setSWRHeaders(res, MIN_REFRESH_MS);
        res.setHeader("x-cache", "stale-hit");
        return res.status(200).json(cache.data);
      }
      return res
        .status(502)
        .json({ error: `Upstream error: ${upstreamRes.status}`, body });
    }

    const data = await upstreamRes.json();

    // Update cache and serve
    cache.data = data;
    cache.ts = now;
    setSWRHeaders(res, MIN_REFRESH_MS);
    res.setHeader("x-cache", "miss");
    return res.status(200).json(data);
  } catch (err) {
    // Network or other failure: serve stale if available
    if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
      setSWRHeaders(res, MIN_REFRESH_MS);
      res.setHeader("x-cache", "stale-hit");
      return res.status(200).json(cache.data);
    }
    return res.status(500).json({ error: `Proxy error: ${err.message}` });
  }
}

// cache-control tuned for Vercel CDN: serve cached for a few seconds and revalidate in background
function setSWRHeaders(res, refreshMs) {
  const sMaxAge = Math.max(1, Math.floor(refreshMs / 1000));  // e.g. 5
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=30`);
}

async function safeBody(res) {
  try { return await res.text(); } catch { return ""; }
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
