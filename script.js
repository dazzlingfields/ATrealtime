// ================== v4.43 - Realtime Vehicle Tracking ==================
// Features: AM pairing, bus types (load once, classify new buses),
// trips cache, occupancy, bikes allowed, ferry speed in knots,
// persistent caching, headsign immediate fetch, selectable basemaps
// Mobile: smaller popups, Desktop: smaller font size, checkboxes toggle layers
// Train: line-specific colours (STH, WEST, EAST, ONE)
// Base maps: Light, Dark, OSM, Satellite, Esri Hybrid

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
const esriImagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics", maxZoom: 20 }
);
const esriLabels = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Labels © Esri", maxZoom: 20 }
);
const esriHybrid = L.layerGroup([esriImagery, esriLabels]);

const map = L.map("map", {
  center: [-36.8485, 174.7633], zoom: 12, layers: [light], zoomControl: false
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite, "Esri Hybrid": esriHybrid };

const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out: L.layerGroup().addTo(map)
};
const overlayMaps = {
  "Buses": vehicleLayers.bus,
  "Trains": vehicleLayers.train,
  "Ferries": vehicleLayers.ferry,
  "Out of Service": vehicleLayers.out
};
L.control.layers(baseMaps, overlayMaps).addTo(map);

// --- Data ---
const vehicleMarkers = {};
const tripCache = {};
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

const vehicleColors = { bus: "#4a90e2", train: "#d0021b", ferry: "#1abc9c", out: "#9b9b9b" };
const trainLineColors = { STH: "#d0021b", WEST: "#6aa84f", EAST: "#f8e71c", ONE: "#0e76a8" };

const occupancyLabels = ["Empty","Many Seats Available","Few Seats Available","Standing Room Only","Limited Standing Room","Full","Not accepting passengers"];

// --- Helpers ---
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

function addVehicleMarker(id, lat, lon, popupContent, color, type, tripId, busType = "") {
  const isMobile = window.innerWidth <= 600;
  const popupOpts = { maxWidth: isMobile ? 200 : 250, className: "vehicle-popup" };

  if (vehicleMarkers[id]) {
    // update existing marker
    const marker = vehicleMarkers[id];
    marker.setLatLng([lat, lon]);
    marker.setPopupContent(popupContent);
    marker.setStyle({ fillColor: color });
    marker.tripId = tripId;

    // re-layer if classification changed
    Object.values(vehicleLayers).forEach(layer => layer.removeLayer(marker));
    (vehicleLayers[type] || vehicleLayers.out).addLayer(marker);
  } else {
    // create new marker
    const marker = L.circleMarker([lat, lon], {
      radius: isMobile ? 5 : 6,
      fillColor: color,
      color: "#000",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.9
    });
    (vehicleLayers[type] || vehicleLayers.out).addLayer(marker);
    marker.bindPopup(popupContent, popupOpts);
    marker.tripId = tripId;
    marker.busType = busType; // store classification once
    vehicleMarkers[id] = marker;
  }
}

function buildPopup(routeName, destination, vehicleLabel, busType, licensePlate, speedStr, occupancy, bikesLine) {
  return `
    <div style="font-size: 0.9em; line-height: 1.3;">
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speedStr}<br>
      <b>Occupancy:</b> ${occupancy}
      ${bikesLine}
    </div>
  `;
}

function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.bus.hasLayer(m)).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.train.hasLayer(m)).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.ferry.hasLayer(m)).length;
  document.getElementById("vehicle-count").textContent = `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Trips batch fetch with marker refresh ---
async function fetchTripsBatch(tripIds) {
  const idsToFetch = tripIds.filter(tid => tid && !tripCache[tid]);
  if (idsToFetch.length === 0) return;
  const tripJson = await safeFetch(`${tripsUrl}?ids=${idsToFetch.join(",")}`);
  if (tripJson?.data?.length > 0) {
    tripJson.data.forEach(t => {
      const attrs = t.attributes;
      if (attrs) {
        tripCache[attrs.trip_id] = {
          trip_id: attrs.trip_id,
          trip_headsign: attrs.trip_headsign || "N/A",
          route_id: attrs.route_id,
          bikes_allowed: attrs.bikes_allowed
        };
      }
    });

    // immediately update markers with new headsigns
    idsToFetch.forEach(tid => {
      const trip = tripCache[tid];
      if (!trip) return;
      Object.values(vehicleMarkers).forEach(m => {
        if (m.tripId === tid) {
          const r = routes[trip.route_id] || {};
          const basePopup = buildPopup(
            r.route_short_name || r.route_long_name || "Unknown",
            trip.trip_headsign || r.route_long_name || "Unknown",
            m.vehicleLabel || "N/A",
            m.busType || "", // use stored busType
            m.licensePlate || "N/A",
            "", "", ""
          );
          const pairedNote = m.pairedTo ? `<br><b>Paired to:</b> ${m.pairedTo} (6-car)` : "";
          m.setPopupContent(basePopup + pairedNote);
        }
      });
    });
  }
}

// --- AM train pairing ---
function pairAMTrains(inService, outOfService) {
  const pairs = [];
  const usedOut = new Set();
  inService.forEach(inTrain => {
    let bestMatch = null, bestDist = Infinity;
    outOfService.forEach(o => {
      if (usedOut.has(o.vehicleId)) return;
      const dx = inTrain.lat - o.lat;
      const dy = inTrain.lon - o.lon;
      const dist = Math.sqrt(dx * dx + dy * dy) * 111000;
      if (dist <= 200 && Math.abs(inTrain.speedKmh - o.speedKmh) <= 15) {
        if (dist < bestDist) { bestDist = dist; bestMatch = o; }
      }
    });
    if (bestMatch) {
      usedOut.add(bestMatch.vehicleId);
      pairs.push({ inTrain, outTrain: bestMatch });
    }
  });

  pairs.forEach(pair => {
    const inColor = pair.inTrain.color || vehicleColors.train;
    const outMarker = vehicleMarkers[pair.outTrain.vehicleId];
    const inMarker  = vehicleMarkers[pair.inTrain.vehicleId];
    if (outMarker) {
      outMarker.setStyle({ fillColor: inColor });
      const baseContent = outMarker.getPopup()?.getContent() || "";
      outMarker.getPopup().setContent(baseContent + `<br><b>Paired to:</b> ${pair.inTrain.vehicleLabel} (6-car)`);
      outMarker.pairedTo = pair.inTrain.vehicleLabel;
    }
    if (inMarker) {
      inMarker.pairedTo = pair.outTrain.vehicleLabel;
    }
  });

  return pairs;
}

// --- Render cached snapshot ---
function renderFromCache(cachedVehicles) {
  if (!cachedVehicles) return;
  cachedVehicles.forEach(v => {
    addVehicleMarker(v.vehicleId, v.lat, v.lon, v.popupContent, v.color, v.typeKey, v.tripId, v.busType || "");
  });
  debugBox.textContent = `Showing cached data (last update: ${new Date(cachedVehicles[0]?.ts || Date.now()).toLocaleTimeString()})`;
  updateVehicleCount();
}

// --- Fetch vehicles live ---
async function fetchVehicles() {
  const json = await safeFetch(realtimeUrl);
  if (!json) return;
  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];
  const allTripIds = [];
  const cachedState = [];

  vehicles.forEach(v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0, 2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";

    // speed
    let speedKmh = null;
    let speedStr = "N/A";
    if (v.vehicle.position.speed !== undefined) {
      const routeId = v.vehicle?.trip?.route_id;
      const routeType = routes[routeId]?.route_type;
      const isTrain = (routeType === 2);
      const isFerry = (routeType === 4);
      const isAM = vehicleLabel.startsWith("AM");
      if (isTrain || isFerry || isAM) speedKmh = v.vehicle.position.speed * 3.6;
      else speedKmh = v.vehicle.position.speed;
      if (isFerry && speedKmh !== null) {
        const speedKnots = v.vehicle.position.speed * 1.94384;
        speedStr = `${speedKmh.toFixed(1)} km/h (${speedKnots.toFixed(1)} kn)`;
      } else {
        speedStr = `${speedKmh.toFixed(1)} km/h`;
      }
    }

    // occupancy
    let occupancy = "N/A";
    if (v.vehicle.occupancy_status !== undefined) {
      const occIdx = v.vehicle.occupancy_status;
      if (occIdx >= 0 && occIdx <= 6) occupancy = occupancyLabels[occIdx];
    }

    // classification
    let typeKey = "out", color = vehicleColors.out;
    let routeName = "Out of Service", destination = "Unknown";
    const routeId = v.vehicle?.trip?.route_id;
    const tripId = v.vehicle?.trip?.trip_id;

    if (routeId && tripId && routes[routeId]) {
      const r = routes[routeId];
      routeName = r.route_short_name || r.route_long_name || "Unknown";
      switch (r.route_type) {
        case 2: typeKey = "train"; color = vehicleColors.train; break;
        case 3: typeKey = "bus"; color = vehicleColors.bus; break;
        case 4: typeKey = "ferry"; color = vehicleColors.ferry; break;
      }
    }
    if (routes[routeId]?.route_type === 3) { typeKey = "bus"; color = vehicleColors.bus; }
    if (tripId) allTripIds.push(tripId);

    if (tripId && tripCache[tripId]?.trip_headsign) {
      destination = tripCache[tripId].trip_headsign;
    } else if (routes[routeId]) {
      destination = routes[routeId].route_long_name || routes[routeId].route_short_name || "Unknown";
    }

    let bikesLine = "";
    const tripData = tripId ? tripCache[tripId] : null;
    if (tripData?.bikes_allowed !== undefined) {
      if (typeKey === "bus" && tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
      if (typeKey === "train") {
        if (tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
        else if (tripData.bikes_allowed === 1) bikesLine = `<br><b>Bikes Allowed:</b> Some`;
      }
    }

    // classify bus type only when a new bus appears
    let busType = vehicleMarkers[vehicleId]?.busType || "";
    if (!vehicleMarkers[vehicleId] && typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const ops = busTypes[model];
        if (ops[operator]?.includes(vehicleNumber)) {
          busType = model;
          break;
        }
      }
    }

    const popupContent = buildPopup(routeName, destination, vehicleLabel, busType, licensePlate, speedStr, occupancy, bikesLine);

    if (vehicleLabel.startsWith("AM")) {
      if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel, color });
      else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
    }

    addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey, tripId, busType);
    if (vehicleMarkers[vehicleId]) {
      vehicleMarkers[vehicleId].vehicleLabel = vehicleLabel;
      vehicleMarkers[vehicleId].licensePlate = licensePlate;
    }

    cachedState.push({ vehicleId, lat, lon, popupContent, color, typeKey, tripId, ts: Date.now(), busType });
  });

  // AM pairing
  pairAMTrains(inServiceAM, outOfServiceAM);

  // remove stale
  Object.keys(vehicleMarkers).forEach(id => {
    if (!newVehicleIds.has(id)) { map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; }
  });

  localStorage.setItem("realtimeSnapshot", JSON.stringify(cachedState));
  debugBox.textContent = `Realtime update complete at ${new Date().toLocaleTimeString()}`;
  updateVehicleCount();

  await fetchTripsBatch([...new Set(allTripIds)]);
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
        route_color: attrs.route_color,
        agency_id: attrs.agency_id
      };
    });
  }
  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson) busTypes = busTypesJson;

  const cached = localStorage.getItem("realtimeSnapshot");
  if (cached) {
    try { renderFromCache(JSON.parse(cached)); } catch {}
  }

  document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", e => {
      const layer = e.target.getAttribute("data-layer");
      if (vehicleLayers[layer]) {
        if (e.target.checked) map.addLayer(vehicleLayers[layer]);
        else map.removeLayer(vehicleLayers[layer]);
      }
    });
  });

  fetchVehicles();
  setInterval(fetchVehicles, 15000);
}
init();
