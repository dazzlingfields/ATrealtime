// ================== v4.41 - Realtime Vehicle Tracking ==================
// Features: AT + Metlink feeds, AM pairing, bus types, trips cache, occupancy,
// bikes allowed, ferry speed in knots, persistent caching, headsign fallback,
// selectable basemaps, Metlink layer
// Mobile: smaller popups, Desktop: smaller font size, checkboxes toggle layers
// Train: line-specific colours (STH, WEST, EAST, ONE)
// Base maps: Light, Dark, OSM, Satellite, Esri Hybrid

// --- API endpoints (Auckland) ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- API endpoints (Metlink) ---
const metlinkUrl = `${proxyBaseUrl}/api/metlink?endpoint=gtfs-rt/vehiclepositions`;

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
// Esri Hybrid
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

const baseMaps = { 
  "Light": light, 
  "Dark": dark, 
  "OSM": osm, 
  "Satellite": satellite, 
  "Esri Hybrid": esriHybrid
};

const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out: L.layerGroup().addTo(map),
  metlink: L.layerGroup().addTo(map) // NEW
};
const overlayMaps = {
  "Buses": vehicleLayers.bus,
  "Trains": vehicleLayers.train,
  "Ferries": vehicleLayers.ferry,
  "Out of Service": vehicleLayers.out,
  "Metlink": vehicleLayers.metlink // NEW
};
L.control.layers(baseMaps, overlayMaps).addTo(map);

// --- Data ---
const vehicleMarkers = {};
const tripCache = {};
let routes = {};
let busTypes = {};
const debugBox = document.getElementById("debug");

const vehicleColors = { bus: "#4a90e2", train: "#d0021b", ferry: "#1abc9c", out: "#9b9b9b", metlink: "#ff9800" };
const trainLineColors = { 
  STH: "#d0021b",  WEST: "#6aa84f",  EAST: "#f8e71c",  ONE: "#0e76a8"
};

const occupancyLabels = [
  "Empty","Many Seats Available","Few Seats Available",
  "Standing Room Only","Limited Standing Room","Full","Not accepting passengers"
];

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

function addVehicleMarker(id, lat, lon, popupContent, color, type, tripId) {
  const isMobile = window.innerWidth <= 600;
  const popupOpts = { maxWidth: isMobile ? 200 : 250, className: "vehicle-popup" };

  if (vehicleMarkers[id]) {
    vehicleMarkers[id].setLatLng([lat, lon]);
    vehicleMarkers[id].setPopupContent(popupContent);
    vehicleMarkers[id].setStyle({ fillColor: color });
    vehicleMarkers[id].tripId = tripId;
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: isMobile ? 5 : 6, fillColor: color, color: "#000",
      weight: 1, opacity: 1, fillOpacity: 0.9
    });
    (vehicleLayers[type] || vehicleLayers.out).addLayer(marker);
    marker.bindPopup(popupContent, popupOpts);
    marker.tripId = tripId;
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
  const metlinkCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.metlink.hasLayer(m)).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}, Metlink: ${metlinkCount}`;
}

// --- Trips batch fetch (AT only) ---
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
  }
}

// --- AM train pairing (AT only) ---
function pairAMTrains(inService, outOfService) { ... } // unchanged

// --- Render cached snapshot (AT only) ---
function renderFromCache(cachedVehicles) { ... } // unchanged

// --- Fetch AT vehicles ---
async function fetchVehicles() { ... } // unchanged from v4.40 (includes fixes)

// --- Fetch Metlink vehicles ---
async function fetchMetlinkVehicles() {
  const json = await safeFetch(metlinkUrl);
  if (!json) return;
  const vehicles = json.entity || [];
  const newVehicleIds = new Set();

  vehicles.forEach(v => {
    const id = v.vehicle?.vehicle?.id;
    if (!id || !v.vehicle.position) return;
    newVehicleIds.add(id);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const label = v.vehicle.vehicle?.label || "Metlink";
    const speed = v.vehicle.position.speed ? (v.vehicle.position.speed * 3.6).toFixed(1) : "0";

    const popupContent = `
      <div style="font-size: 0.9em; line-height: 1.3;">
        <b>Metlink Vehicle:</b> ${label}<br>
        <b>Speed:</b> ${speed} km/h
      </div>
    `;

    addVehicleMarker("ML-" + id, lat, lon, popupContent, vehicleColors.metlink, "metlink", null);
  });

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

  const cached = localStorage.getItem("realtimeSnapshot");
  if (cached) {
    try { renderFromCache(JSON.parse(cached)); } catch {}
  }

  // Hook up checkboxes
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

  fetchMetlinkVehicles();
  setInterval(fetchMetlinkVehicles, 20000);
}
init();
