// v3.5
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl = `${proxyBaseUrl}/api/realtime`;
const routesUrl   = `${proxyBaseUrl}/api/routes`;
const tripsUrl    = `${proxyBaseUrl}/api/trips`;
const stopsUrl    = `${proxyBaseUrl}/api/stops`;

// Te Huia schedule for simulation (northbound and southbound services)
const teHuiaSchedule = [
  // Northbound (Hamilton → Auckland)
  {
    direction: "north",
    stops: [
      { name: "Frankton",       lat: -37.7850, lon: 175.2790, time: "06:05" },
      { name: "Rotokauri",       lat: -37.7360, lon: 175.2450, time: "06:15" },
      { name: "Raahui Pookeka",   lat: -37.4500, lon: 175.1900, time: "06:39" },
      { name: "Pukekohe",         lat: -37.2030, lon: 174.9280, time: "07:27" },
      { name: "Puhinui",          lat: -36.9110, lon: 174.8440, time: "08:03" },
      { name: "The Strand",       lat: -36.8450, lon: 174.7670, time: "08:30" }
    ]
  },
  // Southbound (Auckland → Hamilton)
  {
    direction: "south",
    stops: [
      { name: "The Strand",       lat: -36.8450, lon: 174.7670, time: "09:45" },
      { name: "Puhinui",           lat: -36.9110, lon: 174.8440, time: "10:15" },
      { name: "Pukekohe",          lat: -37.2030, lon: 174.9280, time: "10:47" },
      { name: "Raahui Pookeka",    lat: -37.4500, lon: 175.1900, time: "11:32" },
      { name: "Rotokauri",         lat: -37.7360, lon: 175.2450, time: "12:03" },
      { name: "Frankton",          lat: -37.7850, lon: 175.2790, time: "12:11" }
    ]
  }
];

// Utility to parse "HH:MM" into a Date (today)
function parseTimeHM(timestr) {
  const [h, m] = timestr.split(":").map(s => parseInt(s,10));
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// Compute simulated position for Te Huia if current time matches one of the schedule segments
function getSimulatedTeHuia() {
  const now = new Date();
  for (const trip of teHuiaSchedule) {
    const stops = trip.stops;
    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i];
      const s2 = stops[i+1];
      const t1 = parseTimeHM(s1.time);
      const t2 = parseTimeHM(s2.time);
      if (now >= t1 && now <= t2) {
        const fraction = (now - t1) / (t2 - t1);
        const lat = s1.lat + (s2.lat - s1.lat) * fraction;
        const lon = s1.lon + (s2.lon - s1.lon) * fraction;
        return {
          direction: trip.direction,
          stopFrom: s1.name,
          stopTo: s2.name,
          position: { lat, lon },
          scheduledFrom: s1.time,
          scheduledTo: s2.time
        };
      }
    }
  }
  return null;
}

// Set up the map
const map = L.map("map").setView([-37.0, 175.0], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Layers
const vehicleLayer = L.layerGroup().addTo(map);
const teHuiaLayer = L.layerGroup().addTo(map);

// Debug / UI
const debugEl = document.getElementById("debug");
const showTeHuiaCheckbox = document.getElementById("show-tehuia");

// Store markers
const vehicleMarkers = {};
let teHuiaMarker = null;

// Fetch real-time vehicles
async function fetchVehicles() {
  try {
    const res = await fetch(realtimeUrl);
    if (!res.ok) throw new Error(`Vehicles fetch failed: ${res.status}`);
    const json = await res.json();
    const vehicles = json?.response?.entity || json?.entity || [];
    const newIds = new Set();

    for (const v of vehicles) {
      const vehicleId = v.vehicle?.vehicle?.id;
      if (!vehicleId || !v.vehicle?.position) continue;
      newIds.add(vehicleId);
      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;

      // Popup info
      const routeId = v.vehicle.trip?.route_id;
      const tripId  = v.vehicle.trip?.trip_id;
      let destination = "N/A";
      // Try to fetch trip info or route info if available
      // (same logic you had before but simplified here)
      if (v.vehicle.trip && v.vehicle.trip.headsign) {
        destination = v.vehicle.trip.headsign;
      }

      const popup = `
        <b>Vehicle:</b> ${v.vehicle.vehicle?.label || "N/A"}<br>
        <b>Speed:</b> ${ (v.vehicle.position.speed ? (v.vehicle.position.speed * 3.6).toFixed(1) : "N/A") } km/h<br>
        <b>Destination:</b> ${destination}
      `;

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([lat, lon]).setPopupContent(popup);
      } else {
        const m = L.marker([lat, lon]);
        m.bindPopup(popup);
        m.addTo(vehicleLayer);
        vehicleMarkers[vehicleId] = m;
      }
    }

    // Remove stale markers
    for (const id in vehicleMarkers) {
      if (!newIds.has(id)) {
        vehicleLayer.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    }

    debugEl.textContent = `Last real-time update: ${new Date().toLocaleTimeString()}, Vehicles: ${vehicles.length}`;

  } catch (err) {
    debugEl.textContent = `Error loading vehicles: ${err.message}`;
    console.error("fetchVehicles error:", err);
  }
}

// Render Te Huia simulated position
function renderTeHuiaSim() {
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
      <b>From-To:</b> ${sim.stopFrom} → ${sim.stopTo}<br>
      <b>Schedule:</b> ${sim.scheduledFrom} → ${sim.scheduledTo}
    `;
    if (teHuiaMarker) {
      teHuiaMarker.setLatLng([lat, lon]).setPopupContent(popup);
    } else {
      const icon = L.divIcon({
        className: 'vehicle-icon',
        html: `<div style="background: orange; width:14px; height:14px; border:2px solid white; border-radius:7px;"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9,9]
      });
      teHuiaMarker = L.marker([lat, lon], { icon: icon });
      teHuiaMarker.bindPopup(popup);
      teHuiaMarker.addTo(teHuiaLayer);
    }
    debugEl.textContent += " | Te Huia simulated running";
  } else {
    if (teHuiaMarker) {
      teHuiaLayer.removeLayer(teHuiaMarker);
      teHuiaMarker = null;
    }
    debugEl.textContent += " | No Te Huia in service now";
  }
}

// Initialise & schedule
(async function init() {
  await fetchVehicles();
  renderTeHuiaSim();
  setInterval(() => {
    fetchVehicles();
    renderTeHuiaSim();
  }, 15000);
})();
