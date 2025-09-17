// routes.js - serverless proxy for AT GTFS routes with caching
let cachedRoutes = null;

export default async function handler(req, res) {
  try {
    // Fetch and cache all routes if not already cached
    if (!cachedRoutes) {
      const response = await fetch("https://api.at.govt.nz/gtfs/v3/routes", {
        headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY }
      });
      if (!response.ok) throw new Error(`Upstream error: ${response.status} ${response.statusText}`);

      const data = await response.json();
      cachedRoutes = data.data || [];
      console.log(`Cached ${cachedRoutes.length} routes at startup`);
    }

    const { id } = req.query;

    let result;
    if (id) {
      // Return single route if requested
      const route = cachedRoutes.find(r => r.id == id);
      if (!route) return res.status(404).json({ error: "Route not found" });
      result = { data: [route] };
    } else {
      // Return all cached routes
      result = { data: cachedRoutes };
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(result);

  } catch (err) {
    console.error("routes.js error:", err);
    res.status(500).json({ error: err.message });
  }
}
