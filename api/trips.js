// trips.js - serverless proxy for AT GTFS trips with caching and batch support
let cachedTrips = {}; // key = tripId, value = trip object

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
    let fetchedTrips = [];

    if (missingIds.length > 0) {
      // Fetch missing trips from AT in one request
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
          const trip = t.attributes || t;
          cachedTrips[t.id] = trip;
          fetchedTrips.push({ id: t.id, attributes: trip });
        });
      }
    }

    // Prepare final response combining cached + newly fetched
    const result = { data: tripIds.map(tid => {
      if (cachedTrips[tid]) return { id: tid, attributes: cachedTrips[tid] };
      return { id: tid, attributes: null }; // fallback
    })};

    // Add CORS header
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(result);

  } catch (err) {
    console.error("trips.js error:", err);
    res.status(500).json({ error: err.message });
  }
}
