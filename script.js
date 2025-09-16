// --- working ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
// v2.3
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
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
async function fetchVehicles() {
    try {
        const res = await fetch(realtimeUrl, {
            headers: { "Ocp-Apim-Subscription-Key": atApiKey }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const vehicles = json.response.entity || [];

        // Clear previous markers
        Object.values(layerGroups).forEach(group => group.clearLayers());

        vehicles.forEach(v => {
            if (!v.vehicle || !v.vehicle.position) return;

            const lat = v.vehicle.position.latitude;
            const lon = v.vehicle.position.longitude;
            const trip = v.vehicle.trip || {};
            const routeId = trip.route_id;
            // NEW LINE - Add this
            const routeInfo = Object.values(routes).find(r => routeId && r.route_short_name && routeId.startsWith(r.route_short_name));
            const routeName = routeInfo
                ? `${routeInfo.route_short_name || ""} ${routeInfo.route_long_name || ""}`.trim()
                : "Unknown";

            const licensePlate = v.vehicle.vehicle.license_plate || "N/A";

            // Operator code
            const operator = v.vehicle.vehicle.operator_code || "";
            const vehicleId = `${operator} ${v.vehicle.vehicle.id}`;

            // Determine vehicle type
            let typeKey = "other";
            let color = vehicleColors.default;

            if (routeInfo && routeInfo.route_type != null) {
                switch (routeInfo.route_type) {
                    case 3: typeKey = "bus"; color = vehicleColors[3]; break;
                    case 2: typeKey = "train"; color = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
                    default: typeKey = "other"; color = vehicleColors.default;
                }
            } else if (trip && trip.vehicle_type != null) {
                switch (trip.vehicle_type) {
                    case 3: typeKey = "bus"; color = vehicleColors[3]; break;
                    case 2: typeKey = "train"; color = vehicleColors[2]; break;
                    case 4: typeKey = "ferry"; color = vehicleColors[4]; break;
                }
            }

            // Speed conversion and clamping
            let speedKmh = v.vehicle.position.speed ? v.vehicle.position.speed * 3.6 : null;

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
            vehicleMarkers[v.vehicle.vehicle.id] = marker;
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






