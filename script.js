// v4.3 - Real-time map with train stations, departures, and 6-car train detection
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const stopsUrl    = `${proxyBaseUrl}/api/stops`;
const stopTimesUrl= `${proxyBaseUrl}/api/stopTimes`;

// --- Map setup ---
const map = L.map("map", { zoomControl:true }).setView([-36.8485,174.7633],13);

// --- Base maps ---
const baseLayers = {
  "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution:'&copy; OpenStreetMap &copy; CARTO', subdomains:'abcd', maxZoom:19 }).addTo(map),
  "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution:'&copy; OpenStreetMap &copy; CARTO', subdomains:'abcd', maxZoom:19 }),
  "OSM": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution:"&copy; OpenStreetMap contributors" }),
  "Satellite": L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { maxZoom:20, subdomains:['mt0','mt1','mt2','mt3'], attribution:'&copy; Google' })
};
L.control.layers(baseLayers).addTo(map);

// --- Global data ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};
const trainStationMarkers = {};
const sixCarPairs = new Set();

// --- Layer groups ---
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map),
  stations: L.layerGroup().addTo(map)
};

// --- Layer toggles ---
["bus","train","ferry","other","stations"].forEach(type=>{
  const checkbox = document.getElementById(type+"-checkbox");
  if(checkbox) checkbox.addEventListener("change", e=>toggleLayer(type, e.target.checked));
});
function toggleLayer(type, visible){ if(visible) map.addLayer(layerGroups[type]); else map.removeLayer(layerGroups[type]); }

// --- Vehicle styles ---
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = {0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers"};
const getVehicleIcon = color => L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

// --- Safe fetch ---
async function safeFetch(url){
  try{
    const res = await fetch(url,{cache:"no-store"});
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    console.error(err);
    debugBox.textContent = `Unable to fetch API data`;
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
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

// --- 6-car detection ---
function detectSixCarTrains(vehicleList){
  const trains = vehicleList.filter(v => v.vehicle.vehicle?.vehicle_type === 2);
  for(let i=0;i<trains.length;i++){
    const trainA=trains[i];
    for(let j=0;j<trains.length;j++){
      if(i===j) continue;
      const trainB=trains[j];
      const lat1=trainA.vehicle.position.latitude, lon1=trainA.vehicle.position.longitude;
      const lat2=trainB.vehicle.position.latitude, lon2=trainB.vehicle.position.longitude;
      const dist=getDistanceMeters(lat1,lon1,lat2,lon2);

      // Keep previous 6-car until >200m
      if(sixCarPairs.has(trainA.vehicle.vehicle.id) || sixCarPairs.has(trainB.vehicle.vehicle.id)){
        if(dist<=200) { sixCarPairs.add(trainA.vehicle.vehicle.id); sixCarPairs.add(trainB.vehicle.vehicle.id); }
        else { sixCarPairs.delete(trainA.vehicle.vehicle.id); sixCarPairs.delete(trainB.vehicle.vehicle.id); }
        continue;
      }

      // New detection: in-service + AM train, <=125m, speed diff <=2 m/s
      const speedA = trainA.vehicle.position.speed||0;
      const speedB = trainB.vehicle.position.speed||0;
      if(dist<=125 && Math.abs(speedA-speedB)<=2){
        sixCarPairs.add(trainA.vehicle.vehicle.id);
        sixCarPairs.add(trainB.vehicle.vehicle.id);
      }
    }
  }
  updateSixCarOverlay();
  return sixCarPairs;
}

// --- Overlay for 6-car trains ---
const sixCarDiv = L.control({position:'topright'});
sixCarDiv.onAdd = function(){
  const div = L.DomUtil.create('div','six-car-overlay');
  div.style.backgroundColor='white'; div.style.padding='5px'; div.style.border='1px solid #333'; div.style.fontSize='12px'; div.style.maxHeight='150px'; div.style.overflowY='auto';
  div.innerHTML='6-car trains: 0';
  return div;
};
sixCarDiv.addTo(map);
function updateSixCarOverlay(){
  const vehicles = Array.from(sixCarPairs);
  sixCarDiv.getContainer().innerHTML=`<b>6-car trains:</b> ${vehicles.length}<br>${vehicles.join(", ")}`;
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
    return Promise.all([ routeId?fetchRouteById(routeId):null, tripId?fetchTripById(tripId):null, v, vehicleId ]);
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
    let typeKey="other"; let color=vehicleColors.default; let routeName="N/A";
    let destination=tripInfo?.trip_headsign || v.vehicle.trip?.trip_headsign || "N/A";
    let speed="N/A";
    const occupancy=occupancyStatus!==undefined?occupancyLabels[occupancyStatus]||"Unknown":"N/A";

    if(routeInfo){
      const routeType=routeInfo.route_type;
      switch(routeType){ case 3:typeKey="bus";color=vehicleColors[3];break; case 2:typeKey="train";color=vehicleColors[2];break; case 4:typeKey="ferry";color=vehicleColors[4];break; }
      routeName = routeInfo.route_short_name||"N/A";
    }

    let speedKmh = v.vehicle.position.speed?v.vehicle.position.speed*3.6:null;
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

  // Update 6-car overlay
  const allTrainVehicles = Object.values(vehicleMarkers).map(m=>m.options.vehicleData).filter(v=>v.vehicle.vehicle?.vehicle_type===2);
  detectSixCarTrains(allTrainVehicles);

  debugBox.textContent=`Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
}

// --- Train stations ---
async function fetchTrainStations(){
  const json = await safeFetch(`${stopsUrl}?filter[route_type]=2`);
  if(!json?.data) return;
  json.data.forEach(stop=>{
    const lat=stop.attributes.latitude, lon=stop.attributes.longitude, name=stop.attributes.stop_name, stopId=stop.id;
    const marker = L.marker([lat,lon], {icon: L.divIcon({className:'station-icon', html:`<div style="background-color:#28a745;width:10px;height:10px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8]}), stopName:name});
    marker.bindPopup(`<b>${name}</b><br>Loading departures...`);
    marker.on("click", async ()=> {
      const departures = await fetchStopDepartures(stopId);
      const html = `<b>${name}</b><br>${departures}`;
      marker.setPopupContent(html).openPopup();
    });
    marker.addTo(layerGroups.stations);
    trainStationMarkers[stopId] = marker;
  });
}

// --- Fetch next departures ---
async function fetchStopDepartures(stopId){
  const today = new Date().toISOString().split('T')[0];
  const nowHour = new Date().getHours();
  const url = `${stopsUrl}/${stopId}/stoptrips?filter[date]=${today}&filter[start_hour]=${nowHour}&filter[hour_range]=2`;
  const json = await safeFetch(url);
  if(!json?.data) return "No upcoming departures";

  const departures = json.data.slice(0,4).map(d=>{
    const tripHeadsign=d.attributes.trip_headsign||"N/A";
    const platform=d.attributes.platform_code||"N/A";
    const time=d.attributes.arrival_time||d.attributes.departure_time||"N/A";
    return `${time} - ${tripHeadsign} (Platform ${platform})`;
  }).join("<br>");
  return departures || "No upcoming departures";
}

// --- Init ---
(async function init(){
  await fetchTrainStations();
  await fetchVehicles();
  setInterval(fetchVehicles,15000);
})();
