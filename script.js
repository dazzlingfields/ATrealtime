// Replace with your AT API key
const API_KEY = "YOUR_AT_API_KEY";

// v3 endpoints
const VEHICLE_API_URL = "https://api.at.govt.nz/v3/public/realtime/vehiclelocations";
const ROUTES_API_URL = "https://api.at.govt.nz/v3/gtfs/routes";

const map = L.map("map").setView([-36.8485, 174.7633], 13); // Auckland

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markers = {};
let routesData = {};

async function fetchRoutes() {
    try {
        const res = await fetch(ROUTES_API_URL, {
            headers: { "Ocp-Apim-Subscription-Key": API_KEY }
        });
        if (!res.ok) throw new Error("Failed to fetch routes");
        const data = await res.json();
        routesData = data.response.reduce((acc, route) => {
            acc[route.route_id] = route;
            return acc;
        }, {});
    } catch (err) {
        console.error("Error fetching routes:", err);
        document.getElementById("debug").innerText = "Error loading routes";
    }
}

async function fetchVehicles() {
    try {
        const res = await fetch(VEHICLE_API_URL, {
            headers: { "Ocp-Apim-Subscription-Key": API_KEY }
        });
        if (!res.ok) throw new Error("Failed to fetch vehicles");
        const data = await res.json();

        updateVehicles(data.response.entity || []);
    } catch (err) {
        console.error("Error fetching vehicles:", err);
        document.getElementById("debug").innerText = "Error loading vehicles";
    }
}

function getVehicleType(routeId) {
    const route = routesData[routeId];
    if (!route) return "other";

    switch (route.route_type) {
        case 3: return "bus";
        case 2: return "train";
        case 4: return "ferry";
        default: return "other";
    }
}

function updateVehicles(vehicles) {
    const visible = {
        bus: document.getElementById("bus-checkbox").checked,
        train: document.getElementById("train-checkbox").checked,
        ferry: document.getElementById("ferry-checkbox").checked,
        other: document.getElementById("other-checkbox").checked
    };

    vehicles.forEach(entity => {
        const v = entity.vehicle;
        if (!v || !v.position) return;

        const id = v.vehicle.id;
        const lat = v.position.latitude;
        const lon = v.position.longitude;
        const type = getVehicleType(v.trip.route_id);

        if (!visible[type]) {
            if (markers[id]) {
                map.removeLayer(markers[id]);
                delete markers[id];
            }
            return;
        }

        if (!markers[id]) {
            const dot = L.divIcon({
                className: "vehicle-dot " + type + "-dot"
            });
            markers[id] = L.marker([lat, lon], { icon: dot }).addTo(map);
        } else {
            markers[id].setLatLng([lat, lon]);
        }
    });

    document.getElementById("debug").innerText = `Vehicles updated: ${vehicles.length}`;
}

(async function init() {
    await fetchRoutes();
    await fetchVehicles();
    setInterval(fetchVehicles, 15000); // refresh every 15s
})();
