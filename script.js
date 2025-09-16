// A valid AT API key is required here
const atApiKey = '18e2ee8ee75d4e6ca7bd446ffa9bd50f';

// The API endpoint for vehicle positions
const apiUrl = 'https://api.at.govt.nz/v2/gtfs/vehiclepositions';

// --- Set up the Map ---
// Initialize the map and set its initial view to Auckland
const map = L.map('map').setView([-36.8485, 174.7633], 13);

// Add the base tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- Fetch and Display Vehicle Data ---
async function fetchVehicleData() {
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Ocp-Apim-Subscription-Key': atApiKey
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // The API returns a JSON object, but the actual GTFS-RT data
        // is in a protobuf format inside the 'response' key.
        // You would need a library like 'gtfs-realtime-bindings'
        // to parse this data in a real application.
        // For a simplified example, we'll assume a simpler JSON structure
        // that's easier to work with.

        // In a real application, you would parse the GTFS-RT data
        // and loop through each vehicle entity to get its position.
        
        // Simplified example of how to add a marker:
        data.forEach(vehicle => {
            const lat = vehicle.latitude;
            const lng = vehicle.longitude;
            const occupancy = vehicle.occupancy;

            // Define marker colour based on occupancy
            let markerColor = 'blue';
            if (occupancy === 'FULL') {
                markerColor = 'red';
            } else if (occupancy === 'STANDING_ROOM_ONLY') {
                markerColor = 'orange';
            } else if (occupancy === 'FEW_SEATS_AVAILABLE') {
                markerColor = 'green';
            }

            // Create a custom icon with the specified colour
            const busIcon = L.divIcon({
                className: 'bus-marker',
                html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="${markerColor}" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`,
                iconSize: [24, 24]
            });

            // Add the marker to the map
            L.marker([lat, lng], {icon: busIcon}).addTo(map)
                .bindPopup(`Occupancy: ${occupancy}`);
        });

    } catch (error) {
        console.error("Failed to fetch vehicle data:", error);
    }
}

// Fetch data on page load
fetchVehicleData();

// Refresh data every 30 seconds
setInterval(fetchVehicleData, 30000);