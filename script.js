// v4.3
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;

let routeData = {};
let tripData = {};
const vehicleMarkers = {}; // Store markers by vehicle ID

// Global layers for each vehicle type
const busLayer = L.layerGroup();
const trainLayer = L.layerGroup();
const ferryLayer = L.layerGroup();
const outOfServiceLayer = L.layerGroup();

// Object to hold all layers
const vehicleLayers = {
    'bus': busLayer,
    'train': trainLayer,
    'ferry': ferryLayer,
    'outOfService': outOfServiceLayer,
};

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

// Define coloured circle icons
function getIconForVehicle(serviceType, isOutOfService) {
    const colours = {
        'bus': 'blue',
        'train': 'green',
        'ferry': 'red',
    };
    const color = isOutOfService ? 'grey' : colours[serviceType] || 'black';

    return L.divIcon({
        className: 'vehicle-icon',
        html: `<div style="background: ${color}; width:10px; height:10px; border:2px solid white; border-radius:5px;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

// Fetch and render vehicle data
async function fetchVehicles() {
    const statusDisplay = document.getElementById('status-display');
    statusDisplay.textContent = 'Updating...';

    try {
        const response = await fetch(realtimeUrl);
        const data = await response.json();
        renderVehicles(data);
        const now = new Date();
        statusDisplay.textContent = `Last update: ${now.toLocaleTimeString()}`;
    } catch (err) {
        console.error("fetchVehicles error:", err);
        statusDisplay.textContent = 'Connection Error';
    }
}

// Render real-time vehicles
function renderVehicles(data) {
    const newIds = new Set();
    
    data.forEach(vehicle => {
        const vehicleId = vehicle.vehicle?.id;
        if (!vehicleId || !vehicle.vehicle?.position) return;
        newIds.add(vehicleId);

        const lat = vehicle.vehicle.position.latitude;
        const lon = vehicle.vehicle.position.longitude;
        const speed = vehicle.vehicle.position.speed ? (vehicle.vehicle.position.speed * 3.6).toFixed(1) : 'N/A';
        const isOutOfService = vehicle.vehicle.current_status === "IN_TRANSIT_TO";
        const serviceType = vehicle.trip.service_type;
        const destination = vehicle.trip.headsign || 'N/A';
        const occupancyStatus = occupancyStatusMap[vehicle.vehicle.occupancy_status] || 'No data available';
        const vehicleLabel = vehicle.vehicle.label || 'N/A';
        
        // Get the route short name
        const tripInfo = tripData[vehicle.trip.trip_id];
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
            // Update existing marker
            vehicleMarkers[vehicleId].setLatLng([lat, lon]).setPopupContent(popupContent);
        } else {
            // Create new marker
            const marker = L.marker([lat, lon], { icon: icon }).bindPopup(popupContent);
            vehicleMarkers[vehicleId] = marker;
            
            if (isOutOfService) {
                outOfServiceLayer.addLayer(marker);
            } else {
                switch (serviceType) {
                    case 'bus':
                        busLayer.addLayer(marker);
                        break;
                    case 'train':
                        trainLayer.addLayer(marker);
                        break;
                    case 'ferry':
                        ferryLayer.addLayer(marker);
                        break;
                }
            }
        }
    });

    // Remove markers that are no longer in the data feed
    for (const id in vehicleMarkers) {
        if (!newIds.has(id)) {
            Object.values(vehicleLayers).forEach(layer => layer.removeLayer(vehicleMarkers[id]));
            delete vehicleMarkers[id];
        }
    }

    updateVehicleDisplay();
}

// Function to control layer visibility based on checkbox state
function updateVehicleDisplay() {
    const busCheckbox = document.getElementById('bus-checkbox');
    const trainCheckbox = document.getElementById('train-checkbox');
    const ferryCheckbox = document.getElementById('ferry-checkbox');
    const outOfServiceCheckbox = document.getElementById('outofservice-checkbox');

    if (busCheckbox.checked) {
        busLayer.addTo(map);
    } else {
        map.removeLayer(busLayer);
    }

    if (trainCheckbox.checked) {
        trainLayer.addTo(map);
    } else {
        map.removeLayer(trainLayer);
    }

    if (ferryCheckbox.checked) {
        ferryLayer.addTo(map);
    } else {
        map.removeLayer(ferryLayer);
    }

    if (outOfServiceCheckbox.checked) {
        outOfServiceLayer.addTo(map);
    } else {
        map.removeLayer(outOfServiceLayer);
    }
}

// Initial data fetching and map setup
let map;
function initializeMap() {
    // Fetch static data first
    fetch(routesUrl).then(res => res.json()).then(data => {
        data.forEach(route => routeData[route.route_id] = route);
    }).catch(err => console.error("Error fetching routes data:", err));

    fetch(tripsUrl).then(res => res.json()).then(data => {
        data.forEach(trip => tripData[trip.trip_id] = trip);
    }).catch(err => console.error("Error fetching trips data:", err));

    // Define base map layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com/attributions">CartoDB</a>'
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });
    
    // Initialize the map with the default light layer
    map = L.map('map').setView([-36.85, 174.76], 12);
    osmLayer.addTo(map);
    
    // Add vehicle layers to the map
    busLayer.addTo(map);
    trainLayer.addTo(map);
    ferryLayer.addTo(map);
    outOfServiceLayer.addTo(map);

    // Event listeners for base map radio buttons
    document.getElementById('light-map').addEventListener('change', () => {
        map.removeLayer(darkLayer);
        map.removeLayer(satelliteLayer);
        osmLayer.addTo(map);
    });
    document.getElementById('dark-map').addEventListener('change', () => {
        map.removeLayer(osmLayer);
        map.removeLayer(satelliteLayer);
        darkLayer.addTo(map);
    });
    document.getElementById('satellite-map').addEventListener('change', () => {
        map.removeLayer(osmLayer);
        map.removeLayer(darkLayer);
        satelliteLayer.addTo(map);
    });

    // Add event listeners for vehicle checkboxes
    document.getElementById('bus-checkbox').addEventListener('change', updateVehicleDisplay);
    document.getElementById('train-checkbox').addEventListener('change', updateVehicleDisplay);
    document.getElementById('ferry-checkbox').addEventListener('change', updateVehicleDisplay);
    document.getElementById('outofservice-checkbox').addEventListener('change', updateVehicleDisplay);

    // Initial fetch and render of all data
    fetchVehicles();

    // Update vehicle positions every 30 seconds
    setInterval(fetchVehicles, 30000);

     // Initialise the Te Huia simulation
    initializeTeHuiaSim(map, teHuiaLayer);
}

initializeMap();

