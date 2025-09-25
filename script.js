// ================== v4.54 - Realtime Vehicle Tracking ==================
// Adds: retractable search control (icon until clicked), live suggestions below,
// Enter to highlight, Escape to clear and collapse, click-out to collapse.
// Keeps: visibility-aware polling with delayed pause, jittered 10–15 s,
// anti-overlap, 429 backoff, chunked trips, fast bus-type lookup, immediate
// headsigns, AM pairing, train line colours, semi-transparent popups,
// hover-open and click-to-pin popups.

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO", subdomains: "abcd", maxZoom: 20
});
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO", subdomains: "abcd", maxZoom: 20
});
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri"
});
const esriImagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri, Maxar, Earthstar Geographics", maxZoom: 20 }
);
const esriLabels = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Labels © Esri", maxZoom: 20 }
);
const esriHybrid = L.layerGroup([esriImagery, esriLabels]);

const map = L.map("map", {
  center: [-36.8485, 174.7633], zoom: 12, layers: [light], zoomControl: false
});

// Only base maps in control; overlays toggled by your external checkboxes
const baseMaps = { "Light": light, "Dark": dark, "OSM": osm, "Satellite": satellite, "Esri Hybrid": esriHybrid };
L.control.layers(baseMaps, null).addTo(map);

// Overlay groups
const vehicleLayers = {
  bus: L.layerGroup().addTo(map),
  train: L.layerGroup().addTo(map),
  ferry: L.layerGroup().addTo(map),
  out: L.layerGroup().addTo(map)
};

// --- Data and state ---
const vehicleMarkers = {};
const tripCache = {};
let routes = {};
let busTypes = {};
let busTypeIndex = {};
const debugBox = document.getElementById("debug");

// Search indexes (rebuilt every refresh)
const vehicleIndexByFleet = new Map(); // normalized fleet label -> marker
const routeIndex = new Map();          // normalized route short name -> Set<marker>

// Popup pinning and map click-out to unpin and clear highlights
let pinnedPopup = null;
map.on("click", function () {
  if (pinnedPopup) { pinnedPopup.closePopup(); pinnedPopup = null; }
  clearRouteHighlights();
});

const vehicleColors = { bus: "#4a90e2", train: "#d0021b", ferry: "#1abc9c", out: "#9b9b9b" };
const trainLineColors = { STH: "#d0021b", WEST: "#6aa84f", EAST: "#f8e71c", ONE: "#0e76a8" };
const occupancyLabels = [
  "Empty","Many Seats Available","Few Seats Available",
  "Standing Room Only","Limited Standing Room","Full","Not accepting passengers"
];

// --- Polling control ---
const MIN_POLL_MS = 10000;
const MAX_POLL_MS = 15000;
function basePollDelay() { return MIN_POLL_MS + Math.floor(Math.random() * (MAX_POLL_MS - MIN_POLL_MS + 1)); }

// Backoff for 429
let backoffMs = 0;
const BACKOFF_START_MS = 30000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
let backoffUntilTs = 0;

// Anti-overlap and visibility flags
let vehiclesAbort;
let vehiclesInFlight = false;
let pollTimeoutId = null;
let pageVisible = !document.hidden;

// Delayed pause when hidden
let hidePauseTimerId = null;
const HIDE_PAUSE_DELAY_MS = 10000;

// --- Helpers ---
function setDebug(msg) { if (debugBox) debugBox.textContent = msg; }
function parseRetryAfterMs(value) {
  if (!value) return 0;
  const sec = Number(value);
  if (!isNaN(sec)) return Math.max(0, Math.floor(sec * 1000));
  const ts = Date.parse(value);
  return isNaN(ts) ? 0 : Math.max(0, ts - Date.now());
}

// safeFetch: null on error; {_rateLimited:true,retryAfterMs} on 429
async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
      let body = ""; try { body = await res.text(); } catch {}
      console.warn("429 Too Many Requests", { url, retryAfterMs, body: body?.slice(0, 200) });
      return { _rateLimited: true, retryAfterMs };
    }
    if (!res.ok) {
      let body = ""; try { body = await res.text(); } catch {}
      const extra = body ? ` | ${body.slice(0, 200)}` : "";
      throw new Error(`${res.status} ${res.statusText}${extra}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Fetch error:", err);
    setDebug(`Fetch error: ${err.message}`);
    return null;
  }
}

function chunk(arr, n) { const out = []; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

function buildBusTypeIndex(json) {
  const index = {};
  if (!json || typeof json !== "object") return index;
  for (const model of Object.keys(json)) {
    const ops = json[model] || {};
    for (const op of Object.keys(ops)) {
      const nums = ops[op] || [];
      if (!index[op]) index[op] = {};
      for (const n of nums) index[op][n] = model;
    }
  }
  return index;
}
function getBusType(operator, vehicleNumber) {
  if (!operator || vehicleNumber == null) return "";
  const ix = busTypeIndex[operator];
  return ix ? (ix[vehicleNumber] || "") : "";
}

function buildPopup(routeName, destination, vehicleLabel, busType, licensePlate, speedStr, occupancy, bikesLine) {
  return `
    <div style="font-size:0.9em;line-height:1.3;">
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType ? `<b>Bus Model:</b> ${busType}<br>` : ""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speedStr}<br>
      <b>Occupancy:</b> ${occupancy}
      ${bikesLine}
    </div>
  `;
}

// --- Marker creation/update with hover-open and click-to-pin ---
function addOrUpdateMarker(id, lat, lon, popupContent, color, type, tripId, fields = {}) {
  const isMobile = window.innerWidth <= 600;
  const popupOpts = { maxWidth: isMobile ? 200 : 250, className: "vehicle-popup" };

  if (vehicleMarkers[id]) {
    const m = vehicleMarkers[id];
    m.setLatLng([lat, lon]);
    m.setPopupContent(popupContent);
    m.setStyle({ fillColor: color });
    m.tripId = tripId;
    Object.assign(m, fields);
    Object.values(vehicleLayers).forEach(layer => layer.removeLayer(m));
    (vehicleLayers[type] || vehicleLayers.out).addLayer(m);
  } else {
    const marker = L.circleMarker([lat, lon], {
      radius: isMobile ? 6 : 5, fillColor: color, color: "#000",
      weight: 1, opacity: 1, fillOpacity: 0.9
    });
    (vehicleLayers[type] || vehicleLayers.out).addLayer(marker);
    marker.bindPopup(popupContent, popupOpts);

    if (!marker._eventsBound) {
      marker.on("mouseover", function () { if (pinnedPopup !== this) this.openPopup(); });
      marker.on("mouseout", function () { if (pinnedPopup !== this) this.closePopup(); });
      marker.on("click", function (e) {
        if (pinnedPopup && pinnedPopup !== this) pinnedPopup.closePopup();
        pinnedPopup = this;
        this.openPopup();
        if (e && e.originalEvent && typeof e.originalEvent.stopPropagation === "function") {
          e.originalEvent.stopPropagation();
        }
      });
      marker._eventsBound = true;
    }

    marker.tripId = tripId;
    Object.assign(marker, fields);
    vehicleMarkers[id] = marker;
  }
}

function updateVehicleCount() {
  const busCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.bus.hasLayer(m)).length;
  const trainCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.train.hasLayer(m)).length;
  const ferryCount = Object.values(vehicleMarkers).filter(m => vehicleLayers.ferry.hasLayer(m)).length;
  const el = document.getElementById("vehicle-count");
  if (el) el.textContent = `Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Semi-transparent popup + search styles ---
(function injectStyle() {
  const style = document.createElement("style");
  style.textContent = `
  .leaflet-popup-content-wrapper,
  .leaflet-popup-tip { background: rgba(255,255,255,0.85); backdrop-filter: blur(4px); }

  .veh-highlight { stroke: #333; stroke-width: 3; }

  .leaflet-control.search-control {
    position: relative;
    background: rgba(255,255,255,0.9);
    padding: 6px;
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    display: flex; align-items: center; gap: 6px;
  }
  .search-icon-btn {
    width: 28px; height: 28px; border: 1px solid #bbb; border-radius: 4px;
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    background: white;
  }
  .search-icon-btn svg { width: 16px; height: 16px; }
  .search-input {
    width: 0;
    opacity: 0;
    border: 1px solid #bbb; border-radius: 4px; padding: 4px 8px; font-size: 13px;
    transition: width 140ms ease, opacity 120ms ease;
  }
  .search-control.expanded .search-input { width: 220px; opacity: 1; }
  .search-suggestions {
    position: absolute; top: 100%; left: 0; right: 0;
    background: rgba(255,255,255,0.97);
    border: 1px solid #bbb; border-radius: 6px; margin-top: 6px; max-height: 240px; overflow: auto;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    display: none;
    z-index: 4000;
  }
  .search-control.expanded .search-suggestions { display: block; }
  .suggestion-section { padding: 6px 6px 0 6px; font-size: 12px; color: #666; }
  .suggestion-item {
    padding: 6px 10px; font-size: 13px; cursor: pointer;
    display: flex; justify-content: space-between; gap: 12px;
  }
  .suggestion-item:hover { background: #eef3ff; }
  .suggestion-meta { color: #666; font-size: 12px; }
  `;
  document.head.appendChild(style);
})();

// --- Search helpers and highlighting ---
function normalizeFleetLabel(s) { return (s || "").toString().trim().replace(/\s+/g, "").toUpperCase(); }
function normalizeRouteKey(s)   { return (s || "").toString().trim().replace(/\s+/g, "").toUpperCase(); }

function clearRouteHighlights() {
  Object.values(vehicleMarkers).forEach(m => {
    if (m._isRouteHighlighted) {
      m.setStyle({ weight: 1 });
      m._isRouteHighlighted = false;
    }
  });
}

function highlightMarkers(markers) {
  clearRouteHighlights();
  const bounds = [];
  markers.forEach(m => {
    try { m.setStyle({ weight: 3 }); m._isRouteHighlighted = true; bounds.push(m.getLatLng()); } catch {}
  });
  if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
}

// Search logic that returns an object { type: 'fleet'|'route'|'none', markers: Marker[], exemplar?: Marker }
function resolveQueryToMarkers(queryRaw) {
  const q = (queryRaw || "").trim();
  if (!q) return { type: "none", markers: [] };

  const fleetCandidate = normalizeFleetLabel(q);
  const routeCandidate = normalizeRouteKey(q);
  const hasLetters = /[A-Z]/i.test(fleetCandidate);
  const hasDigits  = /\d/.test(fleetCandidate);

  if (hasLetters && hasDigits) {
    const m = vehicleIndexByFleet.get(fleetCandidate);
    return m ? { type: "fleet", markers: [m], exemplar: m } : { type: "none", markers: [] };
  }

  const set = routeIndex.get(routeCandidate);
  if (set && set.size > 0) {
    const markers = Array.from(set);
    return { type: "route", markers, exemplar: markers[0] };
  }

  return { type: "none", markers: [] };
}

// --- Search control with retract/expand and suggestions ---
const SearchControl = L.Control.extend({
  onAdd: function () {
    const div = L.DomUtil.create("div", "leaflet-control search-control");
    const btn = L.DomUtil.create("button", "search-icon-btn", div);
    btn.setAttribute("type", "button");
    btn.setAttribute("title", "Search");
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

    const input = L.DomUtil.create("input", "search-input", div);
    input.type = "text";
    input.placeholder = "Fleet RT1234 or route 27";

    const sugg = L.DomUtil.create("div", "search-suggestions", div);
    sugg.innerHTML = ""; // filled dynamically

    // prevent map interactions while using the control
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    function expand() {
      div.classList.add("expanded");
      input.focus();
      renderSuggestions(input.value);
    }

    function collapseAndReset() {
      input.value = "";
      sugg.innerHTML = "";
      div.classList.remove("expanded");
      clearRouteHighlights();
      if (pinnedPopup) { pinnedPopup.closePopup(); pinnedPopup = null; }
    }

    btn.addEventListener("click", () => {
      if (div.classList.contains("expanded")) collapseAndReset();
      else expand();
    });

    let debounceId = null;
    input.addEventListener("input", () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => renderSuggestions(input.value), 180);
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        const res = resolveQueryToMarkers(input.value);
        if (res.type === "fleet") {
          const m = res.exemplar;
          const ll = m.getLatLng();
          map.setView(ll, Math.max(map.getZoom(), 14));
          if (pinnedPopup && pinnedPopup !== m) pinnedPopup.closePopup();
          pinnedPopup = m;
          m.openPopup();
          clearRouteHighlights();
        } else if (res.type === "route") {
          highlightMarkers(res.markers);
          if (res.exemplar) res.exemplar.openPopup();
        } else {
          clearRouteHighlights();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        collapseAndReset();
      }
    });

    // click outside collapses
    document.addEventListener("mousedown", onDocDown);
    function onDocDown(ev) {
      if (!div.classList.contains("expanded")) return;
      if (!div.contains(ev.target)) collapseAndReset();
    }

    // suggestions rendering and click handling
    function renderSuggestions(raw) {
      const q = (raw || "").trim();
      if (!div.classList.contains("expanded")) return;
      if (!q) { sugg.innerHTML = ""; return; }

      const qNorm = q.replace(/\s+/g, "").toUpperCase();

      // collect fleet suggestions: startsWith by normalized label
      const fleetItems = [];
      for (const [label, marker] of vehicleIndexByFleet.entries()) {
        if (label.startsWith(qNorm)) {
          const rName = marker.tripId ? (routes[Object.values(routes).find(r => r.route_short_name === (routes[marker.tripId]?.route_short_name))] || {}) : {};
          fleetItems.push({ kind: "fleet", label, marker });
          if (fleetItems.length >= 6) break;
        }
      }

      // collect route suggestions: startsWith by route key
      const routeItems = [];
      for (const [rKey, set] of routeIndex.entries()) {
        if (rKey.startsWith(qNorm)) {
          routeItems.push({ kind: "route", rKey, count: set.size });
          if (routeItems.length >= 6) break;
        }
      }

      // build HTML
      const parts = [];
      if (fleetItems.length > 0) {
        parts.push(`<div class="suggestion-section">Fleets</div>`);
        fleetItems.forEach(it => {
          parts.push(`<div class="suggestion-item" data-kind="fleet" data-id="${it.label}">
              <span>${it.label}</span><span class="suggestion-meta">vehicle</span>
            </div>`);
        });
      }
      if (routeItems.length > 0) {
        parts.push(`<div class="suggestion-section">Routes</div>`);
        routeItems.forEach(it => {
          parts.push(`<div class="suggestion-item" data-kind="route" data-id="${it.rKey}">
              <span>${it.rKey}</span><span class="suggestion-meta">${it.count} vehicle${it.count===1?"":"s"}</span>
            </div>`);
        });
      }
      sugg.innerHTML = parts.join("") || "";

      // item click
      sugg.querySelectorAll(".suggestion-item").forEach(el => {
        el.addEventListener("mousedown", ev => {
          ev.preventDefault(); // keep focus
          const kind = el.getAttribute("data-kind");
          const id = el.getAttribute("data-id");
          if (kind === "fleet") {
            const m = vehicleIndexByFleet.get(id);
            if (m) {
              const ll = m.getLatLng();
              map.setView(ll, Math.max(map.getZoom(), 14));
              if (pinnedPopup && pinnedPopup !== m) pinnedPopup.closePopup();
              pinnedPopup = m;
              m.openPopup();
              clearRouteHighlights();
              input.value = id;
            }
          } else if (kind === "route") {
            const set = routeIndex.get(id);
            if (set && set.size > 0) {
              const list = Array.from(set);
              highlightMarkers(list);
              list[0].openPopup();
              input.value = id;
            }
          }
        });
      });
    }

    // expose for cleanup if the control is removed
    this._collapseAndReset = collapseAndReset;
    this._docHandler = onDocDown;

    return div;
  },
  onRemove: function () {
    // in case we ever remove the control
    document.removeEventListener("mousedown", this._docHandler);
    if (typeof this._collapseAndReset === "function") this._collapseAndReset();
  }
});
map.addControl(new SearchControl({ position: "topright" }));

// --- Trips batch fetch with chunking and marker refresh ---
async function fetchTripsBatch(tripIds) {
  const idsToFetch = tripIds.filter(tid => tid && !tripCache[tid]);
  if (idsToFetch.length === 0) return;

  const batches = chunk([...new Set(idsToFetch)], 100);
  for (const ids of batches) {
    const tripJson = await safeFetch(`${tripsUrl}?ids=${ids.join(",")}`);
    if (!tripJson || tripJson._rateLimited) {
      if (tripJson && tripJson._rateLimited) applyRateLimitBackoff(tripJson.retryAfterMs, "trips");
      continue;
    }
    if (tripJson?.data?.length > 0) {
      tripJson.data.forEach(t => {
        const a = t.attributes;
        if (a) {
          tripCache[a.trip_id] = {
            trip_id: a.trip_id,
            trip_headsign: a.trip_headsign || "N/A",
            route_id: a.route_id,
            bikes_allowed: a.bikes_allowed
          };
        }
      });

      // refresh any markers for these trips
      ids.forEach(tid => {
        const trip = tripCache[tid];
        if (!trip) return;
        Object.values(vehicleMarkers).forEach(m => {
          if (m.tripId === tid) {
            const r = routes[trip.route_id] || {};
            const basePopup = buildPopup(
              r.route_short_name || r.route_long_name || "Unknown",
              trip.trip_headsign || r.route_long_name || "Unknown",
              m.vehicleLabel || "N/A",
              m.busType || "",
              m.licensePlate || "N/A",
              m.speedStr || "",
              m.occupancy || "",
              m.bikesLine || ""
            );
            const pairedNote = m.pairedTo ? `<br><b>Paired to:</b> ${m.pairedTo} (6-car)` : "";
            m.setPopupContent(basePopup + pairedNote);
          }
        });
      });
    }
  }
}

// --- AM train pairing ---
function pairAMTrains(inService, outOfService) {
  const pairs = [];
  const usedOut = new Set();
  inService.forEach(inTrain => {
    let bestMatch = null, bestDist = Infinity;
    outOfService.forEach(o => {
      if (usedOut.has(o.vehicleId)) return;
      const dx = inTrain.lat - o.lat;
      const dy = inTrain.lon - o.lon;
      const dist = Math.sqrt(dx*dx + dy*dy) * 111000;
      if (dist <= 200 && Math.abs(inTrain.speedKmh - o.speedKmh) <= 15) {
        if (dist < bestDist) { bestDist = dist; bestMatch = o; }
      }
    });
    if (bestMatch) {
      usedOut.add(bestMatch.vehicleId);
      pairs.push({ inTrain, outTrain: bestMatch });
    }
  });

  pairs.forEach(pair => {
    const inColor = pair.inTrain.color || vehicleColors.train;
    const outMarker = vehicleMarkers[pair.outTrain.vehicleId];
    const inMarker  = vehicleMarkers[pair.inTrain.vehicleId];
    if (outMarker) {
      outMarker.setStyle({ fillColor: inColor });
      const baseContent = outMarker.getPopup()?.getContent() || "";
      outMarker.getPopup().setContent(baseContent + `<br><b>Paired to:</b> ${pair.inTrain.vehicleLabel} (6-car)`);
      outMarker.pairedTo = pair.inTrain.vehicleLabel;
    }
    if (inMarker) inMarker.pairedTo = pair.outTrain.vehicleLabel;
  });

  return pairs;
}

// --- Render cached snapshot ---
function renderFromCache(cached) {
  if (!cached) return;
  cached.forEach(v => {
    addOrUpdateMarker(
      v.vehicleId, v.lat, v.lon, v.popupContent, v.color, v.typeKey, v.tripId,
      {
        currentType: v.typeKey,
        vehicleLabel: v.vehicleLabel || "",
        licensePlate: v.licensePlate || "",
        busType: v.busType || "",
        speedStr: v.speedStr || "",
        occupancy: v.occupancy || "",
        bikesLine: v.bikesLine || ""
      }
    );
  });
  setDebug(`Showing cached data (last update: ${new Date(cached[0]?.ts || Date.now()).toLocaleTimeString()})`);
  updateVehicleCount();
}

// --- Train colour helper ---
function trainColorForRoute(routeShortName) {
  if (!routeShortName) return vehicleColors.train;
  if (routeShortName.includes("STH")) return trainLineColors.STH;
  if (routeShortName.includes("WEST")) return trainLineColors.WEST;
  if (routeShortName.includes("EAST")) return trainLineColors.EAST;
  if (routeShortName.includes("ONE")) return trainLineColors.ONE;
  return vehicleColors.train;
}

// --- Rate limit backoff ---
function applyRateLimitBackoff(retryAfterMs, sourceLabel) {
  const retry = Math.max(retryAfterMs || 0, BACKOFF_START_MS);
  backoffMs = backoffMs ? Math.min(BACKOFF_MAX_MS, Math.max(backoffMs * 2, retry)) : retry;
  backoffUntilTs = Date.now() + backoffMs;
  setDebug(`Rate limited by ${sourceLabel}. Backing off for ${(backoffMs/1000).toFixed(0)} s`);
}

// --- Fetch vehicles with anti-overlap, visibility gating, and 429 handling ---
async function fetchVehicles() {
  if (!pageVisible) return;
  if (vehiclesInFlight) return;
  if (backoffUntilTs && Date.now() < backoffUntilTs) return;

  vehiclesInFlight = true;
  try {
    vehiclesAbort?.abort?.();
    vehiclesAbort = new AbortController();

    const json = await safeFetch(realtimeUrl, { signal: vehiclesAbort.signal });
    if (!json) return;
    if (json._rateLimited) { applyRateLimitBackoff(json.retryAfterMs, "realtime"); return; }

    // decay backoff on success
    if (backoffMs) { backoffMs = Math.floor(backoffMs / 2); if (backoffMs < 5000) backoffMs = 0; }
    backoffUntilTs = 0;

    const vehicles = json?.response?.entity || json?.entity || [];
    const newIds = new Set();
    const inServiceAM = [], outOfServiceAM = [];
    const allTripIds = [];
    const cachedState = [];

    // rebuild search indexes
    vehicleIndexByFleet.clear();
    routeIndex.clear();

    vehicles.forEach(v => {
      const vehicleId = v.vehicle?.vehicle?.id;
      if (!v.vehicle || !v.vehicle.position || !vehicleId) return;
      newIds.add(vehicleId);

      const lat = v.vehicle.position.latitude;
      const lon = v.vehicle.position.longitude;
      const vehicleLabel = v.vehicle.vehicle?.label || "N/A";
      const licensePlate = v.vehicle.vehicle?.license_plate || "N/A";

      const operator = v.vehicle.vehicle?.operator_id
        || (vehicleLabel.match(/^[A-Za-z]+/)?.[0] ?? "")
        || "";
      const vehicleNumber = (() => {
        const digits = Number(vehicleLabel.replace(/\D/g, ""));
        if (!isNaN(digits) && digits > 0) return digits;
        return Number(vehicleLabel) || Number(vehicleLabel.slice(2)) || 0;
      })();

      // Speed
      let speedKmh = null;
      let speedStr = "N/A";
      if (v.vehicle.position.speed !== undefined) {
        const rIdTmp = v.vehicle?.trip?.route_id;
        const rTypeTmp = routes[rIdTmp]?.route_type;
        const isTrainTmp = rTypeTmp === 2;
        const isFerryTmp = rTypeTmp === 4;
        const isAM = vehicleLabel.startsWith("AM");
        speedKmh = (isTrainTmp || isFerryTmp || isAM) ? v.vehicle.position.speed * 3.6
                                                      : v.vehicle.position.speed;
        if (isFerryTmp && speedKmh !== null) {
          const speedKnots = v.vehicle.position.speed * 1.94384;
          speedStr = `${speedKmh.toFixed(1)} km/h (${speedKnots.toFixed(1)} kn)`;
        } else {
          speedStr = `${speedKmh.toFixed(1)} km/h`;
        }
      }

      // Occupancy
      let occupancy = "N/A";
      if (v.vehicle.occupancy_status !== undefined) {
        const idx = v.vehicle.occupancy_status;
        if (idx >= 0 && idx <= 6) occupancy = occupancyLabels[idx];
      }

      // Classification and colours
      let typeKey = "out", color = vehicleColors.out;
      let routeName = "Out of Service", destination = "Unknown";
      const routeId = v.vehicle?.trip?.route_id;
      const tripId = v.vehicle?.trip?.trip_id;

      if (routeId && tripId && routes[routeId]) {
        const r = routes[routeId];
        routeName = r.route_short_name || r.route_long_name || "Unknown";
        switch (r.route_type) {
          case 2: { typeKey = "train"; color = trainColorForRoute(r.route_short_name); break; }
          case 3: { typeKey = "bus";   color = vehicleColors.bus; break; }
          case 4: { typeKey = "ferry"; color = vehicleColors.ferry; break; }
        }
      }
      if (routes[routeId]?.route_type === 3) { typeKey = "bus"; color = vehicleColors.bus; }
      if (tripId) allTripIds.push(tripId);

      // Destination
      if (tripId && tripCache[tripId]?.trip_headsign) {
        destination = tripCache[tripId].trip_headsign;
      } else if (routes[routeId]) {
        destination = routes[routeId].route_long_name || routes[routeId].route_short_name || "Unknown";
      }

      // Bikes allowed
      let bikesLine = "";
      const tripData = tripId ? tripCache[tripId] : null;
      if (tripData?.bikes_allowed !== undefined) {
        if (typeKey === "bus" && tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
        if (typeKey === "train") {
          if (tripData.bikes_allowed === 2) bikesLine = `<br><b>Bikes Allowed:</b> Yes`;
          else if (tripData.bikes_allowed === 1) bikesLine = `<br><b>Bikes Allowed:</b> Some`;
        }
      }

      // Bus type lookup
      let busType = vehicleMarkers[vehicleId]?.busType || "";
      const wasBus = vehicleMarkers[vehicleId]?.currentType === "bus";
      const isBusNow = typeKey === "bus";
      const mustComputeBusType =
        (isBusNow && !busType) || (isBusNow && !wasBus) || (!vehicleMarkers[vehicleId] && isBusNow);
      if (mustComputeBusType && operator && vehicleNumber) {
        const model = getBusType(operator, vehicleNumber);
        if (model) busType = model;
      }

      const popupContent = buildPopup(
        routeName, destination, vehicleLabel, busType, licensePlate, speedStr, occupancy, bikesLine
      );

      // AM pairing pools
      if (vehicleLabel.startsWith("AM")) {
        if (typeKey === "train") inServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel, color });
        else outOfServiceAM.push({ vehicleId, lat, lon, speedKmh, vehicleLabel });
      }

      addOrUpdateMarker(
        vehicleId, lat, lon, popupContent, color, typeKey, tripId,
        { currentType: typeKey, vehicleLabel, licensePlate, busType, speedStr, occupancy, bikesLine }
      );

      // Build indexes
      if (vehicleLabel && typeKey !== "out") {
        vehicleIndexByFleet.set(normalizeFleetLabel(vehicleLabel), vehicleMarkers[vehicleId]);
      }
      if (routes[routeId]?.route_short_name && typeKey !== "out") {
        const rKey = normalizeRouteKey(routes[routeId].route_short_name);
        if (!routeIndex.has(rKey)) routeIndex.set(rKey, new Set());
        routeIndex.get(rKey).add(vehicleMarkers[vehicleId]);
      }

      cachedState.push({
        vehicleId, lat, lon, popupContent, color, typeKey, tripId, ts: Date.now(),
        vehicleLabel, licensePlate, busType, speedStr, occupancy, bikesLine
      });
    });

    // AM pairing
    pairAMTrains(inServiceAM, outOfServiceAM);

    // Remove stale; unpin if removing pinned marker
    Object.keys(vehicleMarkers).forEach(id => {
      if (!newIds.has(id)) {
        if (pinnedPopup === vehicleMarkers[id]) pinnedPopup = null;
        map.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    localStorage.setItem("realtimeSnapshot", JSON.stringify(cachedState));
    setDebug(`Realtime update complete at ${new Date().toLocaleTimeString()}`);
    updateVehicleCount();

    // Fill headsigns via trips
    await fetchTripsBatch([...new Set(allTripIds)]);
  } finally {
    vehiclesInFlight = false;
  }
}

// --- Scheduler (jitter + backoff) ---
function scheduleNextFetch() {
  if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null; }
  if (!pageVisible) return;
  const delay = basePollDelay() + (backoffMs || 0);
  pollTimeoutId = setTimeout(async () => {
    if (!pageVisible) return;
    await fetchVehicles();
    scheduleNextFetch();
  }, delay);
}

// --- Visibility handling with delayed pause ---
function pauseUpdatesNow() {
  pageVisible = false;
  if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null; }
  vehiclesAbort?.abort?.();
  setDebug("Paused updates: tab not visible");
}
function schedulePauseAfterHide() {
  if (hidePauseTimerId) return;
  hidePauseTimerId = setTimeout(() => {
    hidePauseTimerId = null;
    if (document.hidden) pauseUpdatesNow();
  }, HIDE_PAUSE_DELAY_MS);
}
function cancelScheduledPause() { if (hidePauseTimerId) { clearTimeout(hidePauseTimerId); hidePauseTimerId = null; } }
async function resumeUpdatesNow() {
  cancelScheduledPause();
  const wasHidden = !pageVisible;
  pageVisible = true;
  if (wasHidden) { setDebug("Tab visible. Refreshing…"); await fetchVehicles(); }
  scheduleNextFetch();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) schedulePauseAfterHide();
  else resumeUpdatesNow();
});

// --- Init ---
async function init() {
  const routesJson = await safeFetch(routesUrl);
  if (routesJson && routesJson._rateLimited) applyRateLimitBackoff(routesJson.retryAfterMs, "routes");
  if (routesJson?.data) {
    routesJson.data.forEach(r => {
      const a = r.attributes || r;
      routes[r.id] = {
        route_type: a.route_type,
        route_short_name: a.route_short_name,
        route_long_name: a.route_long_name,
        route_color: a.route_color,
        agency_id: a.agency_id
      };
    });
  }

  const busTypesJson = await safeFetch(busTypesUrl);
  if (busTypesJson && busTypesJson._rateLimited) applyRateLimitBackoff(busTypesJson.retryAfterMs, "busTypes");
  if (busTypesJson && !busTypesJson._rateLimited) {
    busTypes = busTypesJson;
    busTypeIndex = buildBusTypeIndex(busTypesJson);
  }

  // Render cached snapshot if present
  const cached = localStorage.getItem("realtimeSnapshot");
  if (cached) { try { renderFromCache(JSON.parse(cached)); } catch {} }

  // Wire your external checkboxes
  document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", e => {
      const layer = e.target.getAttribute("data-layer");
      if (vehicleLayers[layer]) {
        if (e.target.checked) map.addLayer(vehicleLayers[layer]);
        else map.removeLayer(vehicleLayers[layer]);
      }
    });
  });

  await fetchVehicles();
  scheduleNextFetch();
}
init();
