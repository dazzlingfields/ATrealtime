// ================== v4.21e - Realtime Vehicle Tracking (AM pairing, occupancy, bus types, train line colours, trip cache, active headsigns fixed) ==================

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
  zoomControl: false
});
const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Vehicle layers ---
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out: L.layerGroup().addTo(map)
};

// --- Vehicle data structures ---
const vehicleMarkers = {};
const tripCache = {};
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

// --- Colours ---
const vehicleColors = {
  bus: "#4a90e2",
  train: "#d0021b",
  ferry: "#1abc9c",   // teal for distinction
  out: "#9b9b9b"
};
const trainLineColors = {
  STH: "#d0021b",
  WEST: "#417505",
  EAST: "#f8e71c",
  ONE: "#4a90e2"
};

// --- Occupancy labels ---
const occupancyLabels = [
  "Empty",
  "Many Seats Available",
  "Few Seats Available",
  "Standing Room Only",
  "Limited Standing Room",
  "Full",
  "Not accepting passengers"
];

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

// --- Pick currently active trip from list ---
function selectActiveTrip(trips) {
  if (!trips?.length) return null;

  const now = new Date();
  const today = now.toISOString().slice(0,10).replace(/-/g,""); // YYYYMMDD

  let bestTrip = null;
  let bestDelta = Infinity;

  for (const t of trips) {
    const attrs = t.attributes;
    if (!attrs.start_time || !attrs.start_date) continue;
    if (attrs.start_date !== today) continue;

    const [hh, mm, ss] = attrs.start_time.split(":").map(Number);
    const tripStart = new Date(now);
    tripStart.setHours(hh, mm, ss, 0);

    const delta = Math.abs(now - tripStart);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestTrip = attrs;
    }
  }

  return bestTrip || trips[0].attributes;
}

// --- Trip fetch with caching ---
async function fetchTrip(tripId, routeId = null) {
  if (!tripId && !routeId) return null;

  if (tripId && tripCache[tripId]) return tripCache[tripId];

  // Corrected: fetch trip by ID using REST path
  if (tripId) {
    const tripJson = await safeFetch(`${tripsUrl}/${tripId}`);
    if (tripJson?.data) {
      const attrs = tripJson.data.attributes || tripJson.data[0]?.attributes;
      if (attrs) {
        tripCache[tripId] = {
          trip_id: attrs.trip_id,
          trip_headsign: attrs.trip_headsign || attrs.headsign || "N/A",
          route_id: attrs.route_id,
          bikes_allowed: attrs.bikes_allowed
        };
        return tripCache[tripId];
      }
    }
  }

  // Fallback: by route_id
  if (routeId) {
    const tripJson = await safeFetch(`${tripsUrl}?route_id=${routeId}`);
    if (tripJson?.data?.length > 0) {
      const activeAttrs = selectActiveTrip(tripJson.data);
      if (activeAttrs) {
        const result = {
          trip_id: activeAttrs.trip_id,
          trip_headsign: activeAttrs.trip_headsign || activeAttrs.headsign || "N/A",
          route_id: activeAttrs.route_id,
          bikes_allowed: activeAttrs.bikes_allowed
        };
        if (activeAttrs.trip_id) tripCache[activeAttrs.trip_id] = result;
        return result;
      }
    }
  }

  return null;
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
  return pairs;
}

// --- Update vehicle count ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.bus).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor !== vehicleColors.bus && m.options.fillColor !== vehicleColors.ferry && m.options.fillColor !== vehicleColors.out).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === vehicleColors.ferry).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Fetch vehicles ---
async function fetchVehicles() {
  const json = await safeFetch(realtimeUrl);
  if (!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [], outOfServiceAM = [];

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0, 2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;

    const occIdx = v.vehicle.occupancy_status;
    const occupancy = (occIdx !== undefined && occIdx >= 0 && occIdx <= 6)
      ? occupancyLabels[occIdx]
      : "N/A";

    let typeKey = "out", color = vehicleColors.out;
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
      if (typeKey === "train") {
        if (r.route_color) {
          color = `#${r.route_color}`;
        } else if (routeName.includes("STH")) color = trainLineColors.STH;
        else if (routeName.includes("WEST")) color = trainLineColors.WEST;
        else if (routeName.includes("EAST")) color = trainLineColors.EAST;
        else if (routeName.includes("ONE")) color = trainLineColors.ONE;
        else color = vehicleColors.train;
      } else {
        color = vehicleColors[typeKey] || color;
      }
    }

    // Trip info
    const tripId = v.vehicle?.trip?.trip_id;
    const tripData = await fetchTrip(tripId, routeId);
    if (tripData?.trip_headsign && tripData.trip_headsign !== "N/A") {
      destination = tripData.trip_headsign;
    } else if (routes[routeId]) {
      destination = routes[routeId].route_long_name || routes[routeId].route_short_name || "N/A";
    }
    if (tripData?.bikes_allowed !== undefined) {
      const bikeText = tripData.bikes_allowed === 2 ? "Yes" :
                       tripData.bikes_allowed === 1 ? "Some" : "No";
      destination += `<br><b>Bikes Allowed:</b> ${bikeText}`;
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

    const popupContent = `
      <b>Route:</b> ${routeName}<br>
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
      marker.getPopup().setContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel} (6-car)`);
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
        route_color: attrs.route_color,
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
