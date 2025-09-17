// v5 - Real-time vehicle tracking with loading and retry
const proxyUrl = "/api/realtime"; // your serverless proxy
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
const vehicleMarkers = {};
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
    checkbox.addEventListener("change", e=>{
      if(e.target.checked) map.addLayer(layerGroups[type]);
      else map.removeLayer(layerGroups[type]);
    });
  }
});

// --- Vehicle styles ---
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = { 0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers" };
const getVehicleIcon = color => L.divIcon({
  className:'vehicle-icon',
  html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
  iconSize:[16,16],
  iconAnchor:[8,8]
});

// --- Fetch helper ---
async function safeFetch(url){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    console.error(err);
    debugBox.textContent = "Waiting for data...";
    return null;
  }
}

// --- Vehicle tracking ---
async function fetchVehicles(){
  const json = await safeFetch(proxyUrl);
  if(!json) return setTimeout(fetchVehicles, 3000); // retry after 3s

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

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = v.vehicle.trip?.route_id || "N/A";
    let destination = v.vehicle.trip?.trip_headsign || "N/A";
    let speed = "N/A";
    const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus]||"Unknown" : "N/A";

    // Determine type color
    const routeType = v.vehicle.vehicle?.vehicle_type;
    switch(routeType){
      case 3:typeKey="bus";color=vehicleColors[3];break;
      case 2:typeKey="train";color=vehicleColors[2];break;
      case 4:typeKey="ferry";color=vehicleColors[4];break;
    }

    // Speed sanity
    let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : null;
    if(speedKmh!==null){
      let maxSpeed = typeKey==="bus"?100:typeKey==="train"?125:typeKey==="ferry"?60:160;
      if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";
    }

    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleLabelWithOperator = operator+vehicleLabel;

    const popupContent = `
<b>Route:</b> ${routeName}<br>
<b>Destination:</b> ${destination}<br>
<b>Vehicle:</b> ${vehicleLabelWithOperator}<br>
<b>Number Plate:</b> ${licensePlate}<br>
<b>Speed:</b> ${speed}<br>
<b>Occupancy:</b> ${occupancy}`;

    if(vehicleMarkers[vehicleId]){
      vehicleMarkers[vehicleId].setLatLng([lat,lon]);
      vehicleMarkers[vehicleId].setPopupContent(popupContent);
      vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
    } else {
      const marker = L.marker([lat,lon], {icon:getVehicleIcon(color)});
      marker.bindPopup(popupContent);
      marker.addTo(layerGroups[typeKey]);
      vehicleMarkers[vehicleId] = marker;
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
  setTimeout(fetchVehicles, 15000); // refresh every 15s
}

// --- Init ---
debugBox.textContent = "Loading vehicle data...";
fetchVehicles();
