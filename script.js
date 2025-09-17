// v3.7 - GitHub Pages compatible, ferries integrated
const proxyBaseUrl = "https://atrealtime.vercel.app";  
const corsProxy = "https://api.allorigins.win/raw?url="; // CORS fix

// v3.9 - GitHub Pages compatible, uses serverless proxy
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const stopsUrl    = `${proxyBaseUrl}/api/stops`;

const ferryUrl    = `${corsProxy}${encodeURIComponent("https://api.at.govt.nz/realtime/legacy/ferrypositions")}`;

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// --- Global stores ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};
const ferryMarkers = {};

// Layer groups
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// Checkbox toggles
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(type, visible) {
  if (visible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

// Colors
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };

// Occupancy labels
const occupancyLabels = {
  0: "Empty", 1: "Many Seats Available", 2: "Few Seats Available",
  3: "Standing Room Only", 4: "Crushed Standing Room Only", 5: "Full",
  6: "Not Accepting Passengers"
};

// Vehicle icon
const getVehicleIcon = (color) => L.divIcon({
  className: 'vehicle-icon',
  html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
  iconSize: [16,16],
  iconAnchor: [8,8]
});

// Safe fetch
async function safeFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(err);
    debugBox.textContent = `Error fetching data from API`;
    return null;
  }
}

// Fetch GTFS route/trip
async function fetchRouteById(routeId) {
  if (routes[routeId]) return routes[routeId];
  const json = await safeFetch(`${routesUrl}?id=${routeId}`);
  const routeData = json?.data?.[0]?.attributes || json?.data?.attributes;
  if (routeData) { routes[routeId] = routeData; return routeData; }
  return null;
}

async function fetchTripById(tripId) {
  if (trips[tripId]) return trips[tripId];
  const json = await safeFetch(`${tripsUrl}?id=${tripId}`);
  const tripData = json?.data?.[0]?.attributes || json?.data?.attributes;
  if (tripData) { trips[tripId] = tripData; return tripData; }
  return null;
}

// --- Fetch realtime vehicles ---
async function fetchVehicles() {
  const json = await safeFetch(realtimeUrl);
  if (!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();

  const dataPromises = vehicles.map(v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    const routeId = v.vehicle?.trip?.route_id;
    const tripId = v.vehicle?.trip?.trip_id;

    return Promise.all([
      routeId ? fetchRouteById(routeId) : null,
      tripId ? fetchTripById(tripId) : null,
      v,
      vehicleId
    ]);
  });

  const results = await Promise.all(dataPromises);

  results.forEach(result => {
    const [routeInfo, tripInfo, v, vehicleId] = result;
    if (!v.vehicle || !v.vehicle.position || !vehicleId) return;

    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = "N/A";
    let destination = tripInfo?.trip_headsign || "N/A";
    let speed = "N/A";
    const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

    // Assign type from routeInfo or fallback
    if (routeInfo) {
      const routeType = routeInfo.route_type;
      switch(routeType){
        case 3: typeKey="bus"; color=vehicleColors[3]; break;
        case 2: typeKey="train"; color=vehicleColors[2]; break;
        case 4: typeKey="ferry"; color=vehicleColors[4]; break;
        default: console.warn("Unknown route_type:", routeType, routeInfo.route_short_name);
      }
      routeName = routeInfo.route_short_name || "N/A";
    } else {
      // fallback from label
      const label = vehicleLabel.toLowerCase();
      if(label.includes("train")) { typeKey="train"; color=vehicleColors[2]; }
      else if(label.includes("bus")) { typeKey="bus"; color=vehicleColors[3]; }
      else if(label.includes("ferry")) { typeKey="ferry"; color=vehicleColors[4]; }
    }

    // Speed sanity check
    let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : null;
    if(speedKmh !== null){
      let maxSpeed = 160;
      if(typeKey==="bus") maxSpeed=100;
      else if(typeKey==="train") maxSpeed=120;
      else if(typeKey==="ferry") maxSpeed=60;

      if(speedKmh >=0 && speedKmh <= maxSpeed) speed = speedKmh.toFixed(1) + " km/h";
    }

    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleLabelWithOperator = operator + vehicleLabel;

    const popupContent = `
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabelWithOperator}<br>
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speed}<br>
      <b>Occupancy:</b> ${occupancy}
    `;

    if(vehicleMarkers[vehicleId]){
      vehicleMarkers[vehicleId].setLatLng([lat, lon]);
      vehicleMarkers[vehicleId].setPopupContent(popupContent);
      vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
    } else {
      const newMarker = L.marker([lat, lon], {icon:getVehicleIcon(color)});
      newMarker.bindPopup(popupContent);
      newMarker.addTo(layerGroups[typeKey]);
      vehicleMarkers[vehicleId] = newMarker;
    }
  });

  // Remove old vehicle markers
  Object.keys(vehicleMarkers).forEach(id => {
    if(!newVehicleIds.has(id)){
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });
}

// --- Fetch ferry positions ---
async function fetchFerries() {
  const json = await safeFetch(ferryUrl);
  if(!json || !json.response) return;

  const ferries = json.response;
  const newFerryIds = new Set();

  ferries.forEach(ferry => {
    const id = ferry.mmsi || ferry.callsign;
    if(!id) return;
    newFerryIds.add(id);

    const lat = parseFloat(ferry.lat);
    const lon = parseFloat(ferry.lng);
    if(isNaN(lat) || isNaN(lon)) return;

    const popupContent = `
      <b>Vessel:</b> ${ferry.vessel}<br>
      <b>Operator:</b> ${ferry.operator}<br>
      <b>ETA:</b> ${ferry.eta}<br>
      <b>Callsign:</b> ${ferry.callsign}<br>
      <b>MMSI:</b> ${ferry.mmsi}
    `;

    if(ferryMarkers[id]){
      ferryMarkers[id].setLatLng([lat, lon]);
      ferryMarkers[id].setPopupContent(popupContent);
    } else {
      const marker = L.marker([lat, lon], {icon:getVehicleIcon(vehicleColors[4])});
      marker.bindPopup(popupContent);
      marker.addTo(layerGroups.ferry);
      ferryMarkers[id] = marker;
    }
  });

  // Remove old ferry markers
  Object.keys(ferryMarkers).forEach(id=>{
    if(!newFerryIds.has(id)){
      map.removeLayer(ferryMarkers[id]);
      delete ferryMarkers[id];
    }
  });
}

// --- Init ---
(async function init(){
  await fetchVehicles();
  await fetchFerries();
  setInterval(async ()=>{
    await fetchVehicles();
    await fetchFerries();
    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
  },15000);
})();

