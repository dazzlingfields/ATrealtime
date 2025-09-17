// Version 3.2
// --- API Endpoints ---
// Using a proxy to hide the API key.
// The proxy will be deployed to a serverless function.
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl = `${proxyBaseUrl}/api/routes`;
const tripsUrl = `${proxyBaseUrl}/api/trips`;

// --- Set up the Map ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// --- Global Data Stores and UI Elements ---
const debugBox = document.getElementById("debug");
const routes = {}; // Cache for static route info, indexed by route_id
const trips = {}; // Cache for static trip info, indexed by trip_id
const vehicleMarkers = {}; // Store markers to update them smoothly

// LayerGroups for each vehicle type
const layerGroups = {
    bus: L.layerGroup().addTo(map),
    train: L.layerGroup().addTo(map),
    ferry: L.layerGroup().addTo(map),
    other: L.layerGroup().addTo(map)
};

// Checkbox handlers to toggle layers
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(layerKey, isVisible) {
    if (isVisible) {
        map.addLayer(layerGroups[layerKey]);
    } else {
        map.removeLayer(layerGroups[layerKey]);
    }
}

// --- Helper Functions ---
function getVehicleIcon(color) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>
                <path d="M12 6L12 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
                <path d="M9 9L12 6L15 9" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
              </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
}

async function fetchRouteById(routeId) {
    if (routes[routeId]) return routes[routeId];
    try {
        const response = await fetch(`${routesUrl}?route_id=${routeId}`);
        const data = await response.json();
        if (data.length > 0) {
            routes[routeId] = data[0];
            return data[0];
        }
    } catch (err) {
        console.error(`Error fetching route ${routeId}:`, err);
    }
    return null;
}

async function fetchTripById(tripId) {
    if (trips[tripId]) return trips[tripId];
    try {
        const response = await fetch(`${tripsUrl}?trip_id=${tripId}`);
        const data = await response.json();
        if (data.length > 0) {
            trips[tripId] = data[0];
            return data[0];
        }
    } catch (err) {
        console.error(`Error fetching trip ${tripId}:`, err);
    }
    return null;
}

// --- Main Logic ---
async function fetchVehicles() {
    try {
        const response = await fetch(realtimeUrl);
        const { vehicles } = await response.json();
        const newVehicleIds = new Set();
        
        vehicles.forEach(vehicle => {
            const vehicleId = vehicle.id;
            const { lat, lon, bearing, route_id, trip_id, occupancy_status, speed } = vehicle.position;
            const { service_type } = vehicle;
            
            newVehicleIds.add(vehicleId);

            let color = '#ccc';
            let typeKey = 'other';
            let occupancy = 'Not available';

            if (service_type === 'bus') {
                typeKey = 'bus';
                color = '#007bff';
            } else if (service_type === 'train') {
                typeKey = 'train';
                color = '#28a745';
            } else if (service_type === 'ferry') {
                typeKey = 'ferry';
                color = '#dc3545';
            }

            switch (occupancy_status) {
                case 'EMPTY': occupancy = 'Empty'; break;
                case 'MANY_SEATS_AVAILABLE': occupancy = 'Many seats available'; break;
                case 'FEW_SEATS_AVAILABLE': occupancy = 'Few seats available'; break;
                case 'STANDING_ROOM_ONLY': occupancy = 'Standing room only'; break;
                case 'CRUSHED_STANDING_ROOM_ONLY': occupancy = 'Full'; break;
                case 'FULL': occupancy = 'Full'; break;
            }

            const speedKmh = speed ? (speed * 3.6).toFixed(1) : 'N/A';
            const popupContent = `
                <b>Vehicle:</b> ${vehicleId}<br/>
                <b>Speed:</b> ${speedKmh} km/h<br/>
                <b>Bearing:</b> ${bearing}°<br/>
                <b>Type:</b> ${service_type.charAt(0).toUpperCase() + service_type.slice(1)}<br/>
                <b>Occupancy:</b> ${occupancy}
            `;
            
            if (vehicleMarkers[vehicleId]) {
                // Update existing marker position and popup
                vehicleMarkers[vehicleId].setLatLng([lat, lon]);
                vehicleMarkers[vehicleId].setPopupContent(popupContent);
                vehicleMarkers[vehicleId].setIcon(getVehicleIcon(color));
            } else {
                // Create a new marker
                const newMarker = L.marker([lat, lon], {
                    icon: getVehicleIcon(color)
                });
                newMarker.bindPopup(popupContent);
                newMarker.addTo(layerGroups[typeKey]);
                vehicleMarkers[vehicleId] = newMarker;
            }
        });
        
        // Remove markers for vehicles no longer in the feed
        Object.keys(vehicleMarkers).forEach(id => {
            if (!newVehicleIds.has(id)) {
                map.removeLayer(vehicleMarkers[id]);
                delete vehicleMarkers[id];
            }
        });

        debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
    } catch (err) {
        console.error("Error fetching vehicles:", err);
        debugBox.textContent = `Error loading vehicles: ${err.message}`;
    }
}

// Initial fetch and set interval for updates
(async function init() {
    // FIX: Force Leaflet to recalculate map size after a short delay
    // This is crucial if the map container's size is not immediately available
    // when the script runs (e.g., if it's in a hidden tab or a modal).
    setTimeout(() => {
        map.invalidateSize();
    }, 400);

    fetchVehicles();
    setInterval(fetchVehicles, 15000);
})();
