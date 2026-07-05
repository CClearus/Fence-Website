// ============================================
// INPUT MODE (ระบบกรอกข้อมูล) — input_mode.js
// ============================================
// Allows the user to build a fence shape by typing
// side lengths and angles instead of drawing on the map.
//
// Fence-type angle restrictions:
//   cowboy  → multiples of 90° only
//   barbed  → multiples of 45°
//   brick   → multiples of 45°
//
// Shape closes automatically when the accumulated
// path returns within CLOSE_THRESHOLD metres of the
// origin, OR when the user presses "Finalize".
//
// All geometry is computed from a virtual start-point
// at the current map centre; the shape is drawn via
// fenceLayerGroup (shared with fence.js).
// ============================================

(function () {
    // ── Constants ──────────────────────────────────
    const CLOSE_THRESHOLD = 0.5; // metres — auto-close snap distance
const ANGLE_RULES = {
    cowboy:   { step: 90,  label: '90°' },
    barbed:   { step: 1,   label: '1°'  },
    brick:    { step: 90,  label: '90°' },
    concrete: { step: 90,  label: '90°' },
};
    const DEFAULT_ANGLE_STEP = 1; // degrees (no restriction)

    // ── State ──────────────────────────────────────
// ── State ──────────────────────────────────────
    let imSides      = [];   // [{ length, angle, bearingAbs }]
    let imFenceType  = 'cowboy';
    let imFreeAngle  = false; // true = cowboy angle dial unlocked from 90° steps
    let imLayerGroup = null; // L.layerGroup for preview lines
    let imActive     = false;
    let imOrigin     = null;
    let imLineIndex  = -1;   // index into allLines[] for the IM-owned line

    // ── Initialise layer group (wait for Leaflet map) ──
    function ensureLayer() {
        if (!imLayerGroup && typeof map !== 'undefined') {
            imLayerGroup = L.layerGroup().addTo(map);
        }
    }

    // ============================================
    // GEOMETRY HELPERS (local copies — no dep on fence.js)
    // ============================================
    function im_hav(p1, p2) {
        const R = 6371000;
        const dLat = (p2[0] - p1[0]) * Math.PI / 180;
        const dLon = (p2[1] - p1[1]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function im_offPt(ll, bearingDeg, distM) {
        const R = 6371000, d = distM / R, rb = bearingDeg * Math.PI / 180;
        const f1 = ll[0] * Math.PI / 180, l1 = ll[1] * Math.PI / 180;
        const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(rb));
        const l2 = l1 + Math.atan2(Math.sin(rb) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
        return [f2 * 180 / Math.PI, l2 * 180 / Math.PI];
    }

    // Build ordered [lat,lng] array from imSides
// Build ordered [lat,lng] array from imSides
// Origin is frozen when first side is added (imOrigin), falls back to map center
function buildPoints() {
    ensureLayer();
    if (!imOrigin) {
        const c = map.getCenter();
        imOrigin = [c.lat, c.lng];
    }
    const pts = [imOrigin];
    let cur = imOrigin;
    for (const s of imSides) {
        cur = im_offPt(cur, s.bearingAbs, s.length);
        pts.push(cur);
    }
    return pts;
}

    // Distance from last point back to origin
    function distToClose() {
        if (imSides.length < 2) return Infinity;
        const pts = buildPoints();
        return im_hav(pts[pts.length - 1], pts[0]);
    }

    // Is shape already closed (last pt ≈ first pt)?
    function isClosedShape() {
        return distToClose() < CLOSE_THRESHOLD;
    }

    // ============================================
    // REAL-TIME LOCK ENFORCEMENT
    // window._spacingLocked is set by fence.js's _applyDrawLock() whenever
    // there's a tier-1 (m<1) or tier-3 (panelSpace<0.5) hard violation.
    // Previously that flag only disabled Page-1 draw tools — it never
    // stopped Input Mode from adding more sides, so a warning could appear
    // and the user could just keep adding/drawing past it. These two
    // helpers close that gap.
    // ============================================
    function _imAddBlocked() {
        if (window._spacingLocked) {
            const statusEl = document.getElementById('imStatus');
            if (statusEl) {
                statusEl.textContent = '⛔ กรุณาแก้ไขค่าที่ไม่ถูกต้องให้เรียบร้อยก่อน จึงจะเพิ่มด้านใหม่หรือวาดต่อได้';
                statusEl.className = 'im-status im-status-error';
            }
            return true;
        }
        return false;
    }

    // Keep the "+ เพิ่มด้าน" / "+ เพิ่มด้าน (barbed)" buttons in sync with the
    // current lock state. Called after every recalculation since these
    // buttons get torn down and rebuilt by renderSideList() on every edit.
    function _syncAddButtonLockState() {
        const locked = !!window._spacingLocked;
        ['imAddSegBtn', 'imAddBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = locked;
            el.style.opacity = locked ? '0.4' : '';
            el.style.pointerEvents = locked ? 'none' : '';
            el.style.cursor = locked ? 'not-allowed' : '';
        });
    }
    window._syncAddButtonLockState = _syncAddButtonLockState;

    // ============================================
    // ANGLE SNAPPING
    // ============================================
    function snapAngle(deg, fenceType) {
        const rule = ANGLE_RULES[fenceType];
        if (!rule) return deg;
        const step = rule.step;
        return Math.round(deg / step) * step;
    }

    function angleStepFor(fenceType) {
        if (fenceType === 'cowboy' && imFreeAngle) return DEFAULT_ANGLE_STEP;
        return (ANGLE_RULES[fenceType] || { step: DEFAULT_ANGLE_STEP }).step;
    }

function redrawPreview() {
    ensureLayer();
    imLayerGroup.clearLayers();

    // Always clean up existing ld on map first (polyline, markers, AND labels)
    if (imLineIndex >= 0 && typeof allLines !== 'undefined') {
        const ld = allLines[imLineIndex];
        if (ld) {
            ld.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
            ld.markers = [];
            if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
            ld.polyline = null;
            // Clear labels via redrawLineLabels with empty points — it clears angleLabels/segmentLabels
            const saved = ld.points;
            ld.points = [];
            if (typeof redrawLineLabels === 'function') redrawLineLabels(ld);
            ld.points = saved;
            if (ld.labelLayer) ld.labelLayer.clearLayers();
            if (ld.segLabelLayer) ld.segLabelLayer.clearLayers();
        }
    }

    if (imSides.length === 0) return;

    const pts = buildPoints();
    const drawPts = isClosedShape() ? [...pts, pts[0]] : [...pts];

    const colors = { cowboy: '#d97706', barbed: '#4b5563', brick: '#e8aa60', concrete: '#9ca3af' };
    const col = colors[imFenceType] || '#3b82f6';

    if (typeof redrawLineLabels === 'function' && typeof allLines !== 'undefined') {
        let ld = (imLineIndex >= 0 && imLineIndex < allLines.length) ? allLines[imLineIndex] : null;
        if (!ld) {
            ld = {
                points: drawPts,
                polyline: null,
                markers: [],
                angleLabels: [],
                segmentLabels: [],
                labelLayer: L.layerGroup().addTo(map),
                segLabelLayer: L.layerGroup().addTo(map),
                color: col,
                fenceType: imFenceType,
                fenceOptions: (typeof captureFenceOptions === 'function') ? captureFenceOptions(imFenceType) : {},
                closed: false,
                active: false
            };
            allLines.push(ld);
            imLineIndex = allLines.length - 1;
        } else {
            ld.points = drawPts;
            ld.color = col;
            ld.fenceType = imFenceType;
            ld.fenceOptions = (typeof captureFenceOptions === 'function') ? captureFenceOptions(imFenceType) : {};
            ld.closed = false;
            if (!ld.labelLayer) ld.labelLayer = L.layerGroup().addTo(map);
            if (!ld.segLabelLayer) ld.segLabelLayer = L.layerGroup().addTo(map);
        }

        ld.polyline = L.polyline(drawPts, { color: col, weight: 3, opacity: 0.8 }).addTo(map);

        pts.forEach((p, i) => {
            const m = L.circleMarker(p, {
                radius: 6,
                fillColor: i === 0 ? '#dc2626' : col,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(map);
            ld.markers.push(m);
        });

        redrawLineLabels(ld);
    }

    if (pts.length >= 2) {
        try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 18 }); } catch (_) {}
    }
}

    // ============================================
    // SIDE LIST UI
    // ============================================
function renderSideList() {
    const list = document.getElementById('imSidesBlock');
    if (!list) return;
    list.innerHTML = '';

// REPLACE lines 193–223 (the non-barbed block start):

    if (imFenceType !== 'barbed') {
        // Non-barbed: show only actual sides — no auto-fill
        const count = imSides.length;
        if (count === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'im-empty';
            emptyDiv.textContent = 'ยังไม่มีด้านใดถูกเพิ่ม';
            list.appendChild(emptyDiv);
        }
        for (let i = 0; i < count; i++) {
            const s = imSides[i];
            const absB = s.bearingAbs !== undefined ? ((s.bearingAbs % 360) + 360) % 360 : 0;
            const row = document.createElement('div');
            row.className = 'im-side-row';
            row.innerHTML = `
                <div class="im-side-num" style="min-width:52px;font-size:12px;color:#374151;">ด้านที่ ${i + 1} :</div>
                <input type="number" class="im-inline-len sb-number-input"
                    data-idx="${i}" value="${(s.length||10).toFixed(1)}"
                    min="0.1" step="0.1" style="flex:1;min-width:0;">
                <span style="font-size:12px;color:#374151;margin-left:4px;">ม.</span>
<span style="font-size:11px;color:#6b7280;margin-left:2px;">มุม:</span>
<input type="number" class="im-angle-display-input sb-number-input" data-idx="${i}"
    value="${absB}" min="0" max="359" step="${angleStepFor(imFenceType)}"
    style="width:52px;flex:none;font-size:13px;text-align:center;" readonly
    title="ทิศทาง (°)">
<span style="font-size:10px;color:#9ca3af;margin:0 1px;">°</span>
<button class="im-angle-dial-btn" data-idx="${i}" title="ตั้งมุม"
    style="margin-left:2px;width:26px;height:26px;border-radius:50%;border:1.5px solid #d1d5db;
    background:#f9fafb;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;
    justify-content:center;" data-bearing="${absB}">⊙</button>
            `;
            // Delete button for ALL rows
            const delBtn = document.createElement('button');
            delBtn.className = 'im-del-btn';
            delBtn.setAttribute('data-idx', i);
            delBtn.title = 'ลบด้านนี้';
            delBtn.textContent = '✕';
            delBtn.style.marginLeft = '4px';
            row.appendChild(delBtn);
            list.appendChild(row);
        }
        // "Add segment" button after last row
        const addRow = document.createElement('div');
        addRow.style.cssText = 'padding:6px 10px;';
        addRow.innerHTML = `<button id="imAddSegBtn" style="width:100%;padding:6px 0;font-size:12px;font-weight:600;
            border:1.5px dashed #d1d5db;border-radius:7px;background:#f9fafb;color:#6b7280;cursor:pointer;">
            + เพิ่มด้าน</button>`;
        list.appendChild(addRow);
        if (typeof _syncAddButtonLockState === 'function') _syncAddButtonLockState();

        list.querySelector('#imAddSegBtn').addEventListener('click', function () {
            if (_imAddBlocked()) return;
            const last = imSides[imSides.length - 1];
            const prevB = last ? last.bearingAbs : 270;
            imSides.push({ length: 10, angle: 90, bearingAbs: (prevB + 90) % 360 });
            renderSideList();
            updateStatusBar();
            redrawPreview();
            _pushToAllLines();
        });

        // Delete handlers for extra rows
        list.querySelectorAll('.im-del-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const idx = parseInt(this.getAttribute('data-idx'));
                imSides.splice(idx, 1);
                if (typeof window._recalcBearings === 'function') window._recalcBearings();
                renderSideList();
                updateStatusBar();
                redrawPreview();
                _pushToAllLines();
            });
        });

    } else {
        // Barbed: free-form list with delete buttons
        if (imSides.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'im-empty';
            emptyDiv.textContent = 'ยังไม่มีด้านใดถูกเพิ่ม';
            list.appendChild(emptyDiv);
        }
imSides.forEach((s, i) => {
            const absB = s.bearingAbs !== undefined ? ((s.bearingAbs % 360) + 360) % 360 : 0;

            // Compute interior angle for this vertex (turn from previous side)
            let interiorAngle = 180;
            if (i > 0 && i < imSides.length) {
                const prevB = imSides[i - 1].bearingAbs;
                const diff = ((absB - prevB + 540) % 360) - 180;
                interiorAngle = 180 - Math.abs(diff);
            }
            const isSharp = interiorAngle < 60;

            const row = document.createElement('div');
            row.className = 'im-side-row';
            row.innerHTML = `
                <div class="im-side-num" style="min-width:52px;font-size:12px;color:#374151;">ด้านที่ ${i + 1} :</div>
                <input type="number" class="im-inline-len sb-number-input"
                    data-idx="${i}" value="${s.length.toFixed(1)}"
                    min="0.1" step="0.1" style="flex:1;min-width:0;">
                <span style="font-size:12px;color:#374151;margin-left:4px;">ม.</span>
                <span style="font-size:11px;color:${isSharp ? '#f97316' : '#6b7280'};margin-left:2px;">มุม:</span>
                <input type="number" class="im-angle-display-input sb-number-input" data-idx="${i}"
                    value="${absB}" min="0" max="359" step="${angleStepFor(imFenceType)}"
                    style="width:52px;flex:none;font-size:13px;text-align:center;
                           background:${isSharp ? '#fff7ed' : ''};
                           border-color:${isSharp ? '#f97316' : ''};
                           color:${isSharp ? '#ea580c' : ''};" readonly
                    title="${isSharp ? `⚠️ มุมแหลม ${interiorAngle.toFixed(0)}° < 60° — ต้องการเสาเพิ่ม` : 'ทิศทาง (°)'}">
                <span style="font-size:10px;color:${isSharp ? '#f97316' : '#9ca3af'};margin:0 1px;">°
                    ${isSharp ? `<span title="มุมแหลม < 60°" style="color:#f97316;font-weight:700;">⚠️</span>` : ''}
                </span>
                <button class="im-angle-dial-btn" data-idx="${i}" title="ตั้งมุม"
                    style="margin-left:2px;width:26px;height:26px;border-radius:50%;
                    border:1.5px solid ${isSharp ? '#f97316' : '#d1d5db'};
                    background:${isSharp ? '#fff7ed' : '#f9fafb'};
                    cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;
                    justify-content:center;" data-bearing="${absB}">⊙</button>
                <button class="im-del-btn" data-idx="${i}" title="ลบด้านนี้" style="margin-left:4px;">✕</button>
            `;
            list.appendChild(row);
        });
list.querySelectorAll('.im-del-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const idx = parseInt(this.getAttribute('data-idx'));
                imSides.splice(idx, 1);
                if (typeof window._recalcBearings === 'function') window._recalcBearings();
                renderSideList();
                updateStatusBar();
                redrawPreview();
                _pushToAllLines();
            });
        });
    }

    // Shared: live-update length on input change
    list.querySelectorAll('.im-inline-len').forEach(inp => {
        inp.addEventListener('input', function () {
            const idx = parseInt(this.getAttribute('data-idx'));
            const val = parseFloat(this.value);
            if (!isNaN(val) && val > 0) {
                if (!imSides[idx]) {
                    while (imSides.length <= idx)
                        imSides.push({ length: 10, angle: 90, bearingAbs: imSides.length * 90 });
                }
                imSides[idx].length = val;
                updateStatusBar();
                redrawPreview();
                _pushToAllLines();
            }
        });
    });

    // Angle dial button opens the unit-circle picker
    list.querySelectorAll('.im-angle-dial-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const idx = parseInt(this.getAttribute('data-idx'));
            openAngleDial(idx, this);
        });
    });
    list.querySelectorAll('.im-angle-display-input').forEach(inp => {
    inp.addEventListener('click', function (e) {
        e.stopPropagation();
        const idx = parseInt(this.getAttribute('data-idx'));
        const dialBtn = this.closest('.im-side-row').querySelector('.im-angle-dial-btn');
        openAngleDial(idx, dialBtn || this);
    });
});
}

// ============================================
    // ANGLE DIAL — unit-circle picker popup
    // ============================================
function openAngleDial(idx, anchorEl) {
    const existing = document.getElementById('imAngleDialPopup');
    if (existing) { existing.remove(); if (existing._closedFor === idx) return; }

    const prevBearing = idx === 0
        ? null
        : (imSides[idx - 1] ? ((imSides[idx - 1].bearingAbs % 360) + 360) % 360 : null);

    const currentBearing = imSides[idx]
        ? ((imSides[idx].bearingAbs % 360) + 360) % 360
        : (prevBearing !== null ? (prevBearing + 90) % 360 : 90);

    const step = angleStepFor(imFenceType);

    // For cowboy: forbidden = 181–359 (the left half, reverse side)
function isForbidden(deg) {
    if (prevBearing === null) return false;
    const d = ((deg % 360) + 360) % 360;
if (imFenceType === 'cowboy' && imFreeAngle) {
        return false; // unlocked — any angle allowed
    }
if (imFenceType === 'cowboy' || imFenceType === 'brick' || imFenceType === 'concrete') {
        const reverse = (prevBearing + 180) % 360;
        return d === reverse;
    }
    // barbed (and others): forbidden within ±15° of the reverse bearing
    const FORBID_ZONE = 15;
    const reverse = (prevBearing + 180) % 360;
    const diff = Math.abs(((d - reverse + 540) % 360) - 180);
    return diff < FORBID_ZONE;
}

    const SIZE = 260;
    const CX = SIZE / 2, CY = SIZE / 2;
    const R_RING  = 90;
    const R_DOT   = 90;
    const R_LABEL = 108;
    const R_ARROW = 76;
    const R_AXIS  = 96;

    function bXY(deg, r) {
        const rad = (deg - 90) * Math.PI / 180;
        return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
    }

    function renderDial(selectedDeg) {
        const snapped = ((Math.round(selectedDeg / step) * step) % 360 + 360) % 360;

        const axes = `
            <line x1="${CX}" y1="${CY - R_AXIS}" x2="${CX}" y2="${CY + R_AXIS}"
                stroke="#ccc" stroke-width="1"/>
            <line x1="${CX - R_AXIS}" y1="${CY}" x2="${CX + R_AXIS}" y2="${CY}"
                stroke="#ccc" stroke-width="1"/>
        `;

        // Forbidden arc shading
        let forbiddenArc = '';
        if (prevBearing !== null) {
if (imFenceType === 'cowboy' || imFenceType === 'concrete') {
    // Shade just the reverse bearing wedge (±45° since step=90)
    const reverse = (prevBearing + 180) % 360;
    const arcSpan = 45;
    const aStart = reverse - arcSpan;
    const aEnd   = reverse + arcSpan;
    function arcPt(a, r) {
        const rad = (a - 90) * Math.PI / 180;
        return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
    }
    const p1 = arcPt(aStart, R_RING);
    const p2 = arcPt(aEnd, R_RING);
    forbiddenArc = `
        <path d="M${CX},${CY} L${p1.x},${p1.y} A${R_RING},${R_RING} 0 0,1 ${p2.x},${p2.y} Z"
            fill="rgba(220,38,38,0.13)" stroke="rgba(220,38,38,0.35)" stroke-width="1"/>
    `;
} else {
                const reverse = (prevBearing + 180) % 360;
                const arcSpan = imFenceType === 'barbed' ? 15 : step * 1.5;
                const aStart = reverse - arcSpan;
                const aEnd   = reverse + arcSpan;
                function arcPt(a, r) {
                    const rad = (a - 90) * Math.PI / 180;
                    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
                }
                const p1 = arcPt(aStart, R_RING);
                const p2 = arcPt(aEnd,   R_RING);
                const large = (arcSpan * 2) > 180 ? 1 : 0;
                forbiddenArc = `
                    <path d="M${CX},${CY} L${p1.x},${p1.y} A${R_RING},${R_RING} 0 ${large},1 ${p2.x},${p2.y} Z"
                        fill="rgba(220,38,38,0.12)" stroke="rgba(220,38,38,0.35)" stroke-width="1"/>
                `;
            }
        }

        const ticks = [];
        for (let a = 0; a < 360; a += step) {
            const isMajor = a % 90 === 0;
            const r1 = R_RING - (isMajor ? 10 : 5);
            const p1t = bXY(a, r1), p2t = bXY(a, R_RING);
            ticks.push(`<line x1="${p1t.x}" y1="${p1t.y}" x2="${p2t.x}" y2="${p2t.y}"
                stroke="${isMajor ? '#555' : '#bbb'}" stroke-width="${isMajor ? 2 : 1}"/>`);
        }

        const dots = [];
        [0, 90, 180, 270].forEach(a => {
            const p = bXY(a, R_DOT);
            const isSel = (a === snapped);
            const isForbid = isForbidden(a);
            dots.push(`<circle cx="${p.x}" cy="${p.y}" r="${isSel ? 7 : 5}"
                fill="${isForbid ? '#fca5a5' : isSel ? '#111' : '#555'}"
                stroke="#fff" stroke-width="${isSel ? 2 : 1.5}"/>`);
        });

        const cardinalLabels = [
            { a: 0, label: '0°' }, { a: 90, label: '90°' },
            { a: 180, label: '180°' }, { a: 270, label: '270°' },
        ];
        const degLabels = cardinalLabels.map(({ a, label }) => {
            const p = bXY(a, R_LABEL + 8);
            const forbid = isForbidden(a);
            return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central"
                font-size="10" font-weight="700"
                fill="${forbid ? '#fca5a5' : '#c00'}" font-family="serif"
                style="pointer-events:none;">${label}</text>`;
        }).join('');

        let icLabels = '';
        if (step <= 45) {
            icLabels = [45, 135, 225, 315].map(a => {
                const p = bXY(a, R_LABEL + 6);
                const forbid = isForbidden(a);
                return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central"
                    font-size="8" font-weight="600"
                    fill="${forbid ? '#fca5a5' : '#777'}"
                    style="pointer-events:none;">${a}°</text>`;
            }).join('');
        }

        let prevIndicator = '';
        if (prevBearing !== null) {
            const pp = bXY(prevBearing, R_RING - 6);
            prevIndicator = `
                <line x1="${CX}" y1="${CY}" x2="${pp.x}" y2="${pp.y}"
                    stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>
                <circle cx="${pp.x}" cy="${pp.y}" r="3.5" fill="#94a3b8"/>
                <text x="${bXY(prevBearing, R_LABEL + 12).x}" y="${bXY(prevBearing, R_LABEL + 12).y}"
                    text-anchor="middle" dominant-baseline="central"
                    font-size="8" fill="#94a3b8" style="pointer-events:none;">เดิม</text>
            `;
        }

        const tip = bXY(snapped, R_ARROW);
        const rad = (snapped - 90) * Math.PI / 180;
        const headLen = 11, headAng = 28;
        const h1 = { x: tip.x - headLen * Math.cos(rad - headAng * Math.PI / 180), y: tip.y - headLen * Math.sin(rad - headAng * Math.PI / 180) };
        const h2 = { x: tip.x - headLen * Math.cos(rad + headAng * Math.PI / 180), y: tip.y - headLen * Math.sin(rad + headAng * Math.PI / 180) };
        const forbidSel = isForbidden(snapped);
        const arrowCol = forbidSel ? '#dc2626' : '#111';

       return `
        <svg id="imDialSvg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"
            style="display:block;cursor:crosshair;touch-action:none;background:transparent;">
            ${axes}
            ${forbiddenArc}
            <circle cx="${CX}" cy="${CY}" r="${R_RING}" fill="none" stroke="#333" stroke-width="2"/>
            ${ticks.join('')}
            ${dots.join('')}
            ${degLabels}
            ${icLabels}
            ${prevIndicator}
            <line x1="${CX}" y1="${CY}" x2="${tip.x}" y2="${tip.y}"
                stroke="${arrowCol}" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M${tip.x},${tip.y} L${h1.x},${h1.y} L${h2.x},${h2.y} Z" fill="${arrowCol}"/>
            <circle cx="${CX}" cy="${CY}" r="4" fill="#333"/>
        </svg>`;
    }

    const popup = document.createElement('div');
    popup.id = 'imAngleDialPopup';
    popup.style.cssText = `position:fixed;z-index:9999;`;
popup.innerHTML = `
        <div class="im-dial-header">ด้านที่ ${idx + 1} — เลือกทิศทาง</div>
        <div class="im-dial-svg-wrap" style="width:${SIZE}px;">
            <div id="imDialInner">${renderDial(currentBearing)}</div>
        </div>
        <div id="imDialReadout" class="im-dial-readout">
            <span class="im-dial-prev-label">
                ${prevBearing !== null ? `จากทิศ ${Math.round(prevBearing)}°` : 'ทิศสัมบูรณ์'}
            </span>
            <span class="im-dial-deg-badge">${currentBearing}°</span>
        </div>
        <div class="im-dial-forbidden-hint" id="imDialForbidHint">⚠ ทิศนี้จะทับเส้นก่อนหน้า</div>
        <div class="im-dial-actions">
            <button id="imDialConfirm" class="im-dial-btn im-dial-btn-confirm">✓ ตกลง</button>
            <button id="imDialCancel" class="im-dial-btn im-dial-btn-cancel">ยกเลิก</button>
        </div>`;

    document.body.appendChild(popup);

const rect = anchorEl.getBoundingClientRect();
    const POPUP_W = SIZE + 28;   // 292px (matches #imAngleDialPopup width)
    const POPUP_H = SIZE + 210;  // SVG + header + readout + hint + buttons + padding

    let top  = rect.bottom + 8;
    let left = rect.left - POPUP_W / 2 + rect.width / 2;

    // Clamp horizontally
    if (left < 8) left = 8;
    if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;

    // Flip above anchor if not enough room below; clamp to top of screen
    if (top + POPUP_H > window.innerHeight - 8) top = rect.top - POPUP_H - 8;
    if (top < 8) top = 8;

    popup.style.top  = top + 'px';
    popup.style.left = left + 'px';

    let activeBearing = currentBearing;

function updateFromXY(clientX, clientY) {
        const svgEl = document.getElementById('imDialSvg');
        if (!svgEl) return;
        const sr = svgEl.getBoundingClientRect();
        const mx = clientX - sr.left, my = clientY - sr.top;
        const dx = mx - CX, dy = my - CY;
        if (Math.sqrt(dx * dx + dy * dy) < 10) return;
        let deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
        deg = ((Math.round(deg / step) * step) % 360 + 360) % 360;
        activeBearing = deg;
        document.getElementById('imDialInner').innerHTML = renderDial(activeBearing);
        const forbidden = isForbidden(activeBearing);
        const badge = popup.querySelector('#imDialReadout .im-dial-deg-badge');
        if (badge) {
            badge.textContent = activeBearing + '°';
            badge.classList.toggle('im-dial-forbidden', forbidden);
        }
        const hint = popup.querySelector('#imDialForbidHint');
        if (hint) hint.classList.toggle('visible', forbidden);
        bindDragEvents();
    }

    function bindDragEvents() {
        const svgEl = document.getElementById('imDialSvg');
        if (!svgEl) return;
        svgEl.addEventListener('mousedown', onDown);
        svgEl.addEventListener('touchstart', onTouchDown, { passive: false });
        svgEl.addEventListener('click', onClick);
    }

    function onDown(e) {
        e.preventDefault();
        const move = (ev) => updateFromXY(ev.clientX, ev.clientY);
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        updateFromXY(e.clientX, e.clientY);
    }

    function onTouchDown(e) {
        e.preventDefault();
        const move = (ev) => updateFromXY(ev.touches[0].clientX, ev.touches[0].clientY);
        const up = () => { document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', up);
    }

    function onClick(e) { updateFromXY(e.clientX, e.clientY); }

    bindDragEvents();

    popup.querySelector('#imDialConfirm').addEventListener('click', function () {
        const snapped = activeBearing;
        if (isForbidden(snapped)) {
            const badge = popup.querySelector('.im-dial-deg-badge');
            if (badge) { badge.style.animation = 'imDialShake 0.4s ease'; setTimeout(() => badge.style.animation = '', 400); }
            const hint = popup.querySelector('.im-dial-forbidden-hint');
            if (hint) hint.classList.add('visible');
            return;
        }
        // Only block if this would EXTEND the shape with a new side while
        // locked — editing the angle of an existing (already-invalid) side
        // must stay allowed, since that's often how the user fixes it.
        const isNewSide = idx >= imSides.length;
        if (isNewSide && _imAddBlocked()) return;
        while (imSides.length <= idx)
            imSides.push({ length: 10, angle: 90, bearingAbs: imSides.length * 90 });
        imSides[idx].bearingAbs = snapped;
        if (idx > 0) imSides[idx].angle = ((snapped - imSides[idx - 1].bearingAbs) + 360) % 360;
        else imSides[idx].angle = snapped;
        for (let j = idx + 1; j < imSides.length; j++) {
            imSides[j].bearingAbs = ((imSides[j - 1].bearingAbs + imSides[j].angle) + 360) % 360;
        }
        popup._closedFor = idx;
        popup.remove();
        renderSideList();
        updateStatusBar();
        redrawPreview();
        _pushToAllLines();
    });

    popup.querySelector('#imDialCancel').addEventListener('click', function () {
        popup._closedFor = idx;
        popup.remove();
    });

    setTimeout(() => {
        document.addEventListener('click', function outsideClick(e) {
            if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', outsideClick); }
        });
    }, 100);
}

    // After deleting a mid-segment, re-derive all absolute bearings
    // (relative angles are stored; abs = cumulative sum)
    function _recalcBearings() {
        let abs = imSides.length > 0 ? imSides[0].bearingAbs : 0;
        // First side keeps its absolute bearing as-is (angle stored as absolute for side 0)
        for (let i = 1; i < imSides.length; i++) {
            abs = (abs + imSides[i].angle + 360) % 360;
 imSides[i].bearingAbs = abs;
        }
    }
    window._recalcBearings = _recalcBearings;

    // ============================================
    // STATUS BAR
    // ============================================
function updateStatusBar() {
    const el = document.getElementById('imStatus');
    if (!el) return;
    el.textContent = '';
    el.className = 'im-status';
}

    // ============================================
    // ADD SIDE
    // ============================================
function addSide() {
    if (_imAddBlocked()) return;

    const defaultLen = 10;

    // Freeze origin on first add
    if (imSides.length === 0) {
        const c = map.getCenter();
        imOrigin = [c.lat, c.lng];
    }

    const prevBearing = imSides.length === 0 ? -90 : imSides[imSides.length - 1].bearingAbs;
    const bearingAbs = ((prevBearing + 90 + 360) % 360);

    imSides.push({ length: defaultLen, angle: 90, bearingAbs });

    renderSideList();
    updateStatusBar();
    redrawPreview();
    _pushToAllLines();
}

// Push current shape into allLines and run fence calc (live, every change)
// Push current shape into allLines — delegates all drawing to redrawPreview()
function _pushToAllLines() {
    // Was `< 2` — that skipped runFenceCalc() entirely while only one side
    // existed, so the tier-3 (Ai - Bi·n < 0.5 m) hard-lock check never ran
    // on a lone first side (e.g. typing 0.25 m didn't get blocked).
    // A single side already yields a valid 2-point line, so validate it too.
    if (imSides.length < 1) return;
    redrawPreview();
    if (typeof runFenceCalc === 'function') runFenceCalc();
    // runFenceCalc() (fence.js) just updated window._spacingLocked based on
    // the values as they stand right now — immediately reflect that on the
    // add-side buttons so a locked state actually blocks further additions.
    _syncAddButtonLockState();
}



    // ============================================
    // FINALIZE — push the shape into allLines (measure.js)
    // and trigger fence calculation
    // ============================================
    function finalizeSides() {
        if (imSides.length < 2) return;

        const pts = buildPoints();
        const closed = isClosedShape();

        // Close the shape if it isn't already
        const finalPts = closed ? [...pts, pts[0]] : pts;

        // Push into measure.js data structures
        if (typeof allLines !== 'undefined') {
            const color = _imLineColor();
            const poly  = L.polyline(finalPts, { color, weight: 3, opacity: 0.85 }).addTo(map);

            allLines.push({
                points:    finalPts,
                polyline:  poly,
                fenceType: imFenceType,
fenceOptions: (typeof captureFenceOptions === 'function') ? captureFenceOptions(imFenceType) : {},
                color:     color,
                markers:   []
            });

// Recalculate immediately so the fence preview/result updates live
if (typeof runFenceCalc === 'function') runFenceCalc();
        }

        // Clear preview and state
        clearIM();

        // Switch back to Page 1 to show results
        if (typeof switchSbTab === 'function') switchSbTab(1);
    }

function _imLineColor() {
    const colors = {
        cowboy:   '#d97706',
        barbed:   '#4b5563',
        brick:    '#e8aa60',
        concrete: '#9ca3af',   // ← ADD
    };
    return colors[imFenceType] || '#3b82f6';
}

    // ============================================
    // CLEAR
    // ============================================
// REPLACE the entire clearIM function:

function clearIM() {
    imSides = [];
    imOrigin = null;
    ensureLayer();
    imLayerGroup.clearLayers();
    // Remove allLines entry owned by IM
    if (imLineIndex >= 0 && typeof allLines !== 'undefined') {
        const ld = allLines[imLineIndex];
        if (ld) {
            ld.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
            if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
        }
        allLines.splice(imLineIndex, 1);
        imLineIndex = -1;
    }
    renderSideList();
    updateStatusBar();
}

// Seed 4 sides of a 10×10m closed square going N→E→S→W
function _initDefaultSquare() {
    const defaultLen = 10;
    const c = map.getCenter();
    imOrigin = [c.lat, c.lng];
    // Bearings: 0° (N), 90° (E), 180° (S), 270° (W)
    const bearings = [0, 90, 180, 270];
    imSides = bearings.map((b, i) => ({
        length: defaultLen,
        angle: i === 0 ? 0 : 90,   // side 0: absolute 0°; rest: +90° turn
        bearingAbs: b
    }));
}

    // ============================================
    // FENCE TYPE SYNC — mirror Page 1 selection
    // ============================================
// Per-type saved state — persists sides & origin across fence type switches
const _imSavedState = {
    cowboy:   { sides: [], origin: null },
    barbed:   { sides: [], origin: null },
    brick:    { sides: [], origin: null },
    concrete: { sides: [], origin: null },
};

function setIMFenceType(type) {
    // 1. Save current type's state before switching
    _imSavedState[imFenceType] = {
        sides:  JSON.parse(JSON.stringify(imSides)),
        origin: imOrigin ? [...imOrigin] : null,
    };

    // 2. Clear map preview for old type
    ensureLayer();
    imLayerGroup.clearLayers();
    if (imLineIndex >= 0 && typeof allLines !== 'undefined') {
        const ld = allLines[imLineIndex];
        if (ld) {
            ld.markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
            if (ld.polyline && map.hasLayer(ld.polyline)) map.removeLayer(ld.polyline);
            if (ld.labelLayer) ld.labelLayer.clearLayers();
            if (ld.segLabelLayer) ld.segLabelLayer.clearLayers();
            allLines.splice(imLineIndex, 1);
        }
        imLineIndex = -1;
    }

    // 3. Switch type
    imFenceType = type;

    // 4. Restore saved state for new type
    const saved = _imSavedState[type];
    imSides  = saved ? JSON.parse(JSON.stringify(saved.sides)) : [];
    imOrigin = (saved && saved.origin) ? [...saved.origin] : null;

    // 5. Update fence card highlights
    document.querySelectorAll('#imFenceCards .sb-fence-card').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-type') === type);
    });

    // 6. Show/hide fence-specific option panels
    const cowDiv = document.getElementById('imCowboyOpts');
    const barDiv = document.getElementById('imBarbedOpts');
    const briDiv = document.getElementById('imBrickOpts');
    const conDiv = document.getElementById('imConcreteOpts');
    if (cowDiv) cowDiv.style.display = type === 'cowboy'   ? '' : 'none';
    if (barDiv) barDiv.style.display = type === 'barbed'   ? '' : 'none';
    if (briDiv) briDiv.style.display = type === 'brick'    ? '' : 'none';
    if (conDiv) conDiv.style.display = type === 'concrete' ? '' : 'none';

    // 7. Angle wrap + Add button: only for barbed wire
    const angWrap = document.getElementById('imAngleWrap');
    const addBtn  = document.getElementById('imAddBtn');
    if (angWrap) angWrap.style.display = type === 'barbed' ? '' : 'none';
    if (addBtn)  addBtn.style.display  = type === 'barbed' ? '' : 'none';

    // 8. Re-render UI and map with restored state
    renderSideList();
    updateStatusBar();
    if (imSides.length >= 2) {
        redrawPreview();
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }
}

    // ============================================
    // UI HELPERS
    // ============================================
    function flash(el, color) {
        const prev = el.style.background;
        el.style.background = color;
        setTimeout(() => el.style.background = prev, 500);
    }

    // ============================================
    // BUILD PAGE 2 HTML
    // ============================================
    function buildPage2() {
        const page2 = document.getElementById('sbPage2');
        if (!page2) return;

        page2.innerHTML = `
<div class="im-root">

    <!-- ── Fence type selector ── -->
    <div class="sb-fence-type-area">
        <div class="sb-section-label" style="margin-bottom:8px;">เลือกประเภทรั้ว</div>
        <div class="sb-fence-cards" id="imFenceCards">
            <div class="sb-fence-card active" data-type="cowboy">
                <div class="sfc-icon">
                    <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                        <rect x="4" y="6" width="5" height="36" rx="2" fill="#92400e"/>
                        <rect x="39" y="6" width="5" height="36" rx="2" fill="#92400e"/>
                        <rect x="4" y="14" width="40" height="5" rx="1.5" fill="#d97706"/>
                        <rect x="4" y="26" width="40" height="5" rx="1.5" fill="#d97706"/>
                    </svg>
                </div>
                <div class="sfc-label">รั้วคาวบอย</div>
            </div>
            <div class="sb-fence-card" data-type="concrete">
                <div class="sfc-icon">
                    <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                        <rect x="4" y="6" width="6" height="36" rx="2" fill="#9ca3af"/>
                        <rect x="38" y="6" width="6" height="36" rx="2" fill="#9ca3af"/>
                        <rect x="4" y="11" width="40" height="7" rx="1" fill="#d1d5db"/>
                        <rect x="4" y="22" width="40" height="7" rx="1" fill="#d1d5db"/>
                        <rect x="4" y="33" width="40" height="7" rx="1" fill="#d1d5db"/>
                    </svg>
                </div>
                <div class="sfc-label">รั้วคอนกรีต<br>สำเร็จรูป</div>
            </div>
            <div class="sb-fence-card" data-type="barbed">
                <div class="sfc-icon">
                    <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                        <rect x="4" y="6" width="4" height="36" rx="2" fill="#6b7280"/>
                        <rect x="40" y="6" width="4" height="36" rx="2" fill="#6b7280"/>
                        <rect x="15" y="6" width="3" height="36" rx="1.5" fill="#6b7280"/>
                        <rect x="26" y="6" width="3" height="36" rx="1.5" fill="#6b7280"/>
                        <rect x="4" y="8" width="40" height="3" rx="1" fill="#374151"/>
                        <rect x="4" y="37" width="40" height="3" rx="1" fill="#374151"/>
                    </svg>
                </div>
                <div class="sfc-label">รั้วลวดหนาม</div>
            </div>
            <div class="sb-fence-card" data-type="brick">
                <div class="sfc-icon">
                    <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                        <rect x="3" y="5" width="42" height="38" rx="3" fill="#e8aa60"/>
                        <rect x="4" y="6" width="19" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="25" y="6" width="20" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="4" y="17" width="11" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="17" y="17" width="14" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="33" y="17" width="12" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="4" y="28" width="19" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                        <rect x="25" y="28" width="20" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    </svg>
                </div>
                <div class="sfc-label">รั้วอิฐ</div>
            </div>
        </div>
    </div>

    <div class="sb-divider"></div>

    <!-- ── Four side inputs (independent, no wrapper label) ── -->
    <div class="im-sides-block" id="imSidesBlock">
        <!-- rendered by renderSideList() -->
    </div>

        <!-- ── Barbed-only: angle input + add button ── -->
<!-- ── Barbed-only: add segment button ── -->
    <div id="imAngleWrap" style="display:none; margin-top:8px;">
        <button id="imAddBtn" class="sb-calc-btn-sm" style="width:100%;">+ เพิ่มด้าน</button>
    </div>

    <div class="sb-divider"></div>

    <!-- ── Buttons ── -->
<div style="display:flex;gap:8px;margin-bottom:10px;">
    <button id="imClearBtn" class="sb-calc-btn-sm im-action-btn"
        title="รีเซ็ตเป็นสี่เหลี่ยมอัตโนมัติ"
        style="flex:1;background:#f3f4f6;color:#dc2626;border:1.5px solid #fca5a5;padding:8px 14px;white-space:nowrap;">
        ↺ รีเซ็ต
    </button>
    <button id="imPlanBtn" class="sb-calc-btn-sm"
        style="flex:1;background:#1f2937;color:#fff;padding:8px 14px;">
        แผน
    </button>
</div>

    <div id="imStatus" class="im-status" style="margin-bottom:8px;"></div>

    <div class="sb-divider"></div>

    <!-- ── Fence-specific options ── -->

    <!-- COWBOY opts -->
    <div id="imCowboyOpts">
        <div class="sb-section-label">เลือกเสา - คาน</div>
        <div class="sb-select-wrap" style="position:relative;">
            <select class="sb-select" id="imBeamSelect">
                <option value="2">2 ชั้น</option>
                <option value="3">3 ชั้น</option>
                <option value="4">4 ชั้น</option>
            </select>
            <div class="sb-select-icon">▼</div>
        </div>
<div class="sb-section-label" style="margin-top:10px;">ระยะห่างระหว่างเสา (เมตร)</div>
        <select class="sb-number-input" id="imSpacingSelect"
            style="width:100%;padding:6px 8px;font-size:12px;"
            onchange="imSetSpacing(this.value)">
            <option value="2.0">2.0 ม.</option>
            <option value="2.5" selected>2.5 ม.</option>
            <option value="custom">กำหนดเอง…</option>
        </select>
<input type="number" class="sb-number-input" id="imPostSpacing"
    value="2.5" min="1" max="3" step="0.1"
    style="width:100%;margin-top:6px;display:none;" placeholder="ระบุ (ม.)"
    oninput="if(typeof showSpacingHint==='function') showSpacingHint('imPostSpacingHint', parseFloat(this.value))">
<div id="imPostSpacingHint" class="spacing-hint" style="display:none;"></div>
<div style="margin-top:12px;">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;">
        <input type="checkbox" id="imFreeAngleToggle"
            style="width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;"
            onchange="imOnFreeAngleToggle()">
        <span style="font-size:12px;color:#374151;">ปลดล็อมุม</span>
    </label>
    <div class="sb-section-label">โหมดเสามุม</div>
    <div id="imCornerModeWrap" style="display:flex;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;flex-direction:column;gap:6px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="radio" name="imCornerMode" id="imCornerModeDouble" value="double" checked
                style="width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;"
                onchange="imOnCornerModeChange()">
            <span style="font-size:12px;color:#374151;">เสามุมคู่</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="radio" name="imCornerMode" id="imCornerModeSingle" value="single"
                style="width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;"
                onchange="imOnCornerModeChange()">
            <span style="font-size:12px;color:#374151;">แต่งร่องเสา </span>
        </label>
    </div>
    <!-- Legacy hidden checkbox kept for fence.js compatibility -->
    <input type="checkbox" id="imDoubleCornerPost" style="display:none;" checked>
    <input type="hidden" id="globalCornerMode" value="double">
</div>

        <div class="sb-section-label" style="margin-top:10px;">ราคาโดยประมาณ (บาท/เมตร)</div>
        <div style="display:flex;align-items:center;gap:6px;">
            <input type="number" class="sb-number-input-sm" id="imCowboyPricePerM" value="850"
                min="0" step="10" style="flex:1;" placeholder="บาท/เมตร">
            <button type="button" class="price-reset-btn" onclick="resetFencePrice('cowboy')"
                title="รีเซ็ตราคาเริ่มต้น">↺</button>
        </div>
    </div>

    <!-- BARBED opts -->
<div id="imBarbedOpts" style="display:none;">
        <div class="sb-section-label">ระยะห่างระหว่างเสา (เมตร)</div>
        <select class="sb-number-input" id="imSpacingSelectBarbed"
            style="width:100%;padding:6px 8px;font-size:12px;"
            onchange="imSetSpacingBarbed(this.value)">
            <option value="2.0">2.0 ม.</option>
            <option value="2.5" selected>2.5 ม.</option>
            <option value="3.0">3.0 ม.</option>
            <option value="custom">กำหนดเอง…</option>
        </select>
<input type="number" class="sb-number-input" id="imPostSpacingBarbed"
    value="2.5" min="1" max="3" step="0.1"
    style="width:100%;margin-top:6px;display:none;" placeholder="ระบุ (ม.)"
    oninput="if(typeof showSpacingHint==='function') showSpacingHint('imPostSpacingBarbedHint', parseFloat(this.value))">
<div id="imPostSpacingBarbedHint" class="spacing-hint" style="display:none;"></div>
        <div class="sb-section-label" style="margin-top:10px;">ตัวเลือก N-Brace</div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
            <input type="checkbox" id="imNBraceSolo" style="width:16px;height:16px;accent-color:#dc2626;">
            <span style="font-size:12px;color:#374151;">N-Brace เดี่ยว (เสาค้ำหัว-ท้าย)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
            <input type="checkbox" id="imNBraceDual" style="width:16px;height:16px;accent-color:#1d4ed8;">
            <span style="font-size:12px;color:#374151;">N-Brace คู่ (ทุก 50 ม.)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="imNBraceAngle" style="width:16px;height:16px;accent-color:#7c3aed;">
            <span style="font-size:12px;color:#374151;">N-Brace มุม (เสาคู่ที่มุม)</span>
        </label>

        <div class="sb-section-label" style="margin-top:10px;">ราคาโดยประมาณ (บาท/เมตร)</div>
        <div style="display:flex;align-items:center;gap:6px;">
            <input type="number" class="sb-number-input-sm" id="imBarbedPricePerM" value="850"
                min="0" step="10" style="flex:1;" placeholder="บาท/เมตร">
            <button type="button" class="price-reset-btn" onclick="resetFencePrice('barbed')"
                title="รีเซ็ตราคาเริ่มต้น">↺</button>
        </div>
    </div>

<!-- BRICK opts -->
<!-- CONCRETE opts -->
<div id="imConcreteOpts" style="display:none;">
    <div class="sb-section-label">ระยะห่างระหว่างแผ่น (เมตร)</div>
    <select class="sb-number-input" id="imSpacingSelectConcrete"
        style="width:100%;padding:6px 8px;font-size:12px;"
        onchange="imSetSpacingConcrete(this.value)">
        <option value="2.0">2.0 ม.</option>
        <option value="2.5" selected>2.5 ม.</option>
        <option value="3.0">3.0 ม.</option>
        <option value="custom">กำหนดเอง…</option>
    </select>
<input type="number" class="sb-number-input" id="imPostSpacingConcrete"
    value="2.5" min="1" max="5" step="0.1"
    style="width:100%;margin-top:6px;display:none;" placeholder="ระบุ (ม.)"
    oninput="if(typeof showSpacingHint==='function') showSpacingHint('imPostSpacingConcreteHint', parseFloat(this.value))">
<div id="imPostSpacingConcreteHint" class="spacing-hint" style="display:none;"></div>
    <div class="sb-section-label" style="margin-top:10px;">จำนวนชั้นแผ่น</div>
    <select class="sb-number-input" id="imConcreteLayerSelect"
        style="width:100%;padding:6px 8px;font-size:12px;">
        <option value="3">3 ชั้น</option>
        <option value="4" selected>4 ชั้น</option>
        <option value="5">5 ชั้น</option>
        <option value="6">6 ชั้น</option>
    </select>
<div style="margin-top:12px;">
    <div class="sb-section-label">โหมดเสามุม</div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="radio" name="imConcreteCornerMode" id="imConcreteCornerModeDouble" value="double" checked
                style="width:15px;height:15px;accent-color:#6b7280;cursor:pointer;"
                onchange="imOnCornerModeChange()">
            <span style="font-size:12px;color:#374151;">2️⃣ เสาคู่ที่มุม (แนะนำ)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="radio" name="imConcreteCornerMode" id="imConcreteCornerModeSingle" value="single"
                style="width:15px;height:15px;accent-color:#6b7280;cursor:pointer;"
                onchange="imOnCornerModeChange()">
            <span style="font-size:12px;color:#374151;">1️⃣ เสาเดียวที่มุม (เฉพาะ θ ≥ 120°)</span>
        </label>
    </div>
    <input type="checkbox" id="imConcreteDoubleCorner" style="display:none;" checked>
</div>

    <div class="sb-section-label" style="margin-top:10px;">ราคาโดยประมาณ (บาท/เมตร)</div>
    <div style="display:flex;align-items:center;gap:6px;">
        <input type="number" class="sb-number-input-sm" id="imConcretePricePerM" value="850"
            min="0" step="10" style="flex:1;" placeholder="บาท/เมตร">
        <button type="button" class="price-reset-btn" onclick="resetFencePrice('concrete')"
            title="รีเซ็ตราคาเริ่มต้น">↺</button>
    </div>
</div>
<div id="imBrickOpts" style="display:none;">

    <!-- Fence Height -->
    <div class="sb-section-label" style="margin-top:10px;">ความสูงรั้ว</div>
    <select class="sb-number-input" id="imBrickHeightSelect"
        style="width:100%;padding:6px 8px;font-size:12px;"
        onchange="imSetBrickHeight(this.value)">
        <option value="1.5">1.5 ม.</option>
        <option value="1.8" selected>1.8 ม.</option>
        <option value="2.0">2.0 ม.</option>
        <option value="2.5">2.5 ม.</option>
        <option value="custom">กำหนดเอง…</option>
    </select>
    <input type="number" class="sb-number-input" id="imBrickFenceHeight"
        value="1.8" min="0.5" max="5" step="0.1"
        style="width:100%;margin-top:6px;display:none;" placeholder="ระบุความสูง (ม.)"
        oninput="imSyncBeamCheckboxesToHeight(parseFloat(this.value)||1.8); if(typeof runFenceCalc==='function') runFenceCalc();">

    <!-- Pillar Spacing -->
    <div class="sb-section-label" style="margin-top:10px;">ระยะห่างเสา CENTER-TO-CENTER (D)</div>
    <select class="sb-number-input" id="imSpacingSelectBrick"
        style="width:100%;padding:6px 8px;font-size:12px;"
        onchange="imSetSpacingBrick(this.value)">
        <option value="2.0">2.0 ม.</option>
        <option value="2.5" selected>2.5 ม.</option>
        <option value="3.0">3.0 ม.</option>
        <option value="custom">กำหนดเอง…</option>
    </select>
<input type="number" class="sb-number-input" id="imPostSpacingBrick"
    value="2.5" min="1" max="5" step="0.1"
    style="width:100%;margin-top:6px;display:none;" placeholder="ระบุ (ม.)"
    oninput="if(typeof showSpacingHint==='function') showSpacingHint('imPostSpacingBrickHint', parseFloat(this.value))">
<div id="imPostSpacingBrickHint" class="spacing-hint" style="display:none;"></div>

    <!-- Pillar Size -->
    <div class="sb-section-label" style="margin-top:10px;">ขนาดเสา</div>
    <select class="sb-number-input" id="imBrickPillarSize"
        style="width:100%;padding:6px 8px;font-size:12px;"
        onchange="imOnPillarSizeChange(this.value)">
        <option value="10x10">10×10 ซม. (default)</option>
        <option value="15x15">15×15 ซม.</option>
        <option value="custom">กำหนดเอง…</option>
    </select>
    <input type="number" class="sb-number-input" id="imBrickPillarCustom"
        value="" min="5" max="50" step="1"
        style="width:100%;margin-top:6px;display:none;" placeholder="ขนาดเสา (ซม.) เช่น 20 = 20×20">
    <div id="imBrickPillarCustomLabel" style="display:none;font-size:10px;color:#9ca3af;margin-top:3px;">
        กรอก ซม. เช่น 20 = 20×20 ซม.
    </div>

    <!-- Brick Type -->
    <div class="sb-section-label" style="margin-top:10px;">ประเภทอิฐ</div>
    <input type="hidden" id="imBrickType" value="mong2">
    <button type="button" class="brick-picker-trigger" id="brickPickerTrigger" onclick="openBrickPicker()">
        <div class="bpt-left">
            <div class="bpt-swatch" id="bptSwatch">
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                    <rect x="3" y="5" width="42" height="38" rx="3" fill="#e8aa60"/>
                    <rect x="4" y="6" width="19" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="25" y="6" width="20" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="4" y="17" width="11" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="17" y="17" width="14" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="33" y="17" width="12" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="4" y="28" width="19" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                    <rect x="25" y="28" width="20" height="9" rx="1.5" fill="#d97706" opacity="0.78"/>
                </svg>
            </div>
            <div class="bpt-info">
                <div class="bpt-name" id="bptName">อิฐมอญ 2 ช่อง</div>
                <div class="bpt-meta" id="bptMeta">3×6×15 ซม.<br><span style="color:#6b7280;">฿1.05/ก้อน · 135 ก้อน/ม²</span></div>
            </div>
        </div>
        <span class="bpt-chevron" id="bptChevron">▼</span>
    </button>

    <!-- Price override row -->
    <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
        <span style="font-size:11px;color:#6b7280;white-space:nowrap;">ราคา/ก้อน (฿)</span>
        <input type="number" class="sb-number-input-sm" id="imBrickPrice"
            value="1.05" min="0" step="0.05" style="flex:1;">
        <span style="font-size:11px;color:#6b7280;white-space:nowrap;">ก้อน/ม²</span>
        <input type="number" class="sb-number-input-sm" id="imBrickPpm2"
            value="135" min="1" step="0.1" style="flex:1;">
        <button type="button" class="price-reset-btn" onclick="resetFencePrice('brick')"
            title="รีเซ็ตราคาเริ่มต้นตามชนิดอิฐ">↺</button>
    </div>

    <!-- คานทับหลัง (N) — checkbox style matching draw mode -->
    <div class="sb-section-label" style="margin-top:10px;">คานทับหลัง (N)</div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="imBeamCbTop"
                style="width:15px;height:15px;accent-color:#ea580c;cursor:pointer;"
                onchange="imOnBeamCbChange()">
            <span style="font-size:12px;font-weight:600;color:#ea580c;">● คานบน (Top beam)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="imBeamCbCenter"
                style="width:15px;height:15px;accent-color:#d97706;cursor:pointer;"
                onchange="imOnBeamCbChange()">
            <span style="font-size:12px;font-weight:600;color:#d97706;">● คานกลาง (Center beam)</span>
        </label>
    </div>
    <div id="imBeamAutoLabel" style="font-size:10px;color:#9ca3af;margin-top:4px;"></div>
    <!-- Hidden input that fence.js reads -->
    <input type="hidden" id="imBrickBeamMode" value="auto">

</div>

<div class="sb-divider" style="margin-top:12px;"></div>

    <!-- ── Calculate button ── -->
    <button class="sb-calc-btn-sm" id="imCalcBtn" onclick="imDoCalc()" style="width:100%;margin-bottom:8px;">คำนวณวัสดุ</button>

    <div class="fw-box" id="imFenceWarnings" style="display:none"></div>

    <div class="sb-result-stack" id="imSbResults">
        <div class="sbr-row-item">
            <div class="sbr-label">ความยาวทั้งหมด</div>
            <div class="sbr-field-row">
                <input type="text" class="sbr-input" id="imResTotal" readonly placeholder="—">
                <span class="sbr-unit">เมตร</span>
            </div>
        </div>
        <div class="sbr-row-item">
            <div class="sbr-label">จำนวนเสาที่ต้องใช้</div>
            <div class="sbr-field-row">
                <input type="text" class="sbr-input" id="imResPosts" readonly placeholder="—">
                <span class="sbr-unit">ต้น</span>
            </div>
        </div>
        <div class="sbr-row-item" id="imResBeamsRow">
            <div class="sbr-label">จำนวนคานที่ต้องใช้</div>
            <div class="sbr-field-row">
                <input type="text" class="sbr-input" id="imResBeams" readonly placeholder="—">
                <span class="sbr-unit">อัน</span>
            </div>
        </div>
        <div class="sbr-row-item">
            <div class="sbr-label">ราคาโดยประมาณ</div>
            <div class="sbr-field-row">
                <input type="text" class="sbr-input" id="imResPriceDisplay" readonly placeholder="—">
                <span class="sbr-unit">บาท</span>
            </div>
        </div>
    </div>

</div><!-- /.im-root -->

<style>
/* ── Spacing inline hints (shared with draw mode) ──────────────────────── */
.spacing-hint {
    font-size: 11px;
    border-radius: 6px;
    padding: 6px 8px;
    margin-top: 4px;
    font-weight: 600;
    line-height: 1.4;
    display: none;
}
.spacing-hint-error {
    background: #fee2e2;
    color: #dc2626;
    border: 1px solid #fca5a5;
}
.spacing-hint-warn {
    background: #fef9c3;
    color: #92400e;
    border: 1px solid #fde047;
}
.fw-hard {
    background: #fee2e2;
    color: #991b1b;
    border-left: 3px solid #dc2626;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 600;
}
.fw-soft {
    background: #fef9c3;
    color: #78350f;
    border-left: 3px solid #f59e0b;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.fw-override-btn {
    margin-left: auto;
    background: #f59e0b;
    color: #1f2937;
    border: none;
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}
.fw-override-btn:hover { background: #d97706; }

/* ── Input Mode Styles ───────────────────────────── */
.im-root { padding: 0 2px 24px; }

.im-input-area { padding: 0 2px; }

.im-angle-hint {
    font-size: 11px;
    color: #b45309;
    background: #fef9c3;
    border-radius: 6px;
    padding: 5px 8px;
    margin-bottom: 8px;
    display: none;
    font-weight: 600;
}
.im-angle-hint:not(:empty) { display: block; }

.im-field-group { display: flex; flex-direction: column; gap: 4px; }
.im-field-label { font-size: 12px; font-weight: 600; color: #374151; }
.im-field-sub   { font-size: 10px; font-weight: 400; color: #9ca3af; margin-left: 4px; }

.im-turn-pills {
    display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;
}
.im-turn-pill {
    flex: 1;
    min-width: 52px;
    padding: 5px 4px;
    font-size: 11px;
    font-weight: 600;
    background: #f3f4f6;
    border: 1.5px solid #d1d5db;
    border-radius: 6px;
    cursor: pointer;
    color: #374151;
    transition: background 0.15s;
}
.im-turn-pill:hover { background: #e5e7eb; }
.im-turn-pill.im-turn-active { background: #fef3c7; border-color: #f59e0b; color: #92400e; }

/* Side list */
.im-side-list {
    max-height: 180px;
    overflow-y: auto;
    overflow-x: hidden;
    border: 1.5px solid #e5e7eb;
    border-radius: 8px;
    background: #f9fafb;
    scrollbar-width: thin;
    scrollbar-color: #d1d5db transparent;
}
.im-side-list::-webkit-scrollbar { width: 4px; }
.im-side-list::-webkit-scrollbar-track { background: transparent; border-radius: 99px; margin: 4px 0; }
.im-side-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 99px; }
.im-side-list::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.im-side-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid #f3f4f6;
    font-size: 12px;
}
.im-side-row:last-child { border-bottom: none; }
.im-side-num  { font-weight: 700; color: #6b7280; min-width: 36px; }
.im-side-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.im-side-len  { font-weight: 600; color: #1f2937; }
.im-side-ang  { font-size: 10px; color: #6b7280; }
.im-del-btn {
    background: none; border: none; color: #9ca3af; cursor: pointer;
    font-size: 13px; padding: 2px 4px; border-radius: 4px; line-height: 1;
}
.im-del-btn:hover { background: #fee2e2; color: #dc2626; }
.im-empty { padding: 12px; text-align: center; color: #9ca3af; font-size: 12px; }

/* Status */
.im-status    { font-size: 12px; color: #6b7280; padding: 2px 0; }
.im-status-ok { color: #16a34a; font-weight: 600; }

/* Action buttons */
.im-action-btn {
    padding: 10px 12px;
    border: none; border-radius: 8px;
    font-size: 13px; font-weight: 600;
    cursor: pointer; transition: opacity 0.15s;
}
.im-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.im-btn-primary { background: #f59e0b; color: #1f2937; }
.im-btn-primary:hover:not(:disabled) { background: #d97706; }
.im-btn-danger  { background: #f3f4f6; color: #dc2626; border: 1.5px solid #fca5a5; }
.im-btn-danger:hover { background: #fee2e2; }
.im-btn-flash   { animation: imFlash 0.4s ease; }
@keyframes imFlash {
    0%   { background: #d1fae5; }
    100% { background: #f59e0b; }
}
</style>
        `;

        // ── Wire up fence-card clicks ──
// ── Wire up fence-card clicks ──
        page2.querySelectorAll('.sb-fence-card:not(.sfc-disabled)').forEach(card => {
            card.addEventListener('click', function () {
                setIMFenceType(this.getAttribute('data-type'));
            });
        });


        // ── Add button (barbed only) ──
        const addBtnEl = document.getElementById('imAddBtn');
        if (addBtnEl) addBtnEl.addEventListener('click', addSide);





        // ── "รูปทรงปิดอัตโนมัติ" button — resets to default square ──
        document.getElementById('imClearBtn').addEventListener('click', clearIM);

                // ── Plan mode button (Input Mode) ──
        const imPlanBtn = document.getElementById('imPlanBtn');
        if (imPlanBtn) {
            imPlanBtn.addEventListener('click', function () {
                if (typeof _pushToAllLines === 'function') _pushToAllLines();
                // Small delay ensures allLines is fully populated before togglePlanMode runs
                setTimeout(() => {
                    if (typeof togglePlanMode === 'function') togglePlanMode();
                }, 50);
            });
        }

        // ── Beam select sync ──
        const imBeamEl = document.getElementById('imBeamSelect');
        if (imBeamEl) imBeamEl.addEventListener('change', function () {
            const p1 = document.getElementById('beamSelect');
            if (p1) p1.value = this.value;
        });

        // Init
        setIMFenceType('cowboy');
        renderSideList();
        updateStatusBar();
    }

    // ============================================
    // SPACING PILL HELPERS (called from inline onclick)
    // ============================================
    // ── Input-mode spacing select helpers ──────────────────────────────────
    // Mirrors _applySpacingSelect from index.html but scoped to IM element IDs.
    function _imApplySpacingSelect(selectVal, inputId, hintId, defaultVal) {
        const input = document.getElementById(inputId);
        const hint  = document.getElementById(hintId);
        if (!input) return;
        if (selectVal === 'custom') {
            input.style.display = '';
            input.focus();
            if (typeof showSpacingHint === 'function') showSpacingHint(hintId, parseFloat(input.value));
        } else {
            input.value = parseFloat(selectVal) || defaultVal;
            input.style.display = 'none';
            if (hint) { hint.style.display = 'none'; hint.className = 'spacing-hint'; }
            window._spacingOverride = false;
            if (typeof runFenceCalc === 'function') runFenceCalc();
        }
    }

    window.imSetSpacing = function (val) {
        _imApplySpacingSelect(val, 'imPostSpacing', 'imPostSpacingHint', 2.5);
    };

    window.imSetSpacingBarbed = function (val) {
        _imApplySpacingSelect(val, 'imPostSpacingBarbed', 'imPostSpacingBarbedHint', 2.5);
    };

    window.imSetSpacingBrick = function (val) {
        _imApplySpacingSelect(val, 'imPostSpacingBrick', 'imPostSpacingBrickHint', 2.5);
    };

    window.imSetSpacingConcrete = function (val) {
        _imApplySpacingSelect(val, 'imPostSpacingConcrete', 'imPostSpacingConcreteHint', 2.5);
    };

window.imSetBrickHeight = function (val) {
    const input = document.getElementById('imBrickFenceHeight');
    if (val === 'custom') {
        if (input) { input.style.display = ''; input.focus(); }
    } else {
        const h = parseFloat(val);
        if (input) { input.value = h; input.style.display = 'none'; }
        imSyncBeamCheckboxesToHeight(h);
        imSyncPillarSizeOptions(h);
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }
};

window.imDoCalc = function () {
    _pushToAllLines();
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

window.imOnBeamCbChange = function () {
    const cbTop    = document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('imBeamCbCenter');
    const hidden   = document.getElementById('imBrickBeamMode');
    const label    = document.getElementById('imBeamAutoLabel');
    const top    = cbTop    ? cbTop.checked    : false;
    const center = cbCenter ? cbCenter.checked : false;
    let mode = 'none';
    if (top && center) mode = 'center+top';
    else if (top)      mode = 'top';
    else if (center)   mode = 'center';
    if (hidden) hidden.value = mode;
    if (label)  label.textContent = '';
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

window.imSyncBeamCheckboxesToHeight = function (h) {
    const cbTop    = document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('imBeamCbCenter');
    const hidden   = document.getElementById('imBrickBeamMode');
    const label    = document.getElementById('imBeamAutoLabel');
    let mode, hint;
    if      (h <= 1.2) { mode = 'none';       hint = 'อัตโนมัติ: ไม่มีคาน'; }
    else if (h <  1.8) { mode = 'top';        hint = 'อัตโนมัติ: 1 คาน (บน)'; }
    else if (h <  2.2) { mode = 'center';     hint = 'อัตโนมัติ: 1 คาน (กลาง)'; }
    else               { mode = 'center+top'; hint = 'อัตโนมัติ: 2 คาน (กลาง+บน)'; }
    if (cbTop)    cbTop.checked    = (mode === 'top'    || mode === 'center+top');
    if (cbCenter) cbCenter.checked = (mode === 'center' || mode === 'center+top');
    if (hidden)   hidden.value     = mode;
    if (label)    label.textContent = hint;
};

window.imSyncPillarSizeOptions = function (h) {
    const sel = document.getElementById('imBrickPillarSize');
    if (!sel) return;
    imOnPillarSizeChange(sel.value);
};

window.imOnPillarSizeChange = function (val) {
    const customInput = document.getElementById('imBrickPillarCustom');
    const customLabel = document.getElementById('imBrickPillarCustomLabel');
    if (val === 'custom') {
        if (customInput) { customInput.style.display = ''; customInput.focus(); }
        if (customLabel) customLabel.style.display = '';
    } else {
        if (customInput) customInput.style.display = 'none';
        if (customLabel) customLabel.style.display = 'none';
    }
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

    // Also update beam hint when the custom height input is typed
document.addEventListener('DOMContentLoaded', function() {
    const customH = document.getElementById('imBrickFenceHeight');
    if (customH) customH.addEventListener('input', function() {
        const h = parseFloat(this.value);
        if (isNaN(h)) return;
        imSyncBeamCheckboxesToHeight(h);
        if (typeof runFenceCalc === 'function') runFenceCalc();
    });
    // Init checkboxes to match default height (1.8m)
    imSyncBeamCheckboxesToHeight(1.8);
});

window.BRICK_CATALOGUE = [
    {
        group: 'อิฐมอญ',
        bricks: [
            { value: 'mong2',    name: 'อิฐมอญ 2 ช่อง',      size: '3×6×15 ซม.',     price: 1.05,  ppm2: 135,  bg: '#e8aa60', fg: '#d97706' },
            { value: 'mong3',    name: 'อิฐมอญ 3 ช่อง',      size: '6×10×20 ซม.',    price: 2.50,  ppm2: 42,   bg: '#e8aa60', fg: '#d97706' },
            { value: 'mong4',    name: 'อิฐมอญ 4 ช่อง',      size: '5×16×15 ซม.',    price: 1.20,  ppm2: 95,   bg: '#e8aa60', fg: '#d97706' },
            { value: 'monghand', name: 'อิฐมอญตันทำมือ',     size: '3×6×14 ซม.',     price: 1.20,  ppm2: 145,  bg: '#e8aa60', fg: '#d97706' },
            { value: 'mongstd',  name: 'อิฐมอญ มอก.77-2565', size: '4×6.5×14 ซม.',   price: 1.50,  ppm2: 125,  bg: '#e8aa60', fg: '#d97706' },
        ]
    },
    {
        group: 'อิฐมวลเบา (AAC)',
        bricks: [
            { value: 'aac75',  name: 'อิฐมวลเบา 7.5 ซม.', size: '20×60×7.5 ซม.', price: 23,   ppm2: 8.3, bg: '#d1fae5', fg: '#059669' },
            { value: 'aac100', name: 'อิฐมวลเบา 10 ซม.',  size: '20×60×10 ซม.',  price: 31,   ppm2: 8.3, bg: '#d1fae5', fg: '#059669' },
        ]
    },
    {
        group: 'อิฐบล็อก (มอก.)',
        bricks: [
            { value: 'block7',  name: 'อิฐบล็อก มอก. 7 ซม.',  size: 'มาตรฐาน มอก.', price: 9.50,  ppm2: 12.5, bg: '#eff6ff', fg: '#2563eb' },
            { value: 'block9',  name: 'อิฐบล็อก มอก. 9 ซม.',  size: 'มาตรฐาน มอก.', price: 12,    ppm2: 12.5, bg: '#eff6ff', fg: '#2563eb' },
            { value: 'block14', name: 'อิฐบล็อก มอก. 14 ซม.', size: 'มาตรฐาน มอก.', price: 20.50, ppm2: 12.5, bg: '#eff6ff', fg: '#2563eb' },
        ]
    }
];
 
// Get brick data by value
function _getBrick(value) {
    for (const g of BRICK_CATALOGUE) {
        const b = g.bricks.find(b => b.value === value);
        if (b) return b;
    }
    return BRICK_CATALOGUE[0].bricks[0];
}
 
// Brick SVG swatch (mini brick pattern, tinted to brick colour)
function _brickSwatchSVG(bg, fg) {
    return `<svg width="24" height="24" viewBox="0 0 48 48" fill="none">
        <rect x="2" y="4" width="44" height="40" rx="4" fill="${bg}"/>
        <rect x="3" y="6" width="20" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="25" y="6" width="20" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="3" y="19" width="11" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="17" y="19" width="14" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="34" y="19" width="11" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="3" y="32" width="20" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
        <rect x="25" y="32" width="20" height="10" rx="1.5" fill="${fg}" opacity="0.75"/>
    </svg>`;
}
 
// ── Unified brick picker — works for both Page 1 (p1) and Page 2 (p2) ──
// page = 'p1'  → hidden input: #brickType,   trigger: #p1BrickPickerTrigger,
//                name: #p1BptName, meta: #p1BptMeta, swatch: #p1BptSwatch,
//                price: #brickPricePerPiece, ppm2: #brickPpm2
// page = 'p2'  → hidden input: #imBrickType, trigger: #brickPickerTrigger,
//                name: #bptName,   meta: #bptMeta,   swatch: #bptSwatch,
//                price: #imBrickPrice,       ppm2: #imBrickPpm2

const _BP_CFG = {
    p1: { hidden: 'brickType',   trigger: 'p1BrickPickerTrigger', name: 'p1BptName', meta: 'p1BptMeta', swatch: 'p1BptSwatch', price: 'brickPricePerPiece', ppm2: 'brickPpm2' },
    p2: { hidden: 'imBrickType', trigger: 'brickPickerTrigger',   name: 'bptName',   meta: 'bptMeta',   swatch: 'bptSwatch',   price: 'imBrickPrice',       ppm2: 'imBrickPpm2' }
};

window.openBrickPickerFor = function (page) {
    closeBrickPicker();

    const cfg = _BP_CFG[page] || _BP_CFG.p2;
    const trigger     = document.getElementById(cfg.trigger);
    const currentValue = document.getElementById(cfg.hidden)?.value || 'mong2';

    // Store which page opened this popup (for selectBrick)
    window._brickPickerPage = page;

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'brick-picker-backdrop';
    backdrop.id = 'brickPickerBackdrop';
    backdrop.addEventListener('click', closeBrickPicker);
    document.body.appendChild(backdrop);

    // Popup
    const popup = document.createElement('div');
    popup.className = 'brick-picker-popup';
    popup.id = 'brickPickerPopup';

    let bodyHTML = '';
    for (const group of BRICK_CATALOGUE) {
        bodyHTML += `<div class="bpp-group-label">${group.group}</div>`;
        for (const b of group.bricks) {
            const sel = b.value === currentValue ? ' selected' : '';
            bodyHTML += `
            <div class="bpp-card${sel}" data-value="${b.value}" onclick="selectBrick('${b.value}')">
                <div class="bpp-card-swatch" style="background:${b.bg};">
                    ${_brickSwatchSVG(b.bg, b.fg)}
                </div>
<div class="bpp-card-body">
                    <div class="bpp-card-name">${b.name}</div>
                    <div class="bpp-card-size">${b.size}</div>
                    <div class="bpp-card-size" style="margin-top:2px;">฿${b.price}/ก้อน &nbsp;·&nbsp; ${b.ppm2} ก้อน/ม²</div>
                </div>
                <div class="bpp-card-check">✓</div>
            </div>`;
        }
    }

    popup.innerHTML = `
        <div class="bpp-header">
            <div class="bpp-title">ประเภทอิฐ <span>${BRICK_CATALOGUE.reduce((a,g)=>a+g.bricks.length,0)} ชนิด</span></div>
            <button class="bpp-close" onclick="closeBrickPicker()" title="ปิด">✕</button>
        </div>
        <div class="bpp-body">${bodyHTML}</div>`;

    document.body.appendChild(popup);

    // Position near trigger
    if (trigger) {
        const r = trigger.getBoundingClientRect();
        const PW = 340, PH = Math.min(window.innerHeight * 0.72, 520);
        let top  = r.bottom + 6;
        let left = r.left;
        if (left + PW > window.innerWidth - 8) left = window.innerWidth - PW - 8;
        if (left < 8) left = 8;
        if (top + PH > window.innerHeight - 8) top = r.top - PH - 6;
        if (top < 8) top = 8;
        popup.style.top  = top  + 'px';
        popup.style.left = left + 'px';
        trigger.classList.add('open');
    } else {
        popup.style.top  = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%,-50%)';
    }

    requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        popup.classList.add('visible');
    });

    setTimeout(() => {
        const selCard = popup.querySelector('.bpp-card.selected');
        if (selCard) selCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 180);
};

// Keep the old name working (called from Page 2 trigger button)
window.openBrickPicker = function () { window.openBrickPickerFor('p2'); };

// Close popup
window.closeBrickPicker = function () {
    const backdrop = document.getElementById('brickPickerBackdrop');
    const popup    = document.getElementById('brickPickerPopup');
    // Remove open class from both possible triggers
    ['brickPickerTrigger','p1BrickPickerTrigger'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
    });
    if (popup)    { popup.classList.remove('visible');    setTimeout(() => popup.remove(), 260); }
    if (backdrop) { backdrop.classList.remove('visible'); setTimeout(() => backdrop.remove(), 260); }
};

// Select a brick card — updates the correct page's fields
window.selectBrick = function (value) {
    const page   = window._brickPickerPage || 'p2';
    const cfg    = _BP_CFG[page] || _BP_CFG.p2;
    const brick  = _getBrick(value);

    // Update hidden input
    const hiddenEl = document.getElementById(cfg.hidden);
    if (hiddenEl) hiddenEl.value = value;

    // Update trigger display
    const nameEl   = document.getElementById(cfg.name);
    const metaEl   = document.getElementById(cfg.meta);
    const swatchEl = document.getElementById(cfg.swatch);
if (nameEl)   nameEl.textContent   = brick.name;
if (metaEl)   metaEl.innerHTML     = brick.size + '<br><span style="color:#6b7280;">฿' + brick.price + '/ก้อน · ' + brick.ppm2 + ' ก้อน/ม²</span>';
    if (swatchEl) swatchEl.innerHTML   = _brickSwatchSVG(brick.bg, brick.fg);

    // Sync price/ppm2 inputs
    const priceEl = document.getElementById(cfg.price);
    const ppm2El  = document.getElementById(cfg.ppm2);
    if (priceEl) priceEl.value = brick.price;
    if (ppm2El)  ppm2El.value  = brick.ppm2;

    setTimeout(closeBrickPicker, 140);
};

// Keep old name working
window.imUpdateBrickDefaults = function () {
    const val   = document.getElementById('imBrickType')?.value || 'mong2';
    const brick = _getBrick(val);
    const p = document.getElementById('imBrickPrice');
    const m = document.getElementById('imBrickPpm2');
    if (p) p.value = brick.price;
    if (m) m.value = brick.ppm2;
};


    // ============================================
    // SYNC: when Page 1 fence type changes, mirror to Page 2
    // ============================================
    // Intercept the existing sb-fence-card click handler to also update IM
    document.addEventListener('click', function (e) {
        const card = e.target.closest('#sbPage1 .sb-fence-card:not(.sfc-disabled)');
        if (card && imActive) {
            setIMFenceType(card.getAttribute('data-type'));
        }
    });

    // ============================================
    // HOOK INTO TAB SWITCH — activate/deactivate
    // ============================================
    const origSwitchSbTab = window.switchSbTab;
    window.switchSbTab = function (n) {
        imActive = (n === 2);
        if (origSwitchSbTab) origSwitchSbTab(n);
        if (n === 2) {
            ensureLayer();
            redrawPreview();
        }
    };

    // ============================================
    // BOOT — build the page on DOMContentLoaded
    // ============================================
    function boot() {
        buildPage2();
        ensureLayer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        // DOM already ready — but Leaflet map may not be. Poll briefly.
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            if (typeof map !== 'undefined' || attempts > 30) {
                clearInterval(poll);
                boot();
            }
        }, 100);
    }

function imOnCornerModeChange() {
    // Handles BOTH radio groups: cowboy's "imCornerMode" and concrete's
    // "imConcreteCornerMode". Previously this only ever queried
    // "imCornerMode", so clicking the concrete radios did nothing at all.
    const isConcrete = (imFenceType === 'concrete');
    const groupName = isConcrete ? 'imConcreteCornerMode' : 'imCornerMode';
    const r = document.querySelector('input[name="' + groupName + '"]:checked');
    const globalEl = document.getElementById('globalCornerMode');
    const doubleRadioId = isConcrete ? 'imConcreteCornerModeDouble' : 'imCornerModeDouble';
    const legacyCbId = isConcrete ? 'imConcreteDoubleCorner' : 'imDoubleCornerPost';

    if (r && r.value === 'single') {
        // Check every existing corner's interior angle before allowing global single-post mode
        const sharpCorner = imSides.some((s, i) => {
            if (i === 0) return false; // first vertex isn't a corner between two sides
            const prevB = imSides[i - 1].bearingAbs;
            const curB = s.bearingAbs;
            let diff = Math.abs(curB - prevB) % 360;
            if (diff > 180) diff = 360 - diff;
            const theta = 180 - diff; // interior angle at this corner
            return theta < 120;
        });

        if (sharpCorner) {
            // Block the switch — revert UI back to double and inform the user
            const doubleRadio = document.getElementById(doubleRadioId);
            if (doubleRadio) doubleRadio.checked = true;
            if (globalEl) globalEl.value = 'double';
            const statusEl = document.getElementById('imStatus');
            if (statusEl) statusEl.textContent = '⚠️ ไม่สามารถใช้เสาเดียวที่มุมได้ เนื่องจากมีมุม < 120° อยู่ในรูปร่างนี้';
            const legacyCb = document.getElementById(legacyCbId);
            if (legacyCb) legacyCb.checked = true;
            if (window._cornerModes) window._cornerModes.clear();
            if (typeof runFenceCalc === 'function') runFenceCalc();
            return;
        }
    }

    // Sync the hidden globalCornerMode input that fence.js reads
    if (r && globalEl) globalEl.value = r.value;
    // Keep legacy checkbox in sync (imDoubleCornerPost for cowboy,
    // imConcreteDoubleCorner for concrete)
    const legacyCb = document.getElementById(legacyCbId);
    if (legacyCb) legacyCb.checked = (r?.value !== 'single');
    // Reset per-corner overrides since global mode changed
    if (window._cornerModes) window._cornerModes.clear();
    if (typeof runFenceCalc === 'function') runFenceCalc();
}

    // ============================================
    // FREE-ANGLE TOGGLE — checkbox above "โหมดเสามุม"
    // Tick it to reveal the corner-mode radios AND
    // unlock the cowboy angle dial from 90° steps.
    // ============================================
    function imOnFreeAngleToggle() {
        const cb = document.getElementById('imFreeAngleToggle');
        imFreeAngle = !!(cb && cb.checked);

        // NOTE: corner-mode (เสามุมคู่/เดี่ยว) visibility is independent of
        // free-angle unlock — it must stay visible at all times, not just
        // after unlocking the angle dial. See imCornerModeWrap default style.

        // Re-render so angle inputs/dial pick up the new step (1° vs 90°)
        renderSideList();
        redrawPreview();
    }
    window.imOnFreeAngleToggle = imOnFreeAngleToggle;


})();