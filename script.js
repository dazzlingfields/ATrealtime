// --- API Key and Endpoints ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";

// v3 endpoints (confirmed in AT docs)
const routesApiUrl = "https://api.at.govt.nz/v3/gtfs/routes";
const vehicleApiUrl = "https://api.at.govt.nz/v3/public/realtime/vehiclepositions";

// --- Map Setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const debugBox = document.getElementById("debug");

// --- Data Stores ---
const routes = {};
const routeTypes = { bus: "3", train: "2", ferry: "4" };

const layerGroups = {
  [routeTypes.bus]: L.layerGroup().addTo(map),
  [routeTypes.train]: L.layerGroup().addTo(map),
  [routeTypes.ferry]: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map),
};

// --- Checkbox controls ---
function toggleLayer(type, isVisible) {
  if (isVisible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

document.getElementById("bus-checkbox").addEventListener("change", (e) =>
  toggleLayer(routeTypes.bus, e.target.checked)
);
document.getElementById("train-checkbox").addEventListener("change", (e) =>
  toggleLayer(routeTypes.train, e.target.checked)
);
document.getElementById("ferry-checkbox").addEventListener("change", (e) =>
  toggleLayer(routeTypes.ferry, e.target.checked)
);
document.getElementById("other-checkbox").addEventListener("change", (e) =>
  toggleLayer("other", e.target.checked)
);

// --- Fetch GTFS Static Routes ---
async function fetchRoutes() {
  try {
    const res = await fetch(routesApiUrl, {
      headers: { "Ocp-Apim-Subscription-Key": atApiKey },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    json.data.forEach((route) => {
      routes[route.id] = route.attributes;
    });

    console.log("Fetched routes:", Object.keys(routes).length);
  } catch (err) {
    console.error("Error fetching routes:", err);
    debugBox.textContent = "Error loading routes.";
  }
}

// --- Fetch Vehicles ---
async function fetchVehicles() {
  try {
    const res = await fetch(vehicleApiUrl, {
      headers: { "Ocp-Apim-Subscription-Key": atApiKey },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Clear old markers
    for (const key in layerGroups) {
      layerGroups[key].clearLayers();
    }

    json.entity.forEach((entity) => {
      if (!entity.vehicle) return;
      const v = entity.vehicle;

      const lat = v.position?.latitude;
      const lng = v.position?.longitude;
      if (!lat || !lng) return;

      const routeId = v.trip?.route_id;
      const route = routes[routeId];

      let dotClass = "not-in-service-dot";
      let targetLayer = layerGroups.other;

      if (route) {
        if (route.route_type === parseInt(routeTypes.bus)) {
          dotClass = "bus-dot";
          targetLayer = layerGroups[routeTypes.bus];
        } else if (route.route_type === parseInt(routeTypes.train)) {
          dotClass = "train-dot";
          targetLayer = layerGroups[routeTypes.train];
        } else if (route.route_type === parseInt(routeTypes.ferry)) {
          dotClass = "ferry-dot";
          targetLayer = layerGroups[routeTypes.ferry];
        }
      }

      const icon = L.divIcon({ className: `vehicle-dot ${dotClass}` });

      const popupContent = `
        <b>Route:</b> ${route?.route_long_name || "Unknown"}<br>
        <b>Speed:</b> ${
          v.position?.speed ? Math.round(v.position.speed * 3.6) + " km/h" : "N/A"
        }<br>
        <b>License:</b> ${v.vehicle?.license_plate || "N/A"}<br>
        <b>Occupancy:</b> ${
          v.occupancy_status || v.occupancy_percentage || "Unknown"
        }
      `;

      L.marker([lat, lng], { icon }).bindPopup(popupContent).addTo(targetLayer);
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    debugBox.textContent = "Error loading vehicles.";
  }
}

// --- Init ---
async function init() {
  await fetchRoutes();
  await fetchVehicles();
  setInterval(fetchVehicles, 30000);
}

init();
