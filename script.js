// ================== v4.18 - Realtime Vehicle Tracking (Cached Trips + Custom Colours) ==================

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

const map = L.map("map", { center: [-36.8485, 174.7633], zoom: 12, layers: [light] });
L.control.layers({ Light: light, Dark: dark, OSM: osm, Satellite: satellite }).addTo(map);

// --- Vehicle data ---
const vehicleMarkers = {};
let routes = {};
let busTypes = {};
let trips = {}; // tripId -> { trip_headsign, lastUpdated }
const debugBox = document.getElementById("debug");

// Load cached trips from localStorage
const storedTrips = localStorage.getItem("tripCache");
if (storedTrips) {
  try { trips = JSON.parse(storedTrips); }
  catch (e) { console.warn("Invalid tripCache:", e); }
}

// --- Layers ---
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Colours ---
const lineColours = {
  STH: "rgba(255, 80, 80, 0.9)",    // Southern → Red
  WEST: "rgba(80, 200, 120, 0.9)",  // Western → Green
  EAST: "rgba(255, 220, 80, 0.9)",  // Eastern → Yellow
  ONE: "rgba(80, 150, 255, 0.9)"    // Onehunga → Blue
};
const defaultColours = {
  train: "rgba(200, 200, 200, 0.9)",  // Light gray
  bus: "rgba(135, 206, 235, 0.9)",    // Sky blue
  ferry: "rgba(120, 220, 200, 0.9)",  // Teal
  other: "rgba(180, 180, 180, 0.9)"   // Neutral gray
};

// --- Occupancy ---
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

function pairAMTrains(inService, outOfService) {
  const pairs = [];
  inService.forEach(inTrain => {
    const outTrain = outOfService.find(o => o.vehicleLabel !== inTrain.vehicleLabel);
    if (outTrain) pairs.push({ inTrain, outTrain });
  });
  return pairs;
}

// --- Update counts ---
function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === defaultColours.bus).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === defaultColours.train).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => m.options.fillColor === defaultColours.ferry).length;
  document.getElementById("vehicle-count").textContent =
    `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

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

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || vehicleLabel.slice(0, 2);
    const vehicleNumber = Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : 0;

    // --- Vehicle classification ---
    let typeKey = "other";
    let color = defaultColours.other;
    let routeId = v.vehicle?.trip?.route_id;
    let destination = v.vehicle.trip?.trip_headsign || "N/A";

    if (routeId && routes[routeId]) {
      const r = routes[routeId];
      switch (r.route_type) {
        case 2: typeKey = "train"; break;
        case 3: typeKey = "bus"; break;
        case 4: typeKey = "ferry"; break;
      }

      // Custom train line colours
      if (typeKey === "train") {
        if (r.route_short_name?.toUpperCase().includes("STH")) color = lineColours.STH;
        else if (r.route_short_name?.toUpperCase().includes("WEST")) color = lineColours.WEST;
        else if (r.route_short_name?.toUpperCase().includes("EAST")) color = lineColours.EAST;
        else if (r.route_short_name?.toUpperCase().includes("ONE")) color = lineColours.ONE;
        else color = defaultColours.train;
      } else {
        color = defaultColours[typeKey] || defaultColours.other;
      }
    }

    // Bus types
    let busType = "";
    if (typeKey === "bus" && busTypes && Object.keys(busTypes).length > 0) {
      for (const model in busTypes) {
        const ops = busTypes[model];
        if (ops[operator]?.includes(vehicleNumber)) {
          busType = model;
          break;
        }
      }
    }

    // Trip headsign caching
    const tripId = v.vehicle?.trip?.trip_id;
    if (tripId) {
      if (trips[tripId] && Date.now() - trips[tripId].lastUpdated < 24 * 60 * 60 * 1000) {
        destination = trips[tripId].trip_headsign || destination;
      } else if (!v.vehicle.trip?.trip_headsign) {
        safeFetch(`${tripsUrl}?ids=${tripId}`).then(tripJson => {
          if (tripJson?.data?.length > 0) {
            const headsign = tripJson.data[0].attributes.trip_headsign;
            trips[tripId] = { trip_headsign: headsign, lastUpdated: Date.now() };
            localStorage.setItem("tripCache", JSON.stringify(trips));

            if (vehicleMarkers[vehicleId]) {
              const oldPopup = vehicleMarkers[vehicleId].getPopup()?.getContent() || "";
              const updatedPopup = oldPopup.replace(/<b>Destination:<\/b>.*?<br>/,
                `<b>Destination:</b> ${headsign}<br>`);
              vehicleMarkers[vehicleId].getPopup().setContent(updatedPopup);
            }
          }
        }).catch(err => console.error("Trip fetch failed:", err));
      }
    }

    // --- Popup ---
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
