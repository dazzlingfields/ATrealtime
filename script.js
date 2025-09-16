// --- API Key and Endpoints ---
const atApiKey = '18e2ee8ee75d4e6ca7bd446ffa9bd50f';
const vehicleApiUrl = 'https://api.at.govt.nz/v3/gtfs/vehicles';
const routesApiUrl = 'https://api.at.govt.nz/v3/gtfs/routes';

// --- Map Setup ---
const map = L.map('map').setView([-36.8485, 174.7633], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// --- Data Stores ---
const routes = {};
const markers = {};
const routeTypes = { bus: '3', train: '2', ferry: '4' };

// --- Layer Groups ---
const layerGroups = {
    [routeTypes.bus]: L.layerGroup().addTo(map),
    [routeTypes.train]: L.layerGroup().addTo(map),
    [routeTypes.ferry]: L.layerGroup().addTo(map),
    'other': L.layerGroup().addTo(map)
};

// --- Checkbox Controls ---
const checkboxes = {
    bus: document.getElementById('bus-checkbox'),
    train: document.getElementById('train-checkbox'),
    ferry: document.getElementById('ferry-checkbox'),
    other: document.getElementById('other-checkbox')
};

checkboxes.bus.addEventListener('change', e => toggleLayer(routeTypes.bus, e.target.checked));
checkboxes.train.addEventListener('change', e => toggleLayer(routeTypes.train, e.target.checked));
checkboxes.ferry.addEventListener('change', e => toggleLayer(routeTypes.ferry, e.target.checked));
checkboxes.other.addEventListener('change', e => toggleLayer('other', e.target.checked));

function toggleLayer(type, visible) {
    const layer = layerGroups[type];
    if (visible) map.addLayer(layer);
    else map.removeLayer(layer);
}

// --- Fetch Static Routes ---
async function fetchStaticRoutes() {
    try {
        const response = await fetch(routesApiUrl, {
            headers: { 'Ocp-Apim-Subscription-Key': atApiKey }
        });
        if (!response.ok) throw new Error(`Failed to fetch routes: ${response.status}`);
        const data = await response.json();

        data.forEach(route => {
            routes[route.route_id] = route;
        });

        console.log("Static routes fetched:", Object.keys(routes).length);

        // Start vehicle loop
        fetchVehicleData();
        setInterval(fetchVehicleData, 10000);

    } catch (error) {
        console.error("Error fetching static route data:", error);
        document.getElementById("debug").textContent = "Error fetching routes";
    }
}

// --- Fetch Vehicle Data ---
async function fetchVehicleData() {
    try {
        const response = await fetch(vehicleApiUrl, {
            headers: { 'Ocp-Apim-Subscription-Key': atApiKey }
        });
        if (!response.ok) throw new Error(`Failed to fetch vehicles: ${response.status}`);
        const data = await response.json();
        const seenIds = new Set();

        data.forEach(vehicleInfo => {
            const lat = vehicleInfo.position.latitude;
            const lng = vehicleInfo.position.longitude;
            const vehicleId = vehicleInfo.vehicle?.id || vehicleInfo.vehicle?.vehicle_id;
            if (!vehicleId) return;

            const routeId = vehicleInfo.trip?.route_id;
            const route = routes[routeId];

            let dotClass, targetLayer;
            if (route) {
                if (route.route_type === routeTypes.bus) { dotClass = 'bus-dot'; targetLayer = layerGroups[routeTypes.bus]; }
                else if (route.route_type === routeTypes.train) { dotClass = 'train-dot'; targetLayer = layerGroups[routeTypes.train]; }
                else if (route.route_type === routeTypes.ferry) { dotClass = 'ferry-dot'; targetLayer = layerGroups[routeTypes.ferry]; }
                else { dotClass = 'not-in-service-dot'; targetLayer = layerGroups.other; }
            } else {
                dotClass = 'not-in-service-dot'; targetLayer = layerGroups.other;
            }

            const dotIcon = L.divIcon({ className: `vehicle-dot ${dotClass}` });
            const speed = vehicleInfo.position.speed ? `${Math.round(vehicleInfo.position.speed * 3.6)} km/h` : 'N/A';
            const routeName = route ? route.route_long_name : 'Unknown';
            const headsign = vehicleInfo.trip?.trip_headsign || 'N/A';

            const popupContent = `
                <b>Route:</b> ${routeName}<br>
                <b>Destination:</b> ${headsign}<br>
                <b>Route ID:</b> ${routeId || 'N/A'}<br>
                <b>Speed:</b> ${speed}<br>
                <b>License:</b> ${vehicleInfo.vehicle?.license_plate || 'N/A'}
            `;

            if (markers[vehicleId]) {
                markers[vehicleId].setLatLng([lat, lng]);
                markers[vehicleId].setIcon(dotIcon);
                markers[vehicleId].getPopup()?.setContent(popupContent);
            } else {
                const marker = L.marker([lat, lng], { icon: dotIcon }).bindPopup(popupContent);
                marker.addTo(targetLayer);
                markers[vehicleId] = marker;
            }

            seenIds.add(vehicleId);
        });

        // Remove stale vehicles
        for (const id in markers) {
            if (!seenIds.has(id)) {
                map.removeLayer(markers[id]);
                delete markers[id];
            }
        }

        // --- Debug Panel ---
        const debug = document.getElementById("debug");
        debug.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${data.length}`;
        if (data.length === 0) debug.style.background = "rgba(200,0,0,0.7)";
        else debug.style.background = "rgba(0,0,0,0.7)";

    } catch (error) {
        console.error("Error fetching vehicle data:", error);
        document.getElementById("debug").textContent = "Error fetching vehicles";
    }
}

// --- Start ---
fetchStaticRoutes();
