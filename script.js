// ================== v4.14 - Realtime Vehicle Tracking ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const busTypesUrl = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; <a href='https://www.openstreetmap.org/'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/'>CARTO</a>",
  subdomains: "abcd", maxZoom: 20
});
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; <a href='https://www.openstreetmap.org/'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/'>CARTO</a>",
  subdomains: "abcd", maxZoom: 20
});
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri"
});

// Map setup
const map = L.map("map", { center: [-36.8485, 174.7633], zoom: 12, layers: [light] });
L.control.layers({ Light: light, Dark: dark, OpenStreetMap: osm, Satellite: satellite }).addTo(map);

// --- Vehicle layers ---
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Data structures ---
const vehicleMarkers = {};
const inactiveMarkers = {};
const trips = {};
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

// --- Vehicle colors ---
const vehicleColors = {
  2: "red",    // Train
  3: "blue",   // Bus
  4: "green",  // Ferry
  default: "gray"
};

// --- Occupancy labels ---
const occupancyLabels = {
  EMPTY: "Empty", MANY_SEATS_AVAILABLE: "Many Seats", FEW_SEATS_AVAILABLE: "Few Seats",
  STANDING_ROOM_ONLY: "Standing", CRUSHED_STANDING_ROOM_ONLY: "Full",
  FULL: "Full", NOT_ACCEPTING_PASSENGERS: "Not accepting passengers"
};

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

// --- Marker management ---
function addVehicleMarker(id, lat, lon, popupContent, color, type) {
  if (vehicleMarkers[id]) {
    vehicleMarkers[id].setLatLng([lat, lon]);
    vehicleMarkers[id].setPopupContent(popupContent);
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: 6, fillColor: color, color: "#000",
      weight: 1, opacity: 1, fillOpacity: 0.9
    }).addTo(vehicleLayers[type] || vehicleLayers.other);
    marker.bindPopup(popupContent);
    vehicleMarkers[id] = marker;
  }
}

// --- Main fetch loop ---
async function fetchVehicles() {
  const json = await safeFetch(realtimeUrl);
  if (!json) { debugBox.textContent = "Realtime data unavailable"; return; }

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];
  const missingTripIds = new Set();

  // Collect trips
  vehicles.forEach(v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && !trips[tripId]) missingTripIds.add(tripId);
  });

  // Fetch missing trips
  if (missingTripIds.size > 0) {
    const ids = Array.from(missingTripIds).join(",");
    const tripJson = await safeFetch(`${tripsUrl}?ids=${ids}`);
    if (tripJson?.data) {
      tripJson.data.forEach(t => { trips[t.id] = t.attributes || t; });
    }
  }

  // Process vehicles
  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

    const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0, 2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;

    let typeKey = "other", color = vehicleColors.default, routeName = "N/A", destination = "N/A";
    const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";
    const routeId = v.vehicle?.trip?.route_id, tripId = v.vehicle?.trip?.trip_id;
    let busType = "";

    // Vehicle type
    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      switch (r.route_type) {
        case 3: typeKey = "bus"; color = vehicleColors[3]; break;
        case 2: typeKey = "train"; color = vehicleColors[2]; break;
        case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
      }
      routeName = r.route_short_name || "N/A";
    } else if (vehicleLabel.startsWith("AM")) {
      typeKey = "train"; color = vehicleColors[2];
    }

    // Destination
    if (v.vehicle.trip?.trip_headsign) {
      destination = v.vehicle.trip.trip_headsign;
    } else if (tripId && trips[tripId]) {
      destination = trips[tripId].trip_headsign || "N/A";
    }

    // Bus type
    if (typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const operators = busTypes[model];
        if (operators[operator]?.includes(vehicleNumber)) {
          busType = model; break;
        }
      }
    }

    // Speed limits
    const maxSpeed = typeKey === "bus" ? 100 : typeKey === "train" ? 160 : typeKey === "ferry" ? 80 : 180;
    const speed = speedKmh >= 0 && speedKmh <= maxSpeed ? speedKmh.toFixed(1) + " km/h" : "N/A";

    // Popup content
    const popupContent = `
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speed}<br>
      <b>Occupancy:</b> ${occupancy}
    `;

    if (vehicleLabel.startsWith("AM")) {
      if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
      else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
    }

    addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey);
  }));

  // Pair AM trains
  pairAMTrains(inServiceAM, outOfServiceAM).forEach(pair => {
    const marker = vehicleMarkers[pair.inTrain.vehicleId];
    if (marker) {
      const oldContent = marker.getPopup()?.getContent() || "";
      marker.getPopup().setContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
    }
  });

  // Remove stale markers
  Object.keys(vehicleMarkers).forEach(id => {
    if (!newVehicleIds.has(id)) {
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
      if (inactiveMarkers[id]) {
        map.removeLayer(inactiveMarkers[id]);
        delete inactiveMarkers[id];
      }
    }
  });

  debugBox.textContent = `Realtime update complete.`;
  updateVehicleCount();
}

// --- Vehicle count ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[3]).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[2]).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[4]).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
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

// --- Init ---
async function init() {
  const routesJson = await safeFetch(routesUrl);
  if (routesJson?.data) routesJson.data.forEach(r => { routes[r.id] = r; });
  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson) busTypes = busTypesJson;
  await fetchVehicles();
  setInterval(fetchVehicles, 20000);
}
init();
