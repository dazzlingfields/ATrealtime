// Version 2.7
// --- API Key and Endpoints ---
const atApiKey = "18e2ee8ee75d4e6ca7bd446ffa9bd50f";
const realtimeUrl = "https://api.at.govt.nz/realtime/legacy";
const routesUrl = "https://api.at.govt.nz/gtfs/v3/routes";
const tripsUrl = "https://api.at.govt.nz/gtfs/v3/trips";
const shapesUrl = "https://api.at.govt.nz/gtfs/v3/shapes";

// --- Set up the Map ---
// Updated the default zoom level from 10 to 12 for a closer view
const map = L.map("map").setView([-36.8485, 174.7633], 12);

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
const parsedBusitData = {}; // Store parsed GTFS data for Te Huia

// LayerGroups for each vehicle type
const layerGroups = {
    bus: L.layerGroup().addTo(map),
    train: L.layerGroup().addTo(map),
    ferry: L.layerGroup().addTo(map),
    other: L.layerGroup().addTo(map)
};

// Te Huia line and dot layers, now permanently on
const teHuiaLayerGroup = L.layerGroup().addTo(map);
const teHuiaDotLayerGroup = L.layerGroup().addTo(map);

// Checkbox handlers to toggle layers
document.getElementById("bus-checkbox").addEventListener("change", e => toggleLayer("bus", e.target.checked));
document.getElementById("train-checkbox").addEventListener("change", e => toggleLayer("train", e.target.checked));
document.getElementById("ferry-checkbox").addEventListener("change", e => toggleLayer("ferry", e.target.checked));
document.getElementById("other-checkbox").addEventListener("change", e => toggleLayer("other", e.target.checked));

function toggleLayer(type, visible) {
    if (visible) map.addLayer(layerGroups[type]);
    else map.removeLayer(layerGroups[type]);
}

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

// Function to parse a CSV file and return an array of objects
async function parseCSV(url) {
    const response = await fetch(url);
    const text = await response.text();
    const [header, ...rows] = text.trim().split('\n').map(row => row.split(','));
    
    return rows.map(row => {
        const obj = {};
        header.forEach((key, i) => {
            obj[key.trim()] = row[i]?.trim().replace(/^"|"$/g, '') || '';
        });
        return obj;
    });
}

// Function to fetch and draw Te Huia lines from the uploaded GTFS data
async function drawTeHuiaLines() {
    // Check if the lines have already been drawn
    if (teHuiaLayerGroup.getLayers().length > 0) return;

    try {
        const routesData = parsedBusitData.routes;
        const shapesData = parsedBusitData.shapes;
        const tripsData = parsedBusitData.trips;

        // Find the Te Huia route_id
        const teHuiaRoute = routesData.find(r => r.route_short_name === 'HUIA');
        if (!teHuiaRoute) {
            console.log("Te Huia route not found in uploaded data.");
            return;
        }
        const teHuiaRouteId = teHuiaRoute.route_id;

        // Find the shape_ids associated with the Te Huia route
        const teHuiaShapeIds = [...new Set(tripsData
            .filter(t => t.route_id === teHuiaRouteId)
            .map(t => t.shape_id))];

        // Group shape points by shape_id
        const teHuiaShapes = {};
        shapesData.forEach(shape => {
            if (teHuiaShapeIds.includes(shape.shape_id)) {
                if (!teHuiaShapes[shape.shape_id]) {
                    teHuiaShapes[shape.shape_id] = [];
                }
                teHuiaShapes[shape.shape_id].push({
                    lat: parseFloat(shape.shape_pt_lat),
                    lon: parseFloat(shape.shape_pt_lon),
                    seq: parseInt(shape.shape_pt_sequence),
                    dist: parseFloat(shape.shape_dist_traveled)
                });
            }
        });

        // Draw the lines for each Te Huia shape
        for (const shapeId in teHuiaShapes) {
            const points = teHuiaShapes[shapeId]
                .sort((a, b) => a.seq - b.seq)
                .map(p => [p.lat, p.lon]);
            
            L.polyline(points, {
                color: '#000000', // Te Huia is black
                weight: 4,
                opacity: 0.8
            }).addTo(teHuiaLayerGroup);
        }
        console.log(`Successfully drew ${Object.keys(teHuiaShapes).length} Te Huia lines.`);

    } catch (err) {
        console.error(`Error drawing Te Huia lines:`, err);
    }
}

// Function to calculate the position of the Te Huia train based on the timetable
let teHuiaMarker = null;

async function updateTeHuiaDot() {
    const today = new Date();
    const dayOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][today.getDay()];
    const todayYYYYMMDD = today.getFullYear().toString() + (today.getMonth() + 1).toString().padStart(2, '0') + today.getDate().toString().padStart(2, '0');
    
    const calendarData = parsedBusitData.calendar;
    const calendarDatesData = parsedBusitData.calendar_dates;
    const stopTimesData = parsedBusitData.stop_times;
    const tripsData = parsedBusitData.trips;
    const shapesData = parsedBusitData.shapes;
    const stopsData = parsedBusitData.stops;
    
    const teHuiaRouteId = parsedBusitData.routes.find(r => r.route_short_name === 'HUIA')?.route_id;
    if (!teHuiaRouteId) return;

    // 1. Get all active service IDs for today
    const activeServiceIds = calendarData
        .filter(s => s[dayOfWeek] === '1' && s.start_date <= todayYYYYMMDD && s.end_date >= todayYYYYMMDD)
        .map(s => s.service_id);

    // Add services from calendar_dates with exception_type '1' (service added)
    const addedServiceIds = calendarDatesData
        .filter(s => s.date === todayYYYYMMDD && s.exception_type === '1')
        .map(s => s.service_id);
    activeServiceIds.push(...addedServiceIds);

    // Remove services from calendar_dates with exception_type '2' (service removed)
    const removedServiceIds = calendarDatesData
        .filter(s => s.date === todayYYYYMMDD && s.exception_type === '2')
        .map(s => s.service_id);
    const finalActiveServiceIds = activeServiceIds.filter(id => !removedServiceIds.includes(id));
    
    // 2. Find all Te Huia trips for today
    const activeTeHuiaTrips = tripsData
        .filter(t => t.route_id === teHuiaRouteId && finalActiveServiceIds.includes(t.service_id));
        
    // 3. Find the currently active trip
    const currentTime = today.getHours() * 3600 + today.getMinutes() * 60 + today.getSeconds();
    
    let currentTrip = null;
    let nextStop = null;
    let prevStop = null;

    for (const trip of activeTeHuiaTrips) {
        const tripStopTimes = stopTimesData
            .filter(st => st.trip_id === trip.trip_id)
            .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

        if (tripStopTimes.length === 0) continue;

        const firstStop = tripStopTimes[0];
        const lastStop = tripStopTimes[tripStopTimes.length - 1];

        const firstStopTime = timeToSeconds(firstStop.departure_time);
        const lastStopTime = timeToSeconds(lastStop.arrival_time);

        let adjustedCurrentTime = currentTime;
        if (firstStopTime > lastStopTime && currentTime < firstStopTime) {
            adjustedCurrentTime += 86400; // Add 24 hours for trips spanning midnight
        }
        
        if (adjustedCurrentTime >= firstStopTime && adjustedCurrentTime <= lastStopTime) {
            currentTrip = trip;
            
            for (let i = 0; i < tripStopTimes.length - 1; i++) {
                const stopA = tripStopTimes[i];
                const stopB = tripStopTimes[i + 1];
                
                const timeA = timeToSeconds(stopA.departure_time);
                const timeB = timeToSeconds(stopB.arrival_time);
                
                let adjustedTimeA = timeA;
                let adjustedTimeB = timeB;

                if (timeA > timeB) adjustedTimeB += 86400;

                if (adjustedCurrentTime >= adjustedTimeA && adjustedCurrentTime <= adjustedTimeB) {
                    prevStop = stopA;
                    nextStop = stopB;
                    break;
                }
            }
            if (prevStop && nextStop) {
                break; // Found the trip and segment, so we can exit the loop
            }
        }
    }

    teHuiaDotLayerGroup.clearLayers();
    if (!currentTrip || !prevStop || !nextStop) {
        if (teHuiaMarker) {
             teHuiaDotLayerGroup.removeLayer(teHuiaMarker);
             teHuiaMarker = null;
        }
        return;
    }
    
    // 4. Calculate the position
    const shapeId = currentTrip.shape_id;
    const shapePoints = parsedBusitData.shapes.filter(s => s.shape_id === shapeId)
        .sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence));
    
    const distA = parseFloat(prevStop.shape_dist_traveled);
    const distB = parseFloat(nextStop.shape_dist_traveled);
    const timeA = timeToSeconds(prevStop.departure_time);
    const timeB = timeToSeconds(nextStop.arrival_time);

    let adjustedTimeA = timeA;
    let adjustedTimeB = timeB;
    let adjustedCurrentTime = currentTime;

    if (timeA > timeB) {
        if (currentTime < timeA) adjustedCurrentTime += 86400;
        adjustedTimeB += 86400;
    }
    
    const timeElapsed = adjustedCurrentTime - adjustedTimeA;
    const segmentDuration = adjustedTimeB - adjustedTimeA;
    const progress = segmentDuration > 0 ? timeElapsed / segmentDuration : 0;
    
    // Find the shape point that corresponds to the current distance
    const totalDist = distB - distA;
    const currentDist = distA + (totalDist * progress);

    let currentLat = parseFloat(prevStop.stop_lat);
    let currentLon = parseFloat(prevStop.stop_lon);

    for (let i = 0; i < shapePoints.length - 1; i++) {
        const shapeA = shapePoints[i];
        const shapeB = shapePoints[i + 1];
        if (currentDist >= shapeA.shape_dist_traveled && currentDist <= shapeB.shape_dist_traveled) {
            const shapeProgress = (parseFloat(currentDist) - parseFloat(shapeA.shape_dist_traveled)) / (parseFloat(shapeB.shape_dist_traveled) - parseFloat(shapeA.shape_dist_traveled));
            currentLat = parseFloat(shapeA.shape_pt_lat) + (parseFloat(shapeB.shape_pt_lat) - parseFloat(shapeA.shape_pt_lat)) * shapeProgress;
            currentLon = parseFloat(shapeA.shape_pt_lon) + (parseFloat(shapeB.shape_pt_lon) - parseFloat(shapeA.shape_pt_lon)) * shapeProgress;
            break;
        }
    }
    
    const prevStopName = stopsData.find(s => s.stop_id === prevStop.stop_id)?.stop_name || "N/A";
    const nextStopName = stopsData.find(s => s.stop_id === nextStop.stop_id)?.stop_name || "N/A";

    // 5. Update the marker
    if (teHuiaMarker) {
        teHuiaMarker.setLatLng([currentLat, currentLon]);
        teHuiaMarker.setPopupContent(`
            <b>Te Huia (Simulated)</b><br>
            <b>Trip:</b> ${currentTrip.trip_headsign}<br>
            <b>Status:</b> On Time (Simulated)<br>
            <b>Current Stop:</b> ${prevStopName}<br>
            <b>Next Stop:</b> ${nextStopName}<br>
            <b>Progress:</b> ${(progress * 100).toFixed(0)}%
        `);
    } else {
        teHuiaMarker = L.circleMarker([currentLat, currentLon], {
            radius: 8,
            fillColor: "#4CAF50", // Green for "on time"
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(teHuiaDotLayerGroup);
        teHuiaMarker.bindPopup(`
            <b>Te Huia (Simulated)</b><br>
            <b>Trip:</b> ${currentTrip.trip_headsign}<br>
            <b>Status:</b> On Time (Simulated)<br>
            <b>Current Stop:</b> ${prevStopName}<br>
            <b>Next Stop:</b> ${nextStopName}<br>
            <b>Progress:</b> ${(progress * 100).toFixed(0)}%
        `);
    }
}

// Helper function to convert HH:MM:SS to seconds
function timeToSeconds(time) {
    const parts = time.split(':');
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(parts[2], 10);
    // Handle times past midnight (e.g., 25:00:00)
    return (h * 3600) + (m * 60) + s;
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
                routeName = tripInfo?.trip_headsign || "N/A";

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
    // 1. Load the static GTFS data
    const files = [
        'busit-nz-public.zip/routes.txt',
        'busit-nz-public.zip/trips.txt',
        'busit-nz-public.zip/shapes.txt',
        'busit-nz-public.zip/stop_times.txt',
        'busit-nz-public.zip/calendar.txt',
        'busit-nz-public.zip/calendar_dates.txt',
        'busit-nz-public.zip/stops.txt',
    ];

    try {
        const loadedData = await Promise.all(files.map(file => parseCSV(file)));
        parsedBusitData.routes = loadedData[0];
        parsedBusitData.trips = loadedData[1];
        parsedBusitData.shapes = loadedData[2];
        parsedBusitData.stop_times = loadedData[3];
        parsedBusitData.calendar = loadedData[4];
        parsedBusitData.calendar_dates = loadedData[5];
        parsedBusitData.stops = loadedData[6];
        console.log("Successfully loaded all Busit GTFS data.");
    } catch (err) {
        console.error("Failed to load Busit GTFS data:", err);
        debugBox.textContent = "Error loading Busit GTFS data.";
        return; // Stop if data cannot be loaded
    }

    // 2. Start drawing static and dynamic elements
    await drawTeHuiaLines(); // Draw the Te Huia lines from the uploaded data
    await fetchVehicles(); // Start fetching real-time data for AT services
    updateTeHuiaDot(); // Start simulating the Te Huia dot
    
    // 3. Set up intervals for updates
    setInterval(fetchVehicles, 30000);
    setInterval(updateTeHuiaDot, 5000);
})();
