// Te Huia Simulation
let teHuiaMarker = null;

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

// Define Te Huia schedule
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

// Main function to initialize and run the simulation
function initializeTeHuiaSim(map, teHuiaLayer) {
    function renderTeHuiaSim() {
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
                html: `<div style="background: orange; width:14px; height:14px; border:2px solid black; border-radius:7px;"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
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

    renderTeHuiaSim();
    setInterval(renderTeHuiaSim, 60000); // Update every minute
}
