// v4 - Real-time vehicle tracking
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;

// --- Map setup ---
const map = L.map("map", { zoomControl: true }).setView([-36.8485, 174.7633], 13);

// --- Base maps ---
const baseLayers = {
  "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(map),
  "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
  }),
  "OSM": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }),
  "Satellite": L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'], attribution: '&copy; Google'
  })
};
L.control.layers(baseLayers).addTo(map);

// --- Global data ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};

// --- Layer groups ---
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Layer toggles ---
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
  iconSize:[16,16], iconAnchor:[8,8]
});

// --- Safe fetch ---
async function safeFetch(url){
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    console.error(err);
    debugBox.textContent = `Error fetching data from API`;
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
  if(!json) return;
  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();

  const dataPromises = vehicles.map(v=>{
    const vehicleId = v.vehicle?.vehicle?.id;
    const routeId = v.vehicle?.trip?.route_id;
    const tripId  = v.vehicle?.trip?.trip_id;
    return Promise.all([ routeId?fetchRouteById(routeId):null, tripId?fetchTripById(tripId):null, v, vehicleId ]);
  });

  const results = await Promise.all(dataPromises);

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
      switch(routeType){
        case 3:typeKey="bus";color=vehicleColors[3];break;
        case 2:typeKey="train";color=vehicleColors[2];break;
        case 4:typeKey="ferry";color=vehicleColors[4];break;
      }
      routeName = routeInfo.route_short_name || "N/A";
    }

    let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : null;
    if(speedKmh!==null){
      let maxSpeed = typeKey==="bus"?100:typeKey==="train"?120:typeKey==="ferry"?60:160;
      if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";
    }

    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleLabelWithOperator = operator+vehicleLabel;

    const popupContent = `\
<b>Route:</b> ${routeName}<br>\
<b>Destination:</b> ${destination}<br>\
<b>Vehicle:</b> ${vehicleLabelWithOperator}<br>\
<b>Number Plate:</b> ${licensePlate}<br>\
<b>Speed:</b> ${speed}<br>\
<b>Occupancy:</b> ${occupancy}`;

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

  // Remove old markers
  Object.keys(vehicleMarkers).forEach(id=>{
    if(!newVehicleIds.has(id)){
      map.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  });

  debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
}

// --- Init ---
(async function init(){
  fetchVehicles();
  setInterval(fetchVehicles, 15000);
})();
