// api/routes.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const UPSTREAM_URL = "https://api.at.govt.nz/gtfs/v3/routes";
  const REFRESH_MS = 10 * 60 * 1000;        // refresh every 10 minutes
  const STALE_FALLBACK_MAX_MS = 24 * 60 * 60 * 1000; // serve stale up to 1 day

  const now = Date.now();
  globalThis.__AT_ROUTES__ ||= { data: null, ts: 0 };
  const cache = globalThis.__AT_ROUTES__;

  // fresh cache
  if (cache.data && now - cache.ts < REFRESH_MS) {
    setSWRHeaders(res, REFRESH_MS, 600); // small CDN window, long SWR
    res.setHeader("x-cache", "routes-hit");
    return res.status(200).json(cache.data);
  }

  try {
    const r = await fetch(UPSTREAM_URL, {
      headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
      cache: "no-store"
    });

    if (r.status === 403 || r.status === 429) {
      const body = await safeBody(r);
      if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
        setSWRHeaders(res, REFRESH_MS, 600);
        res.setHeader("x-cache", "routes-stale-hit");
        res.setHeader("x-upstream-status", String(r.status));
        return res.status(200).json(cache.data);
      }
      return res.status(502).json({ error: `Upstream error: ${r.status}`, body });
    }

    if (!r.ok) {
      const body = await safeBody(r);
      if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
        setSWRHeaders(res, REFRESH_MS, 600);
        res.setHeader("x-cache", "routes-stale-hit");
        res.setHeader("x-upstream-status", String(r.status));
        return res.status(200).json(cache.data);
      }
      return res.status(502).json({ error: `Upstream error: ${r.status}`, body });
    }

    const data = await r.json();           // pass through as-is
    cache.data = data;
    cache.ts = now;

    setSWRHeaders(res, REFRESH_MS, 600);
    res.setHeader("x-cache", "routes-miss");
    return res.status(200).json(data);
  } catch (err) {
    if (cache.data && now - cache.ts <= STALE_FALLBACK_MAX_MS) {
      setSWRHeaders(res, REFRESH_MS, 600);
      res.setHeader("x-cache", "routes-stale-hit");
      return res.status(200).json(cache.data);
    }
    return res.status(500).json({ error: `Proxy error: ${err.message}` });
  }
}

function setSWRHeaders(res, refreshMs, swrSeconds) {
  const sMaxAge = Math.max(1, Math.floor(refreshMs / 1000));
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=${swrSeconds}`);
}
async function safeBody(r) { try { return await r.text(); } catch { return ""; } }
