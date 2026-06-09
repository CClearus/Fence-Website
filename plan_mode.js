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
    if (!btn) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ กำลังสร้าง PDF...';

    try {
        if (typeof jspdf === 'undefined') throw new Error('jspdf ยังไม่ถูกโหลด');
        if (typeof allLines === 'undefined' || allLines.length === 0) throw new Error('ยังไม่มีเส้นรั้ว กรุณาวาดก่อน');

        // ════════════════════════════════════════════════════════
        //  STEP 1 – collect every lat/lng point to find bounding box
        // ════════════════════════════════════════════════════════
        let minLat =  Infinity, maxLat = -Infinity;
        let minLng =  Infinity, maxLng = -Infinity;
        allLines.forEach(ld => {
            (ld.points || []).forEach(([la, ln]) => {
                if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
                if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
            });
        });
        if (!isFinite(minLat)) throw new Error('ไม่พบพิกัดจากเส้นรั้ว');

        // ════════════════════════════════════════════════════════
        //  STEP 2 – set up A3 landscape PDF + coordinate transform
        // ════════════════════════════════════════════════════════
        const { jsPDF } = jspdf;
        const PW = 420, PH = 297;            // A3 landscape mm
        const MARGIN = 14, FOOTER_H = 10;
        const drawW = PW - MARGIN * 2;
        const drawH = PH - MARGIN * 2 - FOOTER_H - 8; // leave room for header + footer

        // Mercator helpers (match Leaflet's projection exactly)
        const R = 6378137;
        function latToY(lat) { const s = Math.sin(lat * Math.PI / 180); return R * Math.log((1 + s) / (1 - s)) / 2; }
        function lngToX(lng) { return R * lng * Math.PI / 180; }

        const geoX0 = lngToX(minLng), geoX1 = lngToX(maxLng);
        const geoY0 = latToY(minLat), geoY1 = latToY(maxLat);
        const geoW  = geoX1 - geoX0 || 1;
        const geoH  = geoY1 - geoY0 || 1;

        // Fit with correct aspect ratio, centred in the drawing area
        const scaleX = drawW / geoW, scaleY = drawH / geoH;
        const S = Math.min(scaleX, scaleY);     // uniform scale  (geo-metres → mm)
        const offX = MARGIN + (drawW - geoW * S) / 2;
        const offY = MARGIN + 8 + (drawH - geoH * S) / 2;

        // [lat, lng]  →  [pdf-x-mm, pdf-y-mm]  (Y is flipped: north = top)
        function project([lat, lng]) {
            const x = offX + (lngToX(lng) - geoX0) * S;
            const y = offY + (geoY1 - latToY(lat)) * S;
            return [x, y];
        }

        const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a3', compress: true });

        // ── Background ──
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, PW, PH, 'F');

        // ── Draw area border ──
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.2);
        pdf.rect(MARGIN, MARGIN + 6, drawW, drawH + 2, 'S');

        // ════════════════════════════════════════════════════════
        //  STEP 3 – vector drawing helpers (operate in PDF mm)
        // ════════════════════════════════════════════════════════

        // hex → [r,g,b]
        function hexRgb(h) {
            const n = parseInt(h.replace('#',''), 16);
            return [(n>>16)&255, (n>>8)&255, n&255];
        }

        function setStroke(hex, lw, dash) {
            const [r,g,b] = hexRgb(hex);
            pdf.setDrawColor(r, g, b);
            pdf.setLineWidth(lw);
            if (dash) pdf.setLineDashPattern(dash, 0);
            else      pdf.setLineDashPattern([], 0);
        }
        function setFill(hex) {
            const [r,g,b] = hexRgb(hex);
            pdf.setFillColor(r, g, b);
        }

        // polyline from geo [lat,lng] array
        function geoPolyline(pts, hex, lw, dash) {
            if (pts.length < 2) return;
            setStroke(hex, lw, dash);
            const mapped = pts.map(project);
            pdf.lines(
                mapped.slice(1).map(([x,y], i) => [x - mapped[i][0], y - mapped[i][1]]),
                mapped[0][0], mapped[0][1],
                [1, 1], 'S', false
            );
        }

        // filled rectangle aligned to bearing at a geo point
        function geoRect(pt, bearingDeg, halfW, halfH, fillHex, strokeHex) {
            const [cx, cy] = project(pt);
            const rad = bearingDeg * Math.PI / 180;
            // four corners in PDF space
            const corners = [
                [-halfW * S, -halfH * S],
                [ halfW * S, -halfH * S],
                [ halfW * S,  halfH * S],
                [-halfW * S,  halfH * S],
            ].map(([dx, dy]) => {
                // rotate by bearing
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                return [cx + rx, cy + ry];
            });
            const [fr, fg, fb] = hexRgb(fillHex);
            const [sr, sg, sb] = hexRgb(strokeHex);
            pdf.setFillColor(fr, fg, fb);
            pdf.setDrawColor(sr, sg, sb);
            pdf.setLineWidth(0.35);
            pdf.setLineDashPattern([], 0);
            pdf.lines(
                corners.slice(1).map(([x,y],i) => [x - corners[i][0], y - corners[i][1]]),
                corners[0][0], corners[0][1], [1,1], 'FD', true
            );
        }

        // small filled circle at geo point
        function geoCircle(pt, rMm, fillHex, strokeHex, lw) {
            const [x, y] = project(pt);
            const [fr,fg,fb] = hexRgb(fillHex);
            const [sr,sg,sb] = hexRgb(strokeHex);
            pdf.setFillColor(fr,fg,fb);
            pdf.setDrawColor(sr,sg,sb);
            pdf.setLineWidth(lw || 0.3);
            pdf.setLineDashPattern([], 0);
            pdf.circle(x, y, rMm, 'FD');
        }

        // dimension line between two geo points, offset perpendicularly
        function geoDimLine(p0, p1, offsetM, label, strokeHex) {
            // bearing in degrees
            const b = _geoBearing(p0, p1);
            const perpB = b + 90;
            const s = _geoOffset(p0, perpB, offsetM);
            const e = _geoOffset(p1, perpB, offsetM);
            // witness lines (dashed)
            geoPolyline([p0, s], '#888888', 0.15, [0.8, 0.8]);
            geoPolyline([p1, e], '#888888', 0.15, [0.8, 0.8]);
            // main dim line
            geoPolyline([s, e], strokeHex, 0.25, []);
            // tick marks
            const tk = offsetM * 0.12;
            geoPolyline([_geoOffset(s, b, -tk), _geoOffset(s, b, tk)], strokeHex, 0.35, []);
            geoPolyline([_geoOffset(e, b, -tk), _geoOffset(e, b, tk)], strokeHex, 0.35, []);
            // label
            const mid = [(_geoOffset(s,perpB,0)[0]+_geoOffset(e,perpB,0)[0])/2,
                         (_geoOffset(s,perpB,0)[1]+_geoOffset(e,perpB,0)[1])/2];
            const [mx,my] = project(mid);
            pdf.setFontSize(4.5);
            pdf.setFont('helvetica', 'bold');
            const [tr,tg,tb] = hexRgb(strokeHex);
            pdf.setTextColor(tr,tg,tb);
            // white backing rectangle
            const tw = pdf.getTextWidth(label);
            pdf.setFillColor(255,255,255);
            pdf.setDrawColor(tr,tg,tb);
            pdf.setLineWidth(0.1);
            pdf.setLineDashPattern([],0);
            pdf.rect(mx - tw/2 - 0.5, my - 2.2, tw + 1, 2.8, 'FD');
            pdf.text(label, mx, my - 0.2, { align: 'center' });
        }

        // geo bearing helper (degrees, 0=N, CW)
        function _geoBearing(p0, p1) {
            const dLng = (p1[1] - p0[1]) * Math.cos(p0[0] * Math.PI / 180);
            const dLat = p1[0] - p0[0];
            return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
        }

        // offset a geo point by distance (metres) in a compass bearing
        function _geoOffset([lat, lng], bearingDeg, distM) {
            const R2 = 6378137;
            const d = distM / R2;
            const b = bearingDeg * Math.PI / 180;
            const lat1 = lat * Math.PI / 180;
            const lng1 = lng * Math.PI / 180;
            const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(b));
            const lng2 = lng1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
            return [lat2 * 180 / Math.PI, lng2 * 180 / Math.PI];
        }

        // haversine distance (metres)
        function _geoHav([la0,lo0],[la1,lo1]) {
            const R2=6378137, toR=Math.PI/180;
            const dLa=(la1-la0)*toR, dLo=(lo1-lo0)*toR;
            const a=Math.sin(dLa/2)**2+Math.cos(la0*toR)*Math.cos(la1*toR)*Math.sin(dLo/2)**2;
            return R2*2*Math.asin(Math.sqrt(a));
        }

        // interpolate along a multi-segment geo path by arc-distance
        function _geoInterp(pts, dist) {
            let rem = dist;
            for (let i = 0; i < pts.length - 1; i++) {
                const segLen = _geoHav(pts[i], pts[i+1]);
                if (rem <= segLen + 1e-9) {
                    const t = Math.min(1, rem / (segLen || 1));
                    return [pts[i][0] + (pts[i+1][0]-pts[i][0])*t,
                            pts[i][1] + (pts[i+1][1]-pts[i][1])*t];
                }
                rem -= segLen;
            }
            return pts[pts.length-1];
        }

        // bearing at distance along a path
        function _geoBearingAt(pts, dist) {
            let rem = dist;
            for (let i = 0; i < pts.length - 1; i++) {
                const segLen = _geoHav(pts[i], pts[i+1]);
                if (rem <= segLen + 1e-9) return _geoBearing(pts[i], pts[i+1]);
                rem -= segLen;
            }
            return _geoBearing(pts[pts.length-2], pts[pts.length-1]);
        }

        // total length of a path (metres)
        function _geoTotalLen(pts) {
            let t = 0;
            for (let i = 0; i < pts.length-1; i++) t += _geoHav(pts[i], pts[i+1]);
            return t;
        }

        // draw a fence post (small rectangle aligned to bearing)
        function drawVPost(pt, bearingDeg, isCorner, sizeM) {
            const sc = window._poleScale || 1.0;
            const vis = Math.max(sizeM, 0.15) * sc * (isCorner ? 5 : 3);
            const hSz = vis / 2;
            geoRect(pt, bearingDeg, hSz, hSz,
                isCorner ? '#dc2626' : '#ffffff', '#1a1a1a');
        }

        // ════════════════════════════════════════════════════════
        //  STEP 4 – render each fence line
        // ════════════════════════════════════════════════════════
        allLines.forEach((ld, idx) => {
            const pts = ld.points;
            if (!pts || pts.length < 2) return;
            const fenceType = ld.fenceType || 'cowboy';
            const total = _geoTotalLen(pts);

            // ── COWBOY ──────────────────────────────────────────
            if (fenceType === 'cowboy' || fenceType === 'concrete') {
                geoPolyline(pts, '#1a1a1a', 0.6, []);

                const spacing = parseFloat(document.getElementById('postSpacing')?.value) || 2.5;
                let d = 0;
                const postDists = [0];
                while (d + spacing < total - 0.1) { d += spacing; postDists.push(d); }
                postDists.push(total);

                postDists.forEach((pd, pi) => {
                    const pt = _geoInterp(pts, pd);
                    const b  = _geoBearingAt(pts, pd);
                    const isCorner = (pi === 0 || pi === postDists.length - 1);
                    drawVPost(pt, b, isCorner, 0.15);
                });

                for (let i = 0; i < postDists.length - 1; i++) {
                    const p0 = _geoInterp(pts, postDists[i]);
                    const p1 = _geoInterp(pts, postDists[i+1]);
                    const span = _geoHav(p0, p1);
                    geoDimLine(p0, p1, 0.25, span.toFixed(2)+'m', '#000000');
                }
                for (let i = 0; i < pts.length-1; i++) {
                    const segLen = _geoHav(pts[i], pts[i+1]);
                    geoDimLine(pts[i], pts[i+1], 0.55, segLen.toFixed(2)+'m', '#000000');
                }
            }

            // ── BARBED WIRE ──────────────────────────────────────
            else if (fenceType === 'barbed') {
                const spacing = parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5;
                // main lines (3 strands)
                const offsets = [-0.25, 0, 0.25];
                offsets.forEach((off, si) => {
                    const strandPts = pts.map(p => _geoOffset(p, _geoBearing(pts[0], pts[pts.length>1?1:0]) + 90, off));
                    geoPolyline(pts, '#4b5563', si===1 ? 0.5 : 0.2, si===1 ? [] : [1.2, 0.8]);
                });
                // posts
                let d2 = 0;
                while (d2 <= total + 1e-4) {
                    const pt = _geoInterp(pts, Math.min(d2, total));
                    const b  = _geoBearingAt(pts, Math.min(d2, total));
                    const isEnd = d2 < 1e-3 || d2 >= total - 1e-3;
                    drawVPost(pt, b, isEnd, 0.15);
                    d2 += spacing;
                }
                for (let i = 0; i < pts.length-1; i++) {
                    const segLen = _geoHav(pts[i], pts[i+1]);
                    geoDimLine(pts[i], pts[i+1], 0.5, segLen.toFixed(2)+'m', '#374151');
                }
            }

            // ── BRICK ────────────────────────────────────────────
            else if (fenceType === 'brick') {
                const spacing = parseFloat(
                    (document.getElementById('postSpacingBrick') || document.getElementById('imPostSpacingBrick'))?.value
                ) || 2.5;
                geoPolyline(pts, '#92400e', 0.9, []);

                let cd = 0;
                for (let si = 0; si < pts.length-1; si++) {
                    const p0 = pts[si], p1 = pts[si+1];
                    const segLen = _geoHav(p0, p1);
                    const segB   = _geoBearing(p0, p1);
                    let pCursor = cd;
                    while (pCursor < cd + segLen - 0.1) {
                        const pt = _geoInterp(pts, pCursor);
                        drawVPost(pt, segB, pCursor < 0.01 || pCursor >= total-0.01, 0.15);
                        pCursor += spacing;
                    }
                    geoDimLine(p0, p1, 0.55, segLen.toFixed(2)+'m', '#92400e');
                    cd += segLen;
                }
                const lastPt = pts[pts.length-1];
                const lastB  = _geoBearing(pts[pts.length-2], lastPt);
                drawVPost(lastPt, lastB, true, 0.15);
            }

            // ── Line label (top-left of first point) ────────────
            const [lx, ly] = project(pts[0]);
            const colours = { cowboy:'#000000', concrete:'#000000', barbed:'#374151', brick:'#92400e' };
            const bgColours = { cowboy:'#ffffff', concrete:'#ffffff', barbed:'#f9fafb', brick:'#fff7ed' };
            const typeNames = { cowboy:'คาวบอย', concrete:'คอนกรีต', barbed:'ลวดหนาม', brick:'อิฐ' };
            const label = `Line ${idx+1} (${typeNames[fenceType]||fenceType})  L=${total.toFixed(1)}m`;
            pdf.setFontSize(5.5);
            pdf.setFont('helvetica', 'bold');
            const [cr,cg,cb2] = hexRgb(colours[fenceType]||'#000000');
            pdf.setTextColor(cr,cg,cb2);
            const lw2 = pdf.getTextWidth(label);
            const [br2,bg2,bb2] = hexRgb(bgColours[fenceType]||'#ffffff');
            pdf.setFillColor(br2,bg2,bb2);
            pdf.setDrawColor(cr,cg,cb2);
            pdf.setLineWidth(0.2);
            pdf.setLineDashPattern([],0);
            pdf.rect(lx+0.5, ly-4, lw2+2, 4.5, 'FD');
            pdf.text(label, lx+1.5, ly-0.5);
        });

        // ════════════════════════════════════════════════════════
        //  STEP 5 – header + footer + north arrow + scale bar
        // ════════════════════════════════════════════════════════

        // Header bar
        pdf.setFillColor(30, 41, 59);
        pdf.rect(0, 0, PW, MARGIN + 2, 'F');
        pdf.setTextColor(255,255,255);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text('FENCE PLAN — แบบแปลนรั้ว', PW/2, 8, { align: 'center' });

        const dateStr = new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
        pdf.setFontSize(6);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`วันที่: ${dateStr}`, MARGIN, 12.5);

        const scaleEl = document.querySelector('#psbTitle');
        const scaleText = scaleEl ? scaleEl.textContent.replace('🔒','').trim() : '';
        if (scaleText) pdf.text(scaleText, PW - MARGIN, 12.5, { align: 'right' });

        // Footer bar
        const FY = PH - FOOTER_H;
        pdf.setFillColor(241, 245, 249);
        pdf.rect(0, FY, PW, FOOTER_H, 'F');
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.3);
        pdf.line(0, FY, PW, FY);
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(5.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text('ระบบคำนวณรั้วอัตโนมัติ', PW/2, FY + 6.5, { align: 'center' });

        // Total length summary bottom-left
        let grandTotal = 0;
        allLines.forEach(ld => { grandTotal += _geoTotalLen(ld.points || []); });
        pdf.text(`ความยาวรั้วรวม: ${grandTotal.toFixed(1)} ม.  |  จำนวนด้าน: ${allLines.length}`, MARGIN, FY + 6.5);

        // North arrow (top-right corner of draw area)
        const naX = MARGIN + drawW - 8, naY = MARGIN + 14;
        pdf.setDrawColor(30,41,59); pdf.setLineWidth(0.5); pdf.setLineDashPattern([],0);
        pdf.line(naX, naY + 6, naX, naY);       // shaft
        pdf.line(naX, naY, naX - 2.5, naY + 5); // left arm
        pdf.line(naX, naY, naX + 2.5, naY + 5); // right arm
        pdf.setFillColor(30,41,59);
        pdf.triangle(naX, naY, naX-2.5, naY+5, naX+2.5, naY+5, 'F');
        pdf.setFontSize(6); pdf.setFont('helvetica','bold');
        pdf.setTextColor(30,41,59);
        pdf.text('N', naX, naY - 1.5, { align:'center' });

        // ── Save ──
        pdf.save(`fence-plan-${Date.now()}.pdf`);

    } catch (e) {
        console.error('PDF Export Error:', e);
        alert('เกิดข้อผิดพลาดในการสร้าง PDF: ' + e.message);
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

// NEW
function drawPlanLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;

    const fenceType = lineData.fenceType || 'cowboy';

    // ── BRICK fence in plan mode ──
    if (fenceType === 'brick') {
        _drawPlanBrickLine(lineData, idx);
        return;
    }

    // ── BARBED WIRE fence in plan mode ──
    if (fenceType === 'barbed') {
        _drawPlanBarbedLine(lineData, idx);
        return;
    }

    // ── COWBOY / default fence (existing logic) ──

    // ── COWBOY / default fence (existing logic) ──
    L.polyline(pts, { color: '#1a1a1a', weight: 3, opacity: 1 }).addTo(planLayerGroup);

    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#000;background:#ffffff;padding:4px 8px;border:2px solid #000;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1}</div>`,
            iconSize: null,
            iconAnchor: [0, 0]
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

        for (let j = 0; j < poleDists.length - 1; j++) {
            const sPt = interp(pts, dAcc + poleDists[j]);
            const ePt = interp(pts, dAcc + poleDists[j + 1]);
            const spanLen = hav(sPt, ePt);
            drawDimLine(sPt, ePt, 0.25, spanLen.toFixed(2) + 'm', '#000');
        }
        drawDimLine(p0, p1, 0.55, segLen.toFixed(2) + 'm', '#000');
        dAcc += segLen;
    }
}


// ── Plan-mode barbed wire — respects < 60° cut rule ──
function _drawPlanBarbedLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;
    const m = Math.min(3, Math.max(1,
        parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5
    ));
    const total = totalLen(pts);

    function interiorAngleAt(i) {
        if (i <= 0 || i >= pts.length - 1) return 180;
        const bIn  = bearing(pts[i - 1], pts[i]);
        const bOut = bearing(pts[i], pts[i + 1]);
        let diff = ((bOut - bIn + 540) % 360) - 180;
        return 180 - Math.abs(diff);
    }

    const sharpCorners = [];
    for (let i = 1; i < pts.length - 1; i++) {
        const ang = interiorAngleAt(i);
        if (ang < 60) {
            let distToCorner = 0;
            for (let k = 0; k < i; k++) distToCorner += hav(pts[k], pts[k + 1]);
            sharpCorners.push({ idx: i, angle: ang, dist: distToCorner });
        }
    }

    const GAP = 0.25;
    const cutPoints = [];
    sharpCorners.forEach(({ dist }) => {
        cutPoints.push({ gapStart: Math.max(0, dist - GAP), gapEnd: Math.min(total, dist + GAP) });
    });

    const wireSegments = [];
    let cursor = 0;
    cutPoints.forEach(({ gapStart, gapEnd }) => {
        if (gapStart > cursor + 0.01) wireSegments.push([cursor, gapStart]);
        cursor = gapEnd;
    });
    if (cursor < total - 0.01) wireSegments.push([cursor, total]);
    if (wireSegments.length === 0) wireSegments.push([0, total]);

    const strandOffsets = [-0.3, 0, 0.3];
    strandOffsets.forEach((_, si) => {
        wireSegments.forEach(([segFrom, segTo]) => {
            const steps = Math.max(3, Math.ceil((segTo - segFrom) * 4));
            const wPts = [];
            for (let i = 0; i <= steps; i++) {
                wPts.push(interp(pts, segFrom + (segTo - segFrom) * i / steps));
            }
            L.polyline(wPts, {
                color: '#4b5563',
                weight: si === 1 ? 3 : 1.5,
                opacity: 0.85,
                dashArray: si === 1 ? null : '6,4'
            }).addTo(planLayerGroup);
        });
    });

    sharpCorners.forEach(({ idx }) => {
        L.circleMarker(pts[idx], {
            radius: 10, color: '#f97316', weight: 3,
            fillColor: '#fed7aa', fillOpacity: 0.55, opacity: 1
        }).addTo(planLayerGroup);
    });

    // Collect all post positions for dimension lines
    const postPositions = [];
    let d = 0;
    while (d <= total + 1e-4) {
        const pt = interp(pts, Math.min(d, total));
        const b = bearingAt(pts, Math.min(d, total));
        const isEnd = d < 1e-3 || d >= total - 1e-3;
        drawPlanPost(pt, b, isEnd, 0.15);
        postPositions.push({ dist: d, pt, b });
        d += m;
    }

    sharpCorners.forEach(({ dist }) => {
        const extraDist = Math.max(0, dist - m);
        if (extraDist > 1e-3) {
            const pt = interp(pts, extraDist);
            const b = bearingAt(pts, extraDist);
            drawPlanPost(pt, b, false, 0.15);
        }
    });

    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#374151;background:#f9fafb;padding:4px 8px;border:2px solid #4b5563;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1} (ลวดหนาม)</div>`,
            iconSize: null, iconAnchor: [0, 0]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);

    // Draw dimension lines for EACH post-to-post span (2.5m labels)
    for (let i = 0; i < postPositions.length - 1; i++) {
        const p0 = postPositions[i].pt;
        const p1 = postPositions[i + 1].pt;
        const spanLen = hav(p0, p1);
        // Alternate offset side to reduce overlap
        const offset = 0.3 + (i % 2) * 0.15;
        drawDimLine(p0, p1, offset, spanLen.toFixed(2) + 'm', '#374151');
    }

    // Total segment dimension line
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        drawDimLine(p0, p1, 0.8, segLen.toFixed(2) + 'm', '#374151');
    }

    // N-Brace symbols
    const nbSolo  = (document.getElementById('nBraceSolo')  || document.getElementById('imNBraceSolo'))?.checked  ?? false;
    const nbDual  = (document.getElementById('nBraceDual')  || document.getElementById('imNBraceDual'))?.checked  ?? false;
    const nbAngle = (document.getElementById('nBraceAngle') || document.getElementById('imNBraceAngle'))?.checked ?? false;

    function drawNBrace(pt, b) {
        const sz = 0.4;
        const p1 = offPt(offPt(pt, b + 90, sz), b,       sz);
        const p2 = offPt(offPt(pt, b - 90, sz), b + 180, sz);
        const p3 = offPt(offPt(pt, b - 90, sz), b,       sz);
        const p4 = offPt(offPt(pt, b + 90, sz), b + 180, sz);
        L.polyline([p1, p2], { color: '#1d4ed8', weight: 1.5, opacity: 0.9 }).addTo(planLayerGroup);
        L.polyline([p3, p4], { color: '#1d4ed8', weight: 1.5, opacity: 0.9 }).addTo(planLayerGroup);
        L.circleMarker(pt, {
            radius: 6, color: '#1d4ed8', weight: 1.5,
            fillColor: '#dbeafe', fillOpacity: 0.6
        }).addTo(planLayerGroup);
    }

    if (nbSolo || nbDual || nbAngle) {
        drawNBrace(pts[0], bearingAt(pts, 0));
        drawNBrace(pts[pts.length - 1], bearingAt(pts, total));
    }
    if (nbDual) {
        for (let dist = 50; dist < total - 1; dist += 50) {
            const pt = interp(pts, dist);
            const b = bearingAt(pts, dist);
            drawNBrace(pt, b);
        }
    }
    if (nbAngle) {
        sharpCorners.forEach(({ dist }) => {
            const before = Math.max(0, dist - m);
            const after = Math.min(total, dist + m);
            drawNBrace(interp(pts, before), bearingAt(pts, before));
            drawNBrace(interp(pts, after), bearingAt(pts, after));
        });
    }
}
function _drawPlanBrickLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;
    const d = parseFloat(
        (document.getElementById('postSpacingBrick') || document.getElementById('imPostSpacingBrick'))?.value
    ) || 2.5;
    const h = parseFloat(
        (document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value
    ) || 1.8;
    const beamSel = document.getElementById('imBrickBeamMode');
    const beamOverride = beamSel ? beamSel.value : 'auto';
    let beamMode;
    if (beamOverride === '0') beamMode = 'none';
    else if (beamOverride === 'top') beamMode = 'top';
    else if (beamOverride === 'center') beamMode = 'center';
    else if (beamOverride === 'center+top') beamMode = 'center+top';
    else {
        if (h <= 1.2) beamMode = 'none';
        else if (h < 1.8) beamMode = 'top';
        else if (h < 2.2) beamMode = 'center';
        else beamMode = 'center+top';
    }

    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#92400e;background:#fff7ed;padding:4px 8px;border:2px solid #b45309;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1} (อิฐ)</div>`,
            iconSize: null, iconAnchor: [0, 0]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);

    let cumulDist = 0;
    const numSegs = pts.length - 1;

    for (let si = 0; si < numSegs; si++) {
        const p0 = pts[si], p1 = pts[si + 1];
        const A_i = hav(p0, p1);
        const segB = bearing(p0, p1);

        // Use calcPanels logic to avoid equal spreading
        const fullCount = Math.floor(A_i / d + 1e-9);
        const remainder = A_i - fullCount * d;
        const gaps = [];
        
        if (remainder < d * 0.01) {
            for (let i = 0; i < fullCount; i++) gaps.push(d);
        } else if (fullCount + 1 <= 2) {
            const evenGap = A_i / (fullCount + 1);
            for (let i = 0; i < fullCount + 1; i++) gaps.push(evenGap);
        } else {
            for (let i = 0; i < fullCount - 1; i++) gaps.push(d);
            const endSize = (d + remainder) / 2;
            gaps.push(endSize);
            gaps.push(endSize);
        }

        const steps = Math.max(2, Math.ceil(A_i * 4));
        const wallPts = [];
        for (let s = 0; s <= steps; s++) wallPts.push(interp(pts, cumulDist + A_i * s / steps));
        L.polyline(wallPts, { color: '#92400e', weight: 5, opacity: 1 }).addTo(planLayerGroup);

        // Collect pillar positions for this segment
        const pillarPositions = [];
        let cursor = cumulDist;
        for (let bi = 0; bi < gaps.length; bi++) {
            const distStart = cursor;
            const distEnd   = cursor + gaps[bi];
            const ptStart   = interp(pts, distStart);
            const ptEnd     = interp(pts, distEnd);
            
            const isCorner = (si === 0 && bi === 0) || (si === numSegs - 1 && bi === gaps.length - 1);
            drawPlanPost(ptStart, segB, isCorner, 0.15);
            pillarPositions.push({ dist: distStart, pt: ptStart });

            if (beamMode !== 'none') {
                _drawPlanBeamSymbol(ptStart, ptEnd, segB, beamMode);
            }
            cursor = distEnd;
        }
        
        // Final pillar at segment end
        const finalPt = interp(pts, cumulDist + A_i);
        const isFinalCorner = (si === numSegs - 1);
        drawPlanPost(finalPt, segB, isFinalCorner, 0.15);
        pillarPositions.push({ dist: cumulDist + A_i, pt: finalPt });

        // Draw dimension lines for EACH bay
        for (let bi = 0; bi < pillarPositions.length - 1; bi++) {
            const pStart = pillarPositions[bi].pt;
            const pEnd = pillarPositions[bi + 1].pt;
            const bayLen = hav(pStart, pEnd);
            const offset = 0.3 + (bi % 2) * 0.15;
            drawDimLine(pStart, pEnd, offset, bayLen.toFixed(2) + 'm', '#92400e');
        }

        // Total segment dimension line
        drawDimLine(p0, p1, 0.8, A_i.toFixed(2) + 'm', '#92400e');

        cumulDist += A_i;
    }
}
// Plan-mode beam symbol — uses planLayerGroup instead of fenceLayerGroup
// top beam = orange solid  |  center beam = amber dashed
// NEW
function _drawPlanBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLon = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid    = [midLat, midLon];
    const perpB  = segBearing + 90;
    const tickHalf = 0.28; // shorter tick — was 0.55

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
        // Label removed — was showing 'กลาง' / 'บน' in orange text
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
    const visualN = Math.max(n, 0.15) * scale * (isCorner ? 5 : 3);
    const halfSz = visualN / 2;
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
    const perpBearing = (b + 90 + 360) % 360;   // RIGHT of travel direction

    const s = offPt(startPt, perpBearing, offsetM);
    const e = offPt(endPt,   perpBearing, offsetM);

    // Witness lines (dashed)
    L.polyline([startPt, s], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);
    L.polyline([endPt,   e], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);

    // Main dim line
    L.polyline([s, e], { color: '#000', weight: 1.2 }).addTo(planLayerGroup);

    // Tick marks
    const tickLen = 0.08;
    L.polyline([offPt(s, b + 90, -tickLen), offPt(s, b + 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);
    L.polyline([offPt(e, b + 90, -tickLen), offPt(e, b + 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);

    // Text label
    const mid = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    L.marker(mid, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:11px;color:#000;font-weight:bold;font-family:'Courier New',monospace;background:#ffffff;padding:2px 5px;border:1px solid #000;border-radius:2px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${label}</div>`,
            iconSize: null,
            iconAnchor: null
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