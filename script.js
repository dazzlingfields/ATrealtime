// A valid AT API key is required here
const atApiKey = '18e2ee8ee75d4e6ca7bd446ffa9bd50f';

// The API endpoint for vehicle positions
const apiUrl = 'https://api.at.govt.nz/v2/gtfs/vehiclepositions';

// --- Set up the Map ---
const map = L.map('map').setView([-36.8485, 174.7633], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- Create Layer Groups for each vehicle type ---
const layerGroups = {
    'BUS': L.layerGroup().addTo(map),
    'TRAIN': L.layerGroup().addTo(map),
    'FERRY': L.layerGroup().addTo(map),
    'NOT_IN_SERVICE': L.layerGroup()
};

// --- Get the control checkboxes from the HTML ---
const checkboxes = document.querySelectorAll('#controls input[type="checkbox"]');

// --- Add event listeners to each checkbox ---
checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', updateMapLayers);
});

// --- Function to update layers based on checkbox state ---
function updateMapLayers() {
    for (const key in layerGroups) {
        const checkbox = document.querySelector(`input[data-vehicle-type="${key}"]`);
        if (checkbox && checkbox.checked) {
            map.addLayer(layerGroups[key]);
        } else {
            map.removeLayer(layerGroups[key]);
        }
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

        // Clear all existing markers from all layer groups
        for (const key in layerGroups) {
            layerGroups[key].clearLayers();
        }

        data.response.entity.forEach(vehicle => {
            const vehicleInfo = vehicle.vehicle;
            const lat = vehicleInfo.position.latitude;
            const lng = vehicleInfo.position.longitude;
            const vehicleType = vehicleInfo.vehicle.label;
            const vehicleStatus = vehicleInfo.current_status;

            let targetLayer;
            let dotClass;

            // Determine which layer and colour the dot should have
            if (vehicleStatus === 'NOT_IN_SERVICE') {
                targetLayer = layerGroups['NOT_IN_SERVICE'];
                dotClass = 'not-in-service-dot';
            } else if (vehicleType === 'BUS') {
                targetLayer = layerGroups['BUS'];
                dotClass = 'bus-dot';
            } else if (vehicleType === 'TRAIN') {
                targetLayer = layerGroups['TRAIN'];
                dotClass = 'train-dot';
            } else if (vehicleType === 'FERRY') {
                targetLayer = layerGroups['FERRY'];
                dotClass = 'ferry-dot';
            } else {
                return; // Skip if vehicle type is not recognised
            }

            // Create a custom dot marker
            const dotIcon = L.divIcon({
                className: `vehicle-dot ${dotClass}`
            });

            // Create and add the marker to the correct layer
            const marker = L.marker([lat, lng], { icon: dotIcon })
                .bindPopup(`Type: ${vehicleType}, Status: ${vehicleStatus}`);
            marker.addTo(targetLayer);
        });

    } catch (error) {
        console.error("Failed to fetch vehicle data:", error);
    }
}

// Fetch data on page load
fetchVehicleData();
updateMapLayers(); // Initial call to show default checked layers

// Refresh data every 30 seconds
setInterval(fetchVehicleData, 30000);
