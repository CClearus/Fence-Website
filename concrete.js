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
    // Per-segment geometry, exactly as computed for the map — Plan Mode
    // reads this instead of recalculating panels/ticks itself, so it can
    // never drift from what the map actually draws (mirrors cowboy.js's
    // segGeom / _cowboyPlanGeom exactly).
    const segGeom = [];

    // A corner shortens BOTH of its arms — a single bisector post needs
    // clearance on both sides, and a dual (red+blue) post sits offset
    // along BOTH arms (see drawConcreteDoubleCornerPost), not just one.
    // (Mirrors the same fix already applied to cowboy.js.)

    for (let si = 0; si < numSegs; si++) {
        const p0 = linePoints[si], p1 = linePoints[si + 1];
        const A_i = hav(p0, p1);

        let B_i = 0;
        if (si > 0 || closed) B_i++;
        if (si < numSegs - 1 || closed) B_i++;

        const startIsDC = doubleCorner && isCornerPoint(p0);
        const endIsDC   = doubleCorner && isCornerPoint(p1);

        // Concrete's own corner-shortening — a separate function/system from
        // cowboy's, but the SAME calculation, copied over verbatim:
        //   - Non-square mode OFF ("plain duel"): assumes a square corner.
        //     Red sits AT the vertex (clears only n/2 along its own arm);
        //     blue sits a full post-width n further out along ITS OWN arm
        //     (clears n + n/2 along that arm). Which arm this call is
        //     shortening is passed in as armBearing, matched against the
        //     (swap-aware) red/blue arms.
        //   - Non-square mode ON: Mode 1 (single bisector post, n/2 on both
        //     arms) or Mode 2 (both arms offset by the angle formula), via
        //     getCornerMode. Never runs at the same time as the plain-duel
        //     branch above.
        function cornerShortenAmount(cornerPt, n, armBearing) {
            const entry = cornerMap.get(ptKey(cornerPt));
            if (!entry) return 0;
            const [a1, a2] = getCornerArms(entry); // a1 = armRed, a2 = armBlue
            const theta = cornerAngle(a1, a2);
            const nonSquareCb = document.getElementById('nonSquareModeConcrete') || document.getElementById('imNonSquareModeConcrete');
            const nonSquareActive = nonSquareCb ? nonSquareCb.checked : false;
            if (!nonSquareActive) {
                if (typeof armBearing === 'number') {
                    const angTo = (b) => { let d = Math.abs(((b - armBearing) % 360 + 360) % 360); if (d > 180) d = 360 - d; return d; };
                    const isBlueArm = angTo(a2) < angTo(a1);
                    return isBlueArm ? n + n / 2 : n / 2;
                }
                return n / 2; // fallback if the caller couldn't identify the arm
            }
            const mode = getCornerMode(cornerPt, theta, 'concrete');
            if (mode === 'single') return n / 2; // Mode 1: bisector post at vertex
            return getDualCornerOffset(n, theta); // Mode 2: posts offset by angle formula
        }

        const n_post = 0.15;
        const leftOff = startIsDC ? cornerShortenAmount(p0, n_post, bearing(p0, p1)) : 0;
        const rightOff = endIsDC ? cornerShortenAmount(p1, n_post, bearing(p1, p0)) : 0;
        const panelSpace = A_i - leftOff - rightOff;

if (panelSpace < 0.5) {
    warnings.push(`⚠️ ด้านที่ ${si + 1}: A<sub>${si+1}</sub> − B<sub>${si+1}</sub>·n = <b>${panelSpace.toFixed(2)} ม.</b> — ระยะรั้วต้องไม่ต่ำกว่า 0.5 เมตร`);
            segGeom.push({ A_i, leftOff, rightOff, boundsRel: [0, A_i], standardCount: 0, splitCount: 0, tooShort: true });
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

        const segStart = cumulDist;
        const panelStart = cumulDist + leftOff;
        const panelEnd   = cumulDist + A_i - rightOff;
        const allBounds  = [panelStart, ...absTicks.map(t => t.dist), panelEnd];

        segGeom.push({
            A_i, leftOff, rightOff,
            boundsRel: allBounds.map(d => d - segStart),
            standardCount: calc.standardCount,
            splitCount: calc.splitCount
        });

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

    return { grandTotal, totalPosts, totalBeams, warnings, segGeom };
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
        // Plan Mode reuses this verbatim — no separate recalculation there.
        ld._concretePlanGeom = res.segGeom;
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
    const k = ptKey(cornerPt);

    const nonSquareCb = document.getElementById('nonSquareModeConcrete') || document.getElementById('imNonSquareModeConcrete');
    const nonSquareActive = nonSquareCb ? nonSquareCb.checked : false;

    // Mode 1 / Mode 2 (non-square corners) — same math as cowboy, only
    // active while the "โหมดมุมไม่ตั้งฉาก" checkbox for concrete is on.
    if (nonSquareActive) {
        const mode = getCornerMode(cornerPt, theta, 'concrete');
        if (mode === 'single') {
            const bisect = bisectorBearing(armRed, armBlue);
            drawConcretePost(cornerPt, bisect, 'corner');
            if (addHoverMarkers) _addCornerModeToggle(cornerPt, 'single', theta, undefined, undefined, 'concrete');
            return { count: 1 };
        }
        // Mode 2 — same clearance-floor offset as cowboy's dual corner
        // (getDualCornerOffset, not the raw un-clamped cornerOffsetX), so
        // the two posts sit cleanly apart instead of overlapping.
        const offset = getDualCornerOffset(n > 0 ? n : 0.15, theta);
        const bisect = bisectorBearing(armRed, armBlue);
        const redPt  = offPt(cornerPt, armRed,  offset);
        const bluePt = offPt(cornerPt, armBlue, offset);
        drawConcretePost(redPt,  bisect, 'end');
        drawConcretePost(bluePt, bisect, 'start');
        if (addHoverMarkers) {
            _addCornerModeToggle(cornerPt, 'double', theta, armRed, armBlue, 'concrete');
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

    // ── Plain "duel" fence corner (square / 90°) ─────────────────────────
    // Own, self-contained code path for concrete — only runs when non-square
    // mode is OFF, so it always assumes a right-angle corner. Mirrors
    // cowboy's plain-duel branch exactly: the RED post sits ON the vertex,
    // rotated flush along ITS OWN arm (armRed) — the fence is "on the
    // line". The BLUE post sits one post-width (n) further out along ITS
    // OWN arm (armBlue), also rotated flush with that line, matching the
    // n / (n + n/2) clearance cornerShortenAmount already gives each arm.
    const blueBearing = forcedPerpendicularBearing(armRed, armBlue); // snap to nearest 90° for clean rendering
    const blueOffset = dualPostFootprint(n > 0 ? n : 0.15); // rendered post width — keeps red/blue touching, not overlapping
    const redPt  = cornerPt;
    const bluePt = offPt(cornerPt, blueBearing, blueOffset);

    drawConcretePost(redPt,  armRed,      'end');
    drawConcretePost(bluePt, blueBearing, 'start');

    if (addHoverMarkers) {
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

const n = parseFloat((document.getElementById('postSizeConcrete') || document.getElementById('imPostSizeConcrete'))?.value) || 0.15;
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

    // Reuse the exact geometry the map-mode calculation already produced
    // (see calcConcrete/drawConcreteFence above) — same panel boundaries,
    // same corner shortening (plain-duel AND Mode 1/Mode 2) — rather than
    // recalculating it here from scratch. This is what keeps Plan Mode's
    // dimension labels from drifting out of sync with what the map itself
    // draws. Falls back to a local calc only if that hasn't run yet.
    const geom = lineData._concretePlanGeom;

    const numSegs = pts.length - 1;
    let dAcc = 0;

    for (let i = 0; i < numSegs; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        const g = geom && geom[i];
        let tickDists, stdCount;
        if (g) {
            tickDists = g.boundsRel.slice();
            stdCount = g.standardCount;
        } else {
            // Fallback: no stored map geometry yet — recompute locally.
            const startIsDC = useDualPillar && isCornerPoint(p0);
            const endIsDC   = useDualPillar && isCornerPoint(p1);
            function cornerShortenAmount(cornerPt, armBearing) {
                const entry = cornerMap.get(ptKey(cornerPt));
                if (!entry) return 0;
                const [a1, a2] = getCornerArms(entry);
                const theta = cornerAngle(a1, a2);
                const nonSquareCb = document.getElementById('nonSquareModeConcrete') || document.getElementById('imNonSquareModeConcrete');
                const nonSquareActive = nonSquareCb ? nonSquareCb.checked : false;
                if (!nonSquareActive) {
                    if (typeof armBearing === 'number') {
                        const angTo = (bb) => { let d = Math.abs(((bb - armBearing) % 360 + 360) % 360); if (d > 180) d = 360 - d; return d; };
                        const isBlueArm = angTo(a2) < angTo(a1);
                        return isBlueArm ? n + n / 2 : n / 2;
                    }
                    return n / 2;
                }
                const mode = getCornerMode(cornerPt, theta, 'concrete');
                if (mode === 'single') return n / 2;
                return getDualCornerOffset(n, theta);
            }
            const leftOff  = startIsDC ? cornerShortenAmount(p0, bearing(p0, p1)) : 0;
            const rightOff = endIsDC   ? cornerShortenAmount(p1, bearing(p1, p0)) : 0;
            const panelSpace = Math.max(0, segLen - leftOff - rightOff);
            tickDists = [leftOff];
            stdCount = 1;
            if (panelSpace > 0.5) {
                const calc = calcConcretePanels(panelSpace, m);
                calc.ticks.forEach(t => tickDists.push(leftOff + t.pos));
                stdCount = calc.standardCount;
            }
            tickDists.push(segLen - rightOff);
        }

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

        // Only the FIRST post of this side gets its own footprint-length
        // label — every post is the same size, so repeating it per post
        // was just noise. Mirrored to the inner side (opposite the
        // outward length above).
        postDists.slice(0, 1).forEach(dist => {
            drawPostLengthLabel(pts, dAcc + dist, n, '#000');
        });

        dAcc += segLen;
    }
}

// Shared by concrete.js and cowboy.js (concrete.js loads first) — returns
// the bearing that bisects the angle between two arm bearings, so a
// single corner post can rotate to face non-square corners instead of
// staying axis-aligned.
function bisectorBearing(b1, b2) {
    b1 = ((b1 % 360) + 360) % 360;
    b2 = ((b2 % 360) + 360) % 360;
    let diff = b2 - b1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return ((b1 + diff / 2) % 360 + 360) % 360;
}

// Draws a colored plan-mode corner-post box for concrete, sized/rotated the
// same way as cowboy's drawPlanColorPost — kept as its own function (not
// shared) per concrete/cowboy staying separate systems.
function drawPlanConcreteColorPost(pt, armBearing, color) {
    const n = 0.15;
    const scale = window._poleScale || 1.0;
    const visualN = Math.max(n, 0.15) * scale * 3;
    const halfSz = visualN / 2;
    const b2 = ((armBearing % 360) + 360) % 360;
    const corners = [
        offPt(offPt(pt, b2 + 90, halfSz), b2,       halfSz),
        offPt(offPt(pt, b2 - 90, halfSz), b2,       halfSz),
        offPt(offPt(pt, b2 - 90, halfSz), b2 + 180, halfSz),
        offPt(offPt(pt, b2 + 90, halfSz), b2 + 180, halfSz),
    ];
    L.polygon(corners, {
        color, weight: 2,
        fillColor: '#ffffff', fillOpacity: 1, opacity: 1
    }).addTo(planLayerGroup);
}

function drawPlanConcreteCorners() {
    if (typeof cornerMap === 'undefined' || cornerMap.size === 0) return;

    const dualPillarCheckbox = document.getElementById('concreteDoubleCornerPost')
        || document.getElementById('doubleCornerPost');
    const nonSquareCheckbox = document.getElementById('nonSquareModeConcrete')
        || document.getElementById('imFreeAngleToggleConcrete');
    const mode2Radio = document.getElementById('cornerMode2Concrete') || document.getElementById('imCornerMode2Concrete');
    const nonSquareActive = !!(nonSquareCheckbox && nonSquareCheckbox.checked);

    // Mirrors drawPlanCowboyCorners exactly: while non-square mode is on,
    // whether the dual pillar renders comes from the Mode 2 radio, not the
    // (now-locked/greyed) checkbox; while it's off, the checkbox is
    // authoritative.
    const useDualPillar = nonSquareActive
        ? (mode2Radio ? mode2Radio.checked : false)
        : (dualPillarCheckbox ? dualPillarCheckbox.checked : false);

    const n = 0.15;

    for (const [, entry] of cornerMap.entries()) {
        const arms = entry.arms.slice(0, 2);

        if (arms.length < 2 || !useDualPillar) {
            const [armRed] = arms.length >= 2 ? getCornerArms(entry) : [arms[0].outward];
            drawPlanPost(entry.pt, armRed, true, n, 'concrete');
            continue;
        }

        const [armRed, armBlue] = getCornerArms(entry);
        const theta = cornerAngle(armRed, armBlue);

        if (nonSquareActive) {
            const mode = getCornerMode(entry.pt, theta, 'concrete');
            if (mode === 'single') {
                const b = bisectorBearing(armRed, armBlue);
                drawPlanPost(entry.pt, b, true, n, 'concrete');
                continue;
            }
            // Mode 2 — both posts offset along each arm by the angle
            // formula, sharing the SAME orientation (the bisector) instead
            // of each other's arm bearing, so they don't cross like a
            // pinwheel. Mirrors drawPlanCowboyCorners exactly.
            const offset = getDualCornerOffset(n, theta);
            const bisect = bisectorBearing(armRed, armBlue);
            const redPt  = offPt(entry.pt, armRed,  offset);
            const bluePt = offPt(entry.pt, armBlue, offset);
            drawPlanConcreteColorPost(redPt,  bisect, '#dc2626');
            drawPlanConcreteColorPost(bluePt, bisect, '#2563eb');
            if (typeof drawDimLine === 'function' && typeof cornerDimOutwardSign === 'function') {
                const redSign  = cornerDimOutwardSign(armRed,  armBlue);
                const blueSign = cornerDimOutwardSign(armBlue, armRed);
                drawDimLine(entry.pt, redPt,  redSign  * 0.2, offset.toFixed(2) + 'm', '#dc2626');
                drawDimLine(entry.pt, bluePt, blueSign * 0.2, offset.toFixed(2) + 'm', '#2563eb');
            }
        } else {
            // Plain "duel" (square-corner) layout — mirrors
            // drawConcreteDoubleCornerPost's plain-duel branch and
            // drawPlanCowboyCorners' else branch: red sits ON the vertex,
            // rotated flush with its own arm; blue sits one post-width out
            // along ITS OWN arm, rotated flush with that line.
            const scale = window._poleScale || 1.0;
            const renderOffset = Math.max(n, 0.15) * scale * 3;
            const blueBearing = (typeof forcedPerpendicularBearing === 'function')
                ? forcedPerpendicularBearing(armRed, armBlue)
                : armBlue;
            const redPt  = entry.pt;
            const bluePt = offPt(entry.pt, blueBearing, renderOffset);
            drawPlanConcreteColorPost(redPt,  armRed,     '#dc2626');
            drawPlanConcreteColorPost(bluePt, blueBearing, '#2563eb');
            if (typeof drawDimLine === 'function' && typeof cornerDimOutwardSign === 'function') {
                const blueSign = cornerDimOutwardSign(armBlue, armRed);
                drawDimLine(entry.pt, bluePt, blueSign * 0.2, n.toFixed(2) + 'm', '#2563eb');
            }
        }
    }
}