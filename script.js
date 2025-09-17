// ================== v4.6 - Real-time Vehicle Tracking (AM Pairing only) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);

// Base maps
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  attribution: "© OpenStreetMap contributors © CARTO"
}).addTo(map); // Default
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  attribution: "© OpenStreetMap contributors © CARTO"
});
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
  subdomains: ["mt0", "mt1", "mt2", "mt3"],
  attribution: "© Google"
});

const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite };
L.control.layers(baseMaps).addTo(map);

// --- Globals ---
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

// --- Bus type lookup ---
// Alexander Dennis Enviro200 buses
const enviro200Buses = [
  "G2031","G2032","G2033","G2034","G2035","G2057","G2058","G2059",
  "G4134","G4137","G4138","G4139","G4146","G4181","G4184","G4185",
  "G4186","N4001","N4002","N4004","N4005","N4006","N4007","N4008",
  "N4009","N4011","N4015","N4016","N4017","N4018","N4019","N4020",
  "N4021","N4022","N4023","N4024","N4025","N4026","N4027","N4028",
  "N4029","N4030","N4031","N4032","N4033","N4034","N4035","N4036",
  "N4037","N4038","N4039","N4040","N4041","N4042","N4043","N4044",
  "N4045","N4046","N4047","N4048","N4049","N4050","N4051","N4052",
  "N4053","N4054","N4055","N4056","N4057","N4058","N4059","N4060",
  "N4061","N4062","N4063","N4064","N4065","N4066","N4067","N4068",
  "N4069","N4070","N4071","N4072","N4073","N4074","N4075","N4076",
  "N4077","N4078","N4080","N4081","N4082","N4083","N4084","N4085",
  "N4086","N4087","N4088","N4089","N4091","N4092","N4113","N4114",
  "N4115","N4116","N4117","N4118","N4119","N4120","N4121","N4122",
  "N4123","N4124","N4125","N4126","N4127","N4128","N4129","N4131",
  "N4132","N4133","N4135","N4136","N4140","N4141","N4142","N4143",
  "N4144","N4145","N4147","N4148","N4149","N4150","N4151","N4152",
  "N4153","N4154","N4155","N4156","N4157","N4158","N4159","N4160",
  "N4161","N4162","N4163","N4164","N4165","N4166","N4167","N4168",
  "N4169","N4170","N4171","N4172","N4173","N4174","N4175","N4176",
  "N4177","N4178","N4179","N4180","N4182","N4183","N4188","N4190",
  "N4191","N4192","N4193","N4194","N4195","N4196","N4197","N4198",
  "N4199","N4200","N4201","N4202","N4203","N4204","N4205","N4206",
  "N4207","N4208","N4209","N4210","N4211","N4212","N4213","N4214",
  "N4215","N4216","N4217","N4218","N4219","N4220","N4221","N4222",
  "N4223","N4224","N4225","N4226","N4227","N4228","N4229","N4230",
  "N4231","N4232","N4233","N4234","N4235","N4236","N4237","N4238",
  "N4239","N4240","N4241","N4242","N4243","N4244","N4245","N4246",
  "N4247","N4248","N4249","N4251","N4252","N4253","N4254","N4255",
  "N4256","N4257","N4258","N4259","N4261","N4262","N4263","N4264",
  "N4265","N4266","N4267","N4268","N4269","N4270","N4271","N4272",
  "N4273","N4274","N4275","N4276","N4277","N4278","N4279","N4280",
  "N4281","N4282","N4283","N4284","N4285","N4286","N4287","N4288",
  "N4289","N4290","N4291","N4292","N4293","N4295","N4296","N4297",
  "N4298","N4299","N4300","N4301","N4302","N4303","N4304","N4305",
  "N4306","N4307","N4308","N4309","N4310","N4311","N4312","N4313",
  "N4314","N4315","N4316","N4317","N4318","N4319","N4320","N4321",
  "N4322","N4323","N4324","N4325","N4326","N4327","N4328","N4329",
  "N4330","N4331","N4332","N4333","N4334","N4335","N4336","N4337",
  "N4338","N4339","N4340","N4341","N4342","N4343","N4344","N4345",
  "N4346","N4347","N4348","N4349","N4350","N4351","N4352","N4353",
  "N4354"
];

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
    return Promise.all([
      routeId ? fetchRouteById(routeId) : null,
      tripId ? fetchTripById(tripId) : null,
      v,
      vehicleId
    ]);
  });

  const results = await Promise.all(dataPromises);

  // Collect in-service and out-of-service AM trains
  const inServiceAMTrains = [];
  const outOfServiceAMTrains = [];

  results.forEach(result=>{
    const [routeInfo, tripInfo, v, vehicleId] = result;
    if(!v.vehicle || !v.vehicle.position || !vehicleId) return;
    newVehicleIds.add(vehicleId);

    const lat = v.vehicle.position.latitude;
    const lon = v.vehicle.position.longitude;
    let vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : 0;

    let typeKey = "other";
    let color = vehicleColors.default;
    let routeName = "N/A";
    let destination = tripInfo?.trip_headsign || v.vehicle.trip?.trip_headsign || "N/A";
    const occupancy = occupancyStatus!==undefined
      ? occupancyLabels[occupancyStatus] || "Unknown"
      : "N/A";

    if(routeInfo){
      const routeType = routeInfo.route_type;
      switch(routeType){
        case 3: typeKey="bus"; color=vehicleColors[3]; break;
        case 2: typeKey="train"; color=vehicleColors[2]; break;
        case 4: typeKey="ferry"; color=vehicleColors[4]; break;
      }
      routeName = routeInfo.route_short_name || "N/A";
    }

    if(vehicleLabel.startsWith("AM")){
      if(typeKey==="train") inServiceAMTrains.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
      else outOfServiceAMTrains.push({vehicleId, lat, lon, speedKmh, vehicleLabel});
    }

    let speed = "N/A";
    let maxSpeed = typeKey==="bus"?100:typeKey==="train"?160:typeKey==="ferry"?80:180; 
    if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";

    const operator = v.vehicle.vehicle?.operator_id || "";
    let vehicleLabelWithOperator = operator+vehicleLabel;

    // --- Add bus type if Enviro200 ---
    if(typeKey === "bus" && enviro200Buses.includes(vehicleLabel)){
      vehicleLabelWithOperator += " - Alexander Dennis Enviro200";
    }

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

  // Pair AM trains and update popup
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

  // Update debug info
  debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
}

// --- Init ---
(async function init(){
  fetchVehicles();
  setInterval(fetchVehicles, 15000);
})();
