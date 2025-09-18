// ================== v4.8.2 - Real-time Vehicle Tracking (Headsign + Viewport Fix + Bus Types) ==================

// --- API endpoints --- 
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "busTypes.json"; // JSON file hosted on GitHub Pages

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);

// Base maps
const osm       = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" });
const light     = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }).addTo(map); 
const dark      = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains: ["mt0","mt1","mt2","mt3"], attribution: "© Google" });

L.control.layers({ "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite }).addTo(map);

// --- Globals ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {}; // cache of trip info
const vehicleMarkers = {};
let busTypes = {}; // loaded from JSON

// --- Layer groups ---
const layerGroups = {
  bus:   L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

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

// --- Safe fetch with retry ---
async function safeFetch(url, retries=3, delay=2000){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err) {
    if(retries > 0){
      console.warn(`Fetch failed for ${url}. Retrying in ${delay}ms...`, err);
      await new Promise(r=>setTimeout(r, delay));
      return safeFetch(url, retries-1, delay*2);
    }
    console.error(err);
    return null;
  }
}

// --- Load initial data ---
async function loadBusTypes(){
  const data = await safeFetch(busTypesUrl);
  if(data) busTypes = data;
}

async function loadAllRoutes() {
  const json = await safeFetch(routesUrl);
  if (json?.data) {
    json.data.forEach(route => {
      routes[route.id || route.route_id] = route.attributes || route;
    });
    console.log(`Successfully loaded ${Object.keys(routes).length} routes.`);
  } else {
    console.error("Could not load route data.");
  }
}

// --- Route/Trip caching ---
function getRouteById(routeId){
  return routes[routeId] || null;
}

async function fetchTripById(tripId){
  if(trips[tripId]) return trips[tripId];
  const json = await safeFetch(`${tripsUrl}?id=${tripId}`);
  const tripData = json?.data?.[0]?.attributes || json?.data?.attributes;
  if(tripData) {
    trips[tripId] = tripData;
    return tripData;
  }
  return null;
}

// --- Distance helper ---
function distanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = deg => deg*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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

// --- Add/update vehicle marker ---
function addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey, inBounds){
  if(vehicleMarkers[vehicleId]){
    const marker = vehicleMarkers[vehicleId];
    marker.setLatLng([lat, lon]);
    marker.setPopupContent(popupContent);
    marker.setIcon(getVehicleIcon(color));

    if(inBounds) {
      if(!map.hasLayer(marker)) marker.addTo(layerGroups[typeKey]);
    } else {
      if(map.hasLayer(marker)) map.removeLayer(marker);
    }
  } else {
    const marker = L.marker([lat, lon], {icon: getVehicleIcon(color)});
    marker.bindPopup(popupContent);
    if(inBounds) marker.addTo(layerGroups[typeKey]);
    vehicleMarkers[vehicleId] = marker;
  }
}

// --- Fetch vehicles (always fetch all, filter in display) ---
async function fetchVehicles(){
  const json = await safeFetch(realtimeUrl);
  if(!json){
    debugBox.textContent = "Realtime data unavailable";
    return;
  }

  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const inServiceAM = [];
  const outOfServiceAM = [];

  const bounds = map.getBounds();

  await Promise.all(vehicles.map(async v => {
    const vehicleId = v.vehicle?.vehicle?.id;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    const inBounds = bounds.contains([lat, lon]);

    newVehicleIds.add(vehicleId);

    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleNumber = Number(vehicleLabel.replace(operator,"")) || 0;
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : 0;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = "N/A";
    let destination = "N/A";
    const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus]||"Unknown" : "N/A";

    const routeId = v.vehicle?.trip?.route_id;
    const tripId = v.vehicle?.trip?.trip_id;
    let busType = "";

    if(routeId){
      const routeInfo = getRouteById(routeId);
      if(routeInfo){
        switch(routeInfo.route_type){
          case 3: typeKey="bus"; color=vehicleColors[3]; break;
          case 2: typeKey="train"; color=vehicleColors[2]; break;
          case 4: typeKey="ferry"; color=vehicleColors[4]; break;
        }
        routeName = routeInfo.route_short_name || "N/A";
      }
    } else if(vehicleLabel.startsWith("AM")){
      typeKey = "bus";
    }

    // Determine headsign
    if(v.vehicle.trip?.trip_headsign) {
      destination = v.vehicle.trip.trip_headsign;
    } else if(tripId) {
      if(trips[tripId]) {
        destination = trips[tripId].trip_headsign || "N/A";
      } else {
        fetchTripById(tripId).then(tripData => {
          if(tripData) {
            trips[tripId] = tripData;
            const marker = vehicleMarkers[vehicleId];
            if(marker) {
              const oldContent = marker.getPopup().getContent();
              marker.setPopupContent(oldContent.replace(
                /(<b>Destination:<\/b>\s*)(N\/A)/,
                `$1${tripData.trip_headsign || "N/A"}`
              ));
            }
          }
        });
      }
    }

    // --- Check bus type from external JSON ---
    if(typeKey==="bus"){
      for(const model in busTypes){
        const operators = busTypes[model];
        if(operators[operator]?.includes(vehicleNumber)){
          busType = model;
          break;
        }
      }
    }

    const maxSpeed = typeKey==="bus"?100:typeKey==="train"?160:typeKey==="ferry"?80:180;
    let speed = speedKmh>=0 && speedKmh<=maxSpeed ? speedKmh.toFixed(1)+" km/h" : "N/A";

    const popupContent = `
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${operator+vehicleLabel}<br>
      ${busType?`<b>Bus Type:</b> ${busType}<br>`:""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speed}<br>
      <b>Occupancy:</b> ${occupancy}
    `;

    if(vehicleLabel.startsWith("AM")){
      if(typeKey==="train") inServiceAM.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
      else outOfServiceAM.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
    }

    addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey, inBounds);
  }));

  // Pair AM trains
  const pairs = pairAMTrains(inServiceAM, outOfServiceAM);
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

  debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newVehicleIds.size}`;
}

// --- Init ---
(function init(){
  loadBusTypes();
  loadAllRoutes();

  // Start vehicle loop
  fetchVehicles();
  setInterval(fetchVehicles, 15000);

  // Refresh on map move
  map.on("moveend", fetchVehicles);
})();
