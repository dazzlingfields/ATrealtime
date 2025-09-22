// update-routes.js
import fs from "fs";
import fetch from "node-fetch";

async function updateRoutes() {
  const url = "https://api.at.govt.nz/gtfs/v3/routes";

  const res = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AT_API_KEY, // ✅ must exist
      "Cache-Control": "no-cache"
    }
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  fs.writeFileSync("routes-static.json", JSON.stringify(data, null, 2));
  console.log(`✅ Updated routes: ${data.data?.length || 0} saved to routes-static.json`);
}

updateRoutes().catch(err => {
  console.error("❌ Failed to update routes:", err);
  process.exit(1);
});
