// v4.0 - Preload all routes/trips for better classification
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);

// Base layers
const baseLayers = {
  "Light": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(map),
  "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; Carto" }),
  "Satellite": L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains:['mt0','mt1','mt2','mt3'], attribution:"Google" }),
  "OSM": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" })
};
L.control.layers(baseLayers).addTo(map);

// --- Global data ---
const debugBox = document.getElementById("debug");
const vehicleMarkers = {};
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// Vehicle layer toggles
["bus","train","ferry","other"].forEach(type=>{
  document.getElementById(type+"-checkbox").addEventListener("change", e=> {
    if(e.target.checked) map.addLayer(layerGroups[type]);
    else map.removeLayer(layerGroups[type]);
  });
});

// Vehicle styling
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = {
  0:"Empty",1:"Many Seats Available",2:"Few Seats Available",
  3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers"
};
const getVehicleIcon = color => L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

// --- Safe fetch helper ---
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

// --- Preload all routes/trips ---
let allRoutes = {};
let allTrips = {};

async function preloadRoutesAndTrips(){
  const routeJson = await safeFetch(routesUrl);
  if(routeJson?.data){
    routeJson.data.forEach(r=>{
      const route = r.attributes;
      if(route?.id) allRoutes[route.id] = route;
    });
  }

  const tripJson = await safeFetch(tripsUrl);
  if(tripJson?.data){
    tripJson.data.forEach(t=>{
      const trip = t.attributes;
      if(trip?.trip_id) allTrips[trip.trip_id] = trip;
    });
  }
}

// --- Fetch realtime vehicles ---
async function fetchVehicles(){
  const json = await safeFetch(realtimeUrl);
  if(!json) return;

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();

  vehicles.forEach(v=>{
    const vehicleId = v.vehicle?.vehicle?.id;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;

    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;

    // Route & Trip lookup
    const routeInfo = allRoutes[v.vehicle?.trip?.route_id] || null;
    const tripInfo  = allTrips[v.vehicle?.trip?.trip_id] || null;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = routeInfo?.route_short_name || "N/A";
    let destination = tripInfo?.trip_headsign || routeInfo?.route_long_name || "N/A";
    let speed = "N/A";
    const occupancy = occupancyStatus!==undefined?occupancyLabels[occupancyStatus]||"Unknown":"N/A";

    if(routeInfo){
      switch(routeInfo.route_type){
        case 3: typeKey="bus"; color=vehicleColors[3]; break;
        case 2: typeKey="train"; color=vehicleColors[2]; break;
        case 4: typeKey="ferry"; color=vehicleColors[4]; break;
      }
    }

    // Speed sanity
    let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : null;
    if(speedKmh!==null){
      let maxSpeed = typeKey==="bus"?100:typeKey==="train"?120:typeKey==="ferry"?60:160;
      if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";
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
  await preloadRoutesAndTrips();
  fetchVehicles();
  setInterval(fetchVehicles,15000);
})();
