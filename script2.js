// --- working ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
// v2.3 - UPDATED URL
const realtimeUrl = "https://api.at.govt.nz/v2/realtime/vehiclelocations"; 
const routesUrl = "https://api.at.govt.nz/v3/gtfs/routes";

const map = L.map("map").setView([-36.8485, 174.7633], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const debugBox = document.getElementById("debug");
const routes = {}; // Static route info
const vehicleMarkers = {};

// LayerGroups for each vehicle type
const layerGroups = {
    bus: L.layerGroup().addTo(map),
    train: L.layerGroup().addTo(map),
    ferry: L.layerGroup().addTo(map),
    other: L.layerGroup().addTo(map)
};

// Checkbox handlers
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(type, visible) {
    if (visible) map.addLayer(layerGroups[type]);
    else map.removeLayer(layerGroups[type]);
}

// Vehicle colors
const vehicleColors = {
    3: "#007bff", // bus
    2: "#dc3545", // train
    4: "#ffc107", // ferry
    default: "#6c757d" // other/unknown
};

// Fetch static route info
async function fetchRoutes() {
    try {
        const res = await fetch(routesUrl, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        json.data.forEach(r => routes[r.id] = r.attributes);
        console.log("Routes loaded:", Object.keys(routes).length);
    } catch (err) {
        console.error("Error fetching routes:", err);
        debugBox.textContent = `Error loading routes: ${err.message}`;
    }
}

// Fetch realtime vehicles
// Fetch realtime vehicles
async function fetchVehicles() {
    try {
        const res = await fetch(realtimeUrl, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // The modern API uses json.data instead of json.response.entity
        const vehicles = json.data || []; 

        // Clear previous markers
        Object.values(layerGroups).forEach(group => group.clearLayers());

        vehicles.forEach(v => {
            // Data is now inside an 'attributes' object
            const vehicleData = v.attributes; 
            if (!vehicleData || !vehicleData.position) return;

            const lat = vehicleData.position.latitude;
            const lon = vehicleData.position.longitude;
            const trip = vehicleData.trip || {};
            const routeId = trip.route_id;
            const routeInfo = routes[routeId];
            const routeName = routeInfo
                ? `${routeInfo.route_short_name || ""} ${routeInfo.route_long_name || ""}`.trim()
                : "Unknown";

            const licensePlate = vehicleData.vehicle.license_plate || "N/A";

            // Operator code might not be available in the same way, let's build a robust ID
            const vehicleId = vehicleData.vehicle.id || "N/A";

            // Determine vehicle type
            let typeKey = "other";
            let color = vehicleColors.default;

            // This logic should now work correctly as routeInfo will be found
            if (routeInfo && routeInfo.route_type != null) {
                switch (routeInfo.route_type) {
                    case 3: typeKey = "bus"; color = vehicleColors[3]; break;
                    case 2: typeKey = "train"; color = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
                    default: typeKey = "other"; color = vehicleColors.default;
                }
            }

            // Speed conversion and clamping
            let speedKmh = vehicleData.position.speed ? vehicleData.position.speed * 3.6 : null;

            if (speedKmh !== null) {
                switch (typeKey) {
                    case "bus":
                        if (speedKmh < 0 || speedKmh > 100) speedKmh = null;
                        break;
                    case "train":
                        if (speedKmh < 0 || speedKmh > 120) speedKmh = null;
                        break;
                    case "ferry":
                        if (speedKmh < 0 || speedKmh > 60) speedKmh = null;
                        break;
                    default:
                        if (speedKmh < 0 || speedKmh > 160) speedKmh = null;
                }
            }

            const speed = speedKmh !== null ? speedKmh.toFixed(1) + " km/h" : "N/A";

            // Create marker
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
                <b>Vehicle ID:</b> ${vehicleId}<br>
                <b>License Plate:</b> ${licensePlate}<br>
                <b>Speed:</b> ${speed}
            `);

            marker.addTo(layerGroups[typeKey]);
            vehicleMarkers[vehicleData.vehicle.id] = marker;
        });

        debugBox.textContent = `Last update: ${new Date().toLocaleTimeString()} | Vehicles: ${vehicles.length}`;
    } catch (err) {
        console.error("Error fetching vehicles:", err);
        debugBox.textContent = `Error loading vehicles: ${err.message}`;
    }
}

// Initialize map
(async function init() {
    await fetchRoutes();
    await fetchVehicles();
    setInterval(fetchVehicles, 30000);
})();




