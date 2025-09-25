// ================== v4.46 - Realtime Vehicle Tracking ==================
// Focus: no overlapping polls, chunked trip fetch, resilient errors.
// Also: fast bus-type on first in-service sighting, robust reclassification,
// immediate headsign updates, AM pairing, distinct train line colours.

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
  { attribution: "Tiles © Esri, Maxar, Earthstar Geographics", maxZoom: 20 }
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

// --- Data and state ---
const vehicleMarkers = {};   // id -> Leaflet marker with extra fields
const tripCache = {};
let routes = {};
let busTypes = {};
let busTypeIndex = {};       // operator -> number -> model
const debugBox = document.getElementById("debug");

const vehicleColors = { bus: "#4a90e2", train: "#d0021b", ferry: "#1abc9c", out: "#9b9b9b" };
const trainLineColors = { STH: "#d0021b", WEST: "#6aa84f", EAST: "#f8e71c", ONE: "#0e76a8" };

const occupancyLabels = [
  "Empty","Many Seats Available","Few Seats Available",
  "Standing Room Only","Limited Standing Room","Full","Not accepting passengers"
];

// anti overlap controls
let vehiclesAbort;
let vehiclesInFlight = false;

// --- Helpers ---
function setDebug(msg) { if (debugBox) debugBox.textContent = msg; }

async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      const extra = body ? ` | ${body.slice(0, 200)}` : "";
      throw new Error(`${res.status} ${res.statusText}${extra}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Fetch error:", err);
    setDebug(`Fetch error: ${err.message}`);
    return null;
  }
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Build a fast index from the static busTypes JSON
function buildBusTypeIndex(json) {
  const index = {};
  if (!json || typeof json !== "object") return index;
  for (const model of Object.keys(json)) {
    const ops = json[model] || {};
    for (const op of Object.keys(ops)) {
      const nums = ops[op] || [];
      if (!index[op]) index[op] = {};
      for (const n of nums) index[op][n] = model;
    }
  }
  return index;
}
function getBusType(operator, vehicleNumber) {
  if (!operator || vehicleNumber == null) return "";
  const ix = busTypeIndex[operator];
  return ix ? (ix[vehicleNumber] || "") : "";
}

function addOrUpdateMarker(id, lat, lon, popupContent, color, type, tripId, fields = {}) {
  const isMobile = window.innerWidth <= 600;
  const popupOpts = { maxWidth: isMobile ? 200 : 250, className: "vehicle-popup" };

  if (vehicleMarkers[id]) {
    const m = vehicleMarkers[id];
    m.setLatLng([lat, lon]);
    m.setPopupContent(popupContent);
    m.setStyle({ fillColor: color });
    m.tripId = tripId;
    Object.assign(m, fields);
    // ensure correct layer assignment if classification changed
    Object.values(vehicleLayers).forEach(layer => layer.removeLayer(m));
    (vehicleLayers[type] || vehicleLayers.out).addLayer(m);
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: isMobile ? 5 : 6, fillColor: color, color: "#000",
      weight: 1, opacity: 1, fillOpacity: 0.9
    });
    (vehicleLayers[type] || vehicleLayers.out).addLayer(marker);
    marker.bindPopup(popupContent, popupOpts);
    marker.tripId = tripId;
    Object.assign(marker, fields);
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
  const el = document.getElementById("vehicle-count");
  if (el) el.textContent = `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Trips batch fetch with chunking and marker refresh ---
async function fetchTripsBatch(tripIds) {
  const idsToFetch = tripIds.filter(tid => tid && !tripCache[tid]);
  if (idsToFetch.length === 0) return;

  const batches = chunk([...new Set(idsToFetch)], 100); // tune as needed
  for (const ids of batches) {
    const tripJson = await safeFetch(`${tripsUrl}?ids=${ids.join(",")}`);
    if (!tripJson) continue;
    if (tripJson?.data?.length > 0) {
      tripJson.data.forEach(t => {
        const a = t.attributes;
        if (a) {
          tripCache[a.trip_id] = {
            trip_id: a.trip_id,
            trip_headsign: a.trip_headsign || "N/A",
            route_id: a.route_id,
            bikes_allowed: a.bikes_allowed
          };
        }
      });

      // refresh popups for this batch immediately
      ids.forEach(tid => {
        const trip = tripCache[tid];
        if (!trip) return;
        Object.values(vehicleMarkers).forEach(m => {
          if (m.tripId === tid) {
            const r = routes[trip.route_id] || {};
            const basePopup = buildPopup(
              r.route_short_name || r.route_long_name || "Unknown",
              trip.trip_headsign || r.route_long_name || "Unknown",
              m.vehicleLabel || "N/A",
              m.busType || "",
              m.licensePlate || "N/A",
              m.speedStr || "",
              m.occupancy || "",
              m.bikesLine || ""
            );
            const pairedNote = m.pairedTo ? `<br><b>Paired to:</b> ${m.pairedTo} (6-car)` : "";
            m.setPopupContent(basePopup + pairedNote);
          }
        });
      });
    }
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
function renderFromCache(cached) {
  if (!cached) return;
  cached.forEach(v => {
    addOrUpdateMarker(
      v.vehicleId, v.lat, v.lon, v.popupContent, v.color, v.typeKey, v.tripId,
      {
        currentType: v.typeKey,
        vehicleLabel: v.vehicleLabel || "",
        licensePlate: v.licensePlate || "",
        busType: v.busType || "",
        speedStr: v.speedStr || "",
        occupancy: v.occupancy || "",
        bikesLine: v.bikesLine || ""
      }
    );
  });
  setDebug(`Showing cached data (last update: ${new Date(cached[0]?.ts || Date.now()).toLocaleTimeString()})`);
  updateVehicleCount();
}

// --- Train colour helper ---
function trainColorForRoute(routeShortName) {
  if (!routeShortName) return vehicleColors.train;
  if (routeShortName.includes("STH")) return trainLineColors.STH;
  if (routeShortName.includes("WEST")) return trainLineColors.WEST;
  if (routeShortName.includes("EAST")) return trainLineColors.EAST;
  if (routeShortName.includes("ONE")) return trainLineColors.ONE;
  return vehicleColors.train;
}

// --- Fetch vehicles live with anti overlap and resilience ---
async function fetchVehicles() {
  if (vehiclesInFlight) return;            // prevent overlap
  vehiclesInFlight = true;
  try {
    vehiclesAbort?.abort?.();              // cancel any stale request
    vehiclesAbort = new AbortController();

    const json = await safeFetch(realtimeUrl, { signal: vehiclesAbort.signal });
    if (!json) return;                     // keep previous state on error

    const vehicles = json?.response?.entity || json?.entity || [];
    const newIds = new Set();
    const inServiceAM = [], outOfServiceAM = [];
    const allTripIds = [];
    const cachedState = [];

    vehicles.forEach(v => {
      const vehicleId = v.vehicle?.vehicle?.id;
      if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
      newIds.add(vehicleId);

      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;
      const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
      const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";

      // operator and number parsing
      const operator = v.vehicle.vehicle?.operator_id
        || (vehicleLabel.match(/^[A-Za-z]+/)?.[0] ?? "")
        || "";
      const vehicleNumber = (() => {
        const digits = Number(vehicleLabel.replace(/\D/g, ""));
        if (!isNaN(digits) && digits > 0) return digits;
        return Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
      })();

      // speed
      let speedKmh = null;
      let speedStr = "N/A";
      if (v.vehicle.position.speed !== undefined) {
        const rIdTmp = v.vehicle?.trip?.route_id;
        const rTypeTmp = routes[rIdTmp]?.route_type;
        const isTrainTmp = rTypeTmp === 2;
        const isFerryTmp = rTypeTmp === 4;
        const isAM = vehicleLabel.startsWith("AM");
        speedKmh = (isTrainTmp || isFerryTmp || isAM) ? v.vehicle.position.speed * 3.6
                                                      : v.vehicle.position.speed;
        if (isFerryTmp && speedKmh !== null) {
          const speedKnots = v.vehicle.position.speed * 1.94384;
          speedStr = `${speedKmh.toFixed(1)} km/h (${speedKnots.toFixed(1)} kn)`;
        } else {
          speedStr = `${speedKmh.toFixed(1)} km/h`;
        }
      }

      // occupancy
      let occupancy = "N/A";
      if (v.vehicle.occupancy_status !== undefined) {
        const idx = v.vehicle.occupancy_status;
        if (idx >= 0 && idx <= 6) occupancy = occupancyLabels[idx];
      }

      // classification and line colours
      let typeKey = "out", color = vehicleColors.out;
      let routeName = "Out of Service", destination = "Unknown";
      const routeId = v.vehicle?.trip?.route_id;
      const tripId = v.vehicle?.trip?.trip_id;

      if (routeId && tripId && routes[routeId]) {
        const r = routes[routeId];
        routeName = r.route_short_name || r.route_long_name || "Unknown";
        switch (r.route_type) {
          case 2: { typeKey = "train"; color = trainColorForRoute(r.route_short_name); break; }
          case 3: { typeKey = "bus";   color = vehicleColors.bus; break; }
          case 4: { typeKey = "ferry"; color = vehicleColors.ferry; break; }
        }
      }
      if (routes[routeId]?.route_type === 3) { typeKey = "bus"; color = vehicleColors.bus; }
      if (tripId) allTripIds.push(tripId);

      if (tripId && tripCache[tripId]?.trip_headsign) {
        destination = tripCache[tripId].trip_headsign;
      } else if (routes[routeId]) {
        destination = routes[routeId].route_long_name || routes[routeId].route_short_name || "Unknown";
      }

      // bikes allowed
      let bikesLine = "";
      const tripData = tripId ? tripCache[tripId] : null;
      if (tripData?.bikes_allowed !== undefined) {
        if (typeKey === "bus" && tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
        if (typeKey === "train") {
          if (tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
          else if (tripData.bikes_allowed === 1) bikesLine = `<br><b>Bikes Allowed:</b> Some`;
        }
      }

      // bus type decision points
      let busType = vehicleMarkers[vehicleId]?.busType || "";
      const wasBus = vehicleMarkers[vehicleId]?.currentType === "bus";
      const isBusNow = typeKey === "bus";
      const mustComputeBusType =
        (isBusNow && !busType)                       // first time we have it as bus without stored type
        || (isBusNow && !wasBus)                     // transitioned into bus
        || (!vehicleMarkers[vehicleId] && isBusNow); // brand new marker that is a bus

      if (mustComputeBusType && operator && vehicleNumber) {
        const model = getBusType(operator, vehicleNumber);
        if (model) busType = model;
      }

      const popupContent = buildPopup(
        routeName, destination, vehicleLabel, busType, licensePlate, speedStr, occupancy, bikesLine
      );

      // AM pairing pools
      if (vehicleLabel.startsWith("AM")) {
        if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel, color });
        else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
      }

      addOrUpdateMarker(
        vehicleId, lat, lon, popupContent, color, typeKey, tripId,
        {
          currentType: typeKey,
          vehicleLabel,
          licensePlate,
          busType,
          speedStr,
          occupancy,
          bikesLine
        }
      );

      cachedState.push({
        vehicleId, lat, lon, popupContent, color, typeKey, tripId,
        ts: Date.now(),
        vehicleLabel, licensePlate, busType, speedStr, occupancy, bikesLine
      });
    });

    // AM pairing
    pairAMTrains(inServiceAM, outOfServiceAM);

    // remove stale markers only when realtime fetch succeeded
    Object.keys(vehicleMarkers).forEach(id => {
      if (!newIds.has(id)) {
        map.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    localStorage.setItem("realtimeSnapshot", JSON.stringify(cachedState));
    setDebug(`Realtime update complete at ${new Date().toLocaleTimeString()}`);
    updateVehicleCount();

    // immediate trip fetch to fill headsigns, chunked
    await fetchTripsBatch([...new Set(allTripIds)]);
  } finally {
    vehiclesInFlight = false;
  }
}

// --- Init ---
async function init() {
  // routes first
  const routesJson = await safeFetch(routesUrl);
  if (routesJson?.data) {
    routesJson.data.forEach(r => {
      const a = r.attributes || r;
      routes[r.id] = {
        route_type: a.route_type,
        route_short_name: a.route_short_name,
        route_long_name: a.route_long_name,
        route_color: a.route_color,
        agency_id: a.agency_id
      };
    });
  }

  // preload busTypes once and build index
  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson) {
    busTypes = busTypesJson;
    busTypeIndex = buildBusTypeIndex(busTypesJson);
  }

  // render cached state if any
  const cached = localStorage.getItem("realtimeSnapshot");
  if (cached) {
    try { renderFromCache(JSON.parse(cached)); } catch {}
  }

  // checkbox handlers
  document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", e => {
      const layer = e.target.getAttribute("data-layer");
      if (vehicleLayers[layer]) {
        if (e.target.checked) map.addLayer(vehicleLayers[layer]);
        else map.removeLayer(vehicleLayers[layer]);
      }
    });
  });

  await fetchVehicles();
  setInterval(fetchVehicles, 15000);
}
init();
