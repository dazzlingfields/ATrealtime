// Vehicle tracking v6.1 - bulk fetch, viewport-aware, AM train pairing, caching
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;

const map = L.map("map").setView([-36.8485, 174.7633], 12);
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{ subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" });
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains:["mt0","mt1","mt2","mt3"], attribution:"© Google" });
L.control.layers({"Light":light,"Dark":dark,"OSM":osm,"Satellite":satellite}).addTo(map);

const debugBox = document.getElementById("debug");
const vehicleMarkers = {};
const vehicleData = {}; // cache type, route, headsign
const routes = {};
const trips = {};

const layerGroups = { bus:L.layerGroup().addTo(map), train:L.layerGroup().addTo(map), ferry:L.layerGroup().addTo(map), other:L.layerGroup().addTo(map) };

function getVehicleIcon(type){
    const colors = { bus:"#007bff", train:"#dc3545", ferry:"#ffc107", other:"#6c757d" };
    return L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${colors[type]||colors.other};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });
}

async function safeFetch(url){
    try{ const res = await fetch(url); if(!res.ok) throw new Error(`Failed fetch: ${res.status}`); return await res.json(); } 
    catch(err){ console.error(err); return null; }
}

// bulk fetch routes
async function fetchRoutes(routeIds){
    const uncached = [...routeIds].filter(id => !routes[id]);
    if(!uncached.length) return;
    const json = await safeFetch(`${routesUrl}?id=${uncached.join(",")}`);
    if(!json) return;
    const items = Array.isArray(json.data)?json.data:[json.data];
    items.forEach(item => { routes[item.id] = item.attributes || item; });
}

// bulk fetch trips
async function fetchTrips(tripIds){
    const uncached = [...tripIds].filter(id => !trips[id]);
    if(!uncached.length) return;
    const json = await safeFetch(`${tripsUrl}?id=${uncached.join(",")}`);
    if(!json) return;
    const items = Array.isArray(json.data)?json.data:[json.data];
    items.forEach(item => { trips[item.id] = item.attributes || item; });
}

function addVehicleMarker(id, lat, lon, popup, type){
    if(vehicleMarkers[id]){
        vehicleMarkers[id].setLatLng([lat,lon]);
        vehicleMarkers[id].setPopupContent(popup);
        vehicleMarkers[id].setIcon(getVehicleIcon(type));
    } else {
        const marker = L.marker([lat,lon], {icon:getVehicleIcon(type)}).bindPopup(popup);
        layerGroups[type].addLayer(marker);
        vehicleMarkers[id] = marker;
    }
}

function distanceMeters(lat1, lon1, lat2, lon2){
    const R = 6371000, toRad = deg=>deg*Math.PI/180;
    const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pairAMTrains(inService, outOfService){
    const pairs = [], usedOut = new Set();
    inService.forEach(inTrain=>{
        let best=null, minDist=200;
        outOfService.forEach(outTrain=>{
            if(usedOut.has(outTrain.vehicleId)) return;
            const dist = distanceMeters(inTrain.lat,inTrain.lon,outTrain.lat,outTrain.lon);
            const speedDiff = Math.abs(inTrain.speedKmh - outTrain.speedKmh);
            if(dist<=200 && speedDiff<=10 && dist<minDist){ minDist=dist; best=outTrain; }
        });
        if(best){ pairs.push({inTrain,outTrain:best}); usedOut.add(best.vehicleId); }
    });
    return pairs;
}

// extend viewport slightly to pre-load vehicles outside visible bounds
function getViewportBuffer(padding=0.2){
    const bounds = map.getBounds();
    const latPad = (bounds.getNorth()-bounds.getSouth())*padding;
    const lonPad = (bounds.getEast()-bounds.getWest())*padding;
    return L.latLngBounds(
        [bounds.getSouth()-latPad, bounds.getWest()-lonPad],
        [bounds.getNorth()+latPad, bounds.getEast()+lonPad]
    );
}

async function fetchVehicles(){
    const json = await safeFetch(realtimeUrl);
    if(!json){ debugBox.textContent="Error fetching vehicle data"; return; }

    const vehicles = json.response?.entity || json.entity || [];
    const newIds = new Set();
    const routeIds = new Set();
    const tripIds = new Set();
    const bounds = getViewportBuffer();

    const inServiceAM = [], outOfServiceAM = [];

    // collect IDs and AM trains in/around viewport
    vehicles.forEach(v=>{
        const vehicleId = v.vehicle?.vehicle?.id;
        if(!vehicleId || !v.vehicle?.position) return;
        const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
        if(!bounds.contains([lat, lon])) return;

        newIds.add(vehicleId);
        const rId = v.vehicle?.trip?.route_id;
        const tId = v.vehicle?.trip?.trip_id;
        if(rId) routeIds.add(rId);
        if(tId) tripIds.add(tId);

        const label = v.vehicle.vehicle?.label||"";
        const speed = v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : 0;
        if(label.startsWith("AM")) {
            if(rId && routes[rId]?.route_type===2) inServiceAM.push({vehicleId, lat, lon, speedKmh:speed, label});
            else outOfServiceAM.push({vehicleId, lat, lon, speedKmh:speed, label});
        }
    });

    // bulk fetch route and trip info
    await Promise.all([fetchRoutes(routeIds), fetchTrips(tripIds)]);

    vehicles.forEach(v=>{
        const vehicleId = v.vehicle?.vehicle?.id;
        if(!vehicleId || !v.vehicle?.position) return;
        const lat = v.vehicle.position.latitude, lon = v.vehicle.position.longitude;
        if(!bounds.contains([lat, lon])) return;

        const routeId = v.vehicle?.trip?.route_id;
        const tripId = v.vehicle?.trip?.trip_id;
        const routeInfo = routeId ? routes[routeId] : null;
        const tripInfo = tripId ? trips[tripId] : null;

        const route = routeInfo ? routeInfo.route_short_name||"N/A" : "N/A";
        const headsign = tripInfo ? tripInfo.trip_headsign||"N/A" : "N/A";

        let type="other";
        if(routeInfo){
            const t = routeInfo.route_type;
            if(t===3) type="bus"; else if(t===2) type="train"; else if(t===4) type="ferry";
        }

        vehicleData[vehicleId] = {type, route, headsign};
        const popup = `<b>Type:</b> ${type}<br><b>Route:</b> ${route}<br><b>Destination:</b> ${headsign}`;
        addVehicleMarker(vehicleId, lat, lon, popup, type);
    });

    // pair AM trains
    const pairs = pairAMTrains(inServiceAM, outOfServiceAM);
    pairs.forEach(pair=>{
        const marker = vehicleMarkers[pair.inTrain.vehicleId];
        if(marker){
            const oldContent = marker.getPopup()?.getContent() || "";
            marker.setPopupContent(oldContent + `<br><b>Paired to:</b> ${pair.outTrain.label}`);
        }
    });

    // remove markers outside buffered viewport
    Object.keys(vehicleMarkers).forEach(id=>{
        if(!newIds.has(id)){
            map.removeLayer(vehicleMarkers[id]);
            delete vehicleMarkers[id];
            delete vehicleData[id];
        }
    });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newIds.size}`;
}

(async function init(){
    fetchVehicles();
    setInterval(fetchVehicles, 15000);
})();
