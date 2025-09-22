// ================== v4.18 - Realtime Vehicle Tracking (Line Colours + Core Systems) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  subdomains: "abcd", maxZoom: 20
});
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  subdomains: "abcd", maxZoom: 20
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
  zoomControl: false, // remove zoom buttons
  layers: [light]
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Vehicle data structures ---
const vehicleMarkers = {};
const trips = {};
let routes = {};
let busTypes = {};
const tripCache = {};
const debugBox = document.getElementById("debug");

// --- Vehicle layers ---
const vehicleLayers = {
  bus:   L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out:   L.layerGroup().addTo(map) // out-of-service
};

// --- Vehicle colours ---
const trainLineColors = {
  STH: "#ff4d4d",   // Southern line
  WEST: "#33cc33",  // Western line
  EAST: "#ffcc00",  // Eastern line
  ONE: "#3399ff"    // Onehunga line
};

const vehicleColors = {
  train: "#ff8080",  // fallback if no line colour
  bus:   "#66a3ff",
  ferry: "#66ffb2",
  out:   "#999999"
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

// --- Add/update marker ---
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
      fillOpacity: 0.85
    }).addTo(vehicleLayers[type] || vehicleLayers.out);
    marker.bindPopup(popupContent);
    vehicleMarkers[id] = marker;
  }
}

// --- AM pairing ---
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function pairAMTrains(inService, outOfService) {
  const pairs = [];
  inService.forEach(inTrain => {
    const candidate = outOfService.find(o => {
      const dist = haversine(inTrain.lat, inTrain.lon, o.lat, o.lon);
      const speedDiff = Math.abs(inTrain.speedKmh - o.speedKmh);
      return dist < 200 && speedDiff < 15;
    });
    if (candidate) pairs.push({ inTrain, outTrain: candidate });
  });
  return pairs;
}

// --- Update counts ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.bus).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => Object.values(trainLineColors).includes(m.options.fillColor) || m.options.fillColor === vehicleColors.train).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.ferry).length;
  document.getElementById("vehicle-count").textContent = `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Checkbox filters ---
const checkboxes = document.querySelectorAll("#filters input[type=checkbox]");
function updateLayerVisibility() {
  checkboxes.forEach(cb => {
    const layer = vehicleLayers[cb.dataset.layer];
    if (cb.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
  if (!map.hasLayer(vehicleLayers.out)) map.addLayer(vehicleLayers.out); // out always visible
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

    const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0,2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;
    const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

    let typeKey = "out";
    const routeId = v.vehicle?.trip?.route_id;
    let routeName = "N/A", destination = "N/A";
    let color = vehicleColors.out;

    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      routeName = r.route_short_name || r.route_long_name || "N/A";
      switch (r.route_type) {
        case 2: typeKey = "train"; break;
        case 3: typeKey = "bus"; break;
        case 4: typeKey = "ferry"; break;
      }
      // Train line colouring
      if (typeKey === "train" && routeName) {
        if (routeName.includes("STH")) color = trainLineColors.STH;
        else if (routeName.includes("WEST")) color = trainLineColors.WEST;
        else if (routeName.includes("EAST")) color = trainLineColors.EAST;
        else if (routeName.includes("ONE")) color = trainLineColors.ONE;
        else color = vehicleColors.train;
      } else {
        color = vehicleColors[typeKey] || color;
      }
    } else if (vehicleLabel.startsWith("AM")) {
      typeKey = "bus";
      color = vehicleColors.bus;
    }

    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId && (trips[tripId] || tripCache[tripId])) {
      const tripData = trips[tripId] || tripCache[tripId];
      destination = tripData.trip_headsign || destination;
    }

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

  // AM train pairing
  pairAMTrains(inServiceAM, outOfServiceAM).forEach(pair => {
    const marker = vehicleMarkers[pair.inTrain.vehicleId];
    if (marker) {
      const oldContent = marker.getPopup()?.getContent() || "";
      marker.getPopup().setContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
      const outMarker = vehicleMarkers[pair.outTrain.vehicleId];
      if (outMarker) outMarker.setStyle({ fillColor: marker.options.fillColor });
    }
  });

  // Remove stale markers
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
