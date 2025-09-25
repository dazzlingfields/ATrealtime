// ================== v4.56 - Realtime Vehicle Tracking ==================
// Mobile UX: search stays top-right; Vehicle Display checkboxes compact on mobile.
// Keeps: retractable search w/ suggestions, hover-open + click-to-pin, route highlight
// w/ enlarged markers, visibility-aware polling, jitter 10–15 s, 429 backoff, trips
// chunking, fast bus-type lookup, immediate headsigns, AM pairing, train line colours.

// --- API endpoints ---
const proxyBaseUrl = "https://atrealtime.vercel.app";
const realtimeUrl  = `${proxyBaseUrl}/api/realtime`;
const routesUrl    = `${proxyBaseUrl}/api/routes`;
const tripsUrl     = `${proxyBaseUrl}/api/trips`;
const busTypesUrl  = "https://raw.githubusercontent.com/dazzlingfields/ATrealtime/refs/heads/main/busTypes.json";

// --- Map initialization ---
const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{attribution:"&copy; OpenStreetMap contributors &copy; CARTO",subdomains:"abcd",maxZoom:20});
const dark  = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{attribution:"&copy; OpenStreetMap contributors &copy; CARTO",subdomains:"abcd",maxZoom:20});
const osm   = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"&copy; OpenStreetMap contributors"});
const satellite  = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles © Esri"});
const esriImagery= L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles © Esri, Maxar, Earthstar Geographics",maxZoom:20});
const esriLabels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",{attribution:"Labels © Esri",maxZoom:20});
const esriHybrid = L.layerGroup([esriImagery, esriLabels]);

const map = L.map("map",{center:[-36.8485,174.7633],zoom:12,layers:[light],zoomControl:false});
const baseMaps = {"Light":light,"Dark":dark,"OSM":osm,"Satellite":satellite,"Esri Hybrid":esriHybrid};
L.control.layers(baseMaps,null).addTo(map);

// Overlays (toggled by external #filters panel)
const vehicleLayers={bus:L.layerGroup().addTo(map),train:L.layerGroup().addTo(map),ferry:L.layerGroup().addTo(map),out:L.layerGroup().addTo(map)};

// --- Data/state ---
const vehicleMarkers={};
const tripCache={};
let routes={}, busTypes={}, busTypeIndex={};
const vehicleIndexByFleet=new Map(), routeIndex=new Map();
const debugBox=document.getElementById("debug");
let pinnedPopup=null;

map.on("click",()=>{ if(pinnedPopup){pinnedPopup.closePopup(); pinnedPopup=null;} clearRouteHighlights(); });

const vehicleColors={bus:"#4a90e2",train:"#d0021b",ferry:"#1abc9c",out:"#9b9b9b"};
const trainLineColors={STH:"#d0021b",WEST:"#6aa84f",EAST:"#f8e71c",ONE:"#0e76a8"};
const occupancyLabels=["Empty","Many Seats Available","Few Seats Available","Standing Room Only","Limited Standing Room","Full","Not accepting passengers"];

// --- Polling/backoff/visibility ---
const MIN_POLL_MS=10000, MAX_POLL_MS=15000;
function basePollDelay(){return MIN_POLL_MS+Math.floor(Math.random()*(MAX_POLL_MS-MIN_POLL_MS+1));}
let backoffMs=0, BACKOFF_START_MS=30000, BACKOFF_MAX_MS=5*60*1000, backoffUntilTs=0;
let vehiclesAbort, vehiclesInFlight=false, pollTimeoutId=null, pageVisible=!document.hidden;
let hidePauseTimerId=null; const HIDE_PAUSE_DELAY_MS=10000;

// --- Helpers ---
function setDebug(msg){ if(debugBox) debugBox.textContent=msg; }
function parseRetryAfterMs(v){ if(!v) return 0; const s=Number(v); if(!isNaN(s)) return Math.max(0,Math.floor(s*1000)); const t=Date.parse(v); return isNaN(t)?0:Math.max(0,t-Date.now()); }
async function safeFetch(url,opts={}){
  try{
    const res=await fetch(url,{cache:"no-store",...opts});
    if(res.status===429){const retryAfterMs=parseRetryAfterMs(res.headers.get("Retry-After")); let body=""; try{body=await res.text();}catch{} return {_rateLimited:true,retryAfterMs};}
    if(!res.ok){let body=""; try{body=await res.text();}catch{} throw new Error(`${res.status} ${res.statusText}${body?` | ${body.slice(0,200)}`:""}`);}
    return await res.json();
  }catch(err){console.error("Fetch error:",err); setDebug(`Fetch error: ${err.message}`); return null;}
}
function chunk(a,n){const o=[]; for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n)); return o;}
function buildBusTypeIndex(json){const idx={}; if(!json||typeof json!=="object") return idx; for(const model of Object.keys(json)){const ops=json[model]||{}; for(const op of Object.keys(ops)){const nums=ops[op]||[]; if(!idx[op]) idx[op]={}; for(const n of nums) idx[op][n]=model;}} return idx;}
function getBusType(op,num){const ix=busTypeIndex[op]; return ix?(ix[num]||""):"";}
function trainColorForRoute(s){ if(!s) return vehicleColors.train; if(s.includes("STH"))return trainLineColors.STH; if(s.includes("WEST"))return trainLineColors.WEST; if(s.includes("EAST"))return trainLineColors.EAST; if(s.includes("ONE"))return trainLineColors.ONE; return vehicleColors.train; }

function buildPopup(routeName,destination,vehicleLabel,busType,licensePlate,speedStr,occupancy,bikesLine){
  return `<div style="font-size:0.9em;line-height:1.3;">
      <b>Route:</b> ${routeName}<br>
      <b>Destination:</b> ${destination}<br>
      <b>Vehicle:</b> ${vehicleLabel}<br>
      ${busType?`<b>Bus Model:</b> ${busType}<br>`:""}
      <b>Number Plate:</b> ${licensePlate}<br>
      <b>Speed:</b> ${speedStr}<br>
      <b>Occupancy:</b> ${occupancy}
      ${bikesLine}
    </div>`;
}

// --- Marker creation/update (hover open, click pin) ---
function addOrUpdateMarker(id,lat,lon,popupContent,color,type,tripId,fields={}){
  const isMobile=window.innerWidth<=600;
  const baseRadius=isMobile?4:5; // slightly smaller default
  const popupOpts={maxWidth:isMobile?200:250,className:"vehicle-popup"};

  if(vehicleMarkers[id]){
    const m=vehicleMarkers[id];
    m.setLatLng([lat,lon]); m.setPopupContent(popupContent); m.setStyle({fillColor:color}); m.tripId=tripId;
    if(m._baseRadius==null) m._baseRadius=baseRadius;
    Object.assign(m,fields);
    Object.values(vehicleLayers).forEach(l=>l.removeLayer(m)); (vehicleLayers[type]||vehicleLayers.out).addLayer(m);
  }else{
    const marker=L.circleMarker([lat,lon],{radius:baseRadius,fillColor:color,color:"#000",weight:1,opacity:1,fillOpacity:0.9});
    marker._baseRadius=baseRadius;
    (vehicleLayers[type]||vehicleLayers.out).addLayer(marker);
    marker.bindPopup(popupContent,popupOpts);
    if(!marker._eventsBound){
      marker.on("mouseover",function(){ if(pinnedPopup!==this) this.openPopup(); });
      marker.on("mouseout", function(){ if(pinnedPopup!==this) this.closePopup(); });
      marker.on("click",    function(e){ if(pinnedPopup&&pinnedPopup!==this) pinnedPopup.closePopup(); pinnedPopup=this; this.openPopup(); e?.originalEvent?.stopPropagation?.(); });
      marker._eventsBound=true;
    }
    marker.tripId=tripId; Object.assign(marker,fields); vehicleMarkers[id]=marker;
  }
}

function updateVehicleCount(){
  const busCount=Object.values(vehicleMarkers).filter(m=>vehicleLayers.bus.hasLayer(m)).length;
  const trainCount=Object.values(vehicleMarkers).filter(m=>vehicleLayers.train.hasLayer(m)).length;
  const ferryCount=Object.values(vehicleMarkers).filter(m=>vehicleLayers.ferry.hasLayer(m)).length;
  const el=document.getElementById("vehicle-count"); if(el) el.textContent=`Buses: ${busCount}, Trains: ${trainCount}, Ferries: ${ferryCount}`;
}

// --- Style injection: popups, search, and mobile-optimized #filters panel ---
(function injectStyle(){
  const style=document.createElement("style");
  style.textContent=`
  .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:rgba(255,255,255,0.85);backdrop-filter:blur(4px);}
  .veh-highlight{stroke:#333;stroke-width:3;}

  /* Search control stays top-right on all screens */
  .leaflet-control.search-control{position:relative;background:rgba(255,255,255,0.9);padding:6px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.25);display:flex;align-items:center;gap:6px;z-index:4000;}
  .search-icon-btn{width:28px;height:28px;border:1px solid #bbb;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:white;}
  .search-icon-btn svg{width:16px;height:16px;}
  .search-input{width:0;opacity:0;border:1px solid #bbb;border-radius:4px;padding:4px 8px;font-size:13px;transition:width .14s ease,opacity .12s ease;}
  .search-control.expanded .search-input{width:220px;opacity:1;}
  .search-suggestions{position:absolute;top:100%;left:0;right:0;background:rgba(255,255,255,.97);border:1px solid #bbb;border-radius:6px;margin-top:6px;max-height:240px;overflow:auto;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;}
  .search-control.expanded .search-suggestions{display:block;}
  .suggestion-section{padding:6px 6px 0 6px;font-size:12px;color:#666;}
  .suggestion-item{padding:6px 10px;font-size:13px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;}
  .suggestion-item:hover{background:#eef3ff;}
  .suggestion-meta{color:#666;font-size:12px;}

  /* Mobile: compact search plus compact Vehicle Display card */
  @media (max-width:600px){
    .leaflet-control.search-control{padding:4px;}
    .search-icon-btn{width:26px;height:26px;}
    .search-control.expanded .search-input{width:170px;}
    .search-suggestions{max-height:50vh;}

    /* #filters card compaction */
    #filters{
      font-size:13px;
      padding:8px 10px;
      border-radius:14px;
      box-shadow:0 1px 6px rgba(0,0,0,.15);
      background:rgba(255,255,255,0.92);
      max-width:min(86vw,320px);
    }
    #filters h2{font-size:20px;margin:0 0 6px 0;}
    #filters .row{display:flex;align-items:center;gap:8px;margin:6px 0;}
    #filters input[type="checkbox"]{transform:scale(.9);transform-origin:left top;}
    #filters label{font-size:13px;line-height:1.2;}
    #filters .meta{font-size:12px;opacity:.8;}
  }`;
  document.head.appendChild(style);
})();

// --- Search helpers and highlighting ---
function normalizeFleetLabel(s){return (s||"").toString().trim().replace(/\s+/g,"").toUpperCase();}
function normalizeRouteKey(s){return (s||"").toString().trim().replace(/\s+/g,"").toUpperCase();}

function clearRouteHighlights(){
  Object.values(vehicleMarkers).forEach(m=>{
    if(m._isRouteHighlighted){
      try{ if(typeof m.setRadius==="function" && m._baseRadius!=null) m.setRadius(m._baseRadius); m.setStyle({weight:1}); }catch{}
      m._isRouteHighlighted=false;
    }
  });
}
function highlightMarkers(markers){
  clearRouteHighlights();
  const bounds=[];
  markers.forEach(m=>{
    try{ if(typeof m.setRadius==="function" && m._baseRadius!=null) m.setRadius(m._baseRadius+2); m.setStyle({weight:3}); m._isRouteHighlighted=true; bounds.push(m.getLatLng()); }catch{}
  });
  if(bounds.length>0) map.fitBounds(L.latLngBounds(bounds),{padding:[40,40]});
}
function resolveQueryToMarkers(qRaw){
  const q=(qRaw||"").trim(); if(!q) return {type:"none",markers:[]};
  const fleet=normalizeFleetLabel(q), route=normalizeRouteKey(q);
  const hasLetters=/[A-Z]/i.test(fleet), hasDigits=/\d/.test(fleet);
  if(hasLetters && hasDigits){ const m=vehicleIndexByFleet.get(fleet); return m?{type:"fleet",markers:[m],exemplar:m}:{type:"none",markers:[]}; }
  const set=routeIndex.get(route); if(set && set.size>0){ const arr=[...set]; return {type:"route",markers:arr,exemplar:arr[0]}; }
  return {type:"none",markers:[]};
}

// --- Retractable search (top-right), placeholder "search here" ---
const SearchControl=L.Control.extend({
  options:{position:"topright"},
  onAdd:function(){
    const div=L.DomUtil.create("div","leaflet-control search-control");
    const btn=L.DomUtil.create("button","search-icon-btn",div);
    btn.type="button"; btn.title="Search";
    btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    const input=L.DomUtil.create("input","search-input",div);
    input.type="text"; input.placeholder="search here";
    const sugg=L.DomUtil.create("div","search-suggestions",div);

    L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);

    function expand(){ div.classList.add("expanded"); input.focus(); renderSuggestions(input.value); }
    function collapseAndReset(){ input.value=""; sugg.innerHTML=""; div.classList.remove("expanded"); clearRouteHighlights(); if(pinnedPopup){pinnedPopup.closePopup(); pinnedPopup=null;} }

    btn.addEventListener("click",()=>{ if(div.classList.contains("expanded")) collapseAndReset(); else expand(); });

    let debounceId=null;
    input.addEventListener("input",()=>{ if(debounceId) clearTimeout(debounceId); debounceId=setTimeout(()=>renderSuggestions(input.value),180); });

    input.addEventListener("keydown",e=>{
      if(e.key==="Enter"){
        e.preventDefault();
        const res=resolveQueryToMarkers(input.value);
        if(res.type==="fleet"){ const m=res.exemplar; const ll=m.getLatLng(); map.setView(ll,Math.max(map.getZoom(),14)); if(pinnedPopup&&pinnedPopup!==m) pinnedPopup.closePopup(); pinnedPopup=m; m.openPopup(); clearRouteHighlights(); }
        else if(res.type==="route"){ highlightMarkers(res.markers); res.exemplar?.openPopup(); }
        else clearRouteHighlights();
      }else if(e.key==="Escape"){ e.preventDefault(); collapseAndReset(); }
    });

    document.addEventListener("mousedown",onDocDown);
    function onDocDown(ev){ if(div.classList.contains("expanded") && !div.contains(ev.target)) collapseAndReset(); }

    function renderSuggestions(raw){
      const q=(raw||"").trim(); if(!div.classList.contains("expanded")) return; if(!q){sugg.innerHTML=""; return;}
      const qNorm=q.replace(/\s+/g,"").toUpperCase();
      const fleets=[], routes=[];
      for(const [label,marker] of vehicleIndexByFleet.entries()){ if(label.startsWith(qNorm)){fleets.push({kind:"fleet",label}); if(fleets.length>=6) break;} }
      for(const [rk,set] of routeIndex.entries()){ if(rk.startsWith(qNorm)){routes.push({kind:"route",rk,count:set.size}); if(routes.length>=6) break;} }

      const html=[];
      if(fleets.length){ html.push(`<div class="suggestion-section">Fleets</div>`); fleets.forEach(it=>html.push(`<div class="suggestion-item" data-kind="fleet" data-id="${it.label}"><span>${it.label}</span><span class="suggestion-meta">vehicle</span></div>`)); }
      if(routes.length){ html.push(`<div class="suggestion-section">Routes</div>`); routes.forEach(it=>html.push(`<div class="suggestion-item" data-kind="route" data-id="${it.rk}"><span>${it.rk}</span><span class="suggestion-meta">${it.count} vehicle${it.count===1?"":"s"}</span></div>`)); }
      sugg.innerHTML=html.join("")||"";

      sugg.querySelectorAll(".suggestion-item").forEach(el=>{
        el.addEventListener("mousedown",ev=>{
          ev.preventDefault();
          const kind=el.getAttribute("data-kind"), id=el.getAttribute("data-id");
          if(kind==="fleet"){ const m=vehicleIndexByFleet.get(id); if(m){ const ll=m.getLatLng(); map.setView(ll,Math.max(map.getZoom(),14)); if(pinnedPopup&&pinnedPopup!==m) pinnedPopup.closePopup(); pinnedPopup=m; m.openPopup(); clearRouteHighlights(); input.value=id; } }
          if(kind==="route"){ const set=routeIndex.get(id); if(set&&set.size){ const list=[...set]; highlightMarkers(list); list[0].openPopup(); input.value=id; } }
        });
      });
    }
    this._collapseAndReset=collapseAndReset; this._docHandler=onDocDown;
    return div;
  },
  onRemove:function(){ document.removeEventListener("mousedown",this._docHandler); if(typeof this._collapseAndReset==="function") this._collapseAndReset(); }
});
map.addControl(new SearchControl());

// --- Trips batch fetch (chunked) and marker refresh ---
async function fetchTripsBatch(tripIds){
  const idsToFetch=tripIds.filter(t=>t && !tripCache[t]); if(!idsToFetch.length) return;
  for(const ids of chunk([...new Set(idsToFetch)],100)){
    const tripJson=await safeFetch(`${tripsUrl}?ids=${ids.join(",")}`);
    if(!tripJson || tripJson._rateLimited){ if(tripJson&&tripJson._rateLimited) applyRateLimitBackoff(tripJson.retryAfterMs,"trips"); continue; }
    if(tripJson?.data?.length>0){
      tripJson.data.forEach(t=>{const a=t.attributes; if(a){tripCache[a.trip_id]={trip_id:a.trip_id,trip_headsign:a.trip_headsign||"N/A",route_id:a.route_id,bikes_allowed:a.bikes_allowed};}});
      ids.forEach(tid=>{
        const trip=tripCache[tid]; if(!trip) return;
        Object.values(vehicleMarkers).forEach(m=>{
          if(m.tripId===tid){
            const r=routes[trip.route_id]||{};
            const base=buildPopup(r.route_short_name||r.route_long_name||"Unknown",trip.trip_headsign||r.route_long_name||"Unknown",m.vehicleLabel||"N/A",m.busType||"",m.licensePlate||"N/A",m.speedStr||"",m.occupancy||"",m.bikesLine||"");
            const pair=m.pairedTo?`<br><b>Paired to:</b> ${m.pairedTo} (6-car)`:``;
            m.setPopupContent(base+pair);
          }
        });
      });
    }
  }
}

// --- AM pairing ---
function pairAMTrains(inSvc,outSvc){
  const pairs=[], used=new Set();
  inSvc.forEach(inT=>{
    let best=null, bestDist=Infinity;
    outSvc.forEach(o=>{
      if(used.has(o.vehicleId)) return;
      const dx=inT.lat-o.lat, dy=inT.lon-o.lon, dist=Math.sqrt(dx*dx+dy*dy)*111000;
      if(dist<=200 && Math.abs(inT.speedKmh-o.speedKmh)<=15){ if(dist<bestDist){bestDist=dist; best=o;} }
    });
    if(best){ used.add(best.vehicleId); pairs.push({inTrain:inT,outTrain:best}); }
  });
  pairs.forEach(p=>{
    const inColor=p.inTrain.color||vehicleColors.train;
    const outM=vehicleMarkers[p.outTrain.vehicleId], inM=vehicleMarkers[p.inTrain.vehicleId];
    if(outM){ outM.setStyle({fillColor:inColor}); const c=outM.getPopup()?.getContent()||""; outM.getPopup().setContent(c+`<br><b>Paired to:</b> ${p.inTrain.vehicleLabel} (6-car)`); outM.pairedTo=p.inTrain.vehicleLabel; }
    if(inM) inM.pairedTo=p.outTrain.vehicleLabel;
  });
  return pairs;
}

// --- Render cached snapshot ---
function renderFromCache(c){
  if(!c) return;
  c.forEach(v=>addOrUpdateMarker(v.vehicleId,v.lat,v.lon,v.popupContent,v.color,v.typeKey,v.tripId,{
    currentType:v.typeKey,vehicleLabel:v.vehicleLabel||"",licensePlate:v.licensePlate||"",busType:v.busType||"",speedStr:v.speedStr||"",occupancy:v.occupancy||"",bikesLine:v.bikesLine||""
  }));
  setDebug(`Showing cached data (last update: ${new Date(c[0]?.ts||Date.now()).toLocaleTimeString()})`);
  updateVehicleCount();
}

// --- Fetch vehicles ---
function applyRateLimitBackoff(retryAfterMs,who){const retry=Math.max(retryAfterMs||0,BACKOFF_START_MS); backoffMs=backoffMs?Math.min(BACKOFF_MAX_MS,Math.max(backoffMs*2,retry)):retry; backoffUntilTs=Date.now()+backoffMs; setDebug(`Rate limited by ${who}. Backing off for ${(backoffMs/1000).toFixed(0)} s`);}

async function fetchVehicles(){
  if(!pageVisible||vehiclesInFlight||(backoffUntilTs && Date.now()<backoffUntilTs)) return;
  vehiclesInFlight=true;
  try{
    vehiclesAbort?.abort?.(); vehiclesAbort=new AbortController();
    const json=await safeFetch(realtimeUrl,{signal:vehiclesAbort.signal});
    if(!json) return; if(json._rateLimited){ applyRateLimitBackoff(json.retryAfterMs,"realtime"); return; }
    if(backoffMs){ backoffMs=Math.floor(backoffMs/2); if(backoffMs<5000) backoffMs=0; } backoffUntilTs=0;

    const vehicles=json?.response?.entity||json?.entity||[];
    const newIds=new Set(), inServiceAM=[], outOfServiceAM=[], allTripIds=[], cachedState=[];
    vehicleIndexByFleet.clear(); routeIndex.clear();

    vehicles.forEach(v=>{
      const vehicleId=v.vehicle?.vehicle?.id; if(!v.vehicle||!v.vehicle.position||!vehicleId) return; newIds.add(vehicleId);
      const lat=v.vehicle.position.latitude, lon=v.vehicle.position.longitude;
      const vehicleLabel=v.vehicle.vehicle?.label||"N/A", licensePlate=v.vehicle.vehicle?.license_plate||"N/A";
      const operator=v.vehicle.vehicle?.operator_id||(vehicleLabel.match(/^[A-Za-z]+/)?.[0]??"");
      const vehicleNumber=(()=>{const d=Number(vehicleLabel.replace(/\D/g,"")); return !isNaN(d)&&d>0?d:(Number(vehicleLabel)||Number(vehicleLabel.slice(2))||0);})();

      // speed
      let speedKmh=null, speedStr="N/A"; const rId=v.vehicle?.trip?.route_id; const rType=routes[rId]?.route_type;
      const isTrain=rType===2, isFerry=rType===4, isAM=vehicleLabel.startsWith("AM");
      if(v.vehicle.position.speed!==undefined){
        speedKmh=(isTrain||isFerry||isAM)?v.vehicle.position.speed*3.6:v.vehicle.position.speed;
        speedStr=isFerry?`${speedKmh.toFixed(1)} km/h (${(v.vehicle.position.speed*1.94384).toFixed(1)} kn)`:`${speedKmh.toFixed(1)} km/h`;
      }

      // occupancy
      let occupancy="N/A"; if(v.vehicle.occupancy_status!==undefined){const idx=v.vehicle.occupancy_status; if(idx>=0&&idx<=6) occupancy=occupancyLabels[idx];}

      // classification
      let typeKey="out", color=vehicleColors.out, routeName="Out of Service", destination="Unknown";
      const routeId=v.vehicle?.trip?.route_id, tripId=v.vehicle?.trip?.trip_id;
      if(routeId && tripId && routes[routeId]){
        const r=routes[routeId]; routeName=r.route_short_name||r.route_long_name||"Unknown";
        switch(r.route_type){case 2:typeKey="train";color=trainColorForRoute(r.route_short_name);break; case 3:typeKey="bus";color=vehicleColors.bus;break; case 4:typeKey="ferry";color=vehicleColors.ferry;break;}
      }
      if(routes[routeId]?.route_type===3){typeKey="bus"; color=vehicleColors.bus;}
      if(tripId) allTripIds.push(tripId);

      if(tripId && tripCache[tripId]?.trip_headsign) destination=tripCache[tripId].trip_headsign;
      else if(routes[routeId]) destination=routes[routeId].route_long_name||routes[routeId].route_short_name||"Unknown";

      // bikes
      let bikesLine=""; const t=tripId?tripCache[tripId]:null;
      if(t?.bikes_allowed!==undefined){
        if(typeKey==="bus" && t.bikes_allowed===2) bikesLine=`<br><b>Bikes Allowed:</b> Yes`;
        if(typeKey==="train"){ if(t.bikes_allowed===2) bikesLine=`<br><b>Bikes Allowed:</b> Yes`; else if(t.bikes_allowed===1) bikesLine=`<br><b>Bikes Allowed:</b> Some`; }
      }

      // bus type
      let busType=vehicleMarkers[vehicleId]?.busType||"";
      const wasBus=vehicleMarkers[vehicleId]?.currentType==="bus", isBusNow=typeKey==="bus";
      const needType=(isBusNow && !busType) || (isBusNow && !wasBus) || (!vehicleMarkers[vehicleId] && isBusNow);
      if(needType && operator && vehicleNumber){ const model=getBusType(operator,vehicleNumber); if(model) busType=model; }

      const popup=buildPopup(routeName,destination,vehicleLabel,busType,licensePlate,speedStr,occupancy,bikesLine);

      if(vehicleLabel.startsWith("AM")){
        if(typeKey==="train") inServiceAM.push({vehicleId,lat,lon,speedKmh,vehicleLabel,color});
        else outOfServiceAM.push({vehicleId,lat,lon,speedKmh,vehicleLabel});
      }

      addOrUpdateMarker(vehicleId,lat,lon,popup,color,typeKey,tripId,{currentType:typeKey,vehicleLabel,licensePlate,busType,speedStr,occupancy,bikesLine});

      if(vehicleLabel && typeKey!=="out") vehicleIndexByFleet.set(normalizeFleetLabel(vehicleLabel),vehicleMarkers[vehicleId]);
      if(routes[routeId]?.route_short_name && typeKey!=="out"){ const rk=normalizeRouteKey(routes[routeId].route_short_name); if(!routeIndex.has(rk)) routeIndex.set(rk,new Set()); routeIndex.get(rk).add(vehicleMarkers[vehicleId]); }

      cachedState.push({vehicleId,lat,lon,popupContent:popup,color,typeKey,tripId,ts:Date.now(),vehicleLabel,licensePlate,busType,speedStr,occupancy,bikesLine});
    });

    pairAMTrains(inServiceAM,outOfServiceAM);

    Object.keys(vehicleMarkers).forEach(id=>{ if(!newIds.has(id)){ if(pinnedPopup===vehicleMarkers[id]) pinnedPopup=null; map.removeLayer(vehicleMarkers[id]); delete vehicleMarkers[id]; } });

    localStorage.setItem("realtimeSnapshot",JSON.stringify(cachedState));
    setDebug(`Realtime update complete at ${new Date().toLocaleTimeString()}`);
    updateVehicleCount();

    await fetchTripsBatch([...new Set(allTripIds)]);
  }finally{ vehiclesInFlight=false; }
}

function scheduleNextFetch(){
  if(pollTimeoutId){ clearTimeout(pollTimeoutId); pollTimeoutId=null; }
  if(!pageVisible) return;
  const delay=basePollDelay()+(backoffMs||0);
  pollTimeoutId=setTimeout(async()=>{ if(!pageVisible) return; await fetchVehicles(); scheduleNextFetch(); },delay);
}
function pauseUpdatesNow(){ pageVisible=false; if(pollTimeoutId){clearTimeout(pollTimeoutId); pollTimeoutId=null;} vehiclesAbort?.abort?.(); setDebug("Paused updates: tab not visible"); }
function schedulePauseAfterHide(){ if(hidePauseTimerId) return; hidePauseTimerId=setTimeout(()=>{ hidePauseTimerId=null; if(document.hidden) pauseUpdatesNow(); },HIDE_PAUSE_DELAY_MS); }
function cancelScheduledPause(){ if(hidePauseTimerId){clearTimeout(hidePauseTimerId); hidePauseTimerId=null;} }
async function resumeUpdatesNow(){ cancelScheduledPause(); const wasHidden=!pageVisible; pageVisible=true; if(wasHidden){ setDebug("Tab visible. Refreshing…"); await fetchVehicles(); } scheduleNextFetch(); }
document.addEventListener("visibilitychange",()=>{ if(document.hidden) schedulePauseAfterHide(); else resumeUpdatesNow(); });

// --- Init ---
async function init(){
  const rj=await safeFetch(routesUrl); if(rj&&rj._rateLimited) applyRateLimitBackoff(rj.retryAfterMs,"routes");
  if(rj?.data){ rj.data.forEach(r=>{const a=r.attributes||r; routes[r.id]={route_type:a.route_type,route_short_name:a.route_short_name,route_long_name:a.route_long_name,route_color:a.route_color,agency_id:a.agency_id};}); }

  const bj=await safeFetch(busTypesUrl); if(bj&&bj._rateLimited) applyRateLimitBackoff(bj.retryAfterMs,"busTypes");
  if(bj && !bj._rateLimited){ busTypes=bj; busTypeIndex=buildBusTypeIndex(bj); }

  const cached=localStorage.getItem("realtimeSnapshot"); if(cached){ try{ renderFromCache(JSON.parse(cached)); }catch{} }

  // Wire external #filters checkboxes
  document.querySelectorAll('#filters input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener("change",e=>{
      const layer=e.target.getAttribute("data-layer");
      if(vehicleLayers[layer]){ if(e.target.checked) map.addLayer(vehicleLayers[layer]); else map.removeLayer(vehicleLayers[layer]); }
    });
  });

  await fetchVehicles(); scheduleNextFetch();
}
init();
