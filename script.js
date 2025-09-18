// ================== v5.8 - Real-time Vehicle Tracking (Viewport + Out-of-Service Handling) ==================

// API endpoints
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;
const busTypesUrl = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// Map setup
const map = L.map("map").setView([-36.8485, 174.7633], 12);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ attribution: "© OpenStreetMap contributors" });
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{ subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" }).addTo(map);
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{ subdomains:"abcd", attribution:"© OpenStreetMap contributors © CARTO" });
const satellite = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",{ subdomains:["mt0","mt1","mt2","mt3"], attribution:"© Google" });
L.control.layers({ "Light":light,"Dark":dark,"OSM":osm,"Satellite":satellite }).addTo(map);

// Globals
const debugBox = document.getElementById("debug");
const routes = {};
const trips = {};
const vehicleMarkers = {};
let busTypes = {};

// Layer groups
const layerGroups = { bus:L.layerGroup().addTo(map), train:L.layerGroup().addTo(map), ferry:L.layerGroup().addTo(map), other:L.layerGroup().addTo(map) };

// Vehicle colors and occupancy labels
const vehicleColors = { bus:"#007bff", train:"#dc3545", ferry:"#ffc107", other:"#6c757d" };
const occupancyLabels = { 0:"Empty",1:"Many Seats Available",2:"Few Seats Available",3:"Standing Room Only",4:"Crushed Standing Room Only",5:"Full",6:"Not Accepting Passengers" };

// Utility
function getVehicleIcon(color){
    return L.divIcon({ className:'vehicle-icon', html:`<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize:[16,16], iconAnchor:[8,8] });
}

async function safeFetch(url){
    try{ const res = await fetch(url); if(!res.ok) throw new Error(`Fetch failed: ${res.status}`); return await res.json(); }
    catch(err){ console.error(err); return null; }
}

async function loadBusTypes(){ const data = await safeFetch(busTypesUrl); if(data) busTypes = data; }

// Cache route/trip info
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

// Distance helper
function distanceMeters(lat1, lon1, lat2, lon2){
    const R=6371000,toRad=deg=>deg*Math.PI/180;
    const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Pair AM trains
function pairAMTrains(inService,outOfService){
    const pairs=[], usedOut=new Set();
    inService.forEach(inTrain=>{
        let best=null,minDist=200;
        outOfService.forEach(outTrain=>{
            if(usedOut.has(outTrain.vehicleId)) return;
            const dist=distanceMeters(inTrain.lat,inTrain.lon,outTrain.lat,outTrain.lon);
            const speedDiff=Math.abs(inTrain.speedKmh-outTrain.speedKmh);
            if(dist<=200 && speedDiff<=15 && dist<minDist){ minDist=dist; best=outTrain; }
        });
        if(best){ pairs.push({inTrain,outTrain:best}); usedOut.add(best.vehicleId); }
    });
    return pairs;
}

// Add/update vehicle marker
function addVehicleMarker(vehicleId, lat, lon, popupContent, color, type){
    if(vehicleMarkers[vehicleId]){
        vehicleMarkers[vehicleId].setLatLng([lat,lon]);
        vehicleMarkers[vehicleId].setPopupContent(popupContent);
        vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
    } else {
        const marker=L.marker([lat,lon],{icon:getVehicleIcon(color)});
        marker.bindPopup(popupContent);
        layerGroups[type].addLayer(marker);
        vehicleMarkers[vehicleId]=marker;
    }
}

// Fetch vehicles
async function fetchVehicles(){
    const json = await safeFetch(realtimeUrl);
    if(!json){ debugBox.textContent="Error fetching vehicle data"; return; }

    const vehicles=json?.response?.entity || json?.entity || [];
    const newVehicleIds=new Set();
    const inServiceAMTrains=[], outOfServiceAMTrains=[];
    const bounds = map.getBounds().pad(0.2); // viewport buffer

    for(const v of vehicles){
        const vehicleId=v.vehicle?.vehicle?.id;
        if(!v.vehicle || !v.vehicle.position || !vehicleId) continue;

        const lat=v.vehicle.position.latitude;
        const lon=v.vehicle.position.longitude;
        if(!bounds.contains([lat, lon])) continue;

        const vehicleLabel=v.vehicle.vehicle?.label||"N/A";
        const operator=v.vehicle.vehicle?.operator_id||"";
        const licensePlate=v.vehicle.vehicle?.license_plate||"N/A";
        const occupancyStatus=v.vehicle.occupancy_status;
        const speedKmh=v.vehicle.position.speed ? v.vehicle.position.speed*3.6 : 0;

        let type="other", color=vehicleColors.other, routeName="N/A", destination="N/A";
        const occupancy = occupancyStatus!==undefined ? occupancyLabels[occupancyStatus]||"Unknown":"N/A";

        const routeId=v.vehicle?.trip?.route_id;
        const tripId=v.vehicle?.trip?.trip_id;

        // Fetch route/trip info
        let routeInfo=null, tripInfo=null;
        if(routeId) routeInfo = await fetchRouteById(routeId);
        if(tripId) tripInfo = await fetchTripById(tripId);

        if(routeInfo){
            const rt = routeInfo.route_type;
            type = rt===3?"bus":rt===2?"train":rt===4?"ferry":"other";
            color = vehicleColors[type]||vehicleColors.other;
            routeName = routeInfo.route_short_name||"N/A";
        }

        if(tripInfo) destination = tripInfo.trip_headsign||"N/A";

        // Get bus type only if route exists
        let busType="";
        if(type==="bus" && routeInfo && busTypes && Object.keys(busTypes).length>0){
            const operatorCode = operator || (vehicleLabel.match(/^[A-Z]+/)||[""])[0];
            const vehicleNumber = Number(vehicleLabel.replace(operatorCode,""));
            for(const model in busTypes){
                const operators = busTypes[model];
                if(operators[operatorCode]?.includes(vehicleNumber)){ 
                    busType=model;
                    break;
                }
            }
        }

        let speed="N/A";
        const maxSpeed = type==="bus"?100:type==="train"?160:type==="ferry"?80:180;
        if(speedKmh>=0 && speedKmh<=maxSpeed) speed = speedKmh.toFixed(1)+" km/h";

        const popupContent = `
            <b>Route:</b> ${routeName}<br>
            <b>Destination:</b> ${destination}<br>
            <b>Vehicle:</b> ${vehicleLabel}<br>
            ${busType?`<b>Bus Type:</b> ${busType}<br>`:""}
            <b>Number Plate:</b> ${licensePlate}<br>
            <b>Speed:</b> ${speed}<br>
            <b>Occupancy:</b> ${occupancy}
        `;

        addVehicleMarker(vehicleId, lat, lon, popupContent, color, type);
        newVehicleIds.add(vehicleId);

        // Track AM trains
        if(vehicleLabel.startsWith("AM") && type==="train" && routeInfo) inServiceAMTrains.push({vehicleId,lat,lon,speedKmh,vehicleLabel});
        else if(vehicleLabel.startsWith("AM")) outOfServiceAMTrains.push({vehicleId,lat,lon,speedKmh,vehicleLabel});
    }

    // Pair AM trains
    const pairs = pairAMTrains(inServiceAMTrains,outOfServiceAMTrains);
    pairs.forEach(pair=>{
        const marker = vehicleMarkers[pair.inTrain.vehicleId];
        if(marker){
            const oldContent = marker.getPopup()?.getContent()||"";
            marker.setPopupContent(oldContent+`<br><b>Paired to:</b> ${pair.outTrain.vehicleLabel}`);
        }
    });

    // Remove markers outside viewport
    Object.keys(vehicleMarkers).forEach(id=>{ if(!newVehicleIds.has(id)){ map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; } });

    debugBox.textContent=`Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${newVehicleIds.size}`;
}

// Init
(async function init(){
    await loadBusTypes();
    fetchVehicles();
    setInterval(fetchVehicles, 15000);
    map.on('moveend', fetchVehicles);
})();
