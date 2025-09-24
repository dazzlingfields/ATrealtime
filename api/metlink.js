// /api/metlink.js - proxy for Metlink API (vehicle positions, trip updates, etc.)

export default async function handler(req, res) {
  try {
    // Default to vehicle positions, but allow other endpoints
    const endpoint = req.query.endpoint || "gtfs-rt/vehiclepositions";
    const url = `https://api.opendata.metlink.org.nz/v1/${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": process.env.METLINK_API_KEY,   // stored in Vercel env vars
        "Accept": "application/json"                // force JSON instead of protobuf
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Metlink API error ${response.status}` });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error("Metlink proxy error:", err);
    res.status(500).json({ error: err.message });
  }
}
