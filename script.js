// ================== v4.15 - Realtime Vehicle Tracking (Tab-aware + Visibility-aware) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const busTypesUrl = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  subdomains: "abcd",
  maxZoom: 20
});

const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  subdomains: "abcd",
  maxZoom: 20
});

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});

const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri"
});

const map = L.map("map", {
  center: [-36.8485, 174.7633],
  zoom: 12,
  layers: [light]
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Vehicle data structures ---
const vehicleMarkers = {};
const trips = {};
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

// --- Vehicle layers ---
const vehicleLayers = {
  all: L.layerGroup().addTo(map),
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map)
};
let activeLayer = "all";

// --- Vehicle colors & occupancy ---
const vehicleColors = { 2: "red", 3: "blue", 4: "green", default: "gray" };
const occupancyLabels = {
  EMPTY: "Empty",
  MANY_SEATS_AVAILABLE: "Many Seats Available",
  FEW_SEATS_AVAILABLE: "Few Seats Available",
  STANDING_ROOM_ONLY: "Standing Room Only",
  CRUSHED_STANDING_ROOM_ONLY: "Full",
  FULL: "Full",
  NOT_ACCEPTING_PASSENGERS: "Not accepting passengers"
};

// --- Visibility control ---
let isTabActive = true;
document.addEventListener("visibilitychange", () => {
  isTabActive = document.visibilityState === "visible";
  if (isTabActive) fetchVehicles(); // fetch immediately when user returns
});

// --- Safe fetch helper ---
async function safeFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("Fetch error:", err);
    debugBox.textContent = `Fetch error: ${err.message}`;
    return null;
  }
}

// --- Add marker ---
function addVehicleMarker(id, lat, lon, popupContent, color, type) {
  if (vehicleMarkers[id]) {
    vehicleMarkers[id].setLatLng([lat, lon]);
    vehicleMarkers[id].setPopupContent(popupContent);
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: 6,
      fillColor: color,
      color: "#000",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(vehicleLayers[type] || vehicleLayers.all);
    marker.bindPopup(popupContent);
    vehicleMarkers[id] = marker;
  }
}

// --- AM pairing ---
function pairAMTrains(inService, outOfService) {
  const pairs = [];
  inService.forEach(inTrain => {
    const outTrain = outOfService.find(o => o.vehicleLabel !== inTrain.vehicleLabel);
    if (outTrain) pairs.push({ inTrain, outTrain });
  });
  return pairs;
}

// --- Update vehicle count ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[3]).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[2]).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[4]).length;
  document.getElementById("vehicle-count").textContent = `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Layer tab system ---
const tabs = document.querySelectorAll("#tabs button");
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeLayer = tab.dataset.layer;
    updateLayerVisibility();
    fetchVehicles();
  });
});

function updateLayerVisibility() {
  Object.keys(vehicleLayers).forEach(key => {
    if (activeLayer === "all" || activeLayer === key) map.addLayer(vehicleLayers[key]);
    else map.removeLayer(vehicleLayers[key]);
  });
}

// --- Fetch vehicles ---
async function fetchVehicles() {
  if (!isTabActive) return; // skip updates if tab inactive

  const json = await safeFetch(realtimeUrl);
  if (!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];
  const missingTripIds = new Set();

  vehicles.forEach(v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && !trips[tripId]) missingTripIds.add(tripId);
  });

  if (missingTripIds.size) {
    const ids = Array.from(missingTripIds).join(",");
    const tripJson = await safeFetch(`${tripsUrl}?ids=${ids}`);
    if (tripJson?.data) tripJson.data.forEach(t => trips[t.id] = t.attributes || t);
  }

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

    let typeKey = "other";
    const routeId = v.vehicle?.trip?.route_id;
    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      switch (r.route_type) {
        case 2: typeKey = "train"; break;
        case 3: typeKey = "bus"; break;
        case 4: typeKey = "ferry"; break;
      }
    } else if (v.vehicle.vehicle?.label.startsWith("AM")) typeKey = "bus";

    if (activeLayer !== "all" && activeLayer !== typeKey) return;

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0,2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;
    const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

    let busType = "";
    let color = vehicleColors[typeKey] || vehicleColors.default;

    if (typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const ops = busTypes[model];
        if (ops[operator]?.includes(vehicleNumber)) {
          busType = model;
          color = vehicleColors[3];
          break;
        }
      }
    }

    let destination = v.vehicle.trip?.trip_headsign || "N/A";
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && trips[tripId]) destination = trips[tripId].trip_headsign || "N/A";

    const popupContent = `
      <b>Route:</b> ${routes[routeId]?.route_short_name || "N/A"}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${(speedKmh >= 0 && speedKmh <= 180 ? speedKmh.toFixed(1) : "N/A")} km/h<br>
      <b>Occupancy:</b> ${occupancy}
    `;

    if (vehicleLabel.startsWith("AM")) {
      if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
      else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
    }

    addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey);
  }));

  // AM train pairing
  pairAMTrains(inServiceAM, outOfServiceAM).forEach(pair => {
    const marker = vehicleMarkers[pair.inTrain.vehicleId];
    if (marker) {
      const oldContent = marker.getPopup()?.getContent() || "";
      marker.getPopup().setContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
    }
  });

  Object.keys(vehicleMarkers).forEach(id => {
    if (!newVehicleIds.has(id)) {
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  debugBox.textContent = `Realtime update complete for ${activeLayer}.`;
  updateVehicleCount();
}

// --- Init ---
async function init() {
  const routesJson = await safeFetch(routesUrl);
  if (routesJson?.data) routesJson.data.forEach(r => { routes[r.id] = r; });

  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson) busTypes = busTypesJson;

  await fetchVehicles();
  setInterval(fetchVehicles, 20000); // only runs if tab active
}

init();
