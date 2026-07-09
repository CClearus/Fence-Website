// ============================================
// CONCRETE FENCE — Calculation and Drawing
// ============================================
const PLAN_CONCRETE_ICON_BASE_PX = 20;
function drawConcretePost(latlng, b, type, borderColorOverride, fillColorOverride, sizeMultiplier) {
    const userScale = window._poleScale || 1.0;

    const isEndCap = (type === 'start' || type === 'end');
    const isCorner = (type === 'corner' || type === 'endpoint');
    const baseScale = (isCorner || isEndCap ? 1.6 : 5.4) * userScale;
    const SCALE = baseScale * (sizeMultiplier || 1);

    const halfAlong  = (0.15 * SCALE) / 2;
    const halfAcross = (0.15 * SCALE) / 2;

    const borderColor = borderColorOverride || (isEndCap
        ? (type === 'start' ? '#2563eb' : '#dc2626')
        : (isCorner ? '#ffffff' : '#1f2937'));
    const fillColor = fillColorOverride || (isEndCap ? '#ffffff' : (isCorner ? '#dc2626' : '#ffffff'));

    const webRect = [
        offPt(offPt(latlng, b,       halfAlong), b + 90,  halfAcross),
        offPt(offPt(latlng, b,       halfAlong), b - 90,  halfAcross),
        offPt(offPt(latlng, b + 180, halfAlong), b - 90,  halfAcross),
        offPt(offPt(latlng, b + 180, halfAlong), b + 90,  halfAcross),
    ];
    L.polygon(webRect, { color: borderColor, weight: isEndCap ? 2.5 : (isCorner ? 2 : 1.5), fillColor, fillOpacity: 1, opacity: 1 }).addTo(fenceLayerGroup);
}

// ── Panel slab between two posts ─────────────────────────────────────────────
// Draws a filled rectangle representing the concrete panel sitting in the channels
function drawConcreteSlab(pt0, pt1, lineColor) {
    const userScale = window._poleScale || 1.0;
    const halfW = 0.08 * userScale; // slab half-width (visual thickness)
    const b = bearing(pt0, pt1);
    const steps = Math.max(2, Math.ceil(hav(pt0, pt1) * 3));
    // Just draw a polyline for the slab face (same as cowboy line but thicker/different color)
    const pts = [];
    for (let s = 0; s <= steps; s++) {
        const frac = s / steps;
        pts.push([pt0[0] + frac * (pt1[0] - pt0[0]), pt0[1] + frac * (pt1[1] - pt0[1])]);
    }
    L.polyline(pts, { color: lineColor, weight: 7, opacity: 0.85, lineJoin: 'round' }).addTo(fenceLayerGroup);
    // Thin outline for panel definition
    L.polyline(pts, { color: '#1f2937', weight: 9, opacity: 0.25, lineJoin: 'round' }).addTo(fenceLayerGroup);
}

// ============================================
// CONCRETE FENCE — Panel calculation (reuses cowboy logic)
// ============================================

function calcConcretePanels(space, m) {
    // Identical logic to calcCowboyPanels — concrete uses same spacing rules
    if (space < 1e-4) return { ticks: [], standardCount: 0, splitCount: 0, needsDoubleCorner: false };

    const fullCount = Math.floor(space / m + 1e-9);
    const remainder = space - fullCount * m;

    if (remainder < m * 0.01) {
        const ticks = [];
        let cursor = 0;
        for (let i = 0; i < fullCount - 1; i++) {
            cursor += m;
            if (cursor > 1e-4 && cursor < space - 1e-4)
                ticks.push({ pos: cursor, isSplit: false });
        }
        return { ticks, standardCount: fullCount, splitCount: 0, splitSize: m, m, needsDoubleCorner: false };
    }

    let chosenA = 1;
    let splitSize = m / 2;
    for (let a = 1; a <= fullCount; a++) {
        const r = (space - m * (fullCount - a + 1)) / a;
        if (r >= m / 2 - 1e-9) {
            chosenA = a;
            splitSize = r;
            break;
        }
    }

    const stdPanels = fullCount - chosenA + 1;

    const gaps = [];
    for (let i = 0; i < stdPanels; i++) gaps.push(m);
    for (let i = 0; i < chosenA; i++) gaps.push(splitSize);

    const totalPanels = gaps.length;
    const ticks = [];
    let cursor = 0;
    for (let i = 0; i < totalPanels - 1; i++) {
        cursor += gaps[i];
        if (cursor > 1e-4 && cursor < space - 1e-4)
            ticks.push({ pos: cursor, isSplit: i >= stdPanels - 1 });
    }

    return { ticks, standardCount: stdPanels, splitCount: chosenA, splitSize, m, needsDoubleCorner: true };
}

// ============================================
// CONCRETE FENCE — Drawing
// ============================================

function drawConcreteFence(linePoints, m, n, splitAtStart, doubleCorner, lineColor) {
    lineColor = lineColor || '#9ca3af';
    const numSegs = linePoints.length - 1;
    const closed = numSegs >= 3 && hav(linePoints[0], linePoints[linePoints.length - 1]) < 0.5;
    let grandTotal = 0, totalPosts = 0, totalBeams = 0;
    const warnings = [];
    let cumulDist = 0;
    let postIndex = 0; // used to alternate bracket direction

    function blueArmFacesInto(cornerPt, towardPt) {
        const entry = cornerMap.get(ptKey(cornerPt));
        if (!entry || entry.arms.length < 2) return false;
        const k = ptKey(cornerPt);
        const arms = entry.arms.slice(0, 2);
        const isSwapped = swappedCorners.get(k) || false;
        const blueArm = isSwapped ? arms[0] : arms[1];
        const segDir = bearing(cornerPt, towardPt);
        const a = ((blueArm.outward % 360) + 360) % 360;
        const b2 = ((segDir % 360) + 360) % 360;
        let diff = Math.abs(a - b2);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    for (let si = 0; si < numSegs; si++) {
        const p0 = linePoints[si], p1 = linePoints[si + 1];
        const A_i = hav(p0, p1);

        let B_i = 0;
        if (si > 0 || closed) B_i++;
        if (si < numSegs - 1 || closed) B_i++;

        const startIsDC = doubleCorner && isCornerPoint(p0) && blueArmFacesInto(p0, p1);
        const endIsDC   = doubleCorner && isCornerPoint(p1) && blueArmFacesInto(p1, p0);

        // Mirrors cowboy's cornerShortenAmount: respects whichever mode
        // (single bisector post vs double red/blue pair) this specific
        // corner is currently in, and uses the same clearance-floor offset
        // (getDualCornerOffset) that drawConcreteDoubleCornerPost draws
        // its posts at — so the panel never stops short of, or overlaps,
        // where the post actually is.
        function cornerShortenAmount(cornerPt, n) {
            const entry = cornerMap.get(ptKey(cornerPt));
            if (!entry) return 0;
            const [a1, a2] = getCornerArms(entry);
            const theta = cornerAngle(a1, a2);
            const mode = getCornerMode(cornerPt, theta);
            if (mode === 'single') return n / 2;
            return getDualCornerOffset(n, theta);
        }

        const n_post = 0.15;
        const leftOff = startIsDC ? cornerShortenAmount(p0, n_post) : 0;
        const rightOff = endIsDC ? cornerShortenAmount(p1, n_post) : 0;
        const panelSpace = A_i - leftOff - rightOff;

if (panelSpace < 0.5) {
    warnings.push(`⚠️ ด้านที่ ${si + 1}: A<sub>${si+1}</sub> − B<sub>${si+1}</sub>·n = <b>${panelSpace.toFixed(2)} ม.</b> — ระยะรั้วต้องไม่ต่ำกว่า 0.5 เมตร`);
            cumulDist += A_i;
            const pts = [interp(linePoints, cumulDist - A_i), interp(linePoints, cumulDist)];
            L.polyline(pts, { color: '#f87171', weight: 4, opacity: 0.7, dashArray: '6,4' }).addTo(fenceLayerGroup);
            continue;
        }

        const calc = calcConcretePanels(panelSpace, m);
        grandTotal += A_i;

        const absTicks = calc.ticks.map(t => ({
            dist: cumulDist + leftOff + t.pos,
            isSplit: t.isSplit
        }));

        const panelStart = cumulDist + leftOff;
        const panelEnd   = cumulDist + A_i - rightOff;
        const allBounds  = [panelStart, ...absTicks.map(t => t.dist), panelEnd];

        // Draw panel slabs between each pair of posts
        for (let i = 0; i < allBounds.length - 1; i++) {
            const d0 = allBounds[i], d1 = allBounds[i + 1];
            if (d1 - d0 < 1e-4) continue;
            const ptA = interp(linePoints, d0);
            const ptB = interp(linePoints, d1);
            drawConcreteSlab(ptA, ptB, lineColor);
        }

        // Draw intermediate posts (ticks)
        for (let ti = 0; ti < absTicks.length; ti++) {
            const tick = absTicks[ti];
            const pt = interp(linePoints, tick.dist);
            const b  = bearingAt(linePoints, tick.dist);
            postIndex++;
            drawConcretePost(pt, b, postIndex % 2 === 0 ? 'normal' : 'split');
        }

        // Draw start post of this segment
        if (!(doubleCorner && isCornerPoint(linePoints[si]))) {
            const startPt = interp(linePoints, cumulDist);
            const isTrueLineStart = (si === 0 && !closed);
            const startBearing = isTrueLineStart
                ? bearing(linePoints[1], linePoints[0])   // outward: away from fence
                : bearingAt(linePoints, cumulDist + 0.01);
            if (isTrueLineStart) {
                drawConcretePost(startPt, startBearing, 'start');
            } else {
                // Mid-line bend (or closed-loop wrap point) — a distinct
                // corner post, same as cowboy's solo-mode corner square,
                // not just another alternating in-line panel post.
                drawConcretePost(startPt, startBearing, 'corner');
            }
        }

        totalPosts += calc.ticks.length + 1;
        totalBeams += calc.standardCount + calc.splitCount;
        cumulDist += A_i;
    }

    if (!closed) {
        const last = linePoints[linePoints.length - 1];
        const prev = linePoints[linePoints.length - 2];
        if (!(doubleCorner && isCornerPoint(last))) {
           drawConcretePost(last, bearing(prev, last), 'end');
            totalPosts++;
        }
    }

    return { grandTotal, totalPosts, totalBeams, warnings };
}

function calcConcrete(concreteLines, m_concrete, n, useDoubleCorner, layers) {
    let grandTotal = 0, grandPosts = 0, grandBeams = 0;
    const allWarnings = [];

    // REMOVED: if (concreteLines.length > 1) useDoubleCorner = true;
    // Now respects the checkbox value passed in

    buildCornerMap(concreteLines.map(ld => ld.points));

    concreteLines.forEach(ld => {
        const res = drawConcreteFence(ld.points, m_concrete, n, true, useDoubleCorner, ld.color || '#9ca3af');
        grandTotal += res.grandTotal;
        grandPosts += res.totalPosts;
        grandBeams += res.totalBeams * layers;
        if (res.warnings) allWarnings.push(...res.warnings);
    });

    if (useDoubleCorner) {
        for (const [k, entry] of cornerMap.entries()) {
            const result = drawConcreteDoubleCornerPost(entry.pt, n, true);
            grandPosts += result.count;
        }
    }

    return { grandTotal, grandPosts, grandBeams, warnings: allWarnings };
}


function drawConcreteDoubleCornerPost(cornerPt, n, addHoverMarkers) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return { count: 0 };
    const arms = entry.arms.slice(0, 2);
    if (arms.length < 2) {
        drawConcretePost(cornerPt, arms[0].outward, 'corner');
        return { count: 1 };
    }

    const [armRed, armBlue] = getCornerArms(entry);
    const theta = cornerAngle(armRed, armBlue);
    const mode = getCornerMode(cornerPt, theta);

    if (mode === 'single') {
        const bisect = (armRed + armBlue) / 2;
        drawConcretePost(cornerPt, bisect, 'corner');
        if (addHoverMarkers) _addCornerModeToggle(cornerPt, 'single', theta);
        return { count: 1 };
    }

    // double mode — same clearance-floor offset as cowboy's dual corner
    // (getDualCornerOffset, not the raw un-clamped cornerOffsetX), so the
    // two brackets sit cleanly apart instead of overlapping.
    const offset = getDualCornerOffset(n > 0 ? n : 0.15, theta);

    // armRed/armBlue are each arm's OUTWARD bearing (away from the corner,
    // into that segment) — the red post sits right at the corner point,
    // the blue post sits `offset` further out along armBlue. Both are drawn
    // as plain colored-outline segment blocks via drawConcretePost (red
    // border for 'end', blue border for 'start') — no image icons.
    drawConcretePost(cornerPt, armRed, 'end');

    const bluePt = offPt(cornerPt, armBlue, offset);
    drawConcretePost(bluePt, armBlue, 'start');

    if (addHoverMarkers) {
        _addCornerModeToggle(cornerPt, 'double', theta, armRed, armBlue);
        const k = ptKey(cornerPt);
        L.marker(cornerPt, {
            icon: L.divIcon({
                className: '',
                html: `<div class="dc-swap-btn" data-k="${k}" title="Swap corner side">⇄</div>`,
                iconSize: [24, 24], iconAnchor: [12, 12]
            }),
            zIndexOffset: 3000, interactive: true
        }).addTo(fenceLayerGroup);
    }
    return { count: 2 };
}
// ============================================
// CONCRETE FENCE — Plan Mode Drawing
// ============================================

function drawPlanConcreteLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;

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

    const fenceOpts = lineData.fenceOptions || {};
    const m = fenceOpts.postSpacing
        || parseFloat(document.getElementById('postSpacingConcrete')?.value)
        || parseFloat(document.getElementById('imPostSpacingConcrete')?.value)
        || parseFloat(document.getElementById('spacingSelectConcrete')?.value)
        || parseFloat(document.getElementById('imSpacingSelectConcrete')?.value)
        || 2.5;

    const dualPillarCheckbox = document.getElementById('concreteDoubleCornerPost')
        || document.getElementById('doubleCornerPost');
    const useDualPillar = fenceOpts.doubleCorner
        ?? (dualPillarCheckbox ? dualPillarCheckbox.checked : false);

const n = 0.15;
const userScale = window._poleScale || 1.0;
// NEW — fixed 20px, no zoom scaling:
const PLAN_ICON_FIXED_PX = 20; // fixed size — matches segment pillar box, no zoom dependency

function drawPlanConcreteIcon(pt, iconUrl, rot) {
    const scale = window._poleScale || 1.0;
    const n = 0.15;
    const visualN = Math.max(n, 0.15) * scale * 3;
    const halfSz = visualN / 2;
    const bearingDeg = rot;
    const corners = [
        offPt(offPt(pt, bearingDeg + 90, halfSz), bearingDeg,       halfSz),
        offPt(offPt(pt, bearingDeg - 90, halfSz), bearingDeg,       halfSz),
        offPt(offPt(pt, bearingDeg - 90, halfSz), bearingDeg + 180, halfSz),
        offPt(offPt(pt, bearingDeg + 90, halfSz), bearingDeg + 180, halfSz),
    ];
    const borderColor = iconUrl === 'start.png' ? '#2563eb' : '#dc2626';
    L.polygon(corners, {
        color: borderColor, weight: 2,
        fillColor: '#ffffff', fillOpacity: 1, opacity: 1
    }).addTo(planLayerGroup);
}

    function drawDualPair(pt, inB, outB) {
        const rotEnd   = ((inB + 180) % 360 + 360) % 360;
        const rotStart = ((outB % 360) + 360) % 360;
        const gap = DOUBLE_CORNER_OFFSET > 0 ? DOUBLE_CORNER_OFFSET : 0.3;
        const ptEnd   = offPt(pt, inB,  gap / 2);
        const ptStart = offPt(pt, outB, gap / 2);
        drawPlanConcreteIcon(ptEnd,   'end.png',   rotEnd);
        drawPlanConcreteIcon(ptStart, 'start.png', rotStart);
    }

    // --- FIX: mirror drawConcreteFence's corner clearance -----------------
    // The real map never splits the FULL segment length into panels — it
    // first pulls back `leftOff`/`rightOff` at any dual-corner post, then
    // divides only the remaining `panelSpace`. Plan Mode was feeding the
    // raw segment length straight into calcConcretePanels, so its leftover
    // "split" panel near a corner was the wrong size and its dimension
    // label ended up sitting on top of the corner post / total-length label.
    function blueArmFacesInto(cornerPt, towardPt) {
        const entry = cornerMap.get(ptKey(cornerPt));
        if (!entry || entry.arms.length < 2) return false;
        const k = ptKey(cornerPt);
        const arms = entry.arms.slice(0, 2);
        const isSwapped = swappedCorners.get(k) || false;
        const blueArm = isSwapped ? arms[0] : arms[1];
        const segDir = bearing(cornerPt, towardPt);
        const a = ((blueArm.outward % 360) + 360) % 360;
        const b2 = ((segDir % 360) + 360) % 360;
        let diff = Math.abs(a - b2);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    function cornerShortenAmount(cornerPt) {
        const entry = cornerMap.get(ptKey(cornerPt));
        if (!entry) return 0;
        const [a1, a2] = getCornerArms(entry);
        const theta = cornerAngle(a1, a2);
        const mode = getCornerMode(cornerPt, theta);
        if (mode === 'single') return n / 2;
        return getDualCornerOffset(n, theta);
    }
    // ------------------------------------------------------------------------

    const numSegs = pts.length - 1;
    let dAcc = 0;

    for (let i = 0; i < numSegs; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        const startIsDC = useDualPillar && isCornerPoint(p0) && blueArmFacesInto(p0, p1);
        const endIsDC   = useDualPillar && isCornerPoint(p1) && blueArmFacesInto(p1, p0);
        const leftOff  = startIsDC ? cornerShortenAmount(p0) : 0;
        const rightOff = endIsDC   ? cornerShortenAmount(p1) : 0;
        const panelSpace = Math.max(0, segLen - leftOff - rightOff);

        // tickDists = panel/slab boundaries, bounded by the shortened span
        let tickDists = [leftOff];
        let stdCount = 1;
        if (panelSpace > 0.5) {
            const calc = calcConcretePanels(panelSpace, m);
            calc.ticks.forEach(t => tickDists.push(leftOff + t.pos));
            stdCount = calc.standardCount;
        }
        tickDists.push(segLen - rightOff);

        // postDists = actual post render points — corners/ends still sit at
        // the TRUE endpoint; drawDualPair applies its own visual offset,
        // same as the live map does.
        const postDists = [0, ...tickDists.slice(1, -1), segLen];

postDists.forEach((dist, pIdx) => {
    const pt = interp(pts, dAcc + dist);
    const isTrueStart  = (i === 0 && pIdx === 0);
    const isTrueEnd    = (i === numSegs - 1 && pIdx === postDists.length - 1);
    const isMidCorner  = (pIdx === postDists.length - 1 && i < numSegs - 1);
    const isCornerSkip = (pIdx === 0 && i > 0);

    if (isCornerSkip) return;

    // Only a point actually SHARED with another line (2+ arms in cornerMap)
    // is the double red/blue pillar pair, drawn once by
    // drawPlanConcreteCorners(). A true, unshared start/end always gets its
    // own single start.png/end.png cap, same as the live map's isEndCap
    // branch in drawConcretePost — dual-pillar mode doesn't change that.
    const sharedCorner = useDualPillar && isCornerPoint(pt);

    if (isTrueStart) {
        if (sharedCorner) return; // handled by drawPlanConcreteCorners
        drawPlanConcreteIcon(pt, 'start.png', ((b % 360) + 360) % 360);
    } else if (isTrueEnd) {
        if (sharedCorner) return;
        drawPlanConcreteIcon(pt, 'end.png', (((b + 180) % 360) + 360) % 360);
} else if (isMidCorner) {
    if (sharedCorner) return; // dual-pillar pair drawn once, elsewhere
    if (useDualPillar) {
        // Dual pillar mode on: use the red/blue pair, not the plain red box
        const outB = (i + 2 < pts.length) ? bearing(p1, pts[i + 2]) : b;
        drawDualPair(pt, b, outB);
    } else {
        drawPlanPost(pt, b, true, n, 'concrete'); // single-mode corner square
    }
} else {
        drawPlanPost(pt, b, false, n, 'concrete');
    }
});

        for (let j = 0; j < tickDists.length - 1; j++) {
            const isStandardPanel = j < stdCount;
            if (isStandardPanel && j > 0) continue;
            const sPt = interp(pts, dAcc + tickDists[j]);
            const ePt = interp(pts, dAcc + tickDists[j + 1]);
            drawDimLine(sPt, ePt, 0.25, hav(sPt, ePt).toFixed(2) + 'm', '#000');
        }
        drawDimLine(p0, p1, outwardOffset(pts, p0, p1, 0.55), segLen.toFixed(2) + 'm', '#000');
        dAcc += segLen;
    }
}

// NEW — red end.png at corner removed; blue start.png kept with fixed size:
function drawPlanConcreteCorners() {
    if (typeof cornerMap === 'undefined' || cornerMap.size === 0) return;

    const dualPillarCheckbox = document.getElementById('concreteDoubleCornerPost')
        || document.getElementById('doubleCornerPost');
    const useDualPillar = dualPillarCheckbox ? dualPillarCheckbox.checked : false;
    if (!useDualPillar) return;

    const n = 0.15;
    const PLAN_ICON_FIXED_PX = 20; // fixed — no zoom scaling

    for (const [, entry] of cornerMap.entries()) {
        const arms = entry.arms.slice(0, 2);
        if (arms.length < 2) continue;

        const [armRed, armBlue] = getCornerArms(entry);
        const theta = cornerAngle(armRed, armBlue);
        const mode = getCornerMode(entry.pt, theta);
        if (mode === 'single') continue;

        const offset = getDualCornerOffset(n, theta);

        // ── RED end.png at the corner itself is intentionally removed ──
        // In plan mode with dual fence enabled, the corner post (end.png)
        // is replaced by a plain segment-pillar box drawn by drawPlanPost,
        // so we only place the blue start.png at its offset position here.

        const rotBlue = ((armBlue % 360) + 360) % 360;
        const bluePt = offPt(entry.pt, armBlue, offset);
const scale = window._poleScale || 1.0;
const visualN = Math.max(n, 0.15) * scale * 3;
const halfSz = visualN / 2;
const bCorners = [
    offPt(offPt(bluePt, armBlue + 90, halfSz), armBlue,       halfSz),
    offPt(offPt(bluePt, armBlue - 90, halfSz), armBlue,       halfSz),
    offPt(offPt(bluePt, armBlue - 90, halfSz), armBlue + 180, halfSz),
    offPt(offPt(bluePt, armBlue + 90, halfSz), armBlue + 180, halfSz),
];
L.polygon(bCorners, {
    color: '#2563eb', weight: 2,
    fillColor: '#ffffff', fillOpacity: 1, opacity: 1
}).addTo(planLayerGroup);
    }
}