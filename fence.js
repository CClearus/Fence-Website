// ============================================
// FENCE CORE & COORDINATOR
// ============================================

// ── Globals ──────────────────────────────────
let fenceLayerGroup = L.layerGroup().addTo(map);
const PRICE_PER_M = 850;
let cornerMap = new Map();
const swappedCorners = new Map();

// ── Geometry Helpers ─────────────────────────
function hav(p1, p2) {
    const R = 6371000;
    const dLat = (p2[0]-p1[0])*Math.PI/180;
    const dLon = (p2[1]-p1[1])*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function totalLen(pts) {
    let t = 0;
    for(let i = 0; i < pts.length - 1; i++) t += hav(pts[i], pts[i+1]);
    return t;
}

function interp(pts, d) {
    let acc = 0;
    for(let i = 0; i < pts.length - 1; i++){
        const s = hav(pts[i], pts[i+1]);
        if(acc + s >= d - 1e-6){
            const t = Math.min(1, (d - acc) / s);
            return [pts[i][0] + t * (pts[i+1][0] - pts[i][0]), pts[i][1] + t * (pts[i+1][1] - pts[i][1])];
        }
        acc += s;
    }
    return [...pts[pts.length-1]];
}

function bearing(p1, p2) {
    const f1 = p1[0]*Math.PI/180, f2 = p2[0]*Math.PI/180, dl = (p2[1]-p1[1])*Math.PI/180;
    return Math.atan2(Math.sin(dl)*Math.cos(f2), Math.cos(f1)*Math.sin(f2) - Math.sin(f1)*Math.cos(f2)*Math.cos(dl)) * 180/Math.PI;
}

function bearingAt(pts, d) {
    let acc = 0;
    for(let i = 0; i < pts.length - 1; i++){
        const s = hav(pts[i], pts[i+1]);
        if(acc + s >= d - 1e-6) return bearing(pts[i], pts[i+1]);
        acc += s;
    }
    return bearing(pts[pts.length-2], pts[pts.length-1]);
}

function offPt(ll, b, dist) {
    const R = 6371000, d = dist/R, rb = b * Math.PI/180;
    const f1 = ll[0]*Math.PI/180, l1 = ll[1]*Math.PI/180;
    const f2 = Math.asin(Math.sin(f1)*Math.cos(d) + Math.cos(f1)*Math.sin(d)*Math.cos(rb));
    const l2 = l1 + Math.atan2(Math.sin(rb)*Math.sin(d)*Math.cos(f1), Math.cos(d) - Math.sin(f1)*Math.sin(f2));
    return [f2 * 180/Math.PI, l2 * 180/Math.PI];
}

function ptKey(p) { return p[0].toFixed(5) + ',' + p[1].toFixed(5); }

function buildCornerMap(allLinePointsArray) {
    cornerMap = new Map();
    function addArm(pt, bearingInward, bearingOutward) {
        const k = ptKey(pt);
        if (!cornerMap.has(k)) cornerMap.set(k, { pt, arms: [] });
        cornerMap.get(k).arms.push({ inward: bearingInward, outward: bearingOutward });
    }
    allLinePointsArray.forEach(linePoints => {
        if (linePoints.length < 2) return;
        for (let i = 0; i < linePoints.length; i++) {
            const pt = linePoints[i];
            if (i === 0) addArm(pt, bearing(linePoints[0], linePoints[1]), bearing(linePoints[0], linePoints[1]));
            else if (i === linePoints.length - 1) addArm(pt, bearing(linePoints[i], linePoints[i-1]), bearing(linePoints[i], linePoints[i-1]));
            else {
                addArm(pt, bearing(linePoints[i], linePoints[i-1]), bearing(linePoints[i], linePoints[i-1]));
                addArm(pt, bearing(linePoints[i], linePoints[i+1]), bearing(linePoints[i], linePoints[i+1]));
            }
        }
    });
    for (const [k, entry] of cornerMap.entries()) {
        if (entry.arms.length < 2) cornerMap.delete(k);
    }
}

function isCornerPoint(p) { return cornerMap.has(ptKey(p)); }

function getCornerArms(entry) {
    const k = ptKey(entry.pt);
    const arms = entry.arms.slice(0, 2);
    return swappedCorners.get(k) ? [arms[1].outward, arms[0].outward] : [arms[0].outward, arms[1].outward];
}

const DOUBLE_CORNER_HALF = 0.40;
const DOUBLE_CORNER_OFFSET = DOUBLE_CORNER_HALF * 2;

function drawDoubleCornerPost(cornerPt, n, addHoverMarkers) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return { count: 0 };
    const arms = entry.arms.slice(0, 2);
    if (arms.length < 2) { drawPost(cornerPt, arms[0].outward, 'corner'); return { count: 1 }; }

    const [armRed, armBlue] = getCornerArms(entry);
    const halfSz = DOUBLE_CORNER_HALF * (window._poleScale || 1.0);
    
    function drawColorSquare(latlng, b, color) {
        const rect = [
            offPt(offPt(latlng, b + 90, halfSz), b, halfSz),
            offPt(offPt(latlng, b - 90, halfSz), b, halfSz),
            offPt(offPt(latlng, b - 90, halfSz), b + 180, halfSz),
            offPt(offPt(latlng, b + 90, halfSz), b + 180, halfSz),
        ];
        L.polygon(rect, { color, weight: 2, fillColor: 'white', fillOpacity: 1, opacity: 1 }).addTo(fenceLayerGroup);
    }

    drawColorSquare(cornerPt, armRed, '#dc2626');
    drawColorSquare(offPt(cornerPt, armBlue, DOUBLE_CORNER_OFFSET), armBlue, '#2563eb');

    if (addHoverMarkers) {
        const k = ptKey(cornerPt);
        L.marker(cornerPt, { 
            icon: L.divIcon({ className: '', html: `<div class="dc-swap-btn" data-k="${k}" title="Swap corner side">⇄</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), 
            zIndexOffset: 3000, interactive: true 
        }).addTo(fenceLayerGroup);
    }
    return { count: 2 };
}

function drawPost(latlng, b, type) {
    const postW = 0.15, postL = 0.15;
    const userScale = window._poleScale || 1.0;
    const SCALE = (type === 'endpoint' || type === 'corner' ? 1.6 : 5.4) * userScale;
    const halfW = (postW * SCALE) / 2, halfL = (postL * SCALE) / 2;

    const isCorner = type === 'endpoint' || type === 'corner';
    const rect = [
        offPt(offPt(latlng, b + 90, halfW), b, halfL),
        offPt(offPt(latlng, b - 90, halfW), b, halfL),
        offPt(offPt(latlng, b - 90, halfW), b + 180, halfL),
        offPt(offPt(latlng, b + 90, halfW), b + 180, halfL),
    ];

    L.polygon(rect, {
        color: isCorner ? '#ffffff' : '#1f2937',
        weight: isCorner ? 2 : 1.5,
        fillColor: isCorner ? '#dc2626' : '#ffffff',
        fillOpacity: 1, opacity: 1
    }).addTo(fenceLayerGroup);
}

// ── UI Wiring & Core Calculation ─────────────
(function injectSwapCSS() {
    if (document.getElementById('dc-swap-style')) return;
    const style = document.createElement('style');
    style.id = 'dc-swap-style';
    style.textContent = `.dc-swap-btn { width: 24px; height: 24px; line-height: 24px; text-align: center; font-size: 14px; font-weight: bold; background: white; border: 2px solid #2563eb; border-radius: 50%; color: #2563eb; cursor: pointer; opacity: 0; transition: opacity 0.15s; box-shadow: 0 1px 4px rgba(0,0,0,0.25); user-select: none; } .leaflet-marker-icon:hover .dc-swap-btn, .dc-swap-btn:hover { opacity: 1; }`;
    document.head.appendChild(style);
})();

let _swapClickSuppressed = false;
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.dc-swap-btn');
    if (!btn) return;
    e.stopPropagation(); e.preventDefault();
    _swapClickSuppressed = true;
    setTimeout(() => { _swapClickSuppressed = false; }, 50);
    const k = btn.getAttribute('data-k');
    if (k) {
        swappedCorners.set(k, !(swappedCorners.get(k) || false));
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }
});

function runFenceCalc() {
    if (typeof allLines === 'undefined' || allLines.length === 0) return;

    const layersInput = document.getElementById('beamSelect');
    const layers = layersInput ? parseInt(layersInput.value) || 2 : 2;

    const activeCard = document.querySelector('.sb-fence-card.active');
    const activeFenceType = activeCard ? activeCard.getAttribute('data-type') : 'cowboy';

const validLines = allLines.filter(ld => ld.points && ld.points.length >= 2);
    const cowboyLines = validLines.filter(ld => (ld.fenceType || activeFenceType) !== 'brick' && (ld.fenceType || activeFenceType) !== 'barbed');
    const brickLines  = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'brick');
    const barbedLines = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'barbed');

    // Pre-scan: auto-enable double corner silently if any segment needs shortening
    if (cowboyLines.length > 0) {
        const spacingInputPre = document.getElementById('postSpacing') || document.getElementById('imPostSpacing');
        const mPre = Math.min(3, Math.max(1, spacingInputPre ? parseFloat(spacingInputPre.value) || 2.5 : 2.5));
        let anyNeeds = false;
        outer: for (const ld of cowboyLines) {
            for (let si = 0; si < ld.points.length - 1; si++) {
                if (calcCowboyPanels(hav(ld.points[si], ld.points[si + 1]), mPre).needsDoubleCorner) {
                    anyNeeds = true; break outer;
                }
            }
        }
        if (anyNeeds) {
            const dcEl = document.getElementById('doubleCornerPost') || document.getElementById('imDoubleCornerPost');
            if (dcEl && !dcEl.checked) dcEl.checked = true;
        }
    }

    // Read doubleCorner AFTER potential auto-enable above
    const doubleCornerInput = document.getElementById('doubleCornerPost') || document.getElementById('imDoubleCornerPost');
    const doubleCorner = doubleCornerInput ? doubleCornerInput.checked : false;

    const allWarnings = [];
    if (fenceLayerGroup) fenceLayerGroup.clearLayers();
    let grandTotal = 0, grandPosts = 0, grandBeams = 0;
    let hasBrick = false;

    if (cowboyLines.length > 0) {
        const spacingInput = document.getElementById('postSpacing') || document.getElementById('imPostSpacing');
        const m_cowboy = Math.min(3, Math.max(1, spacingInput ? parseFloat(spacingInput.value) || 2.5 : 2.5));
        const res = calcCowboy(cowboyLines, m_cowboy, 0, doubleCorner, layers);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        allWarnings.push(...res.warnings);
    }

    if (brickLines.length > 0) {
        const res = calcBrick(brickLines);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        allWarnings.push(...res.warnings);
        hasBrick = res.hasBrick;
    }

    if (barbedLines.length > 0) {
        const spacingInput = document.getElementById('postSpacingBarbed') || document.getElementById('imPostSpacingBarbed');
        const m_barbed = Math.min(3, Math.max(1, spacingInput ? parseFloat(spacingInput.value) || 2.5 : 2.5));
        const nBraceSolo = (document.getElementById('nBraceSolo') || document.getElementById('imNBraceSolo'))?.checked ?? false;
        const nBraceDual = (document.getElementById('nBraceDual') || document.getElementById('imNBraceDual'))?.checked ?? false;
        const nBraceAngle = (document.getElementById('nBraceAngle') || document.getElementById('imNBraceAngle'))?.checked ?? false;
        
        const res = calcBarbed(barbedLines, m_barbed, 0, nBraceSolo, nBraceDual, nBraceAngle);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        allWarnings.push(...res.warnings);
    }

    function writeResults(ids) {
        const totalInput = document.getElementById(ids.total);
        if (totalInput) totalInput.value = grandTotal.toFixed(2);

        const postsInput = document.getElementById(ids.posts);
        if (postsInput) postsInput.value = grandPosts;

        const beamsInput = document.getElementById(ids.beams);
        const beamsLabel = beamsInput?.closest('.sbr-row-item')?.querySelector('.sbr-label');
        const beamsUnit = beamsInput?.closest('.sbr-field-row')?.querySelector('.sbr-unit');

        if (hasBrick && window._brickCalcResult) {
            const br = window._brickCalcResult;
            const brickCountWithWaste = Math.ceil(br.brickCount * 1.05);
            if (beamsInput) beamsInput.value = brickCountWithWaste.toLocaleString('th-TH');
            if (beamsLabel) beamsLabel.textContent = 'จำนวนอิฐ (รวม +5%)';
            if (beamsUnit) beamsUnit.textContent = 'ก้อน'; 
        } else {
            if (beamsInput) beamsInput.value = grandBeams;
            if (beamsLabel) beamsLabel.textContent = 'จำนวนคานที่ต้องใช้';
            if (beamsUnit) beamsUnit.textContent = 'อัน';
        }

        const priceInput = document.getElementById(ids.price);
        if (priceInput) {
            if (hasBrick && window._brickCalcResult) {
                const br = window._brickCalcResult;
                const brickPrice = parseFloat((document.getElementById('brickPricePerPiece') || document.getElementById('imBrickPrice'))?.value) || 1.05;
                const brickCount = Math.ceil(br.brickCount * 1.05);
                priceInput.value = (brickCount * brickPrice).toLocaleString('th-TH', { maximumFractionDigits: 0 });
            } else {
                priceInput.value = (grandTotal * 850).toLocaleString('th-TH', { maximumFractionDigits: 0 });
            }
        }

        const warnEl = document.getElementById(ids.warnings);
        if (warnEl) {
            if (allWarnings.length > 0) {
                warnEl.innerHTML = allWarnings.map(w => `<div class="fw-item">${w}</div>`).join('');
                warnEl.style.display = 'block';
            } else {
                warnEl.style.display = 'none';
            }
        }
    }

    writeResults({ total: 'resTotal', posts: 'resPosts', beams: 'resBeams', beamsRow: null, price: 'resPriceDisplay', warnings: 'fenceWarnings' });
    writeResults({ total: 'imResTotal', posts: 'imResPosts', beams: 'imResBeams', beamsRow: 'imResBeamsRow', price: 'imResPriceDisplay', warnings: 'imFenceWarnings' });
}

// Shared UI Helpers
window.onBeamCbChange = function() {
    const cbTop = document.getElementById('beamCbTop') || document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('beamCbCenter') || document.getElementById('imBeamCbCenter');
    const hidden = document.getElementById('imBrickBeamMode') || document.getElementById('brickBeamMode');
    if (!cbTop || !cbCenter || !hidden) return;
    
    let mode = (cbTop.checked && cbCenter.checked) ? 'center+top' : (cbTop.checked ? 'top' : (cbCenter.checked ? 'center' : '0'));
    hidden.value = mode;
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

window.syncBeamCheckboxesToHeight = function(h) {
    const cbTop = document.getElementById('beamCbTop') || document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('beamCbCenter') || document.getElementById('imBeamCbCenter');
    const hidden = document.getElementById('imBrickBeamMode') || document.getElementById('brickBeamMode');
    if (!cbTop || !cbCenter) return;
    
    let mode;
    if (h <= 1.2) { mode = '0'; cbTop.checked = false; cbCenter.checked = false; }
    else if (h < 1.8) { mode = 'top'; cbTop.checked = true; cbCenter.checked = false; }
    else if (h < 2.2) { mode = 'center'; cbTop.checked = false; cbCenter.checked = true; }
    else { mode = 'center+top'; cbTop.checked = true; cbCenter.checked = true; }

    if (hidden) hidden.value = mode;
    if (typeof syncPillarSizeOptions === 'function') syncPillarSizeOptions(h);
};

window.syncPillarSizeOptions = function(h) {
    const sel = document.getElementById('brickPillarSize') || document.getElementById('imBrickPillarSize');
    if (!sel) return;
    const current = sel.value;
    const opts = h <= 1.5 ? 
        [{ value: '10x10', label: '10×10 ซม. (default)' }, { value: '15x15', label: '15×15 ซม.' }, { value: 'custom', label: 'กำหนดเอง…' }] :
        [{ value: '15x15', label: '15×15 ซม. (default)' }, { value: '20x20', label: '20×20 ซม.' }, { value: 'custom', label: 'กำหนดเอง…' }];
    
    sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
    if (typeof onPillarSizeChange === 'function') onPillarSizeChange(sel.value);
};

window.onPillarSizeChange = function(val) {
    const customInput = document.getElementById('brickPillarCustom') || document.getElementById('imBrickPillarCustom');
    const customLabel = document.getElementById('brickPillarCustomLabel') || document.getElementById('imBrickPillarCustomLabel');
    if (customInput) customInput.style.display = val === 'custom' ? '' : 'none';
    if (customLabel) customLabel.style.display = val === 'custom' ? '' : 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    const h = parseFloat((document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value) || 1.8;
    if (typeof syncBeamCheckboxesToHeight === 'function') syncBeamCheckboxesToHeight(h);
    if (typeof syncPillarSizeOptions === 'function') syncPillarSizeOptions(h);
});

document.getElementById('clearFenceBtn')?.addEventListener('click', function() {
    fenceLayerGroup.clearLayers();
    swappedCorners.clear();
    ['resTotal','resPosts','resBeams','resPrice','imResTotal','imResPosts','imResBeams','imResPriceDisplay'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const fw1 = document.getElementById('fenceWarnings');
    const fw2 = document.getElementById('imFenceWarnings');
    if (fw1) fw1.style.display = 'none';
    if (fw2) fw2.style.display = 'none';
});

// ── Fence type labels & per-line option snapshot ─────
const FENCE_TYPE_LABELS = {
    cowboy: 'รั้วคาวบอย',
    barbed: 'รั้วลวดหนาม',
    brick: 'รั้วอิฐ',
    concrete: 'รั้วคอนกรีตสำเร็จรูป'
};

// Snapshot the option inputs relevant to a fence type, so each line
// remembers the settings that were active when it was drawn.
function captureFenceOptions(fenceType) {
    const val = (id1, id2) => {
        const el = document.getElementById(id1) || document.getElementById(id2);
        return el ? el.value : undefined;
    };
    const checked = (id1, id2) => {
        const el = document.getElementById(id1) || document.getElementById(id2);
        return el ? el.checked : false;
    };

    if (fenceType === 'barbed') {
        return {
            spacing: val('postSpacingBarbed', 'imPostSpacingBarbed'),
            nBraceSolo: checked('nBraceSolo', 'imNBraceSolo'),
            nBraceDual: checked('nBraceDual', 'imNBraceDual'),
            nBraceAngle: checked('nBraceAngle', 'imNBraceAngle')
        };
    }
    if (fenceType === 'brick') {
        return {
            spacing: val('postSpacingBrick', 'imPostSpacingBrick'),
            height: val('brickFenceHeight', 'imBrickFenceHeight'),
            beamMode: val('brickBeamMode', 'imBrickBeamMode'),
            pillarSize: val('brickPillarSize', 'imBrickPillarSize')
        };
    }
    // cowboy (default)
    const dcEl = document.getElementById('doubleCornerPost') || document.getElementById('imDoubleCornerPost');
    return {
        spacing: val('postSpacing', 'imPostSpacing'),
        doubleCorner: dcEl ? dcEl.checked : false,
        layers: val('beamSelect', 'imBeamSelect')
    };
}

// Build a short label describing a saved line's fence type + options
function getFenceSummaryLabel(ld) {
    const type = ld.fenceType || 'cowboy';
    const typeName = FENCE_TYPE_LABELS[type] || type;
    const opt = ld.fenceOptions || {};
    const parts = [];

    if (type === 'barbed') {
        if (opt.nBraceSolo)  parts.push('N-Brace เดี่ยว');
        if (opt.nBraceDual)  parts.push('N-Brace คู่');
        if (opt.nBraceAngle) parts.push('N-Brace มุม');
        if (opt.spacing)     parts.push(`เสาห่าง ${opt.spacing} ม.`);
    } else if (type === 'brick') {
        if (opt.height)     parts.push(`สูง ${opt.height} ม.`);
        if (opt.pillarSize) parts.push(`เสา ${opt.pillarSize} ซม.`);
        const beamLabels = { top: 'คานบน', center: 'คานกลาง', 'center+top': 'คานบน+กลาง', '0': 'ไม่มีคาน', none: 'ไม่มีคาน' };
        if (opt.beamMode && beamLabels[opt.beamMode]) parts.push(beamLabels[opt.beamMode]);
    } else {
        if (opt.spacing)      parts.push(`เสาห่าง ${opt.spacing} ม.`);
        if (opt.doubleCorner) parts.push('เสามุมคู่');
        if (opt.layers)       parts.push(`${opt.layers} ลอน`);
    }

    return parts.length ? `${typeName} • ${parts.join(' · ')}` : typeName;
}

// ── Auto-recalculate on every change ─────────────────
let _fenceRecalcTimer = null;
function scheduleFenceRecalc() {
    clearTimeout(_fenceRecalcTimer);
    _fenceRecalcTimer = setTimeout(() => {
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }, 100);
}

// Delegated listener: any input/select/checkbox change anywhere in the
// left sidebar (Page 1 fence options AND Input-Mode page options)
// triggers a recalculation — no "Simulate" button needed anymore.
function wireFenceOptionAutoCalc() {
    const sidebar = document.querySelector('.left-sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('input', function (e) {
        if (e.target.matches('input, select, textarea')) {
            scheduleFenceRecalc();
        }
    });

    sidebar.addEventListener('change', function (e) {
        if (e.target.matches('input, select, textarea')) {
            scheduleFenceRecalc();
        }
    });
}

document.addEventListener('DOMContentLoaded', wireFenceOptionAutoCalc);