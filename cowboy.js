// ============================================
// COWBOY FENCE — Calculation and Drawing
// ============================================

function calcCowboyPanels(space, m) {
    if (space < 1e-4) return { ticks: [], standardCount: 0, splitCount: 0, needsDoubleCorner: false };

    const fullCount = Math.floor(space / m + 1e-9);
    const remainder = space - fullCount * m;

    // Perfect fit — no short panels needed
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

    // Find smallest a (1, 2, ...) such that r >= m/2
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

    const stdPanels = fullCount - chosenA + 1;  // ← fixed: image2 formula gives (fullCount - a + 1) std panels

    // Split panels go FIRST, then standard panels
// Split panels go LAST, then standard panels first
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

function drawCowboyFence(linePoints, m, n, splitAtStart, doubleCorner, lineColor) {
    lineColor = lineColor || '#3b82f6';
    const numSegs = linePoints.length - 1;
    const closed = numSegs >= 3 && hav(linePoints[0], linePoints[linePoints.length-1]) < 0.5;
    let grandTotal = 0, totalPosts = 0, totalBeams = 0;
    const warnings = [];
    let cumulDist = 0;
    // Per-segment geometry, exactly as computed for the map — Plan Mode reads
    // this instead of recalculating panels/ticks itself, so it can never
    // drift from what the map actually draws (dual-corner shortening
    // included).
    const segGeom = [];

    // A corner shortens BOTH of its arms — a single bisector post needs
    // clearance on both sides, and a dual (red+blue) post now sits offset
    // along BOTH arms (see drawDoubleCornerPost), not just one. This used
    // to be gated by "is this the blue arm", which only ever shortened one
    // side of a corner and left the other arm's panel running straight
    // into the vertex — that was the dual-corner-not-moving-away bug.

    for (let si = 0; si < numSegs; si++) {
        const p0 = linePoints[si], p1 = linePoints[si+1];
        const A_i = hav(p0, p1);

        let B_i = 0;
        if (si > 0 || closed) B_i++;
        if (si < numSegs-1 || closed) B_i++;

function cornerShortenAmount(cornerPt, n) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return 0;
    const [a1, a2] = getCornerArms(entry);
    const theta = cornerAngle(a1, a2);
    const mode = getCornerMode(cornerPt, theta); // 'single' or 'double' — same source of truth as drawDoubleCornerPost
    if (mode === 'single') return n / 2; // bisector post — panel only needs to clear half its width
    return getDualCornerOffset(n, theta); // double post — must match drawDoubleCornerPost's post placement exactly
}

const startIsDC = doubleCorner && isCornerPoint(p0);
const endIsDC = doubleCorner && isCornerPoint(p1);

const n_post = 0.15; // post size in metres
const leftOff = startIsDC ? cornerShortenAmount(p0, n_post) : 0;
const endsAtDC = doubleCorner && isCornerPoint(p1);
const rightOff = endIsDC ? cornerShortenAmount(p1, n_post) : 0;
        const panelSpace = A_i - leftOff - rightOff;

if (panelSpace < 0.5) {
    warnings.push(`⚠️ ด้านที่ ${si + 1}: A<sub>${si+1}</sub> − B<sub>${si+1}</sub>·n = <b>${panelSpace.toFixed(2)} ม.</b> — ระยะรั้วต้องไม่ต่ำกว่า 0.5 เมตร`);
            segGeom.push({ A_i, leftOff, rightOff, boundsRel: [0, A_i], standardCount: 0, splitCount: 0, tooShort: true });
            cumulDist += A_i;
            const pts = [interp(linePoints, cumulDist - A_i), interp(linePoints, cumulDist)];
            L.polyline(pts, { color: '#f87171', weight: 4, opacity: 0.7, dashArray: '6,4' }).addTo(fenceLayerGroup);
            continue;
        }

        const calc = calcCowboyPanels(panelSpace, m);
        grandTotal += A_i;

        const absTicks = calc.ticks.map(t => ({
            dist: cumulDist + leftOff + t.pos,
            isSplit: t.isSplit
        }));

        const segStart = cumulDist;
        const panelStart = cumulDist + leftOff;
        const panelEnd = cumulDist + A_i - rightOff;
        const allBounds = [panelStart, ...absTicks.map(t => t.dist), panelEnd];

        const splitPanelFlags = [];
        for (let i = 0; i < allBounds.length - 1; i++) {
            splitPanelFlags.push(i >= calc.standardCount);
        }

        segGeom.push({
            A_i, leftOff, rightOff,
            boundsRel: allBounds.map(d => d - segStart),
            standardCount: calc.standardCount,
            splitCount: calc.splitCount
        });

        if (leftOff > 1e-4) {
            const pts = [];
            const steps = Math.max(2, Math.ceil(leftOff * 3));
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, segStart + leftOff * s / steps));
            L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        for (let i = 0; i < allBounds.length - 1; i++) {
            const d0 = allBounds[i], d1 = allBounds[i + 1];
            if (d1 - d0 < 1e-4) continue;
            const steps = Math.max(2, Math.ceil((d1 - d0) * 3));
            const pts = [];
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, d0 + (d1 - d0) * s / steps));
            L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        if (rightOff > 1e-4) {
            const pts = [];
            const steps = Math.max(2, Math.ceil(rightOff * 3));
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, panelEnd + rightOff * s / steps));
            L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        for (let ti = 0; ti < absTicks.length; ti++) {
            const tick = absTicks[ti];
            const pt = interp(linePoints, tick.dist);
            const b = bearingAt(linePoints, tick.dist);
            const isSplitPost = splitPanelFlags[ti] || splitPanelFlags[ti + 1];
            drawPost(pt, b, isSplitPost ? 'split' : 'normal');
        }

        if (!(doubleCorner && isCornerPoint(linePoints[si]))) {
            const startPt = interp(linePoints, cumulDist);
            const isCornerStart = (B_i >= 1 && si > 0) || (closed && si === 0);
            drawPost(startPt, bearingAt(linePoints, cumulDist + 0.01), isCornerStart ? 'corner' : 'endpoint');
        }

        totalPosts += calc.ticks.length + 1;
        totalBeams += calc.standardCount + calc.splitCount;
        cumulDist += A_i;
    }

    if (!closed) {
        const last = linePoints[linePoints.length - 1];
        const prev = linePoints[linePoints.length - 2];
        if (!(doubleCorner && isCornerPoint(last))) {
            drawPost(last, bearing(prev, last), 'endpoint');
            totalPosts++;
        }
    }

    return { grandTotal, totalPosts, totalBeams, warnings, segGeom };
}

function calcCowboy(cowboyLines, m_cowboy, n, useDoubleCorner, layers) {
    let grandTotal = 0, grandPosts = 0, grandBeams = 0;
    const allWarnings = [];

    buildCornerMap(cowboyLines.map(ld => ld.points));

    cowboyLines.forEach(ld => {
        const res = drawCowboyFence(ld.points, m_cowboy, n, true, useDoubleCorner, ld.color);
        grandTotal += res.grandTotal;
        grandPosts += res.totalPosts;
        grandBeams += res.totalBeams * layers;
        if (res.warnings) allWarnings.push(...res.warnings);
        // Plan Mode reuses this verbatim — no separate recalculation there.
        ld._cowboyPlanGeom = res.segGeom;
    });

    if (useDoubleCorner) {
        for (const [k, entry] of cornerMap.entries()) {
            const result = drawDoubleCornerPost(entry.pt, n, true);
            grandPosts += result.count;
        }
    }

    return { grandTotal, grandPosts, grandBeams, warnings: allWarnings };
}

// ============================================
// COWBOY FENCE — Plan Mode Drawing
// ============================================
function drawPlanCowboyLine(lineData, idx) {
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

    const m = parseFloat(document.getElementById('postSpacing')?.value) || 2.5;
    const n = parseFloat((document.getElementById('postSizeCowboy') || document.getElementById('imPostSizeCowboy'))?.value) || 0.15;

    // Reuse the exact geometry the map-mode calculation already produced
    // (see calcCowboy/drawCowboyFence in this file) — same panel boundaries,
    // same dual-corner shortening — rather than recalculating it here from
    // scratch. Falls back to a local calc only if that hasn't run yet.
    const geom = lineData._cowboyPlanGeom;

    let dAcc = 0;
    const numSegs = pts.length - 1;

    for (let i = 0; i < numSegs; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        const g = geom && geom[i];
        let poleDists, stdCount;
        if (g) {
            poleDists = g.boundsRel.slice();
            stdCount = g.standardCount;
        } else {
            poleDists = [0];
            let calc = null;
            if (segLen > 0.5) {
                calc = calcCowboyPanels(segLen, m);
                calc.ticks.forEach(t => poleDists.push(t.pos));
            }
            poleDists.push(segLen);
            stdCount = calc ? calc.standardCount : 1;
        }

        poleDists.forEach((dist, pIdx) => {
            const pt = interp(pts, dAcc + dist);
            const isTrueStart  = (i === 0 && pIdx === 0);
            const isTrueEnd    = (i === numSegs - 1 && pIdx === poleDists.length - 1);
            const isMidCorner  = (pIdx === poleDists.length - 1 && i < numSegs - 1);
            const isCornerSkip = (pIdx === 0 && i > 0);

            if (isCornerSkip) return;

            const isEndOfLine = isTrueStart || isTrueEnd || isMidCorner;

            // Any registered corner (an interior bend, or a point shared with
            // another line) is drawn exactly once by drawPlanCowboyCorners()
            // after all lines are drawn — using the same arm bearings, swap
            // state, and single/double mode as the map view. This is what
            // stops two lines sharing a corner from each drawing their own
            // rotated square on top of one another, and means plan mode has
            // no separate "side" of its own — it just mirrors the map.
            //
            // Test against the TRUE corner coordinate (this segment's own
            // endpoint, p0/p1) rather than `pt`: when a dual-corner offset
            // shortens the boundary inward, `pt` no longer sits exactly on
            // the corner, so checking `pt` itself would miss it.
            const cornerPt = (pIdx === 0) ? p0 : p1;
            if (isEndOfLine && typeof isCornerPoint === 'function' && isCornerPoint(cornerPt)) return;

            drawPlanPost(pt, b, isEndOfLine, n, 'cowboy');
        });

        // Standard-length panels repeat the same spacing, so only the first
        // one per side gets a dimension label — no need to re-label every
        // identical gap. Special panels (split panels near a corner) each
        // get their own label since their length genuinely differs.
        for (let j = 0; j < poleDists.length - 1; j++) {
            const isStandardPanel = j < stdCount;
            if (isStandardPanel && j > 0) continue;
            const sPt = interp(pts, dAcc + poleDists[j]);
            const ePt = interp(pts, dAcc + poleDists[j + 1]);
            drawDimLine(sPt, ePt, 0.25, hav(sPt, ePt).toFixed(2) + 'm', '#000');
        }
       drawDimLine(p0, p1, outwardOffset(pts, p0, p1, 0.55), segLen.toFixed(2) + 'm', '#000');

        // Only the FIRST post of this side gets its own footprint-length
        // label — every post is the same size, so repeating it per post was
        // just noise. Mirrored to the inner side (opposite the outward
        // length above).
        poleDists.slice(0, 1).forEach(dist => {
            drawPostLengthLabel(pts, dAcc + dist, n, '#000');
        });

        dAcc += segLen;
        
    }
    // Draw interior angle at every bend point (not at start/end endpoints)
    for (let i = 1; i < pts.length - 1; i++) {
        if (typeof drawPlanAngle === 'function') {
            drawPlanAngle(pts[i - 1], pts[i], pts[i + 1]);
        }
    }
}

// Draws a colored plan-mode post square (mirrors the map view's dual-corner
// pillar). Standalone/top-level so the unified corner pass below can use it.
function drawPlanColorPost(pt, b, color, n) {
    const scale = window._poleScale || 1.0;
    // Match the NORMAL post size factor (3), not the oversized corner-post
    // factor (5) — the two color posts sit close together at a corner, so
    // drawing them corner-sized made them overlap each other and the nearby
    // dimension line/label. Same footprint as a normal post, just outlined
    // in red/blue instead of white fill's usual dark border.
    const visualN = Math.max(n, 0.15) * scale * 3;
    const halfSz = visualN / 2;
    const corners = [
        offPt(offPt(pt, b + 90, halfSz), b,       halfSz),
        offPt(offPt(pt, b - 90, halfSz), b,       halfSz),
        offPt(offPt(pt, b - 90, halfSz), b + 180, halfSz),
        offPt(offPt(pt, b + 90, halfSz), b + 180, halfSz),
    ];
    L.polygon(corners, {
        color: color, weight: 2,
        fillColor: '#ffffff', fillOpacity: 1, opacity: 1
    }).addTo(planLayerGroup);
}

// ============================================
// COWBOY FENCE — Plan Mode: unified corner-post pass
// ============================================
// Draws every corner exactly once, reusing the SAME arm bearings, swap
// state (swappedCorners), and single/double mode (getCornerMode) as the
// map view. Plan mode has no swap button of its own — it always mirrors
// whichever side/orientation is currently set on the map (e.g. if the
// blue post sits on the vertical arm on the map, it sits on the vertical
// arm here too).
//
// Caller MUST have already called buildCornerMap(...) with the current
// set of visible cowboy lines, so cornerMap reflects exactly what's drawn.
function drawPlanCowboyCorners() {
    if (typeof cornerMap === 'undefined' || cornerMap.size === 0) return;
    const dualPillarCheckbox = document.getElementById('doubleCornerPost')
        || document.getElementById('imDoubleCornerPost');
    // The checkbox itself is now the single source of truth: in non-square
    // mode it's driven by the Mode 1 / Mode 2 radio (see
    // setCornerModeSelection in index.html) — checked means Mode 2 (dual
    // corner post, valid at any angle), unchecked means Mode 1 (single
    // post). No separate non-square override needed here anymore.
    const useDualPillar = dualPillarCheckbox ? dualPillarCheckbox.checked : false;
    const n = 0.15;
    for (const [, entry] of cornerMap.entries()) {
        const arms = entry.arms.slice(0, 2);
        if (arms.length < 2 || !useDualPillar) {
            // Single post: face the angle bisector instead of staying
            // axis-aligned, so it rotates to match non-square corners.
            let b = 0;
            if (arms.length >= 2) {
                const [armRed, armBlue] = getCornerArms(entry);
                b = bisectorBearing(armRed, armBlue);
            }
            drawPlanPost(entry.pt, b, true, n, 'cowboy');
            continue;
        }
        const [armRed, armBlue] = getCornerArms(entry);
        const theta = cornerAngle(armRed, armBlue);
        const mode = getCornerMode(entry.pt, theta);
        if (mode === 'single') {
            const b = bisectorBearing(armRed, armBlue);
            drawPlanPost(entry.pt, b, true, n, 'cowboy');
        } else {
            const offset = getDualCornerOffset(n, theta);
            const redPt = offPt(entry.pt, armRed, offset);
            const bluePt = offPt(entry.pt, armBlue, offset);
            drawPlanColorPost(redPt, 0, '#dc2626', n);
            drawPlanColorPost(bluePt, 0, '#2563eb', n);
            // Label the x offset from the true corner vertex to each post,
            // pushed to the outward side of each arm (away from the other
            // arm) so it doesn't land in the crowded notch between them.
            if (typeof drawDimLine === 'function') {
                const redSign = cornerDimOutwardSign(armRed, armBlue);
                const blueSign = cornerDimOutwardSign(armBlue, armRed);
                drawDimLine(entry.pt, redPt, redSign * 0.2, offset.toFixed(2) + 'm', '#dc2626');
                drawDimLine(entry.pt, bluePt, blueSign * 0.2, offset.toFixed(2) + 'm', '#2563eb');
            }
        }
    }
}