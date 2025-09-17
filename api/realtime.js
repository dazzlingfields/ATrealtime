export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.at.govt.nz/realtime/legacy", {
      headers: { "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY }
    });

    if (!response.ok) {
      throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

