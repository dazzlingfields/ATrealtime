// v4.2
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;

let routeData = {};
let tripData = {};
const vehicleMarkers = {}; // Store markers by vehicle ID
let teHuiaMarker = null;

// Te Huia schedule for simulation
const teHuiaSchedule = [
  // Northbound (Hamilton → Auckland)
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "06:05" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "06:15" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "06:39" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "07:27" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "08:03" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "08:30" }
    ],
    days: [1, 2, 3, 4, 5] // Mon-Fri
  },
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "09:30" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "09:40" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "10:02" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "10:50" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "11:26" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "11:54" }
    ],
    days: [4, 5] // Thurs, Fri (additional service)
  },
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "14:05" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "14:15" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "14:37" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "15:26" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "16:03" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "16:34" }
    ],
    days: [1, 2, 3, 4, 5] // Mon-Fri
  },
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "07:35" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "07:45" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "08:07" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "08:59" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "09:34" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "10:03" }
    ],
    days: [6] // Sat
  },
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "09:00" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "09:10" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "09:32" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "10:27" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "11:01" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "11:29" }
    ],
    days: [6] // Sat
  },
  {
    direction: "north",
    stops: [
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "14:45" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "14:54" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "15:18" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "16:06" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "16:43" },
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "17:17" }
    ],
    days: [0] // Sun
  },
  // Southbound (Auckland → Hamilton)
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "09:45" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "10:15" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "10:47" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "11:32" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "12:03" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "12:11" }
    ],
    days: [1, 2, 3, 4, 5] // Mon-Fri
  },
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "15:25" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "15:59" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "16:29" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "17:13" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "17:42" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "17:50" }
    ],
    days: [4, 5] // Thurs, Fri (additional service)
  },
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "17:45" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "18:20" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "18:57" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "19:41" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "20:11" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "20:19" }
    ],
    days: [1, 2, 3, 4, 5] // Mon-Fri
  },
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "15:05" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "15:38" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "16:07" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "16:59" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "17:28" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "17:36" }
    ],
    days: [6] // Sat
  },
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "17:30" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "17:57" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "18:27" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "19:13" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "19:44" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "19:52" }
    ],
    days: [6] // Sat
  },
  {
    direction: "south",
    stops: [
      { name: "The Strand", lat: -36.8450, lon: 174.7700, time: "18:15" },
      { name: "Puhinui", lat: -36.9110, lon: 174.8440, time: "18:42" },
      { name: "Pukekohe", lat: -37.2030, lon: 174.9280, time: "19:12" },
      { name: "Raahui Pookeka", lat: -37.4500, lon: 175.1900, time: "19:58" },
      { name: "Rotokauri", lat: -37.74595, lon: 175.226539, time: "20:29" },
      { name: "Frankton", lat: -37.7850, lon: 175.2790, time: "20:37" }
    ],
    days: [0] // Sun
  },
];

const occupancyStatusMap = {
  0: 'Empty',
  1: 'Many seats available',
  2: 'Few seats available',
  3: 'Standing room only',
  4: 'Crushed standing room only',
  5: 'Full',
  6: 'Not accepting passengers',
  7: 'No data available'
};

// Helper to convert time string (HH:mm) to a time in minutes from midnight
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper to get interpolated points along a straight line
function getInterpolatedPoints(fromLat, fromLon, toLat, toLon, numPoints) {
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const lat = fromLat + t * (toLat - fromLat);
    const lon = fromLon + t * (toLon - fromLon);
    points.push({ lat, lon });
  }
  return points;
}

// Check for planned closures
function isServiceClosed() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const closureDates = [
    '2025-09-20', '2025-09-21', '2025-09-22', '2025-09-23', '2025-09-24', '2025-09-25', '2025-09-26', '2025-09-27', '2025-09-28', '2025-09-29', '2025-09-30', '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05',
    '2025-10-24', '2025-10-25', '2025-10-26', '2025-10-27',
    '2025-11-16',
    '2025-12-25', '2025-12-26', '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18'
  ];
  return closureDates.includes(dateStr);
}

// Gets the current simulated position of the Te Huia train
function getSimulatedTeHuia() {
  const now = new Date();
  const day = now.getDay();
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

  if (isServiceClosed()) {
    return null;
  }

  const activeTrips = teHuiaSchedule.filter(trip => trip.days.includes(day));

  for (const trip of activeTrips) {
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const stopFrom = trip.stops[i];
      const stopTo = trip.stops[i + 1];

      const scheduledFrom = timeToMinutes(stopFrom.time);
      const scheduledTo = timeToMinutes(stopTo.time);

      if (currentTimeMinutes >= scheduledFrom && currentTimeMinutes < scheduledTo) {
        const timeElapsed = currentTimeMinutes - scheduledFrom;
        const totalDuration = scheduledTo - scheduledFrom;
        const progress = timeElapsed / totalDuration;

        const pathPoints = getInterpolatedPoints(
          stopFrom.lat, stopFrom.lon, stopTo.lat, stopTo.lon, 10
        );
        const pointIndex = Math.floor(progress * (pathPoints.length - 1));
        const currentPos = pathPoints[pointIndex];
        
        return {
          position: currentPos,
          stopFrom: stopFrom.name,
          stopTo: stopTo.name,
          scheduledFrom: stopFrom.time,
          scheduledTo: stopTo.time,
        };
      }
    }
  }
  return null;
}

// Global layers for each vehicle type
const busLayer = L.layerGroup();
const trainLayer = L.layerGroup();
const ferryLayer = L.layerGroup();
const outOfServiceLayer = L.layerGroup();
let teHuiaLayer = L.layerGroup();

// Object to hold all layers
const vehicleLayers = {
  'bus': busLayer,
  'train': trainLayer,
  'ferry': ferryLayer,
  'outOfService': outOfServiceLayer,
};

// Define coloured circle icons
function getIconForVehicle(serviceType, isOutOfService) {
  const colours = {
    'bus': 'blue',
    'train': 'green',
    'ferry': 'red',
  };
  const color = isOutOfService ? 'grey' : colours[serviceType] || 'black';

  return L.divIcon({
    className: 'vehicle-icon',
    html: `<div style="background: ${color}; width:10px; height:10px; border:2px solid white; border-radius:5px;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

// Fetch and render vehicle data
async function fetchVehicles() {
  try {
    const response = await fetch(realtimeUrl);
    const data = await response.json();
    renderVehicles(data);
  } catch (err) {
    console.error("fetchVehicles error:", err);
  }
}

// Render real-time vehicles
function renderVehicles(data) {
  const newIds = new Set();
  
  data.forEach(vehicle => {
    const vehicleId = vehicle.vehicle?.id;
    if (!vehicleId || !vehicle.vehicle?.position) return;
    newIds.add(vehicleId);

    const lat = vehicle.vehicle.position.latitude;
    const lon = vehicle.vehicle.position.longitude;
    const speed = vehicle.vehicle.position.speed ? (vehicle.vehicle.position.speed * 3.6).toFixed(1) : 'N/A';
    const isOutOfService = vehicle.vehicle.current_status === "IN_TRANSIT_TO";
    const serviceType = vehicle.trip.service_type;
    const destination = vehicle.trip.headsign || 'N/A';
    
    // Get the route short name and occupancy
    const tripInfo = tripData[vehicle.trip.trip_id];
    const routeInfo = tripInfo ? routeData[tripInfo.route_id] : null;
    const routeShortName = routeInfo ? routeInfo.route_short_name : 'N/A';
    const occupancyStatus = occupancyStatusMap[vehicle.vehicle.occupancy_status] || 'No data available';

    const popupContent = `
      <b>Route:</b> ${routeShortName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Occupancy:</b> ${occupancyStatus}<br>
      <b>Vehicle Number:</b> ${vehicle.vehicle.label || 'N/A'}<br>
      <b>Vehicle ID:</b> ${vehicleId}<br>
      <b>Speed:</b> ${speed} km/h
    `;

    const icon = getIconForVehicle(serviceType, isOutOfService);

    if (vehicleMarkers[vehicleId]) {
      // Update existing marker
      vehicleMarkers[vehicleId].setLatLng([lat, lon]).setPopupContent(popupContent);
    } else {
      // Create new marker
      const marker = L.marker([lat, lon], { icon: icon }).bindPopup(popupContent);
      vehicleMarkers[vehicleId] = marker;
      
      if (isOutOfService) {
        outOfServiceLayer.addLayer(marker);
      } else {
        switch (serviceType) {
          case 'bus':
            busLayer.addLayer(marker);
            break;
          case 'train':
            trainLayer.addLayer(marker);
            break;
          case 'ferry':
            ferryLayer.addLayer(marker);
            break;
        }
      }
    }
  });

  // Remove markers that are no longer in the data feed
  for (const id in vehicleMarkers) {
    if (!newIds.has(id)) {
      Object.values(vehicleLayers).forEach(layer => layer.removeLayer(vehicleMarkers[id]));
      teHuiaLayer.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
  }

  updateVehicleDisplay();
}

// Render Te Huia simulated position
function renderTeHuiaSim() {
  const showTeHuiaCheckbox = document.getElementById('tehuia-checkbox');
  if (!showTeHuiaCheckbox.checked) {
    if (teHuiaMarker) {
      teHuiaLayer.removeLayer(teHuiaMarker);
      teHuiaMarker = null;
    }
    return;
  }
  
  const sim = getSimulatedTeHuia();
  if (sim) {
    const { lat, lon } = sim.position;
    const popup = `
      <b>Simulated Te Huia Train</b><br>
      <i>This is a simulation and may not be 100% accurate.</i><br>
      <b>From-To:</b> ${sim.stopFrom} → ${sim.stopTo}<br>
      <b>Schedule:</b> ${sim.scheduledFrom} → ${sim.scheduledTo}
    `;
    
    const icon = L.divIcon({
      className: 'vehicle-icon',
      html: `<div style="background: orange; width:14px; height:14px; border:2px solid white; border-radius:7px;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9,9]
    });
    
    if (teHuiaMarker) {
      teHuiaMarker.setLatLng([lat, lon]).setPopupContent(popup);
    } else {
      teHuiaMarker = L.marker([lat, lon], { icon: icon });
      teHuiaMarker.bindPopup(popup);
      teHuiaMarker.addTo(teHuiaLayer);
    }
  } else if (teHuiaMarker) {
    teHuiaLayer.removeLayer(teHuiaMarker);
    teHuiaMarker = null;
  }
}

// Function to control layer visibility based on checkbox state
function updateVehicleDisplay() {
  const busCheckbox = document.getElementById('bus-checkbox');
  const trainCheckbox = document.getElementById('train-checkbox');
  const ferryCheckbox = document.getElementById('ferry-checkbox');
  const outOfServiceCheckbox = document.getElementById('outofservice-checkbox');
  const teHuiaCheckbox = document.getElementById('tehuia-checkbox');

  if (busCheckbox.checked) {
    busLayer.addTo(map);
  } else {
    map.removeLayer(busLayer);
  }
  
  if (trainCheckbox.checked) {
    trainLayer.addTo(map);
  } else {
    map.removeLayer(trainLayer);
  }

  if (ferryCheckbox.checked) {
    ferryLayer.addTo(map);
  } else {
    map.removeLayer(ferryLayer);
  }

  if (outOfServiceCheckbox.checked) {
    outOfServiceLayer.addTo(map);
  } else {
    map.removeLayer(outOfServiceLayer);
  }
  
  if (teHuiaCheckbox.checked) {
    teHuiaLayer.addTo(map);
  } else {
    map.removeLayer(teHuiaLayer);
  }
}

// Initial data fetching and map setup
async function initializeMap() {
  // Fetch static data first
  try {
    const [routesRes, tripsRes] = await Promise.all([
      fetch(routesUrl),
      fetch(tripsUrl)
    ]);
    const [routesJson, tripsJson] = await Promise.all([
      routesRes.json(),
      tripsRes.json()
    ]);
    
    // Store data in a quick-lookup format
    routesJson.forEach(route => routeData[route.route_id] = route);
    tripsJson.forEach(trip => tripData[trip.trip_id] = trip);
    
    console.log("Static data loaded.");

  } catch (err) {
    console.error("Error fetching static data:", err);
  }

  // Initialize the map
  const map = L.map('map').setView([-36.85, 174.76], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  
  // Add layers to the map
  busLayer.addTo(map);
  trainLayer.addTo(map);
  ferryLayer.addTo(map);
  outOfServiceLayer.addTo(map);
  teHuiaLayer.addTo(map);

  // Add event listeners for checkboxes
  document.getElementById('bus-checkbox').addEventListener('change', updateVehicleDisplay);
  document.getElementById('train-checkbox').addEventListener('change', updateVehicleDisplay);
  document.getElementById('ferry-checkbox').addEventListener('change', updateVehicleDisplay);
  document.getElementById('outofservice-checkbox').addEventListener('change', updateVehicleDisplay);
  document.getElementById('tehuia-checkbox').addEventListener('change', renderTeHuiaSim);
  
  // Initial fetch and render of all data
  fetchVehicles();
  renderTeHuiaSim();

  // Update vehicle positions every 30 seconds
  setInterval(fetchVehicles, 30000);
  // Update Te Huia simulation every 10 seconds
  setInterval(renderTeHuiaSim, 10000);
}

initializeMap();
