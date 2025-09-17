// ================== v4.7 - Real-time Vehicle Tracking with Bus Type JSON ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const busTypesJsonUrl = "./bus_types.json"; // JSON file in same folder

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);

// Base maps
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  attribution: "© OpenStreetMap contributors © CARTO"
}).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  attribution: "© OpenStreetMap contributors © CARTO"
});
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
  subdomains: ["mt0","mt1","mt2","mt3"],
  attribution: "© Google"
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Globals ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};
let busTypes = {}; // Will hold JSON data

// --- Layer groups ---
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Checkboxes ---
["bus","train","ferry","other"].forEach(type=>{
  const checkbox = document.getElementById(type+"-checkbox");
  if(checkbox){
    checkbox.addEventListener("change", e=>toggleLayer(type, e.target.checked));
  }
});
function toggleLayer(type, visible){
  if(visible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

// --- Vehicle styles ---
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = {
  0:"Empty",1:"Many Seats Available",2:"Few Seats Available",
  3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers"
};
const getVehicleIcon = color => L.divIcon({
  className:'vehicle-icon',
  html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
  iconSize:[16,16],
  iconAnchor:[8,8]
});

// --- Safe fetch ---
async function safeFetch(url){
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    console.error(err);
    return null;
  }
}

// --- Route/Trip caching ---
async function fetchRouteById(routeId){
  if(routes[routeId]) return routes[routeId];
  const json = await safeFetch(`${routesUrl}?id=${routeId}`);
  const routeData = json?.data?.[0]?.attributes || json?.data?.attributes;
  if(routeData){ routes[routeId]=routeData; return routeData; }
  return null;
}
async function fetchTripById(tripId){
  if(trips[tripId]) return trips[tripId];
  const json = await safeFetch(`${tripsUrl}?id=${tripId}`);
  const tripData = json?.data?.[0]?.attributes || json?.data?.attributes;
  if(tripData){ trips[tripId]=tripData; return tripData; }
  return null;
}

// --- Distance helper ---
function distanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = deg => deg*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// --- Pair AM trains ---
function pairAMTrains(inService, outOfService){
  const pairs = [];
  const usedOut = new Set();
  inService.forEach(inTrain=>{
    let bestMatch = null;
    let minDist = 200;
    outOfService.forEach(outTrain=>{
      if(usedOut.has(outTrain.vehicleId)) return;
      const dist = distanceMeters(inTrain.lat, inTrain.lon, outTrain.lat, outTrain.lon);
      const speedDiff = Math.abs(inTrain.speedKmh - outTrain.speedKmh);
      if(dist <= 200 && speedDiff <= 10){
        if(dist < minDist){
          minDist = dist;
          bestMatch = outTrain;
        }
      }
    });
    if(bestMatch){
      pairs.push({inTrain, outTrain: bestMatch});
      usedOut.add(bestMatch.vehicleId);
    }
  });
  return pairs;
}

// --- Load bus types JSON ---
async function loadBusTypes(){
  const json = await safeFetch(busTypesJsonUrl);
  if(json) busTypes = json;
}

// --- Determine bus type ---
function getBusType(vehicleLabel){
  for(const type in busTypes){
    if(busTypes[type].bus_numbers.includes(vehicleLabel)) return type;
  }
  return "Bus"; // default generic
}

// --- Fetch vehicles ---
async function fetchVehicles(){
  const json = await safeFetch(realtimeUrl);
  if(!json) {
    debugBox.textContent = "Error fetching vehicle data";
    return;
  }

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();

  const dataPromises = vehicles.map(v=>{
    const vehicleId = v.vehicle?.vehicle?.id;
    const routeId = v.vehicle?.trip?.route_id;
    const tripId  = v.vehicle?.trip?.trip_id;
    return Promise.all([routeId ? fetchRouteById(routeId) : null, tripId ? fetchTripById(tripId) : null, v, vehicleId]);
  });

  const results = await Promise.all(dataPromises);

  // Collect AM trains
  const inServiceAMTrains = [];
  const outOfServiceAMTrains = [];

  results.forEach(result=>{
    const [routeInfo, tripInfo, v, vehicleId] = result;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : 0;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = "N/A";
    let destination = tripInfo?.trip_headsign || v.vehicle.trip?.trip_headsign || "N/A";
    const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

    if(routeInfo){
      const routeType = routeInfo.route_type;
      switch(routeType){
        case 3: typeKey="bus"; color=vehicleColors[3]; break;
        case 2: typeKey="train"; color=vehicleColors[2]; break;
        case 4: typeKey="ferry"; color=vehicleColors[4]; break;
      }
      routeName = routeInfo.route_short_name || "N/A";
    }

    // Determine bus type from JSON
    let busType = typeKey === "bus" ? getBusType(vehicleLabel) : null;

    if(vehicleLabel.startsWith("AM")){
      if(typeKey==="train") inServiceAMTrains.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
      else outOfServiceAMTrains.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
    }

    let speed = "N/A";
    let maxSpeed = typeKey==="bus"?100:typeKey==="train"?160:typeKey==="ferry"?80:180;
    if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";

    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleLabelWithOperator = operator+vehicleLabel;

    const popupContent = `
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabelWithOperator}<br>
      <b>Type:</b> ${busType || typeKey}<br>
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speed}<br>
      <b>Occupancy:</b> ${occupancy}
    `;

    if(vehicleMarkers[vehicleId]){
      vehicleMarkers[vehicleId].setLatLng([lat,lon]);
      vehicleMarkers[vehicleId].setPopupContent(popupContent);
      vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
    } else {
      const newMarker = L.marker([lat,lon],{icon:getVehicleIcon(color)});
      newMarker.bindPopup(popupContent);
      newMarker.addTo(layerGroups[typeKey]);
      vehicleMarkers[vehicleId]=newMarker;
    }
  });

  // Pair AM trains
  const pairs = pairAMTrains(inServiceAMTrains, outOfServiceAMTrains);
  pairs.forEach(pair=>{
    const marker = vehicleMarkers[pair.inTrain.vehicleId];
    if(marker){
      const oldContent = marker.getPopup().getContent();
      marker.setPopupContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
    }
  });

  // Remove old markers
  Object.keys(vehicleMarkers).forEach(id=>{
    if(!newVehicleIds.has(id)){
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  // Update debug
  debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
}

// --- Init ---
(async function init(){
  await loadBusTypes(); // load JSON first
  fetchVehicles();
  setInterval(fetchVehicles, 15000);
})();
