// v3.4
const proxyBaseUrl = "https://atrealtime.vercel.app";  // change if project URL changes
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const stopsUrl    = `${proxyBaseUrl}/api/stops`;

// --- Set up the Map ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// --- Global Data Stores and UI Elements ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};

const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// Checkbox toggles
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(type, visible) {
  if (visible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

// Vehicle colours based on GTFS route type
const vehicleColors = {
  3: "#007bff", // bus
  2: "#dc3545", // train
  4: "#ffc107", // ferry
  default: "#6c757d" // other
};

// Occupancy labels
const occupancyLabels = {
  0: "Empty",
  1: "Many Seats Available",
  2: "Few Seats Available",
  3: "Standing Room Only",
  4: "Crushed Standing Room Only",
  5: "Full",
  6: "Not Accepting Passengers"
};

// Vehicle icon
const getVehicleIcon = (color) => L.divIcon({
  className: 'vehicle-icon',
  html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// --- Helpers for fetching with caching ---
async function fetchRouteById(routeId) {
  if (routes[routeId]) return routes[routeId];
  try {
    const res = await fetch(`${routesUrl}?id=${routeId}`);
    if (!res.ok) throw new Error(`Failed to fetch route ${routeId}: ${res.status}`);
    const json = await res.json();
    const routeData = json.data?.[0]?.attributes || json.data?.attributes;
    if (routeData) {
      routes[routeId] = routeData;
      return routeData;
    }
  } catch (err) {
    console.error(`Route fetch error ${routeId}:`, err);
  }
  return null;
}

async function fetchTripById(tripId) {
  if (trips[tripId]) return trips[tripId];
  try {
    const res = await fetch(`${tripsUrl}?id=${tripId}`);
    if (!res.ok) throw new Error(`Failed to fetch trip ${tripId}: ${res.status}`);
    const json = await res.json();
    const tripData = json.data?.[0]?.attributes || json.data?.attributes;
    if (tripData) {
      trips[tripId] = tripData;
      return tripData;
    }
  } catch (err) {
    console.error(`Trip fetch error ${tripId}:`, err);
  }
  return null;
}

// --- Fetch realtime vehicles ---
async function fetchVehicles() {
  try {
    const res = await fetch(realtimeUrl);
    if (!res.ok) throw new Error(`Failed to fetch vehicles: ${res.status}`);
    const json = await res.json();

    // Handle either json.response.entity or json.entity
    const vehicles = json?.response?.entity || json?.entity || [];
    const newVehicleIds = new Set();

    const dataPromises = vehicles.map(v => {
      const vehicleId = v.vehicle?.vehicle?.id;
      const routeId   = v.vehicle?.trip?.route_id;
      const tripId    = v.vehicle?.trip?.trip_id;

      return Promise.all([
        routeId ? fetchRouteById(routeId) : null,
        tripId ? fetchTripById(tripId) : null,
        v,
        vehicleId
      ]);
    });

    const results = await Promise.all(dataPromises);

    results.forEach(result => {
      const [routeInfo, tripInfo, v, vehicleId] = result;
      if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

      newVehicleIds.add(vehicleId);

      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;
      const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
      const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
      const occupancyStatus = v.vehicle.occupancy_status;

      let typeKey = "other";
      let color = vehicleColors.default;
      let routeName = "N/A";
      let destination = "N/A";
      let speed = "N/A";
      const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

      if (routeInfo) {
        const routeType = routeInfo.route_type;
        switch (routeType) {
          case 3: typeKey = "bus"; color = vehicleColors[3]; break;
          case 2: typeKey = "train"; color = vehicleColors[2]; break;
          case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
        }
        routeName = routeInfo.route_short_name || "N/A";
      }

      if (tripInfo) {
        destination = tripInfo.trip_headsign || "N/A";
      }

      // Te Huia special case
      if (v.vehicle.trip?.route_id === "15636") {
        routeName = "Te Huia (Simulated)";
        color = "#e67e22";
      }

      // Speed sanity check
      let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : null;
      if (speedKmh !== null) {
        let maxSpeed = 160;
        if (typeKey === "bus") maxSpeed = 100;
        else if (typeKey === "train") maxSpeed = 120;
        else if (typeKey === "ferry") maxSpeed = 60;

        if (speedKmh >= 0 && speedKmh <= maxSpeed) {
          speed = speedKmh.toFixed(1) + " km/h";
        }
      }

      const popupContent = `
        <b>Route:</b> ${routeName}<br>
        <b>Destination:</b> ${destination}<br>
        <b>Vehicle:</b> ${vehicleLabel}<br>
        <b>Number Plate:</b> ${licensePlate}<br>
        <b>Speed:</b> ${speed}<br>
        <b>Occupancy:</b> ${occupancy}
      `;

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([lat, lon]);
        vehicleMarkers[vehicleId].setPopupContent(popupContent);
        vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
      } else {
        const newMarker = L.marker([lat, lon], { icon: getVehicleIcon(color) });
        newMarker.bindPopup(popupContent);
        newMarker.addTo(layerGroups[typeKey]);
        vehicleMarkers[vehicleId] = newMarker;
      }
    });

    // Remove old markers
    Object.keys(vehicleMarkers).forEach(id => {
      if (!newVehicleIds.has(id)) {
        map.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    debugBox.textContent = `Error loading vehicles: ${err.message}`;
  }
}

// --- Init ---
(async function init() {
  fetchVehicles();
  setInterval(fetchVehicles, 15000);
})();
