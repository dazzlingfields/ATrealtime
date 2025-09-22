// ================== v4.19 - Realtime Vehicle Tracking (Headsign + Occupancy Fix) ==================

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
  layers: [light],
  zoomControl: false // remove zoom buttons
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Vehicle data structures ---
const vehicleMarkers = {};
const trips = {};
const tripCache = {}; // persistent cache for headsigns + bikes_allowed
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

// --- Vehicle layers ---
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out: L.layerGroup().addTo(map) // out of service
};

// --- Vehicle colors & occupancy ---
const vehicleColors = {
  bus: "#4a90e2",
  train: "#d0021b",
  ferry: "#7ed321",
  out: "#9b9b9b"
};

// Train line colors
const trainLineColors = {
  STH: "#d0021b", // red
  WEST: "#417505", // green
  EAST: "#f8e71c", // yellow
  ONE: "#4a90e2" // blue
};

const occupancyLabels = [
  "Empty",
  "Many Seats Available",
  "Few Seats Available",
  "Standing Room Only",
  "Limited Standing Room",
  "Full",
  "Not accepting passengers"
];

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
    }).addTo(vehicleLayers[type] || vehicleLayers.out);
    marker.bindPopup(popupContent);
    vehicleMarkers[id] = marker;
  }
}

// --- AM pairing ---
function pairAMTrains(inService, outOfService) {
  const pairs = [];
  const usedOut = new Set();

  inService.forEach(inTrain => {
    let bestMatch = null;
    let bestDist = Infinity;

    outOfService.forEach(o => {
      if (usedOut.has(o.vehicleId)) return;

      const dLat = inTrain.lat - o.lat;
      const dLon = inTrain.lon - o.lon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);

      // match only if close and similar speed
      if (dist < 0.002 && Math.abs(inTrain.speedKmh - o.speedKmh) < 10) {
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = o;
        }
      }
    });

    if (bestMatch) {
      usedOut.add(bestMatch.vehicleId);
      pairs.push({ inTrain, outTrain: bestMatch });
    }
  });

  return pairs;
}

// --- Update vehicle count ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.bus).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.train).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.ferry).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Checkbox filter system ---
const checkboxes = document.querySelectorAll("#filters input[type=checkbox]");
function updateLayerVisibility() {
  checkboxes.forEach(cb => {
    const layer = vehicleLayers[cb.dataset.layer];
    if (!layer) return;
    if (cb.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
  if (!map.hasLayer(vehicleLayers.out)) {
    map.addLayer(vehicleLayers.out); // out of service always shown
  }
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
  const missingTripIds = new Set();

  vehicles.forEach(v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && !trips[tripId] && !tripCache[tripId]) missingTripIds.add(tripId);
  });

  if (missingTripIds.size) {
    const ids = Array.from(missingTripIds).join(",");
    const tripJson = await safeFetch(`${tripsUrl}?ids=${ids}`);
    if (tripJson?.data) {
      tripJson.data.forEach(t => {
        const trip = t.attributes || t;
        trips[t.id] = trip;
        tripCache[t.id] = trip;
      });
    }
  }

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0,2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;

    const occupancyIndex = v.vehicle.occupancy_status;
    const occupancy = (occupancyIndex !== undefined && occupancyIndex >= 0 && occupancyIndex <= 6)
      ? occupancyLabels[occupancyIndex]
      : "N/A";

    // Classification
    let typeKey = "out";
    let color = vehicleColors.out;
    let routeName = "Out of Service", destination = "N/A";

    const routeId = v.vehicle?.trip?.route_id;
    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      routeName = r.route_short_name || r.route_long_name || "N/A";
      switch (r.route_type) {
        case 2: typeKey = "train"; break;
        case 3: typeKey = "bus"; break;
        case 4: typeKey = "ferry"; break;
      }
      if (typeKey === "train" && routeName) {
        if (routeName.includes("STH")) color = trainLineColors.STH;
        else if (routeName.includes("WEST")) color = trainLineColors.WEST;
        else if (routeName.includes("EAST")) color = trainLineColors.EAST;
        else if (routeName.includes("ONE")) color = trainLineColors.ONE;
        else color = vehicleColors.train;
      } else {
        color = vehicleColors[typeKey] || color;
      }
    }

    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && (trips[tripId] || tripCache[tripId])) {
      const tripData = trips[tripId] || tripCache[tripId];
      if (tripData.trip_headsign) destination = tripData.trip_headsign;
    }

    // Bus type
    let busType = "";
    if (typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const ops = busTypes[model];
        if (ops[operator]?.includes(vehicleNumber)) {
          busType = model;
          color = vehicleColors.bus;
          break;
        }
      }
    }

    // Bikes allowed
    let bikes = "";
    if (tripId && (trips[tripId] || tripCache[tripId])) {
      const tripData = trips[tripId] || tripCache[tripId];
      if (tripData.bikes_allowed !== undefined) {
        bikes = `<br><b>Bikes Allowed:</b> ${tripData.bikes_allowed}`;
      }
    }

    const popupContent = `
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${(speedKmh >= 0 && speedKmh <= 180 ? speedKmh.toFixed(1) : "N/A")} km/h<br>
      <b>Occupancy:</b> ${occupancy}
      ${bikes}
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
      marker.getPopup().setContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel} (6-car)`);
      const outMarker = vehicleMarkers[pair.outTrain.vehicleId];
      if (outMarker) outMarker.setStyle({ fillColor: marker.options.fillColor });
    }
  });

  Object.keys(vehicleMarkers).forEach(id => {
    if (!newVehicleIds.has(id)) {
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  debugBox.textContent = `Realtime update complete.`;
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
