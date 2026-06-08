

// plan_mode.js
let planModeActive = false;
let planLayerGroup = L.layerGroup();
let selectedUnit = 'cm_km';
let activeTileLayer = null;
let originalMapBg = '';

// Locked ratio: null = auto (follows zoom), number = fixed 1:N
let lockedRatio = null;

function initPlanMode() {
  map.on('zoomend moveend', updatePlanScale);

  const btn = document.getElementById('btnTogglePlanMode');
  if(btn) btn.addEventListener('click', togglePlanMode);

  const dlBtn = document.getElementById('btnDownloadPDF');
  if(dlBtn) dlBtn.addEventListener('click', downloadPlanPDF);

  // Scale bar click → toggle picker
  const scaleBar = document.getElementById('customScaleBar');
  if (scaleBar) {
    scaleBar.addEventListener('click', (e) => {
      e.stopPropagation();
      const picker = document.getElementById('psbPicker');
      if (!picker) return;
      const isOpen = picker.style.display !== 'none';
      picker.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) buildRatioPicker();
    });
  }

  // Close picker when clicking elsewhere
  document.addEventListener('click', () => {
    const picker = document.getElementById('psbPicker');
    if (picker) picker.style.display = 'none';
  });
}

function buildRatioPicker() {
  const opts = document.getElementById('psbOptions');
  if (!opts) return;
  const presets = [500, 1000, 2000, 2500, 5000, 10000, 25000, 50000];
  opts.innerHTML = '';

  // Auto option
  const autoEl = document.createElement('div');
  autoEl.className = 'psb-pick-opt' + (lockedRatio === null ? ' active' : '');
  autoEl.textContent = 'Auto (follow zoom)';
  autoEl.addEventListener('click', (e) => { e.stopPropagation(); lockedRatio = null; updatePlanScale(); document.getElementById('psbPicker').style.display = 'none'; });
  opts.appendChild(autoEl);

  presets.forEach(r => {
    const el = document.createElement('div');
    el.className = 'psb-pick-opt' + (lockedRatio === r ? ' active' : '');
    el.textContent = `1 : ${r.toLocaleString()}`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      lockedRatio = r;
      applyLockedRatio(r);
      document.getElementById('psbPicker').style.display = 'none';
    });
    opts.appendChild(el);
  });
}

function applyLockedRatio(ratio) {
  // Adjust zoom so that 1cm on screen = ratio cm in real world
  const center = map.getCenter();
  const mpc = ratio / 100; // meters per screen-cm
  const mpp = mpc / 37.795; // meters per pixel
  const zoom = Math.log2(156543.03 * Math.cos(center.lat * Math.PI / 180) / mpp);
  map.setZoom(zoom);
  updatePlanScale();
}

async function downloadPlanPDF() {
    const btn = document.getElementById('btnDownloadPDF');
    if(!btn) return;
    const origText = btn.innerHTML; // Use innerHTML to restore icon
    btn.innerHTML = '⏳ กำลังสร้าง...';
    btn.disabled = true;

    try {
        const mapEl = document.getElementById('map');
        
        // Ensure tiles are hidden & white bg is applied
        mapEl.classList.add('plan-bg');
        map.invalidateSize();
        await new Promise(res => setTimeout(res, 500)); // Wait for render

        if(typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
            throw new Error('PDF/Canvas libraries not loaded');
        }

        const canvas = await html2canvas(mapEl, { 
            scale: 2, 
            backgroundColor: '#ffffff', 
            logging: false,
            useCORS: true,
            ignoreElements: (el) => el.id === 'customScaleBar' || el.classList.contains('leaflet-control')
        });

        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        const margin = 12;
        const maxW = pw - margin * 2;
        const maxH = ph - margin * 2;
        const ratio = canvas.width / canvas.height;
        let w = maxW, h = maxW / ratio;
        if (h > maxH) { h = maxH; w = maxH * ratio; }

        // Center on A4
        const x = (pw - w) / 2;
        const y = (ph - h) / 2;

        pdf.addImage(imgData, 'PNG', x, y, w, h);
        pdf.save('fence-plan.pdf');
    } catch(e) {
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e.message);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

function togglePlanMode() {
    if (!allLines || allLines.length === 0) {
        alert('กรุณาวาดเส้นหรือเพิ่มด้านก่อนเข้าโหมดแผน');
        return;
    }

    planModeActive = !planModeActive;
    const sidebar = document.querySelector('.left-sidebar');
    const mapEl = document.getElementById('map');
    const imRoot = document.querySelector('.im-root'); // Input Mode Sidebar
    
    // Search bar selector (adjust if your ID is different)
    const searchBar = document.getElementById('searchBar') || document.querySelector('.search-container, #search-input');

    if (planModeActive) {
        // Hide Search Bar
        if (searchBar) searchBar.style.display = 'none';
        
        // Hide Input Mode Sidebar content
        if (imRoot) imRoot.style.display = 'none';

        // Disable map click
        map._savedClickListeners = map._events && map._events.click ? [...map._events.click] : [];
        map.off('click');
        map.getContainer().style.cursor = 'default';
        if (typeof measureActive !== 'undefined') { measureActive = false; }
        const measureBtn = document.getElementById('measureBtn');
        if (measureBtn) measureBtn.classList.remove('active');

        // Hide overlays
        allLines.forEach(ld => {
            if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
            if (ld.segmentLabels) ld.segmentLabels.forEach(l => map.hasLayer(l) && map.removeLayer(l));
            if (ld.angleLabels)   ld.angleLabels.forEach(l =>   map.hasLayer(l)  && map.removeLayer(l));
            if (ld.markers)       ld.markers.forEach(m =>       map.hasLayer(m)  && map.removeLayer(m));
            if (ld.startMarker && map.hasLayer(ld.startMarker)) map.removeLayer(ld.startMarker);
            if (ld.branches) ld.branches.forEach(br => {
                if (br.polyline && map.hasLayer(br.polyline)) map.removeLayer(br.polyline);
            });
        });
        if (typeof fenceLayerGroup !== 'undefined') fenceLayerGroup.clearLayers();

        // Hide UI elements
        const measureInfo = document.getElementById('measureInfo');
        if (measureInfo) measureInfo.style.display = 'none';
        const measureTool = document.querySelector('.measure-tool');
        if (measureTool) measureTool.style.display = 'none';
        
        sidebar.classList.add('plan-mode-active');
        document.querySelectorAll('.custom-label-control, .custom-layer-control').forEach(el => el.style.display = 'none');
        
        const scaleBar = document.getElementById('customScaleBar');
        if (scaleBar) scaleBar.style.display = 'block';
        updatePlanScale();
        const planPanel = document.getElementById('planModePanel');
        if (planPanel) planPanel.style.display = 'block';

        // White background
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
            map.fitBounds(firstLine.points, { padding: [80, 80], maxZoom: 18, animate: true });
        }

        planLayerGroup.addTo(map);
        renderPlanView();
    } else {
        // Show Search Bar
        if (searchBar) searchBar.style.display = '';
        
        // Show Input Mode Sidebar
        if (imRoot) imRoot.style.display = '';

        if (map._savedClickListeners && map._savedClickListeners.length > 0) {
            map._savedClickListeners.forEach(h => map.on('click', h.fn, h.ctx));
        }
        
        // Restore overlays
        allLines.forEach(ld => {
            if (ld.polyline && !map.hasLayer(ld.polyline)) ld.polyline.addTo(map);
            if (ld.segmentLabels && (typeof measurementsVisible === 'undefined' || measurementsVisible))
                ld.segmentLabels.forEach(l => !map.hasLayer(l) && l.addTo(map));
            if (ld.angleLabels && (typeof anglesVisible === 'undefined' || anglesVisible))
                ld.angleLabels.forEach(l => !map.hasLayer(l) && l.addTo(map));
            if (ld.markers) ld.markers.forEach(m => !map.hasLayer(m) && m.addTo(map));
        });

        const measureTool = document.querySelector('.measure-tool');
        if (measureTool) measureTool.style.display = '';
        sidebar.classList.remove('plan-mode-active');
        document.querySelectorAll('.custom-label-control, .custom-layer-control').forEach(el => el.style.display = '');
        
        const scaleBar = document.getElementById('customScaleBar');
        if (scaleBar) scaleBar.style.display = 'none';
        lockedRatio = null;
        
        const planPanel = document.getElementById('planModePanel');
        if (planPanel) planPanel.style.display = 'none';
        mapEl.classList.remove('plan-bg');
        mapEl.style.background = originalMapBg;
        if (activeTileLayer) activeTileLayer.addTo(map);

        document.getElementById('customScaleBar').style.display = 'none';
        map.removeLayer(planLayerGroup);
        planLayerGroup.clearLayers();

        if (typeof switchSbTab === 'function') {
            const activeTab = document.getElementById('sbTab2')?.classList.contains('sb-tab-active') ? 2 : 1;
            switchSbTab(activeTab);
        }

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
    if (!pts || pts.length < 2) return;

    const fenceType = lineData.fenceType || 'cowboy';

    // ── BRICK fence in plan mode ──
    if (fenceType === 'brick') {
        _drawPlanBrickLine(lineData, idx);
        return;
    }

    // ── COWBOY / default fence (existing logic) ──
    L.polyline(pts, { color: '#1a1a1a', weight: 3, opacity: 1 }).addTo(planLayerGroup);

    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#000;background:#ffffff;padding:4px 8px;border:2px solid #000;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1}</div>`,
            iconSize: [0, 0],
            iconAnchor: [-15, -15]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);

    const m = parseFloat(document.getElementById('postSpacing')?.value) || 2.5;
    const n = 0.15;
    let dAcc = 0;
    const standardLen = hav(pts[0], pts[1]);

    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        const isDifferent = Math.abs(segLen - standardLen) > 0.05;
        const showDetails = i < 2 || isDifferent;

        let poleDists = [0];
        if (segLen > 0.5) {
            const calc = calcPanels(segLen, m);
            calc.ticks.forEach(t => poleDists.push(t.pos));
        }
        poleDists.push(segLen);

        poleDists.forEach((dist, pIdx) => {
            const pt = interp(pts, dAcc + dist);
            const isCorner = (i === 0 && pIdx === 0) || (i === pts.length - 2 && pIdx === poleDists.length - 1);
            drawPlanPost(pt, b, isCorner, n);
        });

        if (showDetails) {
            for (let j = 0; j < poleDists.length - 1; j++) {
                const sPt = interp(pts, dAcc + poleDists[j]);
                const ePt = interp(pts, dAcc + poleDists[j + 1]);
                const spanLen = hav(sPt, ePt);
                drawDimLine(sPt, ePt, 0.35, spanLen.toFixed(2) + 'm', '#000');
            }
            drawDimLine(p0, p1, 0.75, segLen.toFixed(2) + 'm', '#000');
        }
        dAcc += segLen;
    }
}

function _drawPlanBrickLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;

    // Read brick params (same sources as fence.js)
    const d = parseFloat(
        (document.getElementById('postSpacingBrick') || document.getElementById('imPostSpacingBrick'))?.value
    ) || 2.5;
    const h = parseFloat(
        (document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value
    ) || 1.8;

    // Determine beam mode from hidden input or auto
    const beamSel = document.getElementById('imBrickBeamMode');
    const beamOverride = beamSel ? beamSel.value : 'auto';
    let beamMode;
    if      (beamOverride === '0')           beamMode = 'none';
    else if (beamOverride === 'top')         beamMode = 'top';
    else if (beamOverride === 'center')      beamMode = 'center';
    else if (beamOverride === 'center+top')  beamMode = 'center+top';
    else {
        // auto
        if      (h <= 1.2) beamMode = 'none';
        else if (h < 1.8)  beamMode = 'top';
        else if (h < 2.2)  beamMode = 'center';
        else               beamMode = 'center+top';
    }

    // Line label
    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#92400e;background:#fff7ed;padding:4px 8px;border:2px solid #b45309;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1} (อิฐ)</div>`,
            iconSize: [0, 0],
            iconAnchor: [-15, -15]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);

    let cumulDist = 0;
    const numSegs = pts.length - 1;
    const standardLen = hav(pts[0], pts[1]);

    for (let si = 0; si < numSegs; si++) {
        const p0 = pts[si], p1 = pts[si + 1];
        const A_i = hav(p0, p1);
        const segB = bearing(p0, p1);

        // Bay count: ⌈A_i / d⌉, actual spacing = A_i / r_i
        const r_i = Math.max(1, Math.ceil(A_i / d));
        const d_prime = A_i / r_i;

        // Draw wall (thick brown line)
        const steps = Math.max(2, Math.ceil(A_i * 4));
        const wallPts = [];
        for (let s = 0; s <= steps; s++) wallPts.push(interp(pts, cumulDist + A_i * s / steps));
        L.polyline(wallPts, { color: '#92400e', weight: 5, opacity: 1 }).addTo(planLayerGroup);

        // Draw pillars and beam symbols per bay
        for (let bi = 0; bi < r_i; bi++) {
            const distStart = cumulDist + bi * d_prime;
            const distEnd   = cumulDist + (bi + 1) * d_prime;
            const ptStart   = interp(pts, distStart);
            const ptEnd     = interp(pts, Math.min(distEnd, cumulDist + A_i));

            // Pillar square (plan style)
            const isCorner = (si === 0 && bi === 0) || (si === numSegs - 1 && bi === r_i - 1);
            drawPlanPost(ptStart, segB, isCorner, 0.15);

            // Beam symbol — plan version (perpendicular ticks)
            if (beamMode !== 'none') {
                _drawPlanBeamSymbol(ptStart, ptEnd, segB, beamMode);
            }
        }
        // Final pillar at segment end
        const isLastCorner = si === numSegs - 1;
        drawPlanPost(interp(pts, cumulDist + A_i), segB, isLastCorner, 0.15);

        // Dimension line for each segment (plan engineering style)
        const isDifferent = Math.abs(A_i - standardLen) > 0.05;
        if (si < 2 || isDifferent) {
            drawDimLine(p0, p1, 0.75, A_i.toFixed(2) + 'm', '#92400e');
        }

        cumulDist += A_i;
    }
}

// Plan-mode beam symbol — uses planLayerGroup instead of fenceLayerGroup
// top beam = orange solid  |  center beam = amber dashed
function _drawPlanBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLon = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid    = [midLat, midLon];
    const perpB  = segBearing + 90;
    const tickHalf = 0.55;

    const drawTick = (pt, color, dashed) => {
        const t1 = offPt(pt, perpB,       tickHalf);
        const t2 = offPt(pt, perpB + 180, tickHalf);
        L.polyline([t1, t2], {
            color, weight: 2.5, opacity: 0.95,
            dashArray: dashed ? '4,3' : null
        }).addTo(planLayerGroup);
        L.circleMarker(pt, {
            radius: 2.5, color, fillColor: color, fillOpacity: 1, weight: 1.5
        }).addTo(planLayerGroup);
        // Small color-coded label
        L.marker(offPt(pt, perpB, tickHalf + 0.25), {
            icon: L.divIcon({
                className: '',
                html: `<div style="font-size:9px;font-weight:700;color:${color};background:rgba(255,255,255,0.9);padding:1px 3px;border-radius:2px;white-space:nowrap;">${dashed ? 'กลาง' : 'บน'}</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            }),
            zIndexOffset: 1500
        }).addTo(planLayerGroup);
    };

    if (mode === 'top') {
        drawTick(mid, '#ea580c', false);
    } else if (mode === 'center') {
        drawTick(mid, '#d97706', true);
    } else if (mode === 'center+top') {
        const offset = 0.28;
        const ptA = offPt(mid, segBearing,       offset);
        const ptB = offPt(mid, segBearing + 180, offset);
        drawTick(ptA, '#d97706', true);   // center — amber dashed
        drawTick(ptB, '#ea580c', false);  // top — orange solid
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


function drawPlanAngle(prevPt, vertexPt, nextPt, idx) {
    const b1 = bearing(prevPt, vertexPt); // incoming bearing
    const b2 = bearing(vertexPt, nextPt); // outgoing bearing
    
    // Calculate interior angle
    let angle = ((b2 - b1) + 360) % 360;
    // For fence drawing, we usually want the interior angle
    if (angle > 180) angle = 360 - angle;
    
    const rad = angle * Math.PI / 180;
    const isRightAngle = Math.abs(angle - 90) < 5; // 85-95° = box style
    const radius = 0.4; // meters for arc/box size
    
    // Position offset for label (pushes label away from vertex)
    const labelOffset = isRightAngle ? 0.65 : 0.55;
    const bisectAngle = ((b1 + b2) / 2 + 360) % 360;
    const labelPt = offPt(vertexPt, bisectAngle + 90, labelOffset);
    
    if (isRightAngle) {
        // ── Engineer Box Style (90°) ──
        const boxSize = radius * 0.8;
        const corner1 = offPt(vertexPt, b1, boxSize);
        const corner2 = offPt(corner1, b2, boxSize);
        const corner3 = offPt(vertexPt, b2, boxSize);
        
        // Draw the square corner
        L.polyline([corner1, corner2, corner3], {
            color: '#2563eb', // blue for engineering style
            weight: 2,
            opacity: 0.9
        }).addTo(planLayerGroup);
        
        // Fill the corner lightly
        L.polygon([vertexPt, corner1, corner2, corner3], {
            color: 'transparent',
            fillColor: '#3b82f6',
            fillOpacity: 0.15
        }).addTo(planLayerGroup);
        
    } else {
        // ── Arc Style (Non-90°) ──
        const steps = 24;
        const arcPts = [];
        // Start from b1 direction, sweep to b2 direction
        let startAngle = b1;
        let endAngle = b2;
        
        // Handle angle wrapping correctly
        if (endAngle < startAngle) endAngle += 360;
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const deg = startAngle + (endAngle - startAngle) * t;
            const pt = offPt(vertexPt, deg, radius);
            arcPts.push(pt);
        }
        
        L.polyline(arcPts, {
            color: '#2563eb',
            weight: 2,
            opacity: 0.9,
            dashArray: null
        }).addTo(planLayerGroup);
        
        // Add a small dot at the vertex
        L.circleMarker(vertexPt, {
            radius: 3,
            color: '#2563eb',
            fillColor: '#2563eb',
            fillOpacity: 1,
            weight: 1
        }).addTo(planLayerGroup);
    }
    
    // ── Angle Label ──
    L.marker(labelPt, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:11px;font-weight:600;color:#1e40af;background:rgba(255,255,255,0.92);padding:2px 4px;border:1px solid #93c5fd;border-radius:2px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.1);">${Math.round(angle)}°</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }),
        zIndexOffset: 1400
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
    
    // Calculate offset direction to avoid crossing the fence line
    const perpBearing = (b - 90 + 360) % 360;
    
    const s = offPt(startPt, perpBearing, offsetM);
    const e = offPt(endPt,   perpBearing, offsetM);
    
    // Witness lines (dashed)
    L.polyline([startPt, s], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);
    L.polyline([endPt,   e], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);

    // Main dim line (solid black)
    L.polyline([s, e], { color: '#000', weight: 1.2 }).addTo(planLayerGroup);

    // Tick marks (vertical lines at ends)
    const tickLen = 0.08;
    L.polyline([offPt(s, b - 90, -tickLen), offPt(s, b - 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);
    L.polyline([offPt(e, b - 90, -tickLen), offPt(e, b - 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);

    // Text Label
    const mid = [(s[0]+e[0])/2, (s[1]+e[1])/2];
    L.marker(mid, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;color:#000;font-weight:bold;font-family:'Courier New',monospace;background:#ffffff;padding:2px 6px;border:1px solid #000;border-radius:2px;white-space:nowrap;">${label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0] // Centers the label perfectly on the midpoint
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);
}

function updatePlanScale() {
  const el = document.getElementById('customScaleBar');
  if (!el) return;
  if (!planModeActive) { el.style.display = 'none'; return; }

  const zoom = map.getZoom();
  const center = map.getCenter();
  const mpp = 156543.03 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
  const mpc = mpp * 37.795;
  const ratio = lockedRatio || Math.round(mpc * 100);

  const niceMeters = niceScaleLength(mpp);
  const barPx = Math.round(niceMeters / mpp);
  const halfLabel = niceMeters >= 1000
    ? ((niceMeters / 2) / 1000).toFixed(1) + ' km'
    : Math.round(niceMeters / 2) + ' m';
  const endLabel = niceMeters >= 1000
    ? (niceMeters / 1000).toFixed(niceMeters % 1000 === 0 ? 0 : 1) + ' km'
    : niceMeters + ' m';

  const title = document.getElementById('psbTitle');
  const track = document.getElementById('psbTrack');
  const mid   = document.getElementById('psbMid');
  const end   = document.getElementById('psbEnd');

  if (title) title.textContent = `SCALE 1:${ratio.toLocaleString()}` + (lockedRatio ? ' 🔒' : '');
  if (track) track.style.width = barPx + 'px';
  if (mid)   { mid.textContent = halfLabel; mid.style.left = (barPx / 2) + 'px'; }
  if (end)   end.textContent = endLabel;
}

  const el = document.getElementById('customScaleBar');
  if (el) el.style.display = 'none';

function niceScaleLength(mpp) {
  // Target ~120px wide bar; pick nicest round meter value
  const target = mpp * 120;
  const candidates = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000];
  return candidates.reduce((best, v) => Math.abs(v - target) < Math.abs(best - target) ? v : best);
}

// Initialize
if(document.readyState !== 'loading') initPlanMode();
else document.addEventListener('DOMContentLoaded', initPlanMode);