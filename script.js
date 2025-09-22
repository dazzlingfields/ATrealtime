// ================== v4.17 - Realtime Vehicle Tracking (Headsign Cache + Bikes Allowed) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO", subdomains: "abcd", maxZoom: 20
});
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO", subdomains: "abcd", maxZoom: 20
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
L.control.layers({ "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite }).addTo(map);

// --- Data stores ---
const vehicleMarkers = {};
let routes = {};
let busTypes = {};
let trips = JSON.parse(localStorage.getItem("tripCache") || "{}"); // load cached trips
const debugBox = document.getElementById("debug");

// --- Vehicle layers ---
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Vehicle colors ---
const vehicleColors = {
  trainSTH: "#ff4d4d",  // Southern - Red
  trainWEST: "#4caf50", // Western - Green
  trainEAST: "#ffd633", // Eastern - Yellow
  trainONE: "#3399ff",  // Onehunga - Blue
  bus: "#66b3ff",
  ferry: "#66ffcc",
  other: "#cccccc"
};

// --- Occupancy labels ---
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
  if (isTabActive) fetchVehicles(); // refresh immediately when returning
});

// --- Safe fetch ---
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

// --- Trip cache helpers ---
function saveTripCache() {
  localStorage.setItem("tripCache", JSON.stringify(trips));
}
async function fetchMissingTrips(missingTripIds) {
  if (missingTripIds.size === 0) return;
  const ids = Array.from(missingTripIds).join(",");
  const tripJson = await safeFetch(`${tripsUrl}?ids=${ids}`);
  if (tripJson?.data) {
    tripJson.data.forEach(t => {
      const attrs = t.attributes || {};
      trips[t.id] = {
        trip_headsign: attrs.trip_headsign || "N/A",
        route_id: attrs.route_id,
        bikes_allowed: attrs.bikes_allowed ?? -1,
        lastUpdated: Date.now()
      };
    });
    saveTripCache();
  }
}
function getHeadsign(v, tripId, routeId) {
  if (v.vehicle.trip?.trip_headsign) return v.vehicle.trip.trip_headsign;
  if (tripId && trips[tripId]) return trips[tripId].trip_headsign || "N/A";
  if (routeId && routes[routeId]) return routes[routeId].route_long_name || routes[routeId].route_short_name || "N/A";
  return "N/A";
}
function getBikesAllowed(tripId) {
  if (tripId && trips[tripId]) {
    const val = trips[tripId].bikes_allowed;
    if (val === 0) return "No bikes";
    if (val === 1) return "Bikes allowed";
    if (val === 2) return "Bikes allowed (limited)";
  }
  return "Unknown";
}

// --- Marker add/update ---
function addVehicleMarker(id, lat, lon, popupContent, color, type) {
  if (vehicleMarkers[id]) {
    vehicleMarkers[id].setLatLng([lat, lon]);
    vehicleMarkers[id].setPopupContent(popupContent);
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: 6, fillColor: color, color: "#000", weight: 1,
      opacity: 1, fillOpacity: 0.85
    }).addTo(vehicleLayers[type] || vehicleLayers.other);
    marker.bindPopup(popupContent);
    vehicleMarkers[id] = marker;
  }
}

// --- AM train pairing ---
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
  const counts = { bus: 0, train: 0, ferry: 0 };
  Object.values(vehicleMarkers).forEach(m => {
    if (m.options.fillColor === vehicleColors.bus) counts.bus++;
    if (Object.values(vehicleColors).includes(m.options.fillColor)) {
      // quick classification
      if (m.options.fillColor === vehicleColors.trainSTH || m.options.fillColor === vehicleColors.trainWEST ||
          m.options.fillColor === vehicleColors.trainEAST || m.options.fillColor === vehicleColors.trainONE) {
        counts.train++;
      }
      if (m.options.fillColor === vehicleColors.ferry) counts.ferry++;
    }
  });
  document.getElementById("vehicle-count").textContent =
    `Buses: ${counts.bus}, Trains: ${counts.train}, Ferries: ${counts.ferry}`;
}

// --- Fetch vehicles ---
async function fetchVehicles() {
  if (!isTabActive) return;

  const json = await safeFetch(realtimeUrl);
  if (!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];
  const missingTripIds = new Set();

  // collect trips
  vehicles.forEach(v => {
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && !trips[tripId]) missingTripIds.add(tripId);
  });
  await fetchMissingTrips(missingTripIds);

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

    newVehicleIds.add(vehicleId);
    const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0,2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;

    const tripId = v.vehicle?.trip?.trip_id;
    const routeId = v.vehicle?.trip?.route_id;
    const headsign = getHeadsign(v, tripId, routeId);
    const bikes = getBikesAllowed(tripId);

    // classify type
    let typeKey = "other", color = vehicleColors.other;
    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      if (r.route_type === 3) { typeKey = "bus"; color = vehicleColors.bus; }
      if (r.route_type === 2) {
        typeKey = "train";
        if (r.route_short_name?.includes("STH")) color = vehicleColors.trainSTH;
        else if (r.route_short_name?.includes("WEST")) color = vehicleColors.trainWEST;
        else if (r.route_short_name?.includes("EAST")) color = vehicleColors.trainEAST;
        else if (r.route_short_name?.includes("ONE")) color = vehicleColors.trainONE;
        else color = vehicleColors.trainWEST;
      }
      if (r.route_type === 4) { typeKey = "ferry"; color = vehicleColors.ferry; }
    } else if (vehicleLabel.startsWith("AM")) {
      typeKey = "bus"; // fallback for AM bus/train edge
    }

    // bus type check
    let busType = "";
    if (typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const ops = busTypes[model];
        if (ops[operator]?.includes(vehicleNumber)) {
          busType = model; break;
        }
      }
    }

    // popup
    const popupContent = `
      <b>Route:</b> ${routes[routeId]?.route_short_name || "N/A"}<br>
      <b>Destination:</b> ${headsign}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${(speedKmh > 0 && speedKmh <= 180) ? speedKmh.toFixed(1) : "N/A"} km/h<br>
      <b>Occupancy:</b> ${occupancyLabels[occupancyStatus] || "N/A"}<br>
      <b>Bikes:</b> ${bikes}
    `;

    if (vehicleLabel.startsWith("AM")) {
      if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
      else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
    }

    addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey);
  }));

  // remove old markers
  Object.keys(vehicleMarkers).forEach(id => {
    if (!newVehicleIds.has(id)) {
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  debugBox.textContent = `Realtime update complete. Last updated: ${new Date().toLocaleTimeString()}`;
  updateVehicleCount();
}

// --- Init ---
async function init() {
  const routesJson = await safeFetch(routesUrl);
  if (routesJson?.data) {
    routesJson.data.forEach(r => {
      const attrs = r.attributes || r;
      routes[r.id] = {
        route_type: attrs.route_type,
        route_short_name: attrs.route_short_name,
        route_long_name: attrs.route_long_name,
        agency_id: attrs.agency_id
      };
    });
  }
  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson) busTypes = busTypesJson;

  await fetchVehicles();
  setInterval(fetchVehicles, 20000);
}
init();
