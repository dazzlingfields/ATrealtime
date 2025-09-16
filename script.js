// working v2.4
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
// Using the legacy realtime endpoint for vehicles
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
// Using the static GTFS route data endpoint to get route types
const routesUrl = "https://api.at.govt.nz/v3/gtfs/routes";

// --- Set up the Map ---
const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// --- Global Data Stores and UI Elements ---
const debugBox = document.getElementById("debug");
const routes = {}; // Static route info, indexed by route_id
const vehicleMarkers = {}; // Stores Leaflet markers for updates

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

// Vehicle colors based on GTFS route type
const vehicleColors = {
    3: "#007bff", // bus
    2: "#dc3545", // train
    4: "#ffc107", // ferry
    default: "#6c757d" // other/unknown
};

// --- Initial Data Fetch: Get Static Route Info ---
async function fetchRoutes() {
    try {
        const res = await fetch(routesUrl, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) {
            throw new Error(`Failed to fetch static routes: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        // The v3 endpoint returns an object with a `data` key
        json.data.forEach(route => {
            // Index routes by their route_id for easy lookup
            routes[route.id] = route.attributes;
        });
        console.log("Static routes loaded:", Object.keys(routes).length);
    } catch (err) {
        console.error("Error fetching static routes:", err);
        debugBox.textContent = `Error loading routes: ${err.message}`;
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
        // The legacy endpoint returns an object with a `response` key
        const vehicles = json.response.entity || [];

        // Clear previous markers from all layer groups
        Object.values(layerGroups).forEach(group => group.clearLayers());

        vehicles.forEach(v => {
            if (!v.vehicle || !v.vehicle.position) return;

            const lat = v.vehicle.position.latitude;
            const lon = v.vehicle.position.longitude;
            const trip = v.vehicle.trip || {};
            const routeId = trip.route_id;

            let typeKey = "other";
            let color = vehicleColors.default;
            let routeInfo = routes[routeId];
            let routeName = "Unknown";

            if (routeInfo) {
                // Use route_type from the static data lookup
                const routeType = routeInfo.route_type;
                switch (routeType) {
                    case 3: typeKey = "bus"; color = vehicleColors[3]; break;
                    case 2: typeKey = "train"; color = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
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
            
            // License plate
            const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";

            // Create a custom circle marker with a class for styling
            const marker = L.circleMarker([lat, lon], {
                radius: 6,
                fillColor: color,
                color: "#fff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9
            });

            marker.bindPopup(`
                <b>Route:</b> ${routeName}<br>
                <b>Route ID:</b> ${routeId || "N/A"}<br>
                <b>License Plate:</b> ${licensePlate}<br>
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
    await fetchRoutes();
    // Fetch vehicles immediately and then every 30 seconds
    await fetchVehicles();
    setInterval(fetchVehicles, 30000);
})();
