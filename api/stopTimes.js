// /api/stopTimes.js
export default async function handler(req, res) {
  try {
    const { tripId } = req.query;

    if (!tripId) {
      res.status(400).json({ error: "Missing tripId parameter" });
      return;
    }

    const url = `https://api.at.govt.nz/gtfs/v3/trips/${tripId}/stoptimes`;

    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);

  } catch (err) {
    console.error("Error fetching stop times:", err);
    res.status(500).json({ error: err.message });
  }
}
