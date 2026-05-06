

// plan_mode.js
let planModeActive = false;
let planLayerGroup = L.layerGroup();
let selectedUnit = 'cm_km';
let activeTileLayer = null;
let originalMapBg = '';

function initPlanMode() {
  const scaleDiv = document.createElement('div');
  scaleDiv.id = 'customScaleBar';
  document.getElementById('map').appendChild(scaleDiv);
  map.on('zoomend moveend', updatePlanScale);
  updatePlanScale();

  const btn = document.getElementById('btnTogglePlanMode');
  if(btn) btn.addEventListener('click', togglePlanMode);

  const dlBtn = document.getElementById('btnDownloadPDF');
  if(dlBtn) dlBtn.addEventListener('click', downloadPlanPDF);

  const unitSel = document.getElementById('planUnitSelect');
  if(unitSel) {
    unitSel.addEventListener('change', (e) => {
      selectedUnit = e.target.value;
      updatePlanScale();
      if(planModeActive) renderPlanView();
    });
  }
}

async function downloadPlanPDF() {
  const btn = document.getElementById('btnDownloadPDF');
  if(!btn) return;
  const origText = btn.textContent;
  btn.textContent = '⏳ กำลังสร้าง PDF...';
  btn.disabled = true;

  try {
    const mapEl = document.getElementById('map');
    // Ensure white background & tiles hidden
    mapEl.classList.add('plan-bg');
    await new Promise(res => setTimeout(res, 300));

    if(typeof html2canvas === 'undefined') throw new Error('html2canvas not loaded');
    if(typeof jspdf === 'undefined') throw new Error('jsPDF not loaded');

    const canvas = await html2canvas(mapEl, { 
      scale: 2, 
      backgroundColor: '#ffffff', 
      logging: false,
      ignoreElements: (el) => el.id === 'customScaleBar' // Hide scale bar in PDF
    });
    const imgData = canvas.toDataURL('image/png');
    
    // Create PDF (A4)
    const { jsPDF } = jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    
    const ratio = canvas.width / canvas.height;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    
    pdf.addImage(imgData, 'PNG', margin, margin, w, h);
    pdf.save('fence-plan.pdf');
  } catch(e) { 
    console.error(e); 
    alert('เกิดข้อผิดพลาด: กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อโหลดไลบรารี PDF'); 
  } finally { 
    btn.textContent = origText; 
    btn.disabled = false; 
  }
}

function togglePlanMode() {
  if (!allLines || allLines.length === 0) {
    alert('กรุณาวาดเส้นก่อนเข้าโหมดแผน');
    return;
  }

  planModeActive = !planModeActive;
  const sidebar = document.querySelector('.left-sidebar');
  const mapEl = document.getElementById('map');

  if (planModeActive) {
    // Disable map click (prevent new lines)
    map.off('click');
    map.getContainer().style.cursor = 'default';
    if (typeof measureActive !== 'undefined') { measureActive = false; }
    const measureBtn = document.getElementById('measureBtn');
    if (measureBtn) measureBtn.classList.remove('active');

    // Hide normal-mode overlays: polylines, labels, markers
    allLines.forEach(ld => {
      if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
      if (ld.segmentLabels) ld.segmentLabels.forEach(l => map.hasLayer(l) && map.removeLayer(l));
      if (ld.angleLabels)   ld.angleLabels.forEach(l =>   map.hasLayer(l) && map.removeLayer(l));
      if (ld.markers)       ld.markers.forEach(m =>       map.hasLayer(m) && map.removeLayer(m));
      if (ld.startMarker && map.hasLayer(ld.startMarker)) map.removeLayer(ld.startMarker);
      if (ld.branches) ld.branches.forEach(br => {
        if (br.polyline && map.hasLayer(br.polyline)) map.removeLayer(br.polyline);
        if (br.segmentLabels) br.segmentLabels.forEach(l => map.hasLayer(l) && map.removeLayer(l));
        if (br.angleLabels)   br.angleLabels.forEach(l =>   map.hasLayer(l) && map.removeLayer(l));
        if (br.markers)       br.markers.forEach(m =>       map.hasLayer(m) && map.removeLayer(m));
      });
    });
    if (typeof fenceLayerGroup !== 'undefined') fenceLayerGroup.clearLayers();

    // Hide bottom-right UI
    const measureInfo = document.getElementById('measureInfo');
    if (measureInfo) measureInfo.style.display = 'none';
    const measureTool = document.querySelector('.measure-tool');
    if (measureTool) measureTool.style.display = 'none';

    // Show plan panel, hide normal sidebar
    sidebar.classList.add('plan-mode-active');
    const planPanel = document.getElementById('planModePanel');
    if (planPanel) planPanel.style.display = 'block';

    // White map background, remove tiles
    originalMapBg = mapEl.style.background;
    mapEl.classList.add('plan-bg');
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) {
        activeTileLayer = layer;
        map.removeLayer(layer);
      }
    });

    const firstLine = allLines[0];
    if (firstLine && firstLine.points.length >= 2) {
      map.fitBounds(firstLine.points, { padding: [100, 100], maxZoom: 18, animate: true });
    }

    planLayerGroup.addTo(map);
    renderPlanView();

  } else {
    // Re-attach map click handler
    map.on('click', window._mapClickHandler || function(){});
    
    // Restore normal overlays
    allLines.forEach(ld => {
      if (ld.polyline && !map.hasLayer(ld.polyline)) ld.polyline.addTo(map);
      if (ld.segmentLabels && (typeof measurementsVisible === 'undefined' || measurementsVisible))
        ld.segmentLabels.forEach(l => !map.hasLayer(l) && l.addTo(map));
      if (ld.angleLabels && (typeof anglesVisible === 'undefined' || anglesVisible))
        ld.angleLabels.forEach(l => !map.hasLayer(l) && l.addTo(map));
      if (ld.markers) ld.markers.forEach(m => !map.hasLayer(m) && m.addTo(map));
    });

    // Restore bottom-right UI
    const measureTool = document.querySelector('.measure-tool');
    if (measureTool) measureTool.style.display = '';

    sidebar.classList.remove('plan-mode-active');
    const planPanel = document.getElementById('planModePanel');
    if (planPanel) planPanel.style.display = 'none';

    mapEl.classList.remove('plan-bg');
    mapEl.style.background = originalMapBg;
    if (activeTileLayer) activeTileLayer.addTo(map);

    map.removeLayer(planLayerGroup);
    planLayerGroup.clearLayers();

    if (typeof runFenceCalc === 'function') runFenceCalc();
  }
}

function renderPlanView() {
    planLayerGroup.clearLayers();
    const listEl = document.getElementById('planLineList');
    if (!listEl) return;
    listEl.innerHTML = '';

    allLines.forEach((ld, idx) => {
        const item = document.createElement('div');
        item.className = 'plan-line-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `plan_cb_${idx}`;
        cb.checked = true; // all checked by default
        cb.addEventListener('change', renderPlanView);
        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id;
        lbl.textContent = `Line ${idx + 1} — ${(ld.fenceType || 'ทั่วไป').toUpperCase()}`;
        item.appendChild(cb);
        item.appendChild(lbl);
        listEl.appendChild(item);
    });

    allLines.forEach((ld, idx) => {
        const cb = document.getElementById(`plan_cb_${idx}`);
        if (cb && cb.checked) drawPlanLine(ld, idx);
    });
}

function drawPlanLine(lineData, idx) {
    const pts = lineData.points;
    if(!pts || pts.length < 2) return;

    // Main black line
    L.polyline(pts, { color: '#1a1a1a', weight: 3, opacity: 1 }).addTo(planLayerGroup);

    // Line label
    L.marker(pts[0], {
        icon: L.divIcon({ className:'', html:`<div style="font-size:12px;font-weight:bold;color:#000;background:#fff;padding:2px 5px;border:1px solid #000;">Line ${idx+1}</div>`, iconSize:[0,0], iconAnchor:[10,10] }),
        zIndexOffset: 1500
    }).addTo(planLayerGroup);

    const m = Math.min(3, Math.max(1, parseFloat(document.getElementById('postSpacing')?.value) || 2.5));
    const n = (parseFloat(document.getElementById('postSizeWidth')?.value) || 6) * 0.0254;
    let dAcc = 0;

    // Use first segment as the "standard" length baseline
    const standardLen = hav(pts[0], pts[1]);

    for(let i=0; i<pts.length-1; i++) {
        const p0 = pts[i], p1 = pts[i+1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        // Determine if this segment needs the detailed pole & measurement breakdown
        const isDifferent = Math.abs(segLen - standardLen) > 0.05;
        const showDetails = i < 2 || isDifferent;

        // Calculate exact distances from segment start (p0) to each pole center
        let leftOff = (i === 0) ? 0 : n / 2;
        let rightOff = (i === pts.length - 2) ? 0 : n / 2;
        let usable = segLen - leftOff - rightOff;
        let poleDists = [leftOff];

        if(usable > 0.5) {
            const k = Math.max(0, Math.floor((usable - m) / (m + n)));
            let gap = (usable - k * n) / (k + 1);
            let cur = leftOff;
            for(let j=0; j<k; j++) {
                cur += gap + n;
                poleDists.push(cur);
            }
        }
        poleDists.push(segLen - rightOff);

        // Draw all poles in this segment
        poleDists.forEach((dist, pIdx) => {
            const pt = interp(pts, dAcc + dist);
            // Corner/start/end of line = red box, normal interior = white box
            const isCorner = (i === 0 && pIdx === 0) || (i === pts.length - 2 && pIdx === poleDists.length - 1);
            drawPlanPost(pt, b, isCorner, n);
        });

        // Only draw detailed measurements on specified segments
        if(showDetails) {
            // 1. Measure between each pole (white/red boxes)
            for(let j=0; j<poleDists.length-1; j++) {
                const sPt = interp(pts, dAcc + poleDists[j]);
                const ePt = interp(pts, dAcc + poleDists[j+1]);
                const spanLen = hav(sPt, ePt);
                // Offset 0.18m places it neatly between pole boxes
                drawDimLine(sPt, ePt, 0.18, spanLen.toFixed(2) + 'm', '#444');
            }
            // 2. Overall segment measurement
            drawDimLine(p0, p1, 0.55, segLen.toFixed(2) + 'm', '#000');
        }
        dAcc += segLen;
    }
}

function drawPlanPost(pt, b, isCorner, n) {
    const scale = window._poleScale || 1.0;
    const halfSz = (n * scale) / 2;
    const color = isCorner ? '#dc2626' : '#ffffff';

    const corners = [
        offPt(offPt(pt, b + 90, halfSz), b,        halfSz),
        offPt(offPt(pt, b - 90, halfSz), b,        halfSz),
        offPt(offPt(pt, b - 90, halfSz), b + 180,  halfSz),
        offPt(offPt(pt, b + 90, halfSz), b + 180,  halfSz),
    ];
    L.polygon(corners, {
        color: '#1a1a1a', weight: 2,
        fillColor: color, fillOpacity: 1, opacity: 1
    }).addTo(planLayerGroup);
}

function drawPostSizeLabel(pt, b, n, inches) {
    const halfN = (n * (window._poleScale || 1.0)) / 2;
    const left  = offPt(pt, b + 90, halfN);
    const right = offPt(pt, b - 90, halfN);
    const tickOff = 0.35;
    const ls = offPt(left,  b + 90, tickOff);
    const rs = offPt(right, b - 90, tickOff);

    // Witness (extension) lines
    L.polyline([left,  ls], { color: '#444', weight: 1, dashArray: '4,3' }).addTo(planLayerGroup);
    L.polyline([right, rs], { color: '#444', weight: 1, dashArray: '4,3' }).addTo(planLayerGroup);
    // Dim line
    L.polyline([ls, rs], { color: '#444', weight: 1.5 }).addTo(planLayerGroup);
    // End ticks
    const tLen = 0.06;
    L.polyline([offPt(ls, b, -tLen), offPt(ls, b, tLen)], { color: '#444', weight: 2 }).addTo(planLayerGroup);
    L.polyline([offPt(rs, b, -tLen), offPt(rs, b, tLen)], { color: '#444', weight: 2 }).addTo(planLayerGroup);
    // Label
    const mid = [(ls[0]+rs[0])/2, (ls[1]+rs[1])/2];
    const lp  = offPt(mid, b - 90, 0.12);
    L.marker(lp, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:11px;color:#222;font-family:'Courier New',monospace;font-weight:bold;white-space:nowrap;">${inches}" (${n.toFixed(3)}m)</div>`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);
}
function drawPostSizeLabel(pt, b, n, inches) {
    // Tick mark on the post width
    const halfN = n / 2;
    const left  = offPt(pt, b + 90, halfN);
    const right = offPt(pt, b - 90, halfN);
    const tickOffset = 0.22;
    const ls = offPt(left,  b + 90, tickOffset);
    const rs = offPt(right, b - 90, tickOffset);

    // Witness lines
    L.polyline([left,  ls], { color:'#555', weight:0.8, dashArray:'3,3' }).addTo(planLayerGroup);
    L.polyline([right, rs], { color:'#555', weight:0.8, dashArray:'3,3' }).addTo(planLayerGroup);
    // Dimension line
    L.polyline([ls, rs], { color:'#555', weight:1 }).addTo(planLayerGroup);
    // End ticks
    const tLen = 0.05;
    L.polyline([offPt(ls, b, -tLen), offPt(ls, b, tLen)], { color:'#555', weight:1.5 }).addTo(planLayerGroup);
    L.polyline([offPt(rs, b, -tLen), offPt(rs, b, tLen)], { color:'#555', weight:1.5 }).addTo(planLayerGroup);
    // Label
    const mid = [(ls[0]+rs[0])/2, (ls[1]+rs[1])/2];
    const lp  = offPt(mid, b - 90, 0.08);
    L.marker(lp, {
        icon: L.divIcon({ className:'', html:`<div style="font-size:8px;color:#555;font-family:'Courier New',monospace;font-weight:bold;white-space:nowrap;">${inches}" (${n.toFixed(3)}m)</div>`, iconSize:[0,0], iconAnchor:[0,0] }),
        zIndexOffset: 1400
    }).addTo(planLayerGroup);
}
function drawDimLine(startPt, endPt, offsetM, label, color) {
    const b = bearing(startPt, endPt);
    const s = offPt(startPt, b - 90, offsetM);
    const e = offPt(endPt,   b - 90, offsetM);

    // Witness lines from fence to dim line
    L.polyline([startPt, s], { color: '#888', weight: 0.8, dashArray: '4,4' }).addTo(planLayerGroup);
    L.polyline([endPt,   e], { color: '#888', weight: 0.8, dashArray: '4,4' }).addTo(planLayerGroup);

    // Main dim line
    L.polyline([s, e], { color: color, weight: 1.5 }).addTo(planLayerGroup);

    // Tick marks (arrowhead-style 45° ticks)
    const tickLen = 0.10;
    L.polyline([offPt(s, b - 90, -tickLen), offPt(s, b - 90, tickLen)], { color: color, weight: 2 }).addTo(planLayerGroup);
    L.polyline([offPt(e, b - 90, -tickLen), offPt(e, b - 90, tickLen)], { color: color, weight: 2 }).addTo(planLayerGroup);

    // Centred label
    const mid = [(s[0]+e[0])/2, (s[1]+e[1])/2];
    const labelLen = label.length;
    L.marker(mid, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;color:${color};font-weight:bold;font-family:'Courier New',monospace;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 4px;">${label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [labelLen * 3.5, -4]
        }),
        zIndexOffset: 1500
    }).addTo(planLayerGroup);
}

function updatePlanScale() {
  const zoom = map.getZoom();
  const center = map.getCenter();
  const mpp = 156543.03 * Math.cos(center.lat * Math.PI/180) / Math.pow(2, zoom);
  const mpc = mpp * (96 / 2.54);
  
  let txt = '';
  if(selectedUnit === 'cm_km') txt = `1 cm = ${(mpc/1000).toFixed(3)} km`;
  else if(selectedUnit === 'm_m') txt = `1 cm = ${mpc.toFixed(2)} m`;
  else if(selectedUnit === 'mm_cm') txt = `1 cm = ${(mpc*100).toFixed(1)} cm`;

  const el = document.getElementById('customScaleBar');
  if(el) el.textContent = `📏 ${txt}`;
}

// Initialize
if(document.readyState !== 'loading') initPlanMode();
else document.addEventListener('DOMContentLoaded', initPlanMode);