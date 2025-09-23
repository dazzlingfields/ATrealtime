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

    // Which trips are missing from cache?
    const missingIds = tripIds.filter(tid => !cachedTrips[tid]);

    if (missingIds.length > 0) {
      // Fetch missing trips in parallel
      const responses = await Promise.all(
        missingIds.map(tid =>
          fetch(`https://api.at.govt.nz/gtfs/v3/trips/${tid}`, {
            headers: {
              "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY,
            },
          }).then(r => ({ tid, res: r }))
        )
      );

      for (const { tid, res: tripRes } of responses) {
        if (!tripRes.ok) {
          console.error(`Failed to fetch trip ${tid}: ${tripRes.status} ${tripRes.statusText}`);
          continue;
        }
        const data = await tripRes.json();
        if (data?.data) {
          // Cache full trip object (id + attributes)
          cachedTrips[tid] = data.data;
        }
      }
    }

    // Prepare response: only include trips we actually have
    const result = {
      data: tripIds
        .map(tid => cachedTrips[tid] || null)
        .filter(Boolean),
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
