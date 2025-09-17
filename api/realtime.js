export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.at.govt.nz/realtime/vehiclelocations", {
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY
      }
    });

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
