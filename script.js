// Version 3.2
// --- API Endpoints ---
// Using a proxy to hide the API key.
// The proxy will be deployed to a serverless function.
const realtimeUrl = "/api/realtime";
const routesUrl = "/api/routes";
const tripsUrl = "/api/trips";

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

function toggleLayer(type, visible) {
    if (visible) map.addLayer(layerGroups[type]);
    else map.removeLayer(layerGroups[type]);
}

// Vehicle colours based on GTFS route type
const vehicleColors = {
    3: "#007bff", // bus
    2: "#dc3545", // train
    4: "#ffc107", // ferry
    default: "#6c757d" // other/unknown
};

// Occupancy status labels
const occupancyLabels = {
    0: "Empty",
    1: "Many Seats Available",
    2: "Few Seats Available",
    3: "Standing Room Only",
    4: "Crushed Standing Room Only",
    5: "Full",
    6: "Not Accepting Passengers"
};

// Custom SVG icon for vehicles
const getVehicleIcon = (color) => L.divIcon({
    className: 'vehicle-icon',
    html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// --- Helper functions for fetching API data with caching ---
async function fetchRouteById(routeId) {
    if (routes[routeId]) {
        return routes[routeId];
    }
    
    try {
        const res = await fetch(`${routesUrl}/${routeId}`);
        if (!res.ok) {
            console.error(`Failed to fetch route ${routeId}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        const routeData = json.data?.attributes;

        if (routeData) {
            routes[routeId] = routeData;
            return routeData;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching route ${routeId}:`, err);
        return null;
    }
}

async function fetchTripById(tripId) {
    if (trips[tripId]) {
        return trips[tripId];
    }

    try {
        const res = await fetch(`${tripsUrl}/${tripId}`);
        if (!res.ok) {
            console.error(`Failed to fetch trip ${tripId}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        const tripData = json.data?.attributes;

        if (tripData) {
            trips[tripId] = tripData;
            return tripData;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching trip ${tripId}:`, err);
        return null;
    }
}

// --- Main Loop: Fetch and Display Real-time Vehicle Data ---
async function fetchVehicles() {
    try {
        const res = await fetch(realtimeUrl);
        if (!res.ok) {
            throw new Error(`Failed to fetch vehicles: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        const vehicles = json.response.entity || [];
        const newVehicleIds = new Set();
        
        const dataPromises = vehicles.map(v => {
            const vehicleId = v.vehicle?.vehicle?.id;
            const routeId = v.vehicle?.trip?.route_id;
            const tripId = v.vehicle?.trip?.trip_id;
            
            return Promise.all([
                routeId ? fetchRouteById(routeId) : null,
                tripId ? fetchTripById(tripId) : null,
                v,
                vehicleId
            ]);
        });

        const results = await Promise.all(dataPromises);

        results.forEach(result => {
            const [routeInfo, tripInfo, v, vehicleId] = result;
            if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
            
            newVehicleIds.add(vehicleId);

            const lat = v.vehicle.position.latitude;
            const lon = v.vehicle.position.longitude;
            const routeId = v.vehicle.trip?.route_id;
            const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
            const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";
            const occupancyStatus = v.vehicle.occupancy_status;
            
            let typeKey = "other";
            let color = vehicleColors.default;
            let routeName = "N/A";
            let destination = "N/A";
            let speed = "N/A";
            const occupancy = occupancyStatus !== undefined ? occupancyLabels[occupancyStatus] || "Unknown" : "N/A";

            // Determine vehicle type, colour and name from GTFS data
            if (routeInfo) {
                const routeType = routeInfo.route_type;
                switch (routeType) {
                    case 3: typeKey = "bus"; color = vehicleColors[3]; break;
                    case 2: typeKey = "train"; color = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
                }
                routeName = routeInfo.route_short_name || "N/A";
            }
            
            // Get destination from trip data
            if (tripInfo) {
                destination = tripInfo.trip_headsign || "N/A";
            }

            // Custom logic for Te Huia train
            if (routeId === "15636") {
                routeName = "Te Huia (Simulated)";
                color = "#e67e22"; // Distinctive orange for Te Huia
            }

            // Sanity check and format speed values
            let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : null;
            if (speedKmh !== null) {
                let maxSpeed = 160; // Default max speed
                if (typeKey === "bus") maxSpeed = 100;
                else if (typeKey === "train") maxSpeed = 120;
                else if (typeKey === "ferry") maxSpeed = 60;
                
                if (speedKmh >= 0 && speedKmh <= maxSpeed) {
                    speed = speedKmh.toFixed(1) + " km/h";
                } else {
                    speed = "N/A";
                }
            }
            
            const popupContent = `
                <b>Route:</b> ${routeName}<br>
                <b>Destination:</b> ${destination}<br>
                <b>Vehicle:</b> ${vehicleLabel}<br>
                <b>Number Plate:</b> ${licensePlate}<br>
                <b>Speed:</b> ${speed}<br>
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
    fetchVehicles();
    setInterval(fetchVehicles, 15000);
})();
