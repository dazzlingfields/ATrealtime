// Vehicle tracking v5.x - viewport buffer, cached info, AM train pairing

const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;

const map = L.map("map").setView([-36.8485, 174.7633], 12);
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{ subdomains:"abcd", attribution:"© OpenStreetMap © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{ subdomains:"abcd", attribution:"© OpenStreetMap © CARTO" });
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ attribution:"© OpenStreetMap" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains:["mt0","mt1","mt2","mt3"], attribution:"© Google" });
L.control.layers({"Light":light,"Dark":dark,"OSM":osm,"Satellite":satellite}).addTo(map);

const debugBox = document.getElementById("debug");
const vehicleMarkers = {};
const routes = {};
const trips = {};
const vehicleData = {}; // cache type, route, headsign

const layerGroups = { bus:L.layerGroup().addTo(map), train:L.layerGroup().addTo(map), ferry:L.layerGroup().addTo(map), other:L.layerGroup().addTo(map) };

const vehicleColors = { bus:"#007bff", train:"#dc3545", ferry:"#ffc107", other:"#6c757d" };

// Safe fetch utility
async function safeFetch(url){
    try{ const res = await fetch(url); if(!res.ok) throw new Error(`Fetch failed ${res.status}`); return await res.json(); }
    catch(err){ console.error(err); return null; }
}

// Fetch route/trip info (cached)
async function fetchRoute(id){ if(routes[id]) return routes[id]; const data = await safeFetch(`${routesUrl}?id=${id}`); if(data){ const r = Array.isArray(data.data)?data.data[0]:data.data; routes[id] = r.attributes || r; return routes[id]; } return null; }
async function fetchTrip(id){ if(trips[id]) return trips[id]; const data = await safeFetch(`${tripsUrl}?id=${id}`); if(data){ const t = Array.isArray(data.data)?data.data[0]:data.data; trips[id] = t.attributes || t; return trips[id]; } return null; }

// Distance helper
function distanceMeters(lat1, lon1, lat2, lon2){
    const R=6371000, rad=deg=>deg*Math.PI/180;
    const dLat=rad(lat2-lat1), dLon=rad(lon2-lon1);
    const a=Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Pair AM trains
function pairAMTrains(inService,outOfService){
    const pairs=[], usedOut=new Set();
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

// Add/update marker only if info complete
function addVehicleMarker(id, lat, lon, type, route, headsign){
    const icon = L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${vehicleColors[type]||vehicleColors.other};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });
    const popup = `<b>Type:</b> ${type}<br><b>Route:</b> ${route}<br><b>Destination:</b> ${headsign}`;
    if(vehicleMarkers[id]){
        vehicleMarkers[id].setLatLng([lat,lon]);
        vehicleMarkers[id].setPopupContent(popup);
        vehicleMarkers[id].setIcon(icon);
    } else {
        const marker = L.marker([lat,lon],{icon}).bindPopup(popup);
        layerGroups[type].addLayer(marker);
        vehicleMarkers[id] = marker;
    }
}

// Main fetch function
async function fetchVehicles(){
    const json = await safeFetch(realtimeUrl);
    if(!json){ debugBox.textContent="Error fetching vehicle data"; return; }

    const vehicles = json.response?.entity || json.entity || [];
    const bounds = map.getBounds().pad(0.2); // viewport buffer
    const newIds = new Set();
    const inServiceAM = [], outOfServiceAM = [];

    // Step 1: fetch all route/trip info per vehicle in parallel
    await Promise.all(vehicles.map(async v=>{
        const vehicleId = v.vehicle?.vehicle?.id;
        if(!vehicleId || !v.vehicle?.position) return;
        const lat=v.vehicle.position.latitude, lon=v.vehicle.position.longitude;
        if(!bounds.contains([lat,lon])) return;

        const routeId = v.vehicle?.trip?.route_id;
        const tripId = v.vehicle?.trip?.trip_id;

        const [route, trip] = await Promise.all([routeId?fetchRoute(routeId):null, tripId?fetchTrip(tripId):null]);

        // Determine type
        let type="other";
        if(route?.route_type===3) type="bus";
        else if(route?.route_type===2) type="train";
        else if(route?.route_type===4) type="ferry";

        newIds.add(vehicleId);
        vehicleData[vehicleId] = { type, routeName: route?.route_short_name||"N/A", headsign: trip?.trip_headsign||"N/A" };

        // Track AM trains
        const label=v.vehicle.vehicle?.label||"";
        const speedKmh = v.vehicle.position.speed?v.vehicle.position.speed*3.6:0;
        if(label.startsWith("AM") && type==="train") inServiceAM.push({vehicleId,lat,lon,speedKmh,label});
        else if(label.startsWith("AM")) outOfServiceAM.push({vehicleId,lat,lon,speedKmh,label});
    }));

    // Step 2: render markers once info complete
    Object.keys(vehicleData).forEach(id=>{
        if(!newIds.has(id)) return;
        const data = vehicleData[id];
        const vehicle = vehicles.find(v=>v.vehicle?.vehicle?.id===id);
        if(!vehicle || !vehicle.position) return;
        addVehicleMarker(id, vehicle.position.latitude, vehicle.position.longitude, data.type, data.routeName, data.headsign);
    });

    // Step 3: pair AM trains
    const pairs = pairAMTrains(inServiceAM, outOfServiceAM);
    pairs.forEach(pair=>{
        const marker = vehicleMarkers[pair.inTrain.vehicleId];
        if(marker){
            const oldContent = marker.getPopup()?.getContent()||"";
            marker.setPopupContent(oldContent+`<br><b>Paired to:</b> ${pair.outTrain.label}`);
        }
    });

    // Remove markers outside viewport
    Object.keys(vehicleMarkers).forEach(id=>{ if(!newIds.has(id)){ map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; delete vehicleData[id]; } });

    debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newIds.size}`;
}

// Init
fetchVehicles();
setInterval(fetchVehicles, 15000);
map.on('moveend', fetchVehicles);
