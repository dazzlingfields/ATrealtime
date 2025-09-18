// ================== v4.9 - Real-time Vehicle Tracking (Optimized Batch Trips + Retry) ==================

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const busTypesUrl = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map setup ---
const map = L.map("map").setView([-36.8485, 174.7633], 12);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" });
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains:["mt0","mt1","mt2","mt3"], attribution:"© Google" });
L.control.layers({ "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite }).addTo(map);

// --- Globals ---
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const tripCacheStatus = {}; // pending, done, failed
let failedTripQueue = new Set();
const vehicleMarkers = {};
let busTypes = {};

const layerGroups = {
    bus: L.layerGroup().addTo(map),
    train: L.layerGroup().addTo(map),
    ferry: L.layerGroup().addTo(map),
    other: L.layerGroup().addTo(map)
};

const vehicleColors = { 3:"#007bff", 2:"#dc3545", 4:"#ffc107", default:"#6c757d" };
const occupancyLabels = { 0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers" };
const getVehicleIcon = color => L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

// --- Safe fetch ---
async function safeFetch(url,retries=2,delay=2000){
    try{
        const res = await fetch(url);
        if(!res.ok) throw new Error(`Failed fetch: ${res.status}`);
        return await res.json();
    } catch(err){
        if(retries>0){ await new Promise(r=>setTimeout(r,delay)); return safeFetch(url,retries-1,delay*2); }
        console.warn("Fetch failed permanently:", url, err);
        return null;
    }
}

// --- Load bus types and routes ---
async function loadBusTypes(){ const data = await safeFetch(busTypesUrl); if(data) busTypes = data; }
async function loadAllRoutes(){ const json = await safeFetch(routesUrl); if(json?.data){ json.data.forEach(route=>routes[route.id||route.route_id]=route.attributes||route); } }

// --- Route/trip helpers ---
function getRouteById(routeId){ return routes[routeId]||null; }

async function fetchTripsBatch(tripIds){
    const batch = tripIds.filter(id => !trips[id] && tripCacheStatus[id]!=="pending");
    if(batch.length === 0) return;
    await Promise.all(batch.map(async tid=>{
        tripCacheStatus[tid] = "pending";
        try{
            const data = await safeFetch(`${tripsUrl}?id=${tid}`);
            const tripData = data?.data?.[0]?.attributes || data?.data?.attributes;
            if(tripData){ trips[tid] = tripData; tripCacheStatus[tid]="done"; failedTripQueue.delete(tid); }
            else { tripCacheStatus[tid]="failed"; failedTripQueue.add(tid); }
        } catch { tripCacheStatus[tid]="failed"; failedTripQueue.add(tid); }
    }));
}

// --- Distance helper ---
function distanceMeters(lat1, lon1, lat2, lon2){
    const R=6371000, toRad=deg=>deg*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// --- Pair AM trains ---
function pairAMTrains(inService,outOfService){
    const pairs=[],usedOut=new Set();
    inService.forEach(inTrain=>{
        let best=null,minDist=200;
        outOfService.forEach(outTrain=>{
            if(usedOut.has(outTrain.vehicleId)) return;
            const dist=distanceMeters(inTrain.lat,inTrain.lon,outTrain.lat,outTrain.lon);
            const speedDiff=Math.abs(inTrain.speedKmh-outTrain.speedKmh);
            if(dist<=200 && speedDiff<=10 && dist<minDist){ minDist=dist; best=outTrain; }
        });
        if(best){ pairs.push({inTrain,outTrain:best}); usedOut.add(best.vehicleId); }
    });
    return pairs;
}

// --- Add/update vehicle marker ---
function addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey, inBounds){
    if(vehicleMarkers[vehicleId]){
        const m=vehicleMarkers[vehicleId];
        m.setLatLng([lat,lon]); m.setPopupContent(popupContent); m.setIcon(getVehicleIcon(color));
        if(inBounds){ if(!map.hasLayer(m)) m.addTo(layerGroups[typeKey]); } 
        else { if(map.hasLayer(m)) map.removeLayer(m); }
    } else {
        const m=L.marker([lat,lon],{icon:getVehicleIcon(color)});
        m.bindPopup(popupContent);
        if(inBounds) m.addTo(layerGroups[typeKey]);
        vehicleMarkers[vehicleId] = m;
    }
}

// --- Update popups asynchronously when trip info arrives ---
function updateVehiclePopup(vehicleId){
    const marker = vehicleMarkers[vehicleId];
    if(!marker) return;
    const v = marker.vehicleData;
    if(!v) return;

    let destination = "N/A";
    const tripId = v.vehicle?.trip?.trip_id;
    if(v.vehicle.trip?.trip_headsign) destination = v.vehicle.trip.trip_headsign;
    else if(tripId && trips[tripId]) destination = trips[tripId].trip_headsign || "N/A";

    const routeId = v.vehicle?.trip?.route_id;
    const routeInfo = routeId ? getRouteById(routeId) : null;
    let routeName = routeInfo?.route_short_name || "N/A";

    const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
    const operator = v.vehicle.vehicle?.operator_id || "";
    const vehicleNumber = Number(vehicleLabel.replace(operator,"")) || 0;
    let busType="";
    if(v.vehicle && v.vehicle.vehicle && routeInfo?.route_type===3){ 
        for(const model in busTypes){
            const ops = busTypes[model];
            if(ops[operator]?.includes(vehicleNumber)){ busType = model; break; }
        }
    }

    const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
    const occupancyStatus = v.vehicle.occupancy_status;
    const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus]||"Unknown" : "N/A";
    const speedKmh = v.vehicle.position?.speed ? v.vehicle.position.speed*3.6 : 0;
    const typeKey = routeInfo ? (routeInfo.route_type===3?"bus":routeInfo.route_type===2?"train":routeInfo.route_type===4?"ferry":"other") : "other";
    const color = vehicleColors[routeInfo?.route_type] || vehicleColors.default;
    const maxSpeed = typeKey==="bus"?100:typeKey==="train"?160:typeKey==="ferry"?80:180;
    const speed = (speedKmh>=0 && speedKmh<=maxSpeed)? speedKmh.toFixed(1)+" km/h":"N/A";

    const popupContent = `
        <b>Route:</b> ${routeName}<br>
        <b>Destination:</b> ${destination}<br>
        <b>Vehicle:</b> ${operator+vehicleLabel}<br>
        ${busType?`<b>Bus Type:</b> ${busType}<br>`:""}
        <b>Number Plate:</b> ${licensePlate}<br>
        <b>Speed:</b> ${speed}<br>
        <b>Occupancy:</b> ${occupancy}
    `;
    addVehicleMarker(vehicleId,v.vehicle.position.latitude,v.vehicle.position.longitude,popupContent,color,typeKey,true);
}

// --- Fetch and display vehicles ---
async function fetchVehicles(){
    const json = await safeFetch(realtimeUrl);
    if(!json){ debugBox.textContent="Realtime unavailable"; return; }

    const vehicles = json?.response?.entity || json?.entity || [];
    const newVehicleIds = new Set();
    const inServiceAM = [], outOfServiceAM = [];
    const bounds = map.getBounds();

    // Attach vehicleData for async popup updates
    vehicles.forEach(v=>{
        if(v.vehicle && v.vehicle.position && v.vehicle.vehicle?.id){
            const vehicleId = v.vehicle.vehicle.id;
            vehicleMarkers[vehicleId] = vehicleMarkers[vehicleId] || {};
            vehicleMarkers[vehicleId].vehicleData = v;
        }
    });

    // --- Collect trip IDs and fetch in batches ---
    const tripIds = [...new Set(vehicles.map(v=>v.vehicle?.trip?.trip_id).filter(Boolean))];
    for(let i=0;i<tripIds.length;i+=20) await fetchTripsBatch(tripIds.slice(i,i+20));

    // --- Display markers and popups ---
    vehicles.forEach(v=>{
        const vehicleId = v.vehicle?.vehicle?.id;
        if(!v.vehicle || !v.vehicle.position || !vehicleId) return;

        const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
        newVehicleIds.add(vehicleId);

        const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
        const operator = v.vehicle.vehicle?.operator_id || "";
        const vehicleNumber = Number(vehicleLabel.replace(operator,"")) || 0;

        let typeKey="other", color=vehicleColors.default;
        const routeId = v.vehicle?.trip?.route_id;
        const routeInfo = routeId ? getRouteById(routeId) : null;
        if(routeInfo){ switch(routeInfo.route_type){ case 3: typeKey="bus"; color=vehicleColors[3]; break; case 2: typeKey="train"; color=vehicleColors[2]; break; case 4: typeKey="ferry"; color=vehicleColors[4]; break; } }

        // Initial popup content
        const popupContent = `<b>Route:</b> ${routeInfo?.route_short_name||"N/A"}<br><b>Destination:</b> Loading...<br><b>Vehicle:</b> ${operator+vehicleLabel}`;

        addVehicleMarker(vehicleId, lat, lon, popupContent, color, typeKey, bounds.contains([lat,lon]));
        updateVehiclePopup(vehicleId);

        // AM train pairing
        if(vehicleLabel.startsWith("AM")){
            if(typeKey==="train") inServiceAM.push({vehicleId,lat,lon,speedKmh:v.vehicle.position.speed*3.6||0,vehicleLabel});
            else outOfServiceAM.push({vehicleId,lat,lon,speedKmh:v.vehicle.position.speed*3.6||0,vehicleLabel});
        }
    });

    // Pair AM trains
    const pairs = pairAMTrains(inServiceAM,outOfServiceAM);
    pairs.forEach(pair=>{
        const marker = vehicleMarkers[pair.inTrain.vehicleId];
        if(marker){
            const old = marker.getPopup().getContent();
            marker.setPopupContent(old+`<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
        }
    });

    // Remove old markers
    Object.keys(vehicleMarkers).forEach(id=>{
        if(!newVehicleIds.has(id) && vehicleMarkers[id].setLatLng){
            map.removeLayer(vehicleMarkers[id]);
            delete vehicleMarkers[id];
        }
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newVehicleIds.size}`;
}

// --- Retry failed trips periodically ---
setInterval(async ()=>{
    if(failedTripQueue.size>0){
        const retryIds = Array.from(failedTripQueue);
        for(let i=0;i<retryIds.length;i+=20) await fetchTripsBatch(retryIds.slice(i,i+20));
        retryIds.forEach(id=>updateVehiclePopup(id));
    }
}, 30000);

// --- Init ---
(async function init(){
    await loadBusTypes();
    await loadAllRoutes();
    await fetchVehicles();
    setInterval(fetchVehicles,15000); // refresh vehicles
    map.on("moveend", fetchVehicles); // filter markers on viewport change
})();
