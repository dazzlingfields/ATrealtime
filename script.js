// --- API Key and Endpoints ---
const atApiKey = '18e2ee8ee75d4e6ca7bd446ffa9bd50f'; 

// Official AT API endpoints
const vehicleApiUrl = 'https://api.at.govt.nz/v2/gtfs-realtime-compat/v1/feed';
const routesApiUrl = 'https://api.at.govt.nz/v2/gtfs/routes';

// --- Set up the Map ---
const map = L.map('map').setView([-36.8485, 174.7633], 13);

// Use OpenStreetMap as the base layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// --- Global Data Stores ---
const markers = {};
const routes = {};

// GTFS route_type values for each mode
const routeTypes = {
    bus: '3',
    train: '2',
    ferry: '4'
};

// --- Create Layer Groups for each vehicle type ---
const layerGroups = {
    [routeTypes.bus]: L.layerGroup().addTo(map),
    [routeTypes.train]: L.layerGroup().addTo(map),
    [routeTypes.ferry]: L.layerGroup().addTo(map),
    'other': L.layerGroup() // For vehicles without a recognised route
};

// --- Custom Checkbox Logic ---
const checkboxes = {
    bus: document.getElementById('bus-checkbox'),
    train: document.getElementById('train-checkbox'),
    ferry: document.getElementById('ferry-checkbox'),
    other: document.getElementById('other-checkbox')
};

checkboxes.bus.addEventListener('change', (e) => toggleLayer(routeTypes.bus, e.target.checked));
checkboxes.train.addEventListener('change', (e) => toggleLayer(routeTypes.train, e.target.checked));
checkboxes.ferry.addEventListener('change', (e) => toggleLayer(routeTypes.ferry, e.target.checked));
checkboxes.other.addEventListener('change', (e) => toggleLayer('other', e.target.checked));

function toggleLayer(type, isVisible) {
    const layer = layerGroups[type];
    if (isVisible) {
        map.addLayer(layer);
    } else {
        map.removeLayer(layer);
    }
}


// --- Initial Data Fetch: Get Static Route Info ---
async function fetchStaticRoutes() {
    // We now use the atApiKey variable from the global scope
    try {
        const response = await fetch(routesApiUrl, {
            headers: { 'Ocp-Apim-Subscription-Key': atApiKey }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch routes: ${response.status}`);
        }
        const data = await response.json();
        
        // Store route data in the global 'routes' object for quick lookup
        data.response.forEach(route => {
            routes[route.route_id] = route;
        });

        console.log("Static routes fetched:", Object.keys(routes).length);
        
        // Once static data is loaded, start the real-time loop
        fetchVehicleData();
        setInterval(fetchVehicleData, 30000);

    } catch (error) {
        console.error("Error fetching static route data:", error);
    }
}


// --- Main Loop: Fetch and Display Real-time Vehicle Data ---
async function fetchVehicleData() {
    // We now use the atApiKey variable from the global scope
    try {
        const response = await fetch(vehicleApiUrl, {
            headers: { 'Ocp-Apim-Subscription-Key': atApiKey }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch vehicles: ${response.status}`);
        }
        const data = await response.json();

        // Clear existing markers from all layer groups
        for (const key in layerGroups) {
            layerGroups[key].clearLayers();
        }

        data.entity.forEach(entity => {
            // Check if the entity is a vehicle position
            if (entity.vehicle) {
                const vehicleInfo = entity.vehicle;
                const tripInfo = vehicleInfo.trip;
                
                const lat = vehicleInfo.position.latitude;
                const lng = vehicleInfo.position.longitude;
                
                const routeId = tripInfo?.route_id;
                const route = routes[routeId];
                
                let targetLayer;
                let dotClass;
                
                // Check if route data is available and determine vehicle type
                if (route) {
                    const routeType = route.route_type;
                    if (routeType === routeTypes.bus) {
                        dotClass = 'bus-dot';
                        targetLayer = layerGroups[routeTypes.bus];
                    } else if (routeType === routeTypes.train) {
                        dotClass = 'train-dot';
                        targetLayer = layerGroups[routeTypes.train];
                    } else if (routeType === routeTypes.ferry) {
                        dotClass = 'ferry-dot';
                        targetLayer = layerGroups[routeTypes.ferry];
                    } else {
                        dotClass = 'not-in-service-dot';
                        targetLayer = layerGroups.other;
                    }
                } else {
                    // If no route info, assume it's an "other" vehicle
                    dotClass = 'not-in-service-dot';
                    targetLayer = layerGroups.other;
                }
    
                // Create a custom dot marker
                const dotIcon = L.divIcon({ className: `vehicle-dot ${dotClass}` });
    
                // Create a pop-up with all the vehicle details
                const speed = vehicleInfo.position.speed ? `${Math.round(vehicleInfo.position.speed * 3.6)} km/h` : 'N/A';
                const routeName = route ? route.route_long_name : 'Unknown';
    
                const popupContent = `
                    <b>Route:</b> ${routeName}<br>
                    <b>Route ID:</b> ${routeId || 'N/A'}<br>
                    <b>Speed:</b> ${speed}<br>
                    <b>License:</b> ${vehicleInfo.vehicle?.license_plate || 'N/A'}
                `;
    
                // Create and add the marker to the correct layer
                const marker = L.marker([lat, lng], { icon: dotIcon })
                    .bindPopup(popupContent);
                
                marker.addTo(targetLayer);
            }
        });

    } catch (error) {
        console.error("Error fetching vehicle data:", error);
    }
}

// Start the process by fetching static routes first
fetchStaticRoutes();
