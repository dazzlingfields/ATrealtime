// ================== v4.18 - Realtime Vehicle Tracking (Line Colors + HeadSign Cache + Bikes) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

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
  layers: [light],
  zoomControl: false // remove zoom buttons
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
  bus:   L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Colors ---
const trainLineColors = {
  STH: "#ff4d4d",   // Southern = red
  WEST: "#33cc33",  // Western = green
  EAST: "#ffcc00",  // Eastern = yellow
  ONE: "#3399ff"    // Onehunga = blue
};
const vehicleColors = {
  3: "#99ccff",  // Bus (light blue)
  4: "#99ffcc",  // Ferry (light green)
  default: "#cccccc"
};
const occupancyLabels = {
  EMPTY: "Empty",
  MANY_SEATS_AVAILABLE: "Many Seats Available",
  FEW_SEATS_AVAILABLE: "Few Seats Available",
  STANDING_ROOM_ONLY: "Standing Room Only",
  CRUSHED_STANDING_ROOM_ONLY: "Full",
  FULL: "Full",
  NOT_ACCEPTING_PASSENGERS: "Not accepting passengers"
};

// --- Trip cache ---
const headsignCache = {}; // tripId -> { headsign, bikes, wheelchair }

// --- Visibility control ---
let isTabActive = true;
document.addEventListener("visibilitychange", () => {
  isTabActive = document.visibilityState === "visible";
  if (isTabActive) fetchVehicles();
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

// --- Trip details fetch + cache ---
async function getTripDetails(tripId, vehicleId) {
  if (headsignCache[tripId]) return headsignCache[tripId];

  const tripJson = await safeFetch(`${tripsUrl}?ids=${tripId}`);
  if (tripJson?.data?.length > 0) {
    const attrs = tripJson.data[0].attributes;
    headsignCache[tripId] = {
      headsign: attrs.trip_headsign || "N/A",
      bikes: attrs.bikes_allowed,
      wheelchair: attrs.wheelchair_accessible
    };

    // Update popup for this vehicle
    if (vehicleMarkers[vehicleId]) {
      let popup = vehicleMarkers[vehicleId].getPopup()?.getContent() || "";
      popup = popup.replace(/<b>Destination:<\/b>.*?<br>/,
        `<b>Destination:</b> ${headsignCache[tripId].headsign}<br>`);
      if (headsignCache[tripId].bikes > 0) {
        popup += `<b>Bikes Allowed:</b> Yes<br>`;
      }
      vehicleMarkers[vehicleId].setPopupContent(popup);
    }
  }

  return headsignCache[tripId];
}

// --- Add or update marker ---
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
    }).addTo(vehicleLayers[type] || vehicleLayers.other);
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
  const busCount   = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[3]).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => Object.values(trainLineColors).includes(m.options.fillColor)).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors[4]).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Checkbox filter system ---
const checkboxes = document.querySelectorAll("#filters input[type=checkbox]");
function updateLayerVisibility() {
  checkboxes.forEach(cb => {
    const layer = vehicleLayers[cb.dataset.layer];
    if (cb.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
}
checkboxes.forEach(cb => cb.addEventListener("change", updateLayerVisibility));

// --- Fetch vehicles ---
async function fetchVehicles() {
  if (!isTabActive) return;

  const json = await safeFetch(realtimeUrl);
  if (!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const routeId = v.vehicle?.trip?.route_id;
    let typeKey = "other";
    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      switch (r.route_type) {
        case 2: typeKey = "train"; break;
        case 3: typeKey = "bus"; break;
        case 4: typeKey = "ferry"; break;
      }
    } else if (v.vehicle.vehicle?.label.startsWith("AM")) {
      typeKey = "bus";
    }

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

    // --- Train line colors ---
    if (typeKey === "train" && routeId && routes[routeId]) {
      const line = routes[routeId].route_short_name?.toUpperCase();
      if (trainLineColors[line]) color = trainLineColors[line];
    }

    // --- Bus types ---
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

    // Trip + headsign
    let destination = "N/A";
    let bikesText = "";
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId) {
      if (headsignCache[tripId]) {
        destination = headsignCache[tripId].headsign;
        if (headsignCache[tripId].bikes > 0) bikesText = `<b>Bikes Allowed:</b> Yes<br>`;
      } else {
        getTripDetails(tripId, vehicleId);
      }
    }

    const popupContent = `
      <b>Route:</b> ${routes[routeId]?.route_short_name || "N/A"}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      ${bikesText}
      <b>Speed:</b> ${(speedKmh >= 0 && speedKmh <= 180 ? speedKmh.toFixed(1) : "N/A")} km/h<br>
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
    const inMarker = vehicleMarkers[pair.inTrain.vehicleId];
    const outMarker = vehicleMarkers[pair.outTrain.vehicleId];
    if (inMarker && outMarker) {
      const oldContent = inMarker.getPopup()?.getContent() || "";
      inMarker.setPopupContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
      outMarker.setStyle({ fillColor: inMarker.options.fillColor });
    }
  });

  // Remove stale markers
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
