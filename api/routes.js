let cacheBody = null, cacheExpiry = 0, inflight = null, blockUntil = 0;
const TTL_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const now = Date.now();
  if (now < blockUntil) {
    const retry = Math.ceil((blockUntil - now) / 1000);
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Temporarily rate limited" });
  }

  if (cacheBody && cacheExpiry > now) {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).type("application/json").send(cacheBody);
  }

  if (inflight) {
    try { const r = await inflight; return pipe(r, res); }
    catch (e) { console.error(e); return res.status(502).json({ error: "Coalesced fetch failed" }); }
  }

  const qsIndex = req.url.indexOf("?");
  const qs = qsIndex >= 0 ? req.url.slice(qsIndex) : "";
  const upstreamUrl = `${process.env.UPSTREAM_ROUTES}${qs}`;

  inflight = (async () => {
    try {
      const upstream = await fetch(upstreamUrl, {
        cache: "no-store",
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY },
      });

      if (upstream.status === 429) {
        const ra = upstream.headers.get("Retry-After");
        const waitMs = parseRetryAfterMs(ra);
        if (waitMs) blockUntil = Date.now() + waitMs;
        const body = await upstream.text();
        return new Response(body, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": ra ?? "15" } });
      }

      if (!upstream.ok) {
        const text = await upstream.text();
        return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}`, body: text.slice(0, 500) }), {
          status: 502, headers: { "Content-Type": "application/json" }
        });
      }

      const body = await upstream.text();
      cacheBody = body; cacheExpiry = Date.now() + TTL_MS;

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" }
      });
    } catch (e) {
      console.error("routes upstream error", e);
      return new Response(JSON.stringify({ error: "Function threw" }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      inflight = null;
    }
  })();

  const resp = await inflight;
  return pipe(resp, res);
}

function pipe(r, res){ for (const [k,v] of r.headers.entries()) res.setHeader(k,v); res.status(r.status); return r.text().then(t=>res.send(t)); }
function parseRetryAfterMs(v){ if(!v) return 0; const n=Number(v); if(!Number.isNaN(n)) return Math.max(0,Math.floor(n*1000)); const t=Date.parse(v); return Number.isNaN(t)?0:Math.max(0,t-Date.now()); }
function cors(res){ res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization"); return res; }
