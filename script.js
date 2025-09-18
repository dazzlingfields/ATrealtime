// ================== v4.8.2 - Real-time Vehicle Tracking (Optimized + Independent Vehicle Updates) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const busTypesUrl = "busTypes.json"; // hosted on GitHub Pages

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" });
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains: ["mt0","mt1","mt2","mt3"], attribution: "© Google" });

L.control.layers({ "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite }).addTo(map);

// --- Globals ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};           // cached trips
const failedTripIds = new Set(); // skip repeatedly failing trips
const vehicleMarkers = {};
let busTypes = {};

// --- Layer groups ---
const layerGroups = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  other: L.layerGroup().addTo(map)
};

// --- Vehicle styles ---
const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = { 0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers" };
const getVehicleIcon = color => L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

// --- Safe fetch ---
async function safeFetch(url, retries=1, delay=2000){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
    return await res.json();
  } catch(err){
    if(retries>0){
      await new Promise(r=>setTimeout(r, delay));
      return safeFetch(url, retries-1, delay*2);
    }
    console.warn(`Skipped failing request: ${url}`, err);
    return null;
  }
}

// --- Load routes and bus types ---
async function loadBusTypes(){ const data = await safeFetch(busTypesUrl); if(data) busTypes=data; }
async function loadAllRoutes(){
  const json = await safeFetch(routesUrl);
  if(json?.data) json.data.forEach(r => routes[r.id||r.route_id]=r.attributes||r);
}

// --- Route helper ---
function getRouteById(id){ return routes[id]||null; }

// --- Trip fetch (skips failed trips) ---
async function fetchTripById(tripId){
  if(trips[tripId] || failedTripIds.has(tripId)) return trips[tripId]||null;
  const json = await safeFetch(`${tripsUrl}?id=${tripId}`);
  const data = json?.data?.[0]?.attributes || json?.data?.attributes;
  if(data){ trips[tripId]=data; failedTripIds.delete(tripId); return data; }
  failedTripIds.add(tripId);
  return null;
}

// --- Distance ---
function distanceMeters(lat1, lon1, lat2, lon2){
  const R=6371000, toRad=deg=>deg*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- Pair AM trains ---
function pairAMTrains(inService, outOfService){
  const pairs=[], usedOut=new Set();
  inService.forEach(i=>{
    let best=null, minD=200;
    outOfService.forEach(o=>{
      if(usedOut.has(o.vehicleId)) return;
      const d=distanceMeters(i.lat,i.lon,o.lat,o.lon);
      const sDiff=Math.abs(i.speedKmh-o.speedKmh);
      if(d<=200 && sDiff<=10 && d<minD){ minD=d; best=o; }
    });
    if(best){ pairs.push({inTrain:i,outTrain:best}); usedOut.add(best.vehicleId); }
  });
  return pairs;
}

// --- Add/update marker ---
function addVehicleMarker(id, lat, lon, popup, color, typeKey, inBounds){
  if(vehicleMarkers[id]){
    const m=vehicleMarkers[id];
    m.setLatLng([lat,lon]);
    if(popup) m.setPopupContent(popup);
    m.setIcon(getVehicleIcon(color));
    if(inBounds){ if(!map.hasLayer(m)) m.addTo(layerGroups[typeKey]); }
    else{ if(map.hasLayer(m)) map.removeLayer(m); }
  } else {
    const m=L.marker([lat,lon],{icon:getVehicleIcon(color)});
    if(popup) m.bindPopup(popup);
    if(inBounds) m.addTo(layerGroups[typeKey]);
    vehicleMarkers[id]=m;
  }
}

// --- Fetch and display vehicles ---
async function fetchVehicles(){
  const json=await safeFetch(realtimeUrl);
  if(!json){ debugBox.textContent="Realtime unavailable"; return; }

  const vehicles=json.response?.entity||json.entity||[];
  const bounds=map.getBounds();
  const newVehicleIds=new Set();
  const inServiceAM=[], outOfServiceAM=[];

  // --- Display/update positions ---
  await Promise.all(vehicles.map(async v=>{
    const vid=v.vehicle?.vehicle?.id;
    if(!vid || !v.vehicle.position) return;

    const lat=v.vehicle.position.latitude, lon=v.vehicle.position.longitude;
    const inBounds=bounds.contains([lat,lon]);
    newVehicleIds.add(vid);

    const label=v.vehicle.vehicle?.label||"N/A";
    const operator=v.vehicle.vehicle?.operator_id||"";
    const num=Number(label.replace(operator,""))||0;
    const license=v.vehicle.vehicle?.license_plate||"N/A";
    const occ=v.vehicle.occupancy_status!==undefined ? occupancyLabels[v.vehicle.occupancy_status]||"Unknown":"N/A";
    const speed=v.vehicle.position.speed ? (v.vehicle.position.speed*3.6).toFixed(1)+" km/h" : "N/A";

    let type="other", color=vehicleColors.default, routeName="N/A", destination="N/A", busType="";
    const routeId=v.vehicle.trip?.route_id, tripId=v.vehicle.trip?.trip_id;

    if(routeId){ const r=getRouteById(routeId); if(r){ routeName=r.route_short_name||"N/A"; switch(r.route_type){ case 3:type="bus"; color=vehicleColors[3]; break; case 2:type="train"; color=vehicleColors[2]; break; case 4:type="ferry"; color=vehicleColors[4]; break; } } }
    else if(label.startsWith("AM")) type="bus";

    if(tripId && trips[tripId]) destination=trips[tripId].trip_headsign||"N/A";
    else if(tripId){ fetchTripById(tripId).then(t=>{ if(t){ const m=vehicleMarkers[vid]; if(m){ const old=m.getPopup()?.getContent(); if(old) m.setPopupContent(old.replace(/(<b>Destination:<\/b>\s*)(N\/A)/, `$1${t.trip_headsign||"N/A"}`)); } } }); }

    if(type==="bus"){
      for(const model in busTypes){
        const ops=busTypes[model];
        if(ops[operator]?.includes(num)){ busType=model; break; }
      }
    }

    const maxS=type==="bus"?100:type==="train"?160:type==="ferry"?80:180;
    const displaySpeed=speed.split(" ")[0]>maxS ? "N/A" : speed;

    const popup=`
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${operator+label}<br>
      ${busType?`<b>Bus Type:</b> ${busType}<br>`:""}
      <b>Number Plate:</b> ${license}<br>
      <b>Speed:</b> ${displaySpeed}<br>
      <b>Occupancy:</b> ${occ}
    `;

    if(label.startsWith("AM")){ if(type==="train") inServiceAM.push({vehicleId:vid,lat,lon,speedKmh:parseFloat(speed),vehicleLabel:label}); else outOfServiceAM.push({vehicleId:vid,lat,lon,speedKmh:parseFloat(speed),vehicleLabel:label}); }

    addVehicleMarker(vid,lat,lon,popup,color,type,inBounds);
  }));

  // --- Pair AM trains ---
  const pairs=pairAMTrains(inServiceAM,outOfServiceAM);
  pairs.forEach(p=>{
    const m=vehicleMarkers[p.inTrain.vehicleId];
    if(m){ const old=m.getPopup().getContent(); m.setPopupContent(old+`<br><b>Paired to:</b> ${p.outTrain.vehicleLabel}`); }
  });

  // Remove old markers
  Object.keys(vehicleMarkers).forEach(id=>{ if(!newVehicleIds.has(id)){ map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; } });

  debugBox.textContent=`Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newVehicleIds.size}`;
}

// --- Init ---
(async function init(){
  await loadBusTypes();
  await loadAllRoutes();
  fetchVehicles();
  setInterval(fetchVehicles,15000);
  map.on("moveend", fetchVehicles);
})();
