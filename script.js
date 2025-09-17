// Version 1.2
// --- API Key and Endpoints ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
const routesUrl = "https://api.at.govt.nz/gtfs/v3/routes";
const tripsUrl = "https://api.at.govt.nz/gtfs/v3/trips";
const shapesUrl = "https://api.at.govt.nz/gtfs/v3/shapes";

// --- Set up the Map ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);

// Define the different base maps
const baseMaps = {
    streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    })
};

// Set the default map layer
baseMaps.light.addTo(map);

// --- Global Data Stores and UI Elements ---
const debugBox = document.getElementById("debug");
const routes = {}; // Cache for static route info, indexed by route_short_name
const trips = {}; // Cache for static trip info, indexed by trip_id
const shapes = {}; // Cache for shape data, indexed by shape_id

// LayerGroups for each vehicle type
const layerGroups = {
    bus: L.layerGroup().addTo(map),
    train: L.layerGroup().addTo(map),
    ferry: L.layerGroup().addTo(map),
    other: L.layerGroup().addTo(map)
};

// Layer group for train lines
const trainLinesLayerGroup = L.layerGroup().addTo(map);

// Checkbox handlers to toggle layers
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

// Base map selector handler
document.getElementById("base-map-selector").addEventListener("change", e => {
    // Remove all current layers
    for (const key in baseMaps) {
        if (map.hasLayer(baseMaps[key])) {
            map.removeLayer(baseMaps[key]);
        }
    }
    // Add the new selected layer
    baseMaps[e.target.value].addTo(map);
});

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

// --- Helper functions for fetching API data with caching ---
async function fetchRouteByShortName(routeShortName) {
    if (routes[routeShortName]) {
        return routes[routeShortName];
    }
    
    try {
        const res = await fetch(`${routesUrl}?filter[route_short_name]=${routeShortName}`, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            console.error(`Failed to fetch route ${routeShortName}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        const routeData = json.data && json.data.length > 0 ? json.data[0].attributes : null;

        if (routeData) {
            routes[routeShortName] = routeData;
            return routeData;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching route ${routeShortName}:`, err);
        return null;
    }
}

async function fetchTripById(tripId) {
    if (trips[tripId]) {
        return trips[tripId];
    }

    try {
        const res = await fetch(`${tripsUrl}/${tripId}`, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            console.error(`Failed to fetch trip ${tripId}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        const tripData = json.data ? json.data.attributes : null;

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

async function fetchTrainLines() {
    if (Object.keys(shapes).length > 0) return; // Only fetch once
    try {
        const res = await fetch(`${shapesUrl}?filter[route_type]=2`, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            console.error(`Failed to fetch train shapes: ${res.status} ${res.statusText}`);
            return;
        }
        const json = await res.json();
        const shapeData = json.data || [];
        
        // Group points by shape_id
        shapeData.forEach(shape => {
            const shapeId = shape.attributes.shape_id;
            const lat = shape.attributes.shape_pt_lat;
            const lon = shape.attributes.shape_pt_lon;
            const sequence = shape.attributes.shape_pt_sequence;

            if (!shapes[shapeId]) {
                shapes[shapeId] = [];
            }
            shapes[shapeId].push([lat, lon, sequence]);
        });
        
        // Draw the lines
        for (const shapeId in shapes) {
            const points = shapes[shapeId].sort((a, b) => a[2] - b[2]).map(p => [p[0], p[1]]);
            L.polyline(points, {
                color: '#8b0000', // Dark red for train lines
                weight: 3,
                opacity: 0.7
            }).addTo(trainLinesLayerGroup);
        }

    } catch (err) {
        console.error(`Error fetching train lines:`, err);
    }
}

// --- Main Loop: Fetch and Display Real-time Vehicle Data ---
async function fetchVehicles() {
    try {
        const res = await fetch(realtimeUrl, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            throw new Error(`Failed to fetch vehicles: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        const vehicles = json.response.entity || [];

        // Clear previous markers from all layer groups
        Object.values(layerGroups).forEach(group => group.clearLayers());
        
        // Use a Set to store promises for routes we've already requested in this loop
        const requestedRoutes = new Set();
        const dataPromises = vehicles.map(v => {
            const routeId = v.vehicle?.trip?.route_id;
            const tripId = v.vehicle?.trip?.trip_id;

            // Robust logic to extract route short name
            const routeShortNameMatch = routeId?.match(/^([a-zA-Z0-9]+)/);
            const routeShortName = routeShortNameMatch ? routeShortNameMatch[1] : null;

            // Only fetch the route if we haven't already requested it this cycle
            const routePromise = routeShortName && !requestedRoutes.has(routeShortName)
                ? fetchRouteByShortName(routeShortName).finally(() => requestedRoutes.add(routeShortName))
                : Promise.resolve(routes[routeShortName] || null);
            
            return Promise.all([
                routePromise,
                tripId ? fetchTripById(tripId) : null,
            ]);
        });

        const results = await Promise.all(dataPromises);

        vehicles.forEach((v, index) => {
            if (!v.vehicle || !v.vehicle.position) return;

            const lat = v.vehicle.position.latitude;
            const lon = v.vehicle.position.longitude;
            const trip = v.vehicle.trip || {};
            const routeId = trip.route_id;

            const [routeInfo, tripInfo] = results[index];
            // Extract the route short name for the pop-up
            const routeShortName = (routeId?.match(/^([a-zA-Z0-9]+)/) || [])[1];

            let typeKey = "other";
            let colour = vehicleColors.default;
            let routeName = "Unknown";
            
            // New, more robust logic for vehicle classification and status
            if (routeInfo) {
                // Primary classification: Vehicle is in service, use GTFS data
                const routeType = routeInfo.route_type;
                switch (routeType) {
                    case 3: typeKey = "bus"; colour = vehicleColors[3]; break;
                    case 2: typeKey = "train"; colour = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; colour = vehicleColors[4]; break;
                }
                routeName = `${routeInfo.route_short_name || ""} ${routeInfo.route_long_name || ""}`.trim();

            } else if (trip.trip_id) {
                // Fallback classification: In service but GTFS route data is missing
                const vehicleId = v.vehicle.vehicle?.label || "N/A";
                const operatorPrefix = (vehicleId !== "N/A") ? vehicleId.match(/^[a-zA-Z]+/) : null;
                const busPrefixes = ["RT", "GB", "PC", "NB", "HE", "TR"];
                const trainPrefixes = ["AD", "AM", "STH", "WST", "EST", "PAPT"]; 

                if (operatorPrefix && busPrefixes.includes(operatorPrefix[0])) {
                    typeKey = "bus";
                    colour = vehicleColors[3];
                } else if (operatorPrefix && trainPrefixes.includes(operatorPrefix[0])) {
                    typeKey = "train";
                    colour = vehicleColors[2];
                }
                // The route name will be "Unknown" but the vehicle will be colored correctly.
                routeName = tripInfo?.trip_headsign || "Unknown";

            } else {
                // Truly "Out of Service" or unassigned vehicle
                routeName = "Out of Service";
                // typeKey remains "other" and colour remains default grey.
            }
            
            // Speed conversion and clamping (same logic as before)
            let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : null;
            if (speedKmh !== null) {
                if (typeKey === "bus" && (speedKmh < 0 || speedKmh > 100)) speedKmh = null;
                else if (typeKey === "train" && (speedKmh < 0 || speedKmh > 120)) speedKmh = null;
                else if (typeKey === "ferry" && (speedKmh < 0 || speedKmh > 60)) speedKmh = null;
                else if (speedKmh < 0 || speedKmh > 160) speedKmh = null; // General clamp
            }
            const speed = speedKmh !== null ? speedKmh.toFixed(1) + " km/h" : "N/A";
            
            const marker = L.circleMarker([lat, lon], {
                radius: 6,
                fillColor: colour,
                color: "#fff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9
            });

            marker.bindPopup(`
                <b>Legacy Route ID:</b> ${routeId || "N/A"}<br>
                <b>Attempted Route Short Name:</b> ${routeShortName || "N/A"}<br>
                <b>Received Route Type:</b> ${routeInfo?.route_type || "N/A"}<br>
                <b>Route:</b> ${routeName}<br>
                <b>Destination:</b> ${tripInfo?.trip_headsign || "N/A"}<br>
                <b>Vehicle:</b> ${v.vehicle.vehicle?.label || "N/A"}<br>
                <b>Speed:</b> ${speed}
            `);

            marker.addTo(layerGroups[typeKey]);
        });

        debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
    } catch (err) {
        console.error("Error fetching vehicles:", err);
        debugBox.textContent = `Error loading vehicles: ${err.message}`;
    }
}

// Initialize the application
(async function init() {
    await fetchTrainLines(); // Fetch and draw the lines once
    await fetchVehicles();
    setInterval(fetchVehicles, 30000);
})();
