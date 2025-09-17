// ================== v4.6 - Real-time Vehicle Tracking (Paired AM Trains) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);

// Base maps
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" });
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains: ["mt0","mt1","mt2","mt3"], attribution: "© Google" });

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Globals ---
const debugBox = document.getElementById("debug");
const sixCarBox = document.getElementById("six-car-count"); // separate counter display
const routes = {};
const trips = {};
const vehicleMarkers = {};
let sixCarCount = 0;

// --- Layer groups ---
const layerGroups = { bus: L.layerGroup().addTo(map), train: L.layerGroup().addTo(map), ferry: L.layerGroup().addTo(map), other: L.layerGroup().addTo(map) };

// --- Checkboxes ---
["bus","train","ferry","other"].forEach(type=>{
  const checkbox = document.getElementById(type+"-checkbox");
  if(checkbox) checkbox.addEventListener("change", e=> toggleLayer(type, e.target.checked));
});
function toggleLayer(type, visible){
  if(visible) map.addLayer(layerGroups[type]);
  else map.removeLayer(layerGroups[type]);
}

// --- Vehicle styles ---
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = { 0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers" };
const getVehicleIcon = (color) => L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

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

// --- Fetch vehicles ---
async function fetchVehicles(){
  const json = await safeFetch(realtimeUrl);
  if(!json) { debugBox.textContent="Error fetching vehicle data"; return; }

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  sixCarCount = 0;

  const dataPromises = vehicles.map(v=>{
    const vehicleId = v.vehicle?.vehicle?.id;
    const routeId = v.vehicle?.trip?.route_id;
    const tripId  = v.vehicle?.trip?.trip_id;
    return Promise.all([ routeId ? fetchRouteById(routeId) : null, tripId ? fetchTripById(tripId) : null, v, vehicleId ]);
  });

  const results = await Promise.all(dataPromises);

  const inServiceAMTrains = [];
  const outOfServiceAMTrains = [];

  // First pass: classify AM trains
  results.forEach(result=>{
    const [routeInfo, tripInfo, v, vehicleId] = result;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = "N/A";
    let destination = tripInfo?.trip_headsign || v.vehicle.trip?.trip_headsign || "N/A";
    let speed = "N/A";
    const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

    if(routeInfo){
      const routeType = routeInfo.route_type;
      switch(routeType){ case 3:typeKey="bus";color=vehicleColors[3];break; case 2:typeKey="train";color=vehicleColors[2];break; case 4:typeKey="ferry";color=vehicleColors[4];break;}
      routeName = routeInfo.route_short_name || "N/A";
    }

    // Speed sanity with larger tolerance
    let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : null;
    if(speedKmh!==null){
      let maxSpeed = typeKey==="bus"?120:typeKey==="train"?150:typeKey==="ferry"?80:200;
      if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";
    }

    // Track AM trains for pairing
    if(vehicleLabel.includes("AM")){
      if(typeKey==="train") inServiceAMTrains.push({vehicleId, vehicleLabel});
      else outOfServiceAMTrains.push({vehicleId, vehicleLabel});
    }

    // Render marker without 6-car indicator
    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleLabelWithOperator = operator+vehicleLabel;
    const popupContent = `<b>Route:</b> ${routeName}<br><b>Destination:</b> ${destination}<br><b>Vehicle:</b> ${vehicleLabelWithOperator}<br><b>Number Plate:</b> ${licensePlate}<br><b>Speed:</b> ${speed}<br><b>Occupancy:</b> ${occupancy}`;

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

 // Pair AM trains: add "Paired to AMXXX" to in-service popups
const pairedCount = Math.min(inServiceAMTrains.length, outOfServiceAMTrains.length);
sixCarCount = pairedCount;
for(let i=0;i<pairedCount;i++){
  const inTrain = inServiceAMTrains[i];
  const outTrain = outOfServiceAMTrains[i];
  const marker = vehicleMarkers[inTrain.vehicleId];
  if(marker){
    const oldContent = marker.getPopup().getContent();
    marker.setPopupContent(oldContent + `<br><b>Paired to:</b> ${outTrain.vehicleLabel}`);
  }
}


  // Remove old markers
  Object.keys(vehicleMarkers).forEach(id=>{
    if(!newVehicleIds.has(id)){
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  // Update displays
  debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
  if(sixCarBox) sixCarBox.textContent = `Paired AM trains: ${sixCarCount}`;
}

// --- Init ---
(async function init(){
  fetchVehicles();
  setInterval(fetchVehicles, 15000);
})();
