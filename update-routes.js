// update-routes.js
import fs from "fs";
import fetch from "node-fetch";

const routesUrl = "https://api.at.govt.nz/gtfs/v3/routes";
const apiKey = process.env.AT_API_KEY; // store securely in GitHub secrets

async function updateRoutes() {
  try {
    const res = await fetch(routesUrl, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Cache-Control": "no-cache"
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();

    const routes = {};
    json.data.forEach(r => {
      const attrs = r.attributes || r;
      routes[r.id] = {
        route_type: attrs.route_type,
        route_short_name: attrs.route_short_name,
        route_long_name: attrs.route_long_name,
        agency_id: attrs.agency_id
      };
    });

    fs.writeFileSync("routes-static.json", JSON.stringify(routes, null, 2));
    console.log("✅ routes-static.json updated successfully");
  } catch (err) {
    console.error("❌ Failed to update routes:", err);
    process.exit(1);
  }
}

updateRoutes();
