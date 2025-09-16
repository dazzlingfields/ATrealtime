// --- API Key and Endpoints ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";

const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
const routesUrl = "https://api.at.govt.nz/v3/gtfs/routes"; // still valid for static routes

const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const debugBox = document.getElementById("debug");
const routes = {};
const vehicleMarkers = {};

async function fetchRoutes() {
  try {
    const res = await fetch(routesUrl, {
      headers: { "Ocp-Apim-Subscription-Key": atApiKey }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    json.data.forEach(r => {
      routes[r.id] = r.attributes;
    });
    console.log("Routes loaded:", Object.keys(routes).length);
  } catch (err) {
    console.error("Error fetching routes:", err);
    debugBox.textContent = `Error loading routes: ${err.message}`;
  }
}

async function fetchVehicles() {
  try {
    const res = await fetch(realtimeUrl, {
      headers: { "Ocp-Apim-Subscription-Key": atApiKey }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const vehicles = json.response.entity || [];
    console.log("Vehicles:", vehicles.length);

    vehicles.forEach(v => {
      if (!v.vehicle || !v.vehicle.position) return;
      const id = v.vehicle.vehicle.id;
      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;

      // If marker exists, update position, otherwise add new
      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]);
      } else {
        const marker = L.circleMarker([lat, lon], {
          radius: 6,
          fillColor: "#007bff",
          color: "#fff",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(map);
        marker.bindPopup(`Vehicle ID: ${id}`);
        vehicleMarkers[id] = marker;
      }
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    debugBox.textContent = `Error loading vehicles: ${err.message}`;
  }
}

(async function init() {
  await fetchRoutes();
  await fetchVehicles();
  setInterval(fetchVehicles, 30000); // refresh every 30s
})();

