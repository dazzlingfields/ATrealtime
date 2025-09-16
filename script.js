// v1.3 updated
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
const routesUrl = "https://api.at.govt.nz/gtfs/v3/routes"; 

// --- Set up the Map ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// --- Global Data Stores and UI Elements ---
const debugBox = document.getElementById("debug");
const routes = {}; // Cache for static route info, indexed by route_short_name

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

// --- Helper function to fetch a single route by its short name (with caching) ---
async function fetchRouteByShortName(routeShortName) {
    // Return cached route if available
    if (routes[routeShortName]) {
        return routes[routeShortName];
    }
    
    try {
        const res = await fetch(`${routesUrl}?filter[route_short_name]=${routeShortName}`, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            // Log the error but don't stop the loop
            console.error(`Failed to fetch route ${routeShortName}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        // The v3 endpoint returns an object with a `data` key that is an array
        const routeData = json.data && json.data.length > 0 ? json.data[0].attributes : null;

        if (routeData) {
            // Store the fetched route data in the cache
            routes[routeShortName] = routeData;
            return routeData;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching route ${routeShortName}:`, err);
        return null;
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
        
        // Use Promise.all to fetch route data for all vehicles concurrently
        const routePromises = vehicles.map(v => {
            const routeId = v.vehicle?.trip?.route_id;
            // The route_id often contains the short name, but can also be just a number.
            // We use a regex to handle both cases gracefully.
            const routeShortNameMatch = routeId?.match(/([a-zA-Z0-9-]+)/);
            const routeShortName = routeShortNameMatch ? routeShortNameMatch[1] : null;

            return routeShortName ? fetchRouteByShortName(routeShortName) : null;
        });

        const routeDataArray = await Promise.all(routePromises);

        vehicles.forEach((v, index) => {
            if (!v.vehicle || !v.vehicle.position) return;

            const lat = v.vehicle.position.latitude;
            const lon = v.vehicle.position.longitude;
            const trip = v.vehicle.trip || {};
            const routeId = trip.route_id;
            const routeInfo = routeDataArray[index];
            
            // Extract the route short name for the pop-up
            const routeShortName = (routeId?.match(/([a-zA-Z0-9-]+)/) || [])[1];

            let typeKey = "other";
            let colour = vehicleColors.default;
            let routeName = "Unknown";
            
            if (routeInfo) {
                const routeType = routeInfo.route_type;
                switch (routeType) {
                    case 3: typeKey = "bus"; colour = vehicleColors[3]; break;
                    case 2: typeKey = "train"; colour = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; colour = vehicleColors[4]; break;
                }
                routeName = `${routeInfo.route_short_name || ""} ${routeInfo.route_long_name || ""}`.trim();
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
            
            // Vehicle label and operator prefix
            const vehicleId = v.vehicle.vehicle?.label || "N/A";
            const operatorPrefix = (vehicleId !== "N/A") ? vehicleId.match(/^[a-zA-Z]+/) : null;

            // Create a custom circle marker with a class for styling
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
                <b>Operator Prefix:</b> ${operatorPrefix || "N/A"}<br>
                <b>Vehicle:</b> ${vehicleId}<br>
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
    // Start the real-time loop immediately
    await fetchVehicles();
    setInterval(fetchVehicles, 30000);
})();
