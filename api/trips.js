// trips.js - serverless proxy for AT GTFS trips with caching and batch support

let cachedTrips = {}; // key = tripId, value = trip object

export default async function handler(req, res) {
  try {
    // --- Handle preflight CORS ---
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    const { id, ids } = req.query;

    // Collect trip IDs
    let tripIds = [];
    if (id) tripIds = [id];
    if (ids) tripIds = ids.split(",");

    if (tripIds.length === 0) {
      return res.status(400).json({ error: "No trip id(s) specified" });
    }

    // Which trips are missing in cache?
    const missingIds = tripIds.filter(tid => !cachedTrips[tid]);
    const fetchedTrips = [];

    // Fetch missing trips one by one (AT API does not support multiple trip_ids in a single call)
    for (const tid of missingIds) {
      try {
        const response = await fetch(
          `https://api.at.govt.nz/gtfs/v3/trips/${tid}`,
          {
            headers: {
              "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY,
            },
          }
        );

        if (!response.ok) {
          console.error(`Upstream error for ${tid}: ${response.status} ${response.statusText}`);
          continue;
        }

        const data = await response.json();
        if (data?.data?.attributes) {
          const trip = data.data.attributes;
          cachedTrips[tid] = trip;
          fetchedTrips.push({ id: tid, attributes: trip });
        }
      } catch (err) {
        console.error(`Failed to fetch trip ${tid}:`, err);
      }
    }

    // Prepare final response with cached + fetched
    const result = {
      data: tripIds.map(tid => ({
        id: tid,
        attributes: cachedTrips[tid] || null
      }))
    };

    // Add CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(result);

  } catch (err) {
    console.error("trips.js error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: err.message });
  }
}
