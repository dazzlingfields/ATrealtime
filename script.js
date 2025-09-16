// --- working ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
const atApiKey = "YOUR_API_KEY_HERE"; // replace with your AT key
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
const routesUrl = "https://api.at.govt.nz/v3/gtfs/routes";

const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const debugBox = document.getElementById("debug");
const routes = {};
const vehicleMarkers = {};

// --- Layer groups by vehicle type ---
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Checkbox logic ---
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(type, isVisible) {
  if (isVisible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

// --- Colors by GTFS route_type ---
const vehicleColors = {
  3: "#007bff", // bus
  2: "#dc3545", // train
  4: "#ffc107", // ferry
  default: "#6c757d"
};

// --- Fetch static routes ---
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

// --- Fetch vehicles ---
async function fetchVehicles() {
  try {
    const res = await fetch(realtimeUrl, {
      headers: { "Ocp-Apim-Subscription-Key": atApiKey }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const vehicles = json.response.entity || [];
    console.log("Vehicles:", vehicles.length);

    // Clear all layer groups for fresh update
    Object.values(layerGroups).forEach(group => group.clearLayers());

    vehicles.forEach(v => {
      if (!v.vehicle || !v.vehicle.position) return;

      const id = v.vehicle.vehicle.id;
      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;

      const trip = v.vehicle.trip || {};
      const routeId = trip.route_id;
      const routeInfo = routes[routeId];
      const routeName = routeInfo
        ? `${routeInfo.route_short_name || ""} ${routeInfo.route_long_name || ""}`
        : "Unknown";

      const licensePlate = v.vehicle.vehicle.license_plate || "N/A";
      const speedKmh = v.vehicle.position.speed
        ? (v.vehicle.position.speed * 3.6).toFixed(1) + " km/h"
        : "N/A";

      const routeType = routeInfo ? routeInfo.route_type : "other";

      let typeKey = "other";
      if (routeType == 3) typeKey = "bus";
      else if (routeType == 2) typeKey = "train";
      else if (routeType == 4) typeKey = "ferry";

      const color = vehicleColors[routeType] || vehicleColors.default;

      const marker = L.circleMarker([lat, lon], {
        radius: 6,
        fillColor: color,
        color: "#fff",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9
      });

      const popupHtml = `
        <b>Route:</b> ${routeName}<br>
        <b>Route ID:</b> ${routeId || "N/A"}<br>
        <b>Vehicle ID:</b> ${id}<br>
        <b>License Plate:</b> ${licensePlate}<br>
        <b>Speed:</b> ${speedKmh}
      `;
      marker.bindPopup(popupHtml);

      marker.addTo(layerGroups[typeKey]);
      vehicleMarkers[id] = marker;
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    debugBox.textContent = `Error loading vehicles: ${err.message}`;
  }
}

// --- Init ---
(async function init() {
  await fetchRoutes();
  await fetchVehicles();
  setInterval(fetchVehicles, 30000);
})();

