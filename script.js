// v4.1 - GitHub Pages compatible, uses serverless proxy, map type selector, train stations with departures, 6-car detection
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const stopsUrl    = `${proxyBaseUrl}/api/stops`;
const stopTimesUrl= `${proxyBaseUrl}/api/stoptimes`;

// --- Map setup ---
const map = L.map("map", { zoomControl:true }).setView([-36.8485,174.7633],13);

// --- Base maps ---
const baseLayers = {
  "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:'&copy; OpenStreetMap &copy; CARTO', subdomains:'abcd', maxZoom:19
  }).addTo(map),
  "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:'&copy; OpenStreetMap &copy; CARTO', subdomains:'abcd', maxZoom:19
  }),
  "OSM": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:"&copy; OpenStreetMap contributors"
  }),
  "Satellite": L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom:20, subdomains:['mt0','mt1','mt2','mt3'], attribution:'&copy; Google'
  })
};
L.control.layers(baseLayers).addTo(map);

// --- Global data ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};
const stationMarkers = {};
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Layer toggles ---
["bus","train","ferry","other"].forEach(type=>{
  document.getElementById(`${type}-checkbox`).addEventListener("change",e=>{
    toggleLayer(type,e.target.checked);
  });
});
function toggleLayer(type, visible){ if(visible) map.addLayer(layerGroups[type]); else map.removeLayer(layerGroups[type]); }

// --- Vehicle styles ---
const vehicleColors = {3:"#007bff",2:"#dc3545",4:"#ffc107",default:"#6c757d"};
const occupancyLabels = {0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers"};
const getVehicleIcon = color=>L.divIcon({className:'vehicle-icon',html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,iconSize:[16,16],iconAnchor:[8,8]});

// --- Fetch helper ---
async function safeFetch(url){
  try{
    const res = await fetch(url,{cache:"no-store"});
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    console.error(err);
    debugBox.textContent = "Unable to fetch API data";
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

// --- Haversine distance ---
function getDistanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = x=>x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

// --- Detect 6-car trains ---
function detectSixCarTrains(vehicleList){
  const sixCarPairs = new Set();
  const trains = vehicleList.filter(v=>v.vehicle?.trip?.route_id && v.vehicle.vehicle?.vehicle_type===2);
  for(let i=0;i<trains.length;i++){
    const trainA=trains[i]; if(trainA.vehicle?.occupancy_status===6) continue;
    for(let j=i+1;j<trains.length;j++){
      const trainB=trains[j]; if(trainB.vehicle?.occupancy_status!==6) continue;
      const lat1=trainA.vehicle.position.latitude, lon1=trainA.vehicle.position.longitude;
      const lat2=trainB.vehicle.position.latitude, lon2=trainB.vehicle.position.longitude;
      const dist=getDistanceMeters(lat1,lon1,lat2,lon2);
      if(dist<=120){
        const speedA=trainA.vehicle.position.speed||0;
        const speedB=trainB.vehicle.position.speed||0;
        if(Math.abs(speedA-speedB)<1) { sixCarPairs.add(trainA.vehicle.vehicle.id); sixCarPairs.add(trainB.vehicle.vehicle.id); }
      }
    }
  }
  return sixCarPairs;
}

// --- Fetch stop departures ---
async function fetchStopDepartures(stopId){
  const dateStr=new Date().toISOString().split("T")[0];
  const json = await safeFetch(`${stopTimesUrl}?filter[date]=${dateStr}&filter[start_hour]=${new Date().getHours()}&filter[hour_range]=2&stop_id=${stopId}`);
  if(!json || !json.data) return [];
  return json.data.slice(0,4).map(d=>({
    time: d.attributes.departure_time,
    tripHeadsign: d.attributes.trip_headsign,
    platform: d.attributes.platform,
    vehicleId: d.attributes.vehicle_id
  }));
}

// --- Update station popup ---
async function updateStationPopup(marker, stopId){
  const departures = await fetchStopDepartures(stopId);
  const vehicles = Object.values(vehicleMarkers).map(m=>m.options.vehicleData).filter(v=>v.vehicle?.trip?.route_id);
  const sixCarTrains = detectSixCarTrains(vehicles);
  const updated = departures.map(dep=>{
    const sizeLabel = sixCarTrains.has(dep.vehicleId) ? "6-car" : "3-car";
    return `${dep.time} - ${dep.tripHeadsign} (Platform ${dep.platform}) - ${sizeLabel}`;
  });
  marker.setPopupContent(`<b>${marker.options.stopName}</b><br>${updated.join("<br>")}`);
}

// --- Fetch vehicles ---
async function fetchVehicles(){
  const json = await safeFetch(realtimeUrl);
  if(!json) return;
  const vehicles = json?.response?.entity || json?.entity || [];
  const newVehicleIds = new Set();
  const dataPromises = vehicles.map(v=>{
    const vehicleId=v.vehicle?.vehicle?.id;
    const routeId=v.vehicle?.trip?.route_id;
    const tripId=v.vehicle?.trip?.trip_id;
    return Promise.all([routeId?fetchRouteById(routeId):null, tripId?fetchTripById(tripId):null, v, vehicleId]);
  });
  const results = await Promise.all(dataPromises);

  results.forEach(result=>{
    const [routeInfo, tripInfo, v, vehicleId]=result;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat=v.vehicle.position.latitude;
    const lon=v.vehicle.position.longitude;
    const vehicleLabel=v.vehicle.vehicle?.label||"N/A";
    const licensePlate=v.vehicle.vehicle?.license_plate||"N/A";
    const occupancyStatus=v.vehicle.occupancy_status;

    let typeKey="other"; let color=vehicleColors.default;
    let routeName="N/A"; let destination=tripInfo?.trip_headsign||v.vehicle.trip?.trip_headsign||"N/A";
    let speed="N/A";
    const occupancy=occupancyStatus!==undefined?occupancyLabels[occupancyStatus]||"Unknown":"N/A";

    if(routeInfo){
      const routeType=routeInfo.route_type;
      switch(routeType){ case 3:typeKey="bus";color=vehicleColors[3];break; case 2:typeKey="train";color=vehicleColors[2];break; case 4:typeKey="ferry";color=vehicleColors[4];break; }
      routeName=routeInfo.route_short_name||"N/A";
    }

    let speedKmh=v.vehicle.position.speed?v.vehicle.position.speed*3.6:null;
    if(speedKmh!==null){
      let maxSpeed=typeKey==="bus"?100:typeKey==="train"?120:typeKey==="ferry"?60:160;
      if(speedKmh>=0 && speedKmh<=maxSpeed) speed=speedKmh.toFixed(1)+" km/h";
    }

    const operator=v.vehicle.vehicle?.operator_id||"";
    const vehicleLabelWithOperator=operator+vehicleLabel;

    const popupContent=`<b>Route:</b> ${routeName}<br><b>Destination:</b> ${destination}<br><b>Vehicle:</b> ${vehicleLabelWithOperator}<br><b>Number Plate:</b> ${licensePlate}<br><b>Speed:</b> ${speed}<br><b>Occupancy:</b> ${occupancy}`;

    if(vehicleMarkers[vehicleId]){
      vehicleMarkers[vehicleId].setLatLng([lat,lon]);
      vehicleMarkers[vehicleId].setPopupContent(popupContent);
      vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
      vehicleMarkers[vehicleId].options.vehicleData=v;
    } else {
      const newMarker=L.marker([lat,lon],{icon:getVehicleIcon(color),vehicleData:v});
      newMarker.bindPopup(popupContent);
      newMarker.addTo(layerGroups[typeKey]);
      vehicleMarkers[vehicleId]=newMarker;
    }
  });

  Object.keys(vehicleMarkers).forEach(id=>{
    if(!newVehicleIds.has(id)){ map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; }
  });

  debugBox.textContent=`Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
}

// --- Add train stations ---
async function addTrainStations(){
  const json=await safeFetch(`${stopsUrl}?type=train`);
  if(!json?.data) return;
  json.data.forEach(stop=>{
    const lat=stop.attributes.latitude;
    const lon=stop.attributes.longitude;
    const name=stop.attributes.stop_name;
    const stopId=stop.id;
    const marker=L.marker([lat,lon],{stopName:name});
    marker.addTo(map);
    marker.on("click",()=>updateStationPopup(marker, stopId));
    stationMarkers[stopId]=marker;
  });
}

// --- Init ---
(async function init(){
  await addTrainStations();
  await fetchVehicles();
  setInterval(fetchVehicles,15000);
})();
