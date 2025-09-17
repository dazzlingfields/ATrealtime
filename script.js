const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;

let routeData = {};
let tripData = {};
const vehicleMarkers = {};

const busLayer = L.layerGroup();
const trainLayer = L.layerGroup();
const ferryLayer = L.layerGroup();
const outOfServiceLayer = L.layerGroup();

const vehicleLayers = { bus: busLayer, train: trainLayer, ferry: ferryLayer, outOfService: outOfServiceLayer };

const occupancyStatusMap = {
    0: 'Empty',
    1: 'Many seats available',
    2: 'Few seats available',
    3: 'Standing room only',
    4: 'Crushed standing room only',
    5: 'Full',
    6: 'Not accepting passengers',
    7: 'No data available'
};

// Limit speeds for realism
function limitSpeed(speed, type) {
    if (type === 'bus') return Math.min(speed, 100);
    if (type === 'train') return Math.min(speed, 120);
    if (type === 'ferry') return Math.min(speed, 50);
    return speed;
}

function getIconForVehicle(serviceType, isOutOfService) {
    const colours = { bus: 'blue', train: 'green', ferry: 'red' };
    const color = isOutOfService ? 'grey' : colours[serviceType] || 'black';
    return L.divIcon({
        className: 'vehicle-icon',
        html: `<div style="background: ${color}; width:10px; height:10px; border:2px solid white; border-radius:5px;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

async function fetchVehicles() {
    const statusDisplay = document.getElementById('status-display');
    statusDisplay.textContent = 'Updating...';

    try {
        const response = await fetch(realtimeUrl);
        const data = await response.json();
        renderVehicles(data);
        statusDisplay.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    } catch (err) {
        console.error("fetchVehicles error:", err);
        statusDisplay.textContent = 'Connection Error';
    }
}

function renderVehicles(data) {
    const newIds = new Set();

    data.forEach(vehicle => {
        const vehicleId = vehicle.vehicle?.id;
        if (!vehicleId || !vehicle.vehicle?.position) return;
        newIds.add(vehicleId);

        const lat = vehicle.vehicle.position.latitude;
        const lon = vehicle.vehicle.position.longitude;
        const rawSpeed = vehicle.vehicle.position.speed ? (vehicle.vehicle.position.speed * 3.6) : 0;
        const serviceType = vehicle.trip?.service_type || 'unknown';
        const speed = limitSpeed(rawSpeed, serviceType).toFixed(1);
        const isOutOfService = vehicle.vehicle.current_status === "IN_TRANSIT_TO";
        const destination = vehicle.trip?.headsign || 'N/A';
        const occupancyStatus = occupancyStatusMap[vehicle.vehicle.occupancy_status] || 'No data available';
        const vehicleLabel = vehicle.vehicle.label || 'N/A';

        const tripInfo = tripData[vehicle.trip?.trip_id];
        const routeInfo = tripInfo ? routeData[tripInfo.route_id] : null;
        const routeShortName = routeInfo ? routeInfo.route_short_name : 'N/A';

        const popupContent = `
            <b>Route:</b> ${routeShortName}<br>
            <b>Destination:</b> ${destination}<br>
            <b>Occupancy:</b> ${occupancyStatus}<br>
            <b>Vehicle Number:</b> ${vehicleLabel}<br>
            <b>Vehicle ID:</b> ${vehicleId}<br>
            <b>Speed:</b> ${speed} km/h
        `;

        const icon = getIconForVehicle(serviceType, isOutOfService);

        if (vehicleMarkers[vehicleId]) {
            vehicleMarkers[vehicleId].setLatLng([lat, lon]).setPopupContent(popupContent);
        } else {
            const marker = L.marker([lat, lon], { icon }).bindPopup(popupContent);
            vehicleMarkers[vehicleId] = marker;

            if (isOutOfService) outOfServiceLayer.addLayer(marker);
            else if (serviceType === 'bus') busLayer.addLayer(marker);
            else if (serviceType === 'train') trainLayer.addLayer(marker);
            else if (serviceType === 'ferry') ferryLayer.addLayer(marker);
        }
    });

    // Remove markers no longer present
    for (const id in vehicleMarkers) {
        if (!newIds.has(id)) {
            Object.values(vehicleLayers).forEach(layer => layer.removeLayer(vehicleMarkers[id]));
            delete vehicleMarkers[id];
        }
    }

    updateVehicleDisplay();
}

function updateVehicleDisplay() {
    document.getElementById('bus-checkbox').checked ? busLayer.addTo(map) : map.removeLayer(busLayer);
    document.getElementById('train-checkbox').checked ? trainLayer.addTo(map) : map.removeLayer(trainLayer);
    document.getElementById('ferry-checkbox').checked ? ferryLayer.addTo(map) : map.removeLayer(ferryLayer);
    document.getElementById('outofservice-checkbox').checked ? outOfServiceLayer.addTo(map) : map.removeLayer(outOfServiceLayer);
}

let map;
async function initializeMap() {
    try {
        const [routesResponse, tripsResponse] = await Promise.all([fetch(routesUrl), fetch(tripsUrl)]);
        const routes = await routesResponse.json();
        const trips = await tripsResponse.json();

        routes.forEach(route => routeData[route.route_id] = route);
        trips.forEach(trip => tripData[trip.trip_id] = trip);

        // Map layers
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' });
        const lightLayer2 = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB' });
        const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB' });
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' });

        map = L.map('map').setView([-36.85, 174.76], 12);
        osmLayer.addTo(map);
        busLayer.addTo(map);
        trainLayer.addTo(map);
        ferryLayer.addTo(map);
        outOfServiceLayer.addTo(map);

        // Base map controls
    const mapRadios = document.querySelectorAll('input[name="map-style"]');
    	mapRadios.forEach(radio => radio.addEventListener('change', () => {
        map.eachLayer(layer => {
        if (![busLayer, trainLayer, ferryLayer, outOfServiceLayer].includes(layer)) map.removeLayer(layer);
    });
        if (document.getElementById('light-map').checked) lightLayer1.addTo(map);
        if (document.getElementById('light-map-2').checked) lightLayer2.addTo(map);
        if (document.getElementById('dark-map').checked) darkLayer.addTo(map);
        if (document.getElementById('satellite-map').checked) satelliteLayer.addTo(map);
}));


        // Add a second light map option dynamically
        const light2Label = document.createElement('label');
        light2Label.innerHTML = '<input type="radio" name="map-style" id="light-map-2"> Light 2';
        document.querySelector('.map-style-selector').appendChild(light2Label);

        // Vehicle checkboxes
        document.getElementById('bus-checkbox').addEventListener('change', updateVehicleDisplay);
        document.getElementById('train-checkbox').addEventListener('change', updateVehicleDisplay);
        document.getElementById('ferry-checkbox').addEventListener('change', updateVehicleDisplay);
        document.getElementById('outofservice-checkbox').addEventListener('change', updateVehicleDisplay);

        // Te Huia layer
        const teHuiaLayer = L.layerGroup().addTo(map);
        if (typeof initializeTeHuiaSim === 'function') initializeTeHuiaSim(map, teHuiaLayer);

        // Fetch vehicles
        fetchVehicles();
        setInterval(fetchVehicles, 30000);

    } catch (err) {
        console.error("Error initializing map:", err);
    }
}

try {
    const response = await fetch(realtimeUrl);
    if (!response.ok) throw new Error('Network response not ok');
    const data = await response.json();
    renderVehicles(data);
} catch (err) {
    console.error('Error fetching vehicles:', err);
    document.getElementById('status-display').textContent = 'Connection Error';
}


initializeMap();

