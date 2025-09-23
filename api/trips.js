// trips.js - serverless proxy for AT GTFS trips with caching + batch support
let cachedTrips = {}; // key = tripId, value = full trip object

export default async function handler(req, res) {
  try {
    const { id, ids } = req.query;

    // Collect trip IDs
    let tripIds = [];
    if (id) tripIds = [id];
    if (ids) tripIds = ids.split(",");

    if (tripIds.length === 0) {
      return res.status(400).json({ error: "No trip id(s) specified" });
    }

    // Check which trips are missing in cache
    const missingIds = tripIds.filter(tid => !cachedTrips[tid]);

    if (missingIds.length > 0) {
      // Fetch missing trips in one API call
      const response = await fetch(
        `https://api.at.govt.nz/gtfs/v3/trips?trip_id=${missingIds.join(",")}`,
        {
          headers: {
            "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data?.data) {
        data.data.forEach(t => {
          // Cache the full trip object (with attributes, id, etc.)
          cachedTrips[t.id] = t;
        });
      }
    }

    // Return all requested trips (from cache or just fetched)
    const result = {
      data: tripIds
        .map(tid => cachedTrips[tid] || null)
        .filter(Boolean) // remove nulls if some IDs aren’t found
    };

    // Add CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    res.status(200).json(result);

  } catch (err) {
    console.error("trips.js error:", err);
    res.status(500).json({ error: err.message });
  }
}
