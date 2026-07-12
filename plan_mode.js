// plan_mode.js
let planModeActive = false;
let planLayerGroup = L.layerGroup();
let selectedUnit = 'cm_km';
let activeTileLayer = null;
let originalMapBg = '';
let lockedRatio = null;

function initPlanMode() {
    map.on('zoomend moveend', updatePlanScale);
    const btn = document.getElementById('btnTogglePlanMode');
    if(btn) btn.addEventListener('click', togglePlanMode);
    const dlBtn = document.getElementById('btnDownloadPDF');
    if(dlBtn) dlBtn.addEventListener('click', downloadPlanPDF);
    
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
    
    const autoEl = document.createElement('div');
    autoEl.className = 'psb-pick-opt' + (lockedRatio === null ? ' active' : '');
    autoEl.textContent = 'Auto (follow zoom)';
    autoEl.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        lockedRatio = null; 
        updatePlanScale(); 
        document.getElementById('psbPicker').style.display = 'none'; 
    });
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
    const center = map.getCenter();
    const mpc = ratio / 100;
    const mpp = mpc / 37.795;
    const zoom = Math.log2(156543.03 * Math.cos(center.lat * Math.PI / 180) / mpp);
    map.setZoom(zoom);
    updatePlanScale();
}


function geoBrickBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLng = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid = [midLat, midLng];
    const perpB = segBearing + 90;
    const tickHalf = 0.28;

    const drawTick = (pt, hex, dashed) => {
        const t1 = _geoOffset(pt, perpB, tickHalf);
        const t2 = _geoOffset(pt, perpB + 180, tickHalf);
        geoPolyline([t1, t2], hex, 0.35, dashed ? [0.6, 0.5] : []);
        geoCircle(pt, 0.12, hex, hex, 0.2);
    };

    if (mode === 'top') {
        drawTick(mid, '#ea580c', false);
    } else if (mode === 'center') {
        drawTick(mid, '#d97706', true);
    } else if (mode === 'center+top') {
        const offset = 0.28;
        drawTick(_geoOffset(mid, segBearing, offset), '#d97706', true);
        drawTick(_geoOffset(mid, segBearing + 180, offset), '#ea580c', false);
    }
}

// New helper: mirrors cowboy.js's drawPlanCowboyCorners exactly — same
// arm bearings, swap state, and single/double mode as the live map — so
// dual red/blue corner posts (or a single bisector post) that exist in
// Plan Mode actually show up in the PDF too, instead of being silently
// skipped.
function geoDrawCowboyCorners() {
    if (typeof cornerMap === 'undefined' || cornerMap.size === 0) return;
    const dualPillarCheckbox = document.getElementById('doubleCornerPost')
        || document.getElementById('imDoubleCornerPost');
    const useDualPillar = dualPillarCheckbox ? dualPillarCheckbox.checked : false;
    const n = 0.15;
    const scale = window._poleScale || 1.0;
    const vis = Math.max(n, 0.15) * scale * 3;
    const halfSz = vis / 2;
    for (const [, entry] of cornerMap.entries()) {
        const arms = entry.arms.slice(0, 2);
        if (arms.length < 2 || !useDualPillar) {
            // Bearing 0 = axis-aligned post
            drawVPost(entry.pt, 0, true, n);
            continue;
        }
        const [armRed, armBlue] = getCornerArms(entry);
        const theta = cornerAngle(armRed, armBlue);
        const mode = getCornerMode(entry.pt, theta);
        if (mode === 'single') {
            drawVPost(entry.pt, 0, true, n);
        } else {
            const offset = getDualCornerOffset(n, theta);
            // Posts drawn at bearing 0 (axis-aligned), offset still along armBlue
            geoRect(entry.pt, 0, halfSz, halfSz, '#ffffff', '#dc2626');
            geoRect(_geoOffset(entry.pt, armBlue, offset), 0, halfSz, halfSz, '#ffffff', '#2563eb');
        }
    }
}

// Cowboy corners are drawn once, after all cowboy lines are processed —
// scope the shared cornerMap to cowboy-type lines only, exactly like
// calcCowboy() does for the live map.
const cowboyLinesForPdf = allLines.filter(ld => (ld.fenceType || 'cowboy') === 'cowboy');
buildCornerMap(cowboyLinesForPdf.map(ld => ld.points));

allLines.forEach((ld, idx) => {
    const pts = ld.points;
    if (!pts || pts.length < 2) return;
    const fenceType = ld.fenceType || 'cowboy';
    const opts = ld.fenceOptions || {}; // per-line captured settings — same source of truth the map uses
    const total = _geoTotalLen(pts);

    if (fenceType === 'cowboy') {
        geoPolyline(pts, '#1a1a1a', 0.6, []);
        const spacing = parseFloat(opts.spacing) || parseFloat(document.getElementById('postSpacing')?.value) || 2.5;

        // Reuse the exact geometry the map already computed (corner
        // shortening + split panels near dual posts included) instead of
        // recalculating from scratch — this is what was causing panel
        // counts/spacings to disagree with the real drawing.
        const geom = ld._cowboyPlanGeom;
        let dAcc = 0;
        const numSegs = pts.length - 1;

        for (let i = 0; i < numSegs; i++) {
            const p0 = pts[i], p1 = pts[i + 1];
            const segLen = _geoHav(p0, p1);
            const b = _geoBearing(p0, p1);

            const g = geom && geom[i];
            let poleDists, stdCount;
            if (g) {
                poleDists = g.boundsRel.slice();
                stdCount = g.standardCount;
            } else {
                poleDists = [0];
                let calc = null;
                if (segLen > 0.5) {
                    calc = calcCowboyPanels(segLen, spacing);
                    calc.ticks.forEach(t => poleDists.push(t.pos));
                }
                poleDists.push(segLen);
                stdCount = calc ? calc.standardCount : 1;
            }

            poleDists.forEach((dist, pIdx) => {
                const pt = _geoInterp(pts, dAcc + dist);
                const isTrueStart = (i === 0 && pIdx === 0);
                const isTrueEnd   = (i === numSegs - 1 && pIdx === poleDists.length - 1);
                const isMidCorner = (pIdx === poleDists.length - 1 && i < numSegs - 1);
                const isCornerSkip = (pIdx === 0 && i > 0);
                if (isCornerSkip) return;

                const isEndOfLine = isTrueStart || isTrueEnd || isMidCorner;
                const cornerPt = (pIdx === 0) ? p0 : p1;
                // Every corner point (shared or a plain line end) is drawn
                // exactly once by geoDrawCowboyCorners() below — matches
                // drawPlanCowboyLine's own skip logic, so two lines sharing
                // a corner don't each draw their own overlapping post.
                if (isEndOfLine && isCornerPoint(cornerPt)) return;

                drawVPost(pt, b, isEndOfLine, 0.15);
            });

            for (let j = 0; j < poleDists.length - 1; j++) {
                const isStandardPanel = j < stdCount;
                if (isStandardPanel && j > 0) continue;
                const sPt = _geoInterp(pts, dAcc + poleDists[j]);
                const ePt = _geoInterp(pts, dAcc + poleDists[j + 1]);
                geoDimLine(sPt, ePt, 0.25, _geoHav(sPt, ePt).toFixed(2) + 'm', '#000000');
            }
            geoDimLine(p0, p1, 0.55, segLen.toFixed(2) + 'm', '#000000');
            dAcc += segLen;
        }

    } else if (fenceType === 'concrete') {
        geoPolyline(pts, '#1a1a1a', 0.6, []);
        const spacing = opts.postSpacing
            || parseFloat(document.getElementById('postSpacingConcrete')?.value)
            || parseFloat(document.getElementById('spacingSelectConcrete')?.value)
            || 2.5;
        const useDualPillar = opts.doubleCorner
            ?? (document.getElementById('concreteDoubleCornerPost')?.checked || false);

        const numSegs = pts.length - 1;
        let dAcc = 0;

        for (let i = 0; i < numSegs; i++) {
            const p0 = pts[i], p1 = pts[i + 1];
            const segLen = _geoHav(p0, p1);
            const b = _geoBearing(p0, p1);

            let poleDists = [0], stdCount = 1;
            if (segLen > 0.5) {
                const calc = calcConcretePanels(segLen, spacing); // was a naive while-loop before — wrong panel count/split logic
                calc.ticks.forEach(t => poleDists.push(t.pos));
                stdCount = calc.standardCount;
            }
            poleDists.push(segLen);

            poleDists.forEach((dist, pIdx) => {
                const pt = _geoInterp(pts, dAcc + dist);
                const isTrueStart = (i === 0 && pIdx === 0);
                const isTrueEnd   = (i === numSegs - 1 && pIdx === poleDists.length - 1);
                const isMidCorner = (pIdx === poleDists.length - 1 && i < numSegs - 1);
                const isCornerSkip = (pIdx === 0 && i > 0);
                if (isCornerSkip) return;
                const isEndOfLine = isTrueStart || isTrueEnd || isMidCorner;

                if (isEndOfLine && useDualPillar) {
                    // Vector approximation of the map's red "end" / blue "start"
                    // icon pair (jsPDF can't easily embed the PNG icons here) —
                    // still visually distinguishes a dual-post corner from a
                    // normal single post, which the old PDF never did at all.
                    const inB  = isTrueStart ? (b + 180) % 360 : b;
                    const outB = isTrueEnd   ? (b + 180) % 360
                                 : isMidCorner ? _geoBearing(pts[i + 1], pts[i + 2])
                                 : b;
                    const scale = window._poleScale || 1.0;
                    const vis = Math.max(0.15, 0.15) * scale * 3;
                    const gap = 0.3;
                    geoRect(_geoOffset(pt, inB, gap / 2),  inB,  vis / 2, vis / 2, '#ffffff', '#dc2626');
                    geoRect(_geoOffset(pt, outB, gap / 2), outB, vis / 2, vis / 2, '#ffffff', '#2563eb');
                } else {
                    drawVPost(pt, b, isEndOfLine, 0.15);
                }
            });

            for (let j = 0; j < poleDists.length - 1; j++) {
                const isStandardPanel = j < stdCount;
                if (isStandardPanel && j > 0) continue;
                const sPt = _geoInterp(pts, dAcc + poleDists[j]);
                const ePt = _geoInterp(pts, dAcc + poleDists[j + 1]);
                geoDimLine(sPt, ePt, 0.25, _geoHav(sPt, ePt).toFixed(2) + 'm', '#000000');
            }
            geoDimLine(p0, p1, 0.55, segLen.toFixed(2) + 'm', '#000000');
            dAcc += segLen;
        }

    } else if (fenceType === 'barbed') {
        const spacing = parseFloat(opts.spacing) || parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5;
        const offsets = [-0.25, 0, 0.25];
        offsets.forEach((off, si) => {
            geoPolyline(pts, '#4b5563', si === 1 ? 0.5 : 0.2, si === 1 ? [] : [1.2, 0.8]);
        });
        let d2 = 0;
        while (d2 <= total + 1e-4) {
            const pt = _geoInterp(pts, Math.min(d2, total));
            const b  = _geoBearingAt(pts, Math.min(d2, total));
            const isEnd = d2 < 1e-3 || d2 >= total - 1e-3;
            drawVPost(pt, b, isEnd, 0.15);
            d2 += spacing;
        }
        for (let i = 0; i < pts.length - 1; i++) {
            const segLen = _geoHav(pts[i], pts[i + 1]);
            geoDimLine(pts[i], pts[i + 1], 0.5, segLen.toFixed(2) + 'm', '#374151');
        }

    } else if (fenceType === 'brick') {
        // Real spacing rule: even division of each segment, not
        // "spacing, then a leftover remainder" — this alone was producing
        // a different pillar count than what's actually on the map.
        const d = Math.min(5, Math.max(0.5, parseFloat(opts.spacing)
            || parseFloat(document.getElementById('postSpacingBrick')?.value)
            || parseFloat(document.getElementById('imPostSpacingBrick')?.value)
            || 2.5));
        const h = parseFloat(opts.height)
            || parseFloat(document.getElementById('brickFenceHeight')?.value)
            || parseFloat(document.getElementById('imBrickFenceHeight')?.value)
            || 1.8;

        let beamMode = opts.beamMode;
        if (!beamMode || beamMode === '0') {
            if (!opts.beamMode) {
                if (h <= 1.2) beamMode = 'none';
                else if (h < 1.8) beamMode = 'top';
                else if (h < 2.2) beamMode = 'center';
                else beamMode = 'center+top';
            } else {
                beamMode = 'none';
            }
        }

        geoPolyline(pts, '#92400e', 0.9, []);

        let cumulDist = 0;
        const numSegs = pts.length - 1;
        for (let si = 0; si < numSegs; si++) {
            const p0 = pts[si], p1 = pts[si + 1];
            const A_i = _geoHav(p0, p1);
            const segB = _geoBearing(p0, p1);

            const r_i = Math.ceil(A_i / d);
            const dPrime = A_i / r_i;

            let cursor = cumulDist;
            for (let bi = 0; bi < r_i; bi++) {
                const ptStart = _geoInterp(pts, cursor);
                const isStartOfLine = (si === 0 && bi === 0);
                drawVPost(ptStart, segB, isStartOfLine, 0.15);

                if (beamMode !== 'none') {
                    const ptEnd = _geoInterp(pts, cursor + dPrime);
                    geoBrickBeamSymbol(ptStart, ptEnd, segB, beamMode);
                }
                cursor += dPrime;
            }
            geoDimLine(p0, p1, 0.55, A_i.toFixed(2) + 'm', '#92400e');
            cumulDist += A_i;
        }
        const lastPt = pts[pts.length - 1];
        const lastB  = _geoBearing(pts[pts.length - 2], lastPt);
        drawVPost(lastPt, lastB, true, 0.15);
    }

    const [lx, ly] = project(pts[0]);
    const colours = { cowboy:'#000000', concrete:'#000000', barbed:'#374151', brick:'#92400e' };
    const bgColours = { cowboy:'#ffffff', concrete:'#ffffff', barbed:'#f9fafb', brick:'#fff7ed' };
    const typeNames = { cowboy:'คาวบอย', concrete:'คอนกรีต', barbed:'ลวดหนาม', brick:'อิฐ' };
    const label = `Line ${idx+1} (${typeNames[fenceType]||fenceType})  L=${total.toFixed(1)}m`;
    pdf.setFontSize(5.5);
    pdf.setFont('Sarabun', 'bold');
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

// Draw all cowboy dual/single corner posts once, after every line is done —
// same reasoning as drawPlanCowboyCorners on the live map.
geoDrawCowboyCorners();

async function downloadPlanPDF() {
    const btn = document.getElementById('btnDownloadPDF');
    if (!btn) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ กำลังสร้าง PDF...';
    
    try {
        if (typeof jspdf === 'undefined') throw new Error('jspdf ยังไม่ถูกโหลด');
        if (typeof allLines === 'undefined' || allLines.length === 0) throw new Error('ยังไม่มีเส้นรั้ว กรุณาวาดก่อน');

        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        allLines.forEach(ld => {
            (ld.points || []).forEach(([la, ln]) => {
                if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
                if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
            });
        });
        if (!isFinite(minLat)) throw new Error('ไม่พบพิกัดจากเส้นรั้ว');

        const { jsPDF } = jspdf;
        const PW = 420, PH = 297;
        const MARGIN = 14, FOOTER_H = 10;
        const drawW = PW - MARGIN * 2;
        const drawH = PH - MARGIN * 2 - FOOTER_H - 8;

        const R = 6378137;
        function latToY(lat) { const s = Math.sin(lat * Math.PI / 180); return R * Math.log((1 + s) / (1 - s)) / 2; }
        function lngToX(lng) { return R * lng * Math.PI / 180; }

        const geoX0 = lngToX(minLng), geoX1 = lngToX(maxLng);
        const geoY0 = latToY(minLat), geoY1 = latToY(maxLat);
        const geoW  = geoX1 - geoX0 || 1;
        const geoH  = geoY1 - geoY0 || 1;

        const scaleX = drawW / geoW, scaleY = drawH / geoH;
        const S = Math.min(scaleX, scaleY);
        const offX = MARGIN + (drawW - geoW * S) / 2;
        const offY = MARGIN + 8 + (drawH - geoH * S) / 2;

        function project([lat, lng]) {
            const x = offX + (lngToX(lng) - geoX0) * S;
            const y = offY + (geoY1 - latToY(lat)) * S;
            return [x, y];
        }

        const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a3', compress: true });

        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, PW, PH, 'F');

        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.2);
        pdf.rect(MARGIN, MARGIN + 6, drawW, drawH + 2, 'S');

        function hexRgb(h) {
            const n = parseInt(h.replace('#',''), 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

        function geoRect(pt, bearingDeg, halfW, halfH, fillHex, strokeHex) {
            const [cx, cy] = project(pt);
            const rad = bearingDeg * Math.PI / 180;
            const corners = [
                [-halfW * S, -halfH * S],
                [ halfW * S, -halfH * S],
                [ halfW * S,  halfH * S],
                [-halfW * S,  halfH * S],
            ].map(([dx, dy]) => {
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

        function geoDimLine(p0, p1, offsetM, label, strokeHex) {
            const b = _geoBearing(p0, p1);
            const perpB = b + 90;
            const s = _geoOffset(p0, perpB, offsetM);
            const e = _geoOffset(p1, perpB, offsetM);
            geoPolyline([p0, s], '#888888', 0.15, [0.8, 0.8]);
            geoPolyline([p1, e], '#888888', 0.15, [0.8, 0.8]);
            geoPolyline([s, e], strokeHex, 0.25, []);
            const tk = offsetM * 0.12;
            geoPolyline([_geoOffset(s, b, -tk), _geoOffset(s, b, tk)], strokeHex, 0.35, []);
            geoPolyline([_geoOffset(e, b, -tk), _geoOffset(e, b, tk)], strokeHex, 0.35, []);
            const mid = [(_geoOffset(s,perpB,0)[0]+_geoOffset(e,perpB,0)[0])/2,
                          (_geoOffset(s,perpB,0)[1]+_geoOffset(e,perpB,0)[1])/2];
            const [mx,my] = project(mid);
            pdf.setFontSize(4.5);
            pdf.setFont('Sarabun', 'bold');
            const [tr,tg,tb] = hexRgb(strokeHex);
            pdf.setTextColor(tr,tg,tb);
            const tw = pdf.getTextWidth(label);
            pdf.setFillColor(255,255,255);
            pdf.setDrawColor(tr,tg,tb);
            pdf.setLineWidth(0.1);
            pdf.setLineDashPattern([],0);
            pdf.rect(mx - tw/2 - 0.5, my - 2.2, tw + 1, 2.8, 'FD');
            pdf.text(label, mx, my - 0.2, { align: 'center' });
        }

        function _geoBearing(p0, p1) {
            const dLng = (p1[1] - p0[1]) * Math.cos(p0[0] * Math.PI / 180);
            const dLat = p1[0] - p0[0];
            return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
        }

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

        function _geoHav([la0,lo0],[la1,lo1]) {
            const R2=6378137, toR=Math.PI/180;
            const dLa=(la1-la0)*toR, dLo=(lo1-lo0)*toR;
            const a=Math.sin(dLa/2)**2+Math.cos(la0*toR)*Math.cos(la1*toR)*Math.sin(dLo/2)**2;
            return R2*2*Math.asin(Math.sqrt(a));
        }

        function _geoInterp(pts, dist) {
            let rem = dist;
            for (let i = 0; i < pts.length - 1; i++) {
                const segLen = _geoHav(pts[i], pts[i+1]);
                if (rem <= segLen + 1e-9) {
                    const t = Math.min(1, rem / (segLen || 1));
                    return [pts[i][0] + (pts[i+1][0]-pts[i][0])*t, pts[i][1] + (pts[i+1][1]-pts[i][1])*t];
                }
                rem -= segLen;
            }
            return pts[pts.length-1];
        }

        function _geoBearingAt(pts, dist) {
            let rem = dist;
            for (let i = 0; i < pts.length - 1; i++) {
                const segLen = _geoHav(pts[i], pts[i+1]);
                if (rem <= segLen + 1e-9) return _geoBearing(pts[i], pts[i+1]);
                rem -= segLen;
            }
            return _geoBearing(pts[pts.length-2], pts[pts.length-1]);
        }

        function _geoTotalLen(pts) {
            let t = 0;
            for (let i = 0; i < pts.length-1; i++) t += _geoHav(pts[i], pts[i+1]);
            return t;
        }

        function drawVPost(pt, bearingDeg, isCorner, sizeM) {
            const sc = window._poleScale || 1.0;
            const vis = Math.max(sizeM, 0.15) * sc * 3;
            const hSz = vis / 2;
            geoRect(pt, bearingDeg, hSz, hSz, isCorner ? '#dc2626' : '#ffffff', '#1a1a1a');
        }

        allLines.forEach((ld, idx) => {
            const pts = ld.points;
            if (!pts || pts.length < 2) return;
            const fenceType = ld.fenceType || 'cowboy';
            const total = _geoTotalLen(pts);

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
            } else if (fenceType === 'barbed') {
                const spacing = parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5;
                const offsets = [-0.25, 0, 0.25];
                offsets.forEach((off, si) => {
                    const strandPts = pts.map(p => _geoOffset(p, _geoBearing(pts[0], pts[pts.length > 1 ? 1 : 0]) + 90, off));
                    geoPolyline(pts, '#4b5563', si===1 ? 0.5 : 0.2, si===1 ? [] : [1.2, 0.8]);
                });
                let d2 = 0;
                while (d2 <= total + 1e-4) {
                    const pt = _geoInterp(pts, Math.min(d2, total));
                    const b  = _geoBearingAt(pts, Math.min(d2, total));
                    const isEnd  = d2 < 1e-3 || d2 >= total - 1e-3;
                    drawVPost(pt, b, isEnd, 0.15);
                    d2 += spacing;
                }
                for (let i = 0; i < pts.length-1; i++) {
                    const segLen = _geoHav(pts[i], pts[i+1]);
                    geoDimLine(pts[i], pts[i+1], 0.5, segLen.toFixed(2)+'m', '#374151');
                }
            } else if (fenceType === 'brick') {
                const spacing = parseFloat((document.getElementById('postSpacingBrick') || document.getElementById('imPostSpacingBrick'))?.value) || 2.5;
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

            const [lx, ly] = project(pts[0]);
            const colours = { cowboy:'#000000', concrete:'#000000', barbed:'#374151', brick:'#92400e' };
            const bgColours = { cowboy:'#ffffff', concrete:'#ffffff', barbed:'#f9fafb', brick:'#fff7ed' };
            const typeNames = { cowboy:'คาวบอย', concrete:'คอนกรีต', barbed:'ลวดหนาม', brick:'อิฐ' };
            const label = `Line ${idx+1} (${typeNames[fenceType]||fenceType})  L=${total.toFixed(1)}m`;
            pdf.setFontSize(5.5);
            pdf.setFont('Sarabun', 'bold');
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

        pdf.setFillColor(30, 41, 59);
        pdf.rect(0, 0, PW, MARGIN + 2, 'F');
        pdf.setTextColor(255,255,255);
        pdf.setFontSize(10);
        pdf.setFont('Sarabun', 'bold');
        pdf.text('FENCE PLAN — แบบแปลนรั้ว', PW/2, 8, { align: 'center' });

        const dateStr = new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
        pdf.setFontSize(6);
        pdf.setFont('Sarabun', 'normal');
        pdf.text(`วันที่: ${dateStr}`, MARGIN, 12.5);

        const scaleEl = document.querySelector('#psbTitle');
        const scaleText = scaleEl ? scaleEl.textContent.replace('🔒','').trim() : '';
        if (scaleText) pdf.text(scaleText, PW - MARGIN, 12.5, { align: 'right' });

        const FY = PH - FOOTER_H;
        pdf.setFillColor(241, 245, 249);
        pdf.rect(0, FY, PW, FOOTER_H, 'F');
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.3);
        pdf.line(0, FY, PW, FY);
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(5.5);
        pdf.setFont('Sarabun', 'normal');
        pdf.text('Maybe i should put some text here', PW/2, FY + 6.5, { align: 'center' });

        let grandTotal = 0;
        allLines.forEach(ld => { grandTotal += _geoTotalLen(ld.points || []); });
        pdf.text(`ความยาวรั้วรวม: ${grandTotal.toFixed(1)} ม.  |  จำนวนด้าน: ${allLines.length}`, MARGIN, FY + 6.5);

        const naX = MARGIN + drawW - 8, naY = MARGIN + 14;
        pdf.setDrawColor(30,41,59); pdf.setLineWidth(0.5); pdf.setLineDashPattern([],0);
        pdf.line(naX, naY + 6, naX, naY);
        pdf.line(naX, naY, naX - 2.5, naY + 5);
        pdf.line(naX, naY, naX + 2.5, naY + 5);
        pdf.setFillColor(30,41,59);
        pdf.triangle(naX, naY, naX-2.5, naY+5, naX+2.5, naY+5, 'F');
pdf.setFontSize(6); pdf.setFont('Sarabun','bold');
        pdf.setTextColor(30,41,59);
        pdf.text('N', naX, naY - 1.5, { align:'center' });

        // ── LEGEND BOX ────────────────────────────────────────────────
        const presentTypes = new Set(allLines.map(ld => ld.fenceType || 'cowboy'));
        const legendEntries = [];
        legendEntries.push({ kind:'post-normal', label:'Normal post / เสาทั่วไป' });
        legendEntries.push({ kind:'post-corner', label:'Corner / End post / เสามุม' });
        if (presentTypes.has('cowboy') || presentTypes.has('concrete'))
            legendEntries.push({ kind:'line-cowboy', label:'Cowboy / Concrete fence' });
        if (presentTypes.has('barbed')) {
            legendEntries.push({ kind:'line-barbed', label:'Barbed wire fence' });
            legendEntries.push({ kind:'brace-solo',  label:'Single N-brace / ค้ำยันเดี่ยว' });
            legendEntries.push({ kind:'brace-dual',  label:'Double N-brace / ค้ำยันคู่' });
        }
        if (presentTypes.has('brick')) {
            legendEntries.push({ kind:'line-brick',  label:'Brick wall / รั้วอิฐ' });
            legendEntries.push({ kind:'beam-top',    label:'Top beam (orange) / คานบน' });
            legendEntries.push({ kind:'beam-center', label:'Centre beam (blue) / คานกลาง' });
        }
        legendEntries.push({ kind:'dim', label:'Dimension line / เส้นมิติ' });

        const LX = MARGIN;                    // left edge of legend box
        const LY = PH - FOOTER_H - 4;        // just above footer
        const ROW  = 4.8;                     // row height mm
        const SYM  = 10;                      // symbol column width mm
        const TXTW = 52;                      // text column width mm
        const BW   = SYM + TXTW + 6;         // box width
        const BH   = 6 + legendEntries.length * ROW + 3;  // box height
        const legendTop = LY - BH;

        pdf.setFillColor(255,255,255);
        pdf.setDrawColor(30,41,59);
        pdf.setLineWidth(0.4);
        pdf.setLineDashPattern([],0);
        pdf.rect(LX, legendTop, BW, BH, 'FD');

        pdf.setFontSize(5); pdf.setFont('Sarabun','bold');
        pdf.setTextColor(30,41,59);
        pdf.text('LEGEND', LX + BW/2, legendTop + 4, { align:'center' });

        pdf.setLineWidth(0.25);
        pdf.setDrawColor(30,41,59);
        pdf.line(LX + 2, legendTop + 5.2, LX + BW - 2, legendTop + 5.2);

        legendEntries.forEach((entry, ei) => {
            const ry = legendTop + 6.5 + ei * ROW;
            const symCx = LX + 2 + SYM / 2;   // symbol centre x
            const symCy = ry + ROW / 2 - 0.5;  // symbol centre y

            pdf.setLineDashPattern([],0);
            pdf.setLineWidth(0.25);

            switch(entry.kind) {
                case 'post-normal':
                    pdf.setFillColor(255,255,255); pdf.setDrawColor(26,26,26);
                    pdf.rect(symCx - 1.8, symCy - 1.8, 3.6, 3.6, 'FD'); break;
                case 'post-corner':
                    pdf.setFillColor(220,38,38); pdf.setDrawColor(26,26,26);
                    pdf.rect(symCx - 2.2, symCy - 2.2, 4.4, 4.4, 'FD'); break;
                case 'line-cowboy':
                    pdf.setDrawColor(26,26,26); pdf.setLineWidth(0.7);
                    pdf.line(LX+2, symCy, LX+2+SYM, symCy);
                    pdf.setFillColor(255,255,255); pdf.setLineWidth(0.25);
                    pdf.rect(symCx-1.5, symCy-1.5, 3, 3, 'FD'); break;
                case 'line-barbed':
                    pdf.setDrawColor(75,85,99); pdf.setLineWidth(0.3);
                    pdf.line(LX+2, symCy-1.2, LX+2+SYM, symCy-1.2);
                    pdf.setLineWidth(0.6);
                    pdf.line(LX+2, symCy,     LX+2+SYM, symCy);
                    pdf.setLineWidth(0.3);
                    pdf.line(LX+2, symCy+1.2, LX+2+SYM, symCy+1.2);
                    // barb ticks
                    [LX+5, LX+9].forEach(bx => {
                        pdf.setLineWidth(0.4);
                        pdf.line(bx, symCy-2, bx+1.5, symCy+2);
                    }); break;
                case 'brace-solo':
                    pdf.setDrawColor(75,85,99); pdf.setLineWidth(0.6);
                    pdf.line(LX+2,      symCy+2, LX+2,      symCy-2);
                    pdf.line(LX+2+SYM,  symCy+2, LX+2+SYM,  symCy-2);
                    pdf.setLineWidth(0.3);
                    pdf.line(LX+2, symCy-2, LX+2+SYM, symCy+2);
                    pdf.setLineWidth(0.5);
                    pdf.line(LX+1, symCy+2, LX+3, symCy+2);
                    pdf.line(LX+1+SYM, symCy+2, LX+3+SYM, symCy+2); break;
                case 'brace-dual':
                    pdf.setDrawColor(75,85,99); pdf.setLineWidth(0.6);
                    pdf.line(LX+2,      symCy+2, LX+2,      symCy-2);
                    pdf.line(LX+2+SYM,  symCy+2, LX+2+SYM,  symCy-2);
                    pdf.setLineWidth(0.3);
                    pdf.line(LX+2, symCy-2, LX+2+SYM, symCy+2);
                    pdf.line(LX+2, symCy+2, LX+2+SYM, symCy-2);
                    pdf.setLineWidth(0.5);
                    pdf.line(LX+1, symCy+2, LX+3, symCy+2);
                    pdf.line(LX+1+SYM, symCy+2, LX+3+SYM, symCy+2); break;
                case 'line-brick':
                    pdf.setDrawColor(146,64,14); pdf.setLineWidth(1.2);
                    pdf.line(LX+2, symCy, LX+2+SYM, symCy);
                    pdf.setFillColor(255,255,255); pdf.setLineWidth(0.25); pdf.setDrawColor(26,26,26);
                    pdf.rect(symCx-1.5, symCy-1.5, 3, 3, 'FD'); break;
                case 'beam-top':
                    pdf.setDrawColor(234,88,12); pdf.setLineWidth(0.6);
                    pdf.line(LX+2, symCy, LX+2+SYM, symCy);
                    pdf.setFillColor(234,88,12); pdf.setLineWidth(0.25);
                    pdf.circle(symCx, symCy, 1.2, 'FD');
                    pdf.line(symCx, symCy-2.5, symCx, symCy+2.5); break;
                case 'beam-center':
                    pdf.setDrawColor(37,99,235); pdf.setLineWidth(0.6);
                    pdf.setLineDashPattern([1.5,1],0);
                    pdf.line(LX+2, symCy, LX+2+SYM, symCy);
                    pdf.setLineDashPattern([],0);
                    pdf.setFillColor(37,99,235); pdf.setLineWidth(0.25);
                    pdf.circle(symCx, symCy, 1.2, 'FD');
                    pdf.line(symCx, symCy-2.5, symCx, symCy+2.5); break;
                case 'dim':
                    pdf.setDrawColor(0,0,0); pdf.setLineWidth(0.3);
                    pdf.line(LX+2,     symCy, LX+2+SYM, symCy);
                    pdf.line(LX+2,     symCy-1.5, LX+2,     symCy+1.5);
                    pdf.line(LX+2+SYM, symCy-1.5, LX+2+SYM, symCy+1.5);
                    pdf.setFillColor(255,255,255); pdf.setLineWidth(0.2);
                    const dw = 6;
                    pdf.rect(symCx-dw/2, symCy-1.5, dw, 3, 'FD');
                    pdf.setFontSize(3); pdf.setFont('Sarabun','normal');
                    pdf.setTextColor(0,0,0);
                    pdf.text('2.50m', symCx, symCy+0.8, {align:'center'}); break;
            }

            // Row label
            pdf.setFontSize(4.2); pdf.setFont('Sarabun','normal');
            pdf.setTextColor(30,41,59);
            pdf.text(entry.label, LX + 2 + SYM + 2, symCy + 1.2);
        });
        // ── END LEGEND BOX ────────────────────────────────────────────

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
    const imRoot = document.querySelector('.im-root');
    const searchBar = document.getElementById('searchBar') || document.querySelector('.search-container, #search-input');

    if (planModeActive) {
        if (searchBar) searchBar.style.display = 'none';
        if (imRoot) imRoot.style.display = 'none';
        const tabBar = document.querySelector('.sb-tab-bar');
        if (tabBar) tabBar.style.display = 'none';
        const sbPage1 = document.getElementById('sbPage1');
        if (sbPage1) sbPage1.style.display = 'none';

        map._savedClickListeners = map._events && map._events.click ? [...map._events.click] : [];
        map.off('click');
        map.getContainer().style.cursor = 'default';
        if (typeof measureActive !== 'undefined') { measureActive = false; }
        const measureBtn = document.getElementById('measureBtn');
        if (measureBtn) measureBtn.classList.remove('active');

        allLines.forEach(ld => {
            if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
            if (ld.segmentLabels) ld.segmentLabels.forEach(l => map.hasLayer(l) && map.removeLayer(l));
            if (ld.angleLabels)   ld.angleLabels.forEach(l => map.hasLayer(l) && map.removeLayer(l));
            if (ld.markers)       ld.markers.forEach(m => map.hasLayer(m) && map.removeLayer(m));
            if (ld.startMarker && map.hasLayer(ld.startMarker)) map.removeLayer(ld.startMarker);
            if (ld.branches) ld.branches.forEach(br => {
                if (br.polyline && map.hasLayer(br.polyline)) map.removeLayer(br.polyline);
            });
        });
        if (typeof fenceLayerGroup !== 'undefined') fenceLayerGroup.clearLayers();

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
        if (searchBar) searchBar.style.display = '';
        if (imRoot) imRoot.style.display = '';
        const tabBar = document.querySelector('.sb-tab-bar');
        if (tabBar) tabBar.style.display = '';

        if (map._savedClickListeners && map._savedClickListeners.length > 0) {
            map._savedClickListeners.forEach(h => map.on('click', h.fn, h.ctx));
        }
        
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
    if (window._planLegendControl) {
        try { map.removeControl(window._planLegendControl); } catch(_) {}
        window._planLegendControl = null;
    }
    const listEl = document.getElementById('planLineList');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    allLines.forEach((ld, idx) => {
        const item = document.createElement('div');
        item.className = 'plan-line-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `plan_cb_${idx}`;
        cb.checked = true;
        cb.addEventListener('change', renderPlanView);
        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id;
        lbl.textContent = `Line ${idx + 1} — ${(ld.fenceType || 'ทั่วไป').toUpperCase()}`;
        item.appendChild(cb);
        item.appendChild(lbl);
        listEl.appendChild(item);
    });

    // Run the real map-mode calculation FIRST so every cowboy line's
    // _cowboyPlanGeom (segment boundaries, dual-corner offsets, standard vs
    // split panel counts) is fresh before we draw a single plan post or
    // dimension line. Plan mode never recomputes this math itself — it only
    // re-skins the same numbers the map used.
    //
    // This must run BEFORE the visible-only buildCornerMap call below:
    // runFenceCalc() -> calcCowboy() rebuilds cornerMap from ALL cowboy
    // lines internally, which would otherwise clobber the visible-only
    // corner map that the actual plan drawing depends on.
if (typeof runFenceCalc === 'function') runFenceCalc();
if (typeof fenceLayerGroup !== 'undefined') fenceLayerGroup.clearLayers();
// Build cornerMap for ALL visible lines (cowboy + concrete + etc.) before
// drawPlanLine, so concrete corners are properly recognized and don't
// fall through to drawing a red box via drawPlanPost(isCorner=true).
const allVisibleLines = allLines.filter((ld, idx) => {
    const cb = document.getElementById(`plan_cb_${idx}`);
    return cb && cb.checked;
});
if (typeof buildCornerMap === 'function') {
    const visibleCowboyLines = allVisibleLines.filter(ld => (ld.fenceType || 'cowboy') === 'cowboy');
    buildCornerMap(visibleCowboyLines.map(ld => ld.points));
}
allLines.forEach((ld, idx) => {
    const cb = document.getElementById(`plan_cb_${idx}`);
    if (cb && cb.checked) drawPlanLine(ld, idx);
});

// Cowboy corners: single shared pass, same corner data the map used.
if (typeof drawPlanCowboyCorners === 'function') drawPlanCowboyCorners();

// Concrete corners: same idea — rebuild cornerMap scoped to only the
// visible concrete lines (buildCornerMap is destructive/global, so this
// must happen in its own scoped call, after the cowboy pass above has
// already used and finished with the shared cornerMap), then draw each
// dual red/blue corner pillar exactly once.
const visibleConcreteLines = allLines.filter((ld, idx) => {
    const cb = document.getElementById(`plan_cb_${idx}`);
    return cb && cb.checked && (ld.fenceType || 'cowboy') === 'concrete';
});
if (typeof buildCornerMap === 'function') {
    buildCornerMap(visibleConcreteLines.map(ld => ld.points));
}
if (typeof drawPlanConcreteCorners === 'function') drawPlanConcreteCorners();

    _drawPlanLegend();
    renderPlanSummaryTable();
}

// ============================================
// PLAN VIEW — MATERIALS & PRICE SUMMARY TABLE
// (per instruction note #3: the plan must show a table with the
// quantity of materials used — beams, posts, etc. — and the total
// price, calculated across everything.)
// ============================================
function renderPlanSummaryTable() {
    const box = document.getElementById('planSummaryBox');
    if (!box) return;

    // renderPlanView() already ran runFenceCalc() before drawing the plan
    // lines (so their geometry would be fresh), which also refreshed
    // resTotal/resPosts/resBeams/resPriceDisplay — just read them here.
    // (runFenceCalc draws into fenceLayerGroup as a side effect; renderPlanView
    // already clears that layer so it doesn't reappear on top of the plan.)

    const total = document.getElementById('resTotal')?.value || '—';
    const posts = document.getElementById('resPosts')?.value || '—';
    const beamsInput = document.getElementById('resBeams');
    const beamsLabel = beamsInput?.closest('.sbr-row-item')?.querySelector('.sbr-label')?.textContent
        || 'จำนวนคานที่ต้องใช้';
    const beamsUnit = beamsInput?.closest('.sbr-row-item')?.querySelector('.sbr-unit')?.textContent
        || 'อัน';
    const beams = beamsInput?.value || '—';
    const price = document.getElementById('resPriceDisplay')?.value || '—';

    box.innerHTML = `
        <div style="font-family:'Courier New',monospace;font-size:11px;font-weight:bold;color:#1a1a1a;letter-spacing:0.05em;border-bottom:1.5px solid #1a1a1a;padding-bottom:5px;margin-bottom:6px;">
            สรุปวัสดุ &amp; ราคา (รวมทั้งหมด)
        </div>
        <table style="width:100%;border-collapse:collapse;font-family:'Courier New',monospace;font-size:11px;color:#1a1a1a;">
            <tr>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;">ความยาวรั้วรวม</td>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;white-space:nowrap;">${total} ม.</td>
            </tr>
            <tr>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;">จำนวนเสา</td>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;white-space:nowrap;">${posts} ต้น</td>
            </tr>
            <tr>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;">${beamsLabel}</td>
                <td style="padding:4px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;white-space:nowrap;">${beams} ${beamsUnit}</td>
            </tr>
            <tr>
                <td style="padding:6px 4px 2px;font-weight:bold;">ราคารวมทั้งหมด</td>
                <td style="padding:6px 4px 2px;text-align:right;font-weight:bold;color:#dc2626;white-space:nowrap;">${price} บาท</td>
            </tr>
        </table>
    `;
}

// ============================================
// PLAN MODE DISPATCHER
// ============================================
function drawPlanLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;
    const fenceType = lineData.fenceType || 'cowboy';

    if (fenceType === 'barbed') {
        drawPlanBarbedLine(lineData, idx);
    } else if (fenceType === 'brick') {
        drawPlanBrickLine(lineData, idx);
    } else if (fenceType === 'concrete') {
        drawPlanConcreteLine(lineData, idx);
    } else {
        // cowboy (default)
        drawPlanCowboyLine(lineData, idx);
    }
}

// ============================================
// SHARED PLAN MODE GEOMETRY HELPERS
// ============================================
function drawPlanPost(pt, b, isCorner, n, fenceType) {
    const scale = window._poleScale || 1.0;
    const isBarbedEndpoint = (fenceType === 'barbed') && isCorner;
    // Concrete corner/end posts are handled separately (start.png / end.png
    // icons via drawPlanConcreteCorners / drawPlanConcreteLine). Drawing them
    // red here would produce a phantom red box underneath — skip colour.
    const isConcreteCorner = (fenceType === 'concrete') && isCorner;
    const visualN = Math.max(n, 0.15) * scale * 3;
    const halfSz = visualN / 2;
    const color = (isCorner && !isBarbedEndpoint && !isConcreteCorner) ? '#dc2626' : '#ffffff';
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
    const b1 = bearing(prevPt, vertexPt);
    const b2 = bearing(vertexPt, nextPt);
    let angle = ((b2 - b1) + 360) % 360;
    if (angle > 180) angle = 360 - angle;

    const radius = 0.4;
    const bisectAngle = ((b1 + b2) / 2 + 360) % 360;
    const labelPt = offPt(vertexPt, bisectAngle + 90, 0.65);

    // Always draw arc regardless of angle value
    const steps = 24;
    const arcPts = [];
    let startAngle = b1;
    let endAngle = b2;
    if (endAngle < startAngle) endAngle += 360;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const deg = startAngle + (endAngle - startAngle) * t;
        arcPts.push(offPt(vertexPt, deg, radius));
    }
    L.polyline(arcPts, { color: '#2563eb', weight: 2, opacity: 0.9, dashArray: null }).addTo(planLayerGroup);
    L.circleMarker(vertexPt, { radius: 3, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1, weight: 1 }).addTo(planLayerGroup);

    // Label box — same style as drawDimLine segment label
L.marker(labelPt, {
    icon: L.divIcon({
        className: '',
        html: `<div style="font-size:11px;color:#000;font-weight:bold;font-family:'Courier New',monospace;background:#ffffff;padding:2px 5px;border:1px solid #000;border-radius:2px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${angleDeg}°</div>`,
        iconSize: [0, 0], iconAnchor: [0, 0]
    }),
    zIndexOffset: 1700
}).addTo(planLayerGroup);
}

function drawPostSizeLabel(pt, b, n, inches) {
    const halfN = (n * (window._poleScale || 1.0)) / 2;
    const left  = offPt(pt, b + 90, halfN);
    const right = offPt(pt, b - 90, halfN);
    const tickOff = 0.35;
    const ls = offPt(left,  b + 90, tickOff);
    const rs = offPt(right, b - 90, tickOff);
    
    L.polyline([left,  ls], { color: '#444', weight: 1, dashArray: '4,3' }).addTo(planLayerGroup);
    L.polyline([right, rs], { color: '#444', weight: 1, dashArray: '4,3' }).addTo(planLayerGroup);
    L.polyline([ls, rs], { color: '#444', weight: 1.5 }).addTo(planLayerGroup);
    
    const tLen = 0.06;
    L.polyline([offPt(ls, b, -tLen), offPt(ls, b, tLen)], { color: '#444', weight: 2 }).addTo(planLayerGroup);
    L.polyline([offPt(rs, b, -tLen), offPt(rs, b, tLen)], { color: '#444', weight: 2 }).addTo(planLayerGroup);
    
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

function drawDimLine(startPt, endPt, offsetM, label, color) {
    const b = bearing(startPt, endPt);
    const perpBearing = (b + 90 + 360) % 360;
    const s = offPt(startPt, perpBearing, offsetM);
    const e = offPt(endPt,   perpBearing, offsetM);

    L.polyline([startPt, s], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);
    L.polyline([endPt,   e], { color: '#000', weight: 0.8, dashArray: '3,3', opacity: 0.5 }).addTo(planLayerGroup);
    L.polyline([s, e], { color: '#000', weight: 1.2 }).addTo(planLayerGroup);

    const tickLen = 0.08;
    L.polyline([offPt(s, b + 90, -tickLen), offPt(s, b + 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);
    L.polyline([offPt(e, b + 90, -tickLen), offPt(e, b + 90, tickLen)], { color: '#000', weight: 1.5 }).addTo(planLayerGroup);

    const mid = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    L.marker(mid, {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:11px;color:#000;font-weight:bold;font-family:'Courier New',monospace;background:#ffffff;padding:2px 5px;border:1px solid #000;border-radius:2px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${label}</div>`,
            iconSize: null, iconAnchor: null
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);
}

// ============================================
// SHARED: single post's footprint-length label (plan mode)
// ============================================
// Same visual language as drawDimLine — reuses it directly — but sized to
// just one post's own footprint length along the fence line (posts are
// square, so this is also the post's width), and mirrored to the INNER
// side of the fence line by negating outwardOffset()'s sign. This puts it
// on the opposite side from the full side-length label, which always
// renders on the OUTER side.
function drawPostLengthLabel(pts, distAlong, postSize, color) {
    if (!postSize || postSize <= 0) return;
    const half = postSize / 2;
    const from = Math.max(0, distAlong - half);
    const to = distAlong + half;
    const startPt = interp(pts, from);
    const endPt = interp(pts, to);
    const innerOffset = -outwardOffset(pts, startPt, endPt, 0.3);
    drawDimLine(startPt, endPt, innerOffset, postSize.toFixed(2) + 'm', color);
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

function niceScaleLength(mpp) {
    const target = mpp * 120;
    const candidates = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000];
    return candidates.reduce((best, v) => Math.abs(v - target) < Math.abs(best - target) ? v : best);
}

if(document.readyState !== 'loading') initPlanMode();
else document.addEventListener('DOMContentLoaded', initPlanMode);


function _drawPlanLegend() {
    const old = document.getElementById('planLegendBox');
    if (old) old.remove();

    const types = new Set((allLines || []).map(ld => ld.fenceType || 'cowboy'));

    const entries = [];

    entries.push({ kind: 'post-normal', label: 'เสาทั่วไป (Normal post)' });
    entries.push({ kind: 'post-corner', label: 'เสามุม / ปลาย (Corner / End post)' });

    if (types.has('cowboy'))
        entries.push({ kind: 'line-cowboy', label: 'รั้วคาวบอย' });

    if (types.has('concrete'))
        entries.push({ kind: 'line-concrete', label: 'รั้วคอนกรีตสำเร็จรูป' });

    if (types.has('barbed')) {
        entries.push({ kind: 'line-barbed',    label: 'ลวดหนาม — สายลวด (Wire strands)' });
        entries.push({ kind: 'sharp-corner',   label: 'มุมแหลม <60° (Sharp corner)' });
        entries.push({ kind: 'brace-angle',    label: 'N-Brace มุม ◇ (Angle brace)' });
        entries.push({ kind: 'brace-dual',     label: 'N-Brace คู่ ✕ (Dual brace @50m)' });
        entries.push({ kind: 'brace-solo',     label: 'N-Brace ปลาย ↗ (Solo end brace)' });
    }

    if (types.has('brick')) {
        entries.push({ kind: 'line-brick',   label: 'รั้วอิฐ (Brick wall)' });
        entries.push({ kind: 'beam-top',     label: 'คานบน — สีส้ม (Top beam)' });
        entries.push({ kind: 'beam-center',  label: 'คานกลาง — สีน้ำเงิน (Centre beam)' });
    }

    entries.push({ kind: 'dim', label: 'เส้นมิติ (Dimension line)' });

    const svgMap = {
        'post-normal':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <rect x="11" y="3" width="10" height="10" fill="#fff" stroke="#1a1a1a" stroke-width="2"/>
            </svg>`,
        'post-corner':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <rect x="9" y="2" width="14" height="12" fill="#dc2626" stroke="#1a1a1a" stroke-width="2"/>
            </svg>`,
        'line-cowboy':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="8" x2="30" y2="8" stroke="#1a1a1a" stroke-width="3"/>
                <rect x="12" y="4" width="8" height="8" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/>
            </svg>`,
        'line-concrete':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="8" x2="30" y2="8" stroke="#1a1a1a" stroke-width="3"/>
                <rect x="2" y="4" width="8" height="8" fill="#9ca3af" stroke="#1a1a1a" stroke-width="1.5"/>
                <rect x="22" y="4" width="8" height="8" fill="#9ca3af" stroke="#1a1a1a" stroke-width="1.5"/>
            </svg>`,
        'line-barbed':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="5"  x2="30" y2="5"  stroke="#4b5563" stroke-width="1.5" stroke-dasharray="6,4"/>
                <line x1="2" y1="8"  x2="30" y2="8"  stroke="#4b5563" stroke-width="3"/>
                <line x1="2" y1="11" x2="30" y2="11" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="6,4"/>
            </svg>`,
        'sharp-corner':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <circle cx="16" cy="8" r="7" fill="#fed7aa" fill-opacity="0.55" stroke="#f97316" stroke-width="2.5"/>
            </svg>`,
        'brace-angle':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <polygon points="16,2 26,8 16,14 6,8" fill="none" stroke="#7c3aed" stroke-width="2"/>
                <circle cx="16" cy="8" r="4" fill="#ede9fe" stroke="#7c3aed" stroke-width="1.5"/>
            </svg>`,
        'brace-dual':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="7"  y1="2"  x2="25" y2="14" stroke="#1d4ed8" stroke-width="1.5"/>
                <line x1="25" y1="2"  x2="7"  y2="14" stroke="#1d4ed8" stroke-width="1.5"/>
                <circle cx="16" cy="8" r="4" fill="#93c5fd" stroke="#1d4ed8" stroke-width="1.5"/>
            </svg>`,
        'brace-solo':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="16" y1="8" x2="24" y2="2"  stroke="#dc2626" stroke-width="2" stroke-dasharray="4,3"/>
                <line x1="16" y1="8" x2="24" y2="14" stroke="#dc2626" stroke-width="2" stroke-dasharray="4,3"/>
                <circle cx="16" cy="8" r="4" fill="#fca5a5" stroke="#dc2626" stroke-width="1.5"/>
            </svg>`,
        'line-brick':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="8" x2="30" y2="8" stroke="#92400e" stroke-width="5" opacity="0.9"/>
                <rect x="12" y="4" width="8" height="8" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/>
            </svg>`,
        'beam-top':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="8" x2="30" y2="8" stroke="#ea580c" stroke-width="2"/>
                <circle cx="16" cy="8" r="3.5" fill="#ea580c"/>
                <line x1="16" y1="1" x2="16" y2="15" stroke="#ea580c" stroke-width="2"/>
            </svg>`,
        'beam-center':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2" y1="8" x2="30" y2="8" stroke="#2563eb" stroke-width="2" stroke-dasharray="5,3"/>
                <circle cx="16" cy="8" r="3.5" fill="#2563eb"/>
                <line x1="16" y1="1" x2="16" y2="15" stroke="#2563eb" stroke-width="2"/>
            </svg>`,
        'dim':
            `<svg width="32" height="16" viewBox="0 0 32 16">
                <line x1="2"  y1="8" x2="30" y2="8"  stroke="#000" stroke-width="1"/>
                <line x1="2"  y1="4" x2="2"  y2="12" stroke="#000" stroke-width="1.5"/>
                <line x1="30" y1="4" x2="30" y2="12" stroke="#000" stroke-width="1.5"/>
                <rect x="9" y="4" width="14" height="8" fill="#fff" stroke="#000" stroke-width="0.7"/>
                <text x="16" y="10.5" font-size="4.5" text-anchor="middle" fill="#000" font-family="monospace">2.50m</text>
            </svg>`,
    };

    const rows = entries.map(e => `
        <div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
            <div style="width:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">${svgMap[e.kind] || ''}</div>
            <div style="font-size:10px;color:#1a1a1a;font-family:'Courier New',monospace;white-space:nowrap;line-height:1.3;">${e.label}</div>
        </div>`).join('');

    const box = document.createElement('div');
    box.id = 'planLegendBox';
    box.innerHTML = `
        <div style="font-size:10px;font-weight:bold;color:#1a1a1a;letter-spacing:0.05em;border-bottom:1.5px solid #1a1a1a;padding-bottom:4px;margin-bottom:4px;font-family:'Courier New',monospace;">
            LEGEND
        </div>
        ${rows}
    `;
    // Position below the scale bar (top:100%) so it grows downward and stays on screen,
    // instead of bottom:100% which grows upward off the top of the viewport since
    // customScaleBar sits in the top-right corner.
    // Anchor to the RIGHT edge of the scale bar (mirrors #psbPicker's right:0 in style.css).
    // customScaleBar sits near the right edge of the viewport (.top-right-controls { right:20px }),
    // so left:0 made the legend grow rightward off-screen. right:0 grows it leftward, staying visible.
    box.style.cssText = `
        position:absolute;
        top:100%;
        margin-top:6px;
        right:0;
        background:#fff;
        border:2px solid #1a1a1a;
        padding:8px 10px;
        box-shadow:3px 3px 0 rgba(0,0,0,0.12);
        z-index:1000;
        pointer-events:none;
        min-width:220px;
        max-height:80vh;
        overflow-y:auto;
    `;

    const scaleBar = document.getElementById('customScaleBar');
    if (scaleBar) {
        if (getComputedStyle(scaleBar).position === 'static') {
            scaleBar.style.position = 'relative';
        }
        scaleBar.appendChild(box);
    }
}

function outwardOffset(pts, p0, p1, mag) {
    let cLat = 0, cLon = 0;
    pts.forEach(p => { cLat += p[0]; cLon += p[1]; });
    cLat /= pts.length; cLon /= pts.length;

    const mLat = (p0[0] + p1[0]) / 2, mLon = (p0[1] + p1[1]) / 2;
    const b = bearing(p0, p1);
    const vLat = mLat - cLat, vLon = mLon - cLon;

    // drawDimLine's default direction is b+90 — check if that direction
    // points away from the centroid (outward) or toward it (inward).
    const rad = (b + 90) * Math.PI / 180;
    const dot = Math.cos(rad) * vLat + Math.sin(rad) * vLon;
    return dot >= 0 ? mag : -mag;
}