
const atApiKey = '18e2ee8ee75d4e6ca7bd446ffa9bd50f';

// The API endpoint for vehicle positions
const apiUrl = 'https://api.at.govt.nz/v2/gtfs/vehiclepositions';

// --- Set up the Map ---
const map = L.map('map').setView([-36.8485, 174.7633], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- Create Layer Groups for each vehicle type ---
const busLayer = L.layerGroup();
const trainLayer = L.layerGroup();
const ferryLayer = L.layerGroup();
const notInServiceLayer = L.layerGroup();

// Add all layers to the map initially
busLayer.addTo(map);
trainLayer.addTo(map);
ferryLayer.addTo(map);
notInServiceLayer.addTo(map);

// --- Get the control buttons from the HTML ---
const showAllBtn = document.getElementById('show-all');
const showBusesBtn = document.getElementById('show-buses');
const showTrainsBtn = document.getElementById('show-trains');
const showFerriesBtn = document.getElementById('show-ferries');
const showNotInServiceBtn = document.getElementById('show-not-in-service');

// --- Add event listeners for the buttons ---
showAllBtn.addEventListener('click', () => toggleLayers(true, true, true, true));
showBusesBtn.addEventListener('click', () => toggleLayers(true, false, false, false));
showTrainsBtn.addEventListener('click', () => toggleLayers(false, true, false, false));
showFerriesBtn.addEventListener('click', () => toggleLayers(false, false, true, false));
showNotInServiceBtn.addEventListener('click', () => toggleLayers(false, false, false, true));

function toggleLayers(showBuses, showTrains, showFerries, showNotInService) {
    if (showBuses) {
        map.addLayer(busLayer);
    } else {
        map.removeLayer(busLayer);
    }
    if (showTrains) {
        map.addLayer(trainLayer);
    } else {
        map.removeLayer(trainLayer);
    }
    if (showFerries) {
        map.addLayer(ferryLayer);
    } else {
        map.removeLayer(ferryLayer);
    }
    if (showNotInService) {
        map.addLayer(notInServiceLayer);
    } else {
        map.removeLayer(notInServiceLayer);
    }
}

// --- Fetch and Display Vehicle Data ---
async function fetchVehicleData() {
    try {
        const response = await fetch(apiUrl, {
            headers: { 'Ocp-Apim-Subscription-Key': atApiKey }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Clear existing markers before adding new ones
        busLayer.clearLayers();
        trainLayer.clearLayers();
        ferryLayer.clearLayers();
        notInServiceLayer.clearLayers();

        // Loop through the data and add markers to the correct layer
        // NOTE: The property names 'type' and 'status' are examples. 
        // You may need to inspect the API's JSON response for the actual property names.
        data.response.entity.forEach(vehicle => {
            const vehicleInfo = vehicle.vehicle;
            const lat = vehicleInfo.position.latitude;
            const lng = vehicleInfo.position.longitude;
            const type = vehicleInfo.vehicle.vehicle_type;
            const status = vehicleInfo.current_status;

            let targetLayer;

            // Determine which layer the vehicle belongs to
            if (status === 'IN_TRANSIT_TO' || status === 'STOPPED_AT') {
                if (type === 'BUS') {
                    targetLayer = busLayer;
                } else if (type === 'TRAIN') {
                    targetLayer = trainLayer;
                } else if (type === 'FERRY') {
                    targetLayer = ferryLayer;
                }
            } else if (status === 'NOT_IN_SERVICE') {
                targetLayer = notInServiceLayer;
            }

            // Only add a marker if a valid layer was found
            if (targetLayer) {
                const marker = L.marker([lat, lng]).bindPopup(`Type: ${type}, Status: ${status}`);
                marker.addTo(targetLayer);
            }
        });

    } catch (error) {
        console.error("Failed to fetch vehicle data:", error);
    }
}

// Fetch data on page load
fetchVehicleData();

// Refresh data every 30 seconds
setInterval(fetchVehicleData, 30000);
