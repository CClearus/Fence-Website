// ============================================
// CONCRETE FENCE — Calculation and Drawing
// ============================================

function drawConcretePost(latlng, b, type) {
    const userScale = window._poleScale || 1.0;

    const isEndCap = (type === 'start' || type === 'end');
    const isCorner = (type === 'corner' || type === 'endpoint');
    const SCALE = (isCorner ? 1.6 : 5.4) * userScale;

    const halfAlong  = (0.15 * SCALE) / 2;
    const halfAcross = (0.15 * SCALE) / 2;
    const outColor   = '#1f2937';

if (isEndCap) {
    const iconPx = 32 * SCALE / 5.4;
    const iconUrl = (type === 'start') ? 'start.png' : 'end.png';
    // PNG channel is at top (0°). We need channel to face INTO the fence,
    // so rotate by bearing + 180 to flip it inward.
    const rot = ((b + 180) % 360 + 360) % 360;

    const capMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<img src="${iconUrl}" style="width:${iconPx}px;height:${iconPx}px;transform:translate(-50%,-50%) rotate(${rot}deg);position:absolute;left:50%;top:50%;">`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }),
        zIndexOffset: 99999
    }).addTo(fenceLayerGroup);
    capMarker.setZIndexOffset(99999);
    capMarker.bringToFront?.();
} else {
        // plain box for normal/split posts
        const fillColor = '#ffffff';
        const webRect = [
            offPt(offPt(latlng, b,       halfAlong), b + 90,  halfAcross),
            offPt(offPt(latlng, b,       halfAlong), b - 90,  halfAcross),
            offPt(offPt(latlng, b + 180, halfAlong), b - 90,  halfAcross),
            offPt(offPt(latlng, b + 180, halfAlong), b + 90,  halfAcross),
        ];
        L.polygon(webRect, { color: outColor, weight: 1.5, fillColor, fillOpacity: 1, opacity: 1 }).addTo(fenceLayerGroup);
    }
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

const n_post = 0.15;
const leftOff = startIsDC
    ? (() => {
        const entry = cornerMap.get(ptKey(p0));
        const [a1, a2] = entry ? getCornerArms(entry) : [0, 0];
        return cornerOffsetX(n_post, cornerAngle(a1, a2));
    })()
    : 0;
const rightOff = endIsDC
    ? (() => {
        const entry = cornerMap.get(ptKey(p1));
        const [a1, a2] = entry ? getCornerArms(entry) : [0, 0];
        return cornerOffsetX(n_post, cornerAngle(a1, a2));
    })()
    : 0;
        const panelSpace = A_i - leftOff - rightOff;

        if (panelSpace < 0.5) {
            warnings.push(`ด้านยาว ${A_i.toFixed(2)}m สั้นเกินไป`);
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
            postIndex++;
            const startType = (si === 0) ? 'start' : (postIndex % 2 === 0 ? 'normal' : 'split');
            const startBearing = (si === 0)
    ? bearing(linePoints[1], linePoints[0])   // outward: away from fence
    : bearingAt(linePoints, cumulDist + 0.01);
drawConcretePost(startPt, startBearing, startType);
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

    const userScale = window._poleScale || 1.0;
    const iconPx = 24 * userScale;

    if (mode === 'single') {
        const bisect = (armRed + armBlue) / 2;
        drawConcretePost(cornerPt, bisect, 'corner');
        if (addHoverMarkers) _addCornerModeToggle(cornerPt, 'single', theta);
        return { count: 1 };
    }

    // double mode — geometry-correct offset
    const offset = cornerOffsetX(n > 0 ? n : 0.15, theta);

    const rotRed = ((armRed % 360) + 360) % 360;
    L.marker(cornerPt, {
        icon: L.divIcon({
            className: '',
            html: `<img src="end.png" style="width:${iconPx}px;height:${iconPx}px;transform:translate(-50%,-50%) rotate(${rotRed}deg);position:absolute;left:50%;top:50%;">`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        }),
        zIndexOffset: 99999
    }).addTo(fenceLayerGroup);

    const rotBlue = ((armBlue % 360) + 360) % 360;
    const bluePt = offPt(cornerPt, armBlue, offset);
    L.marker(bluePt, {
        icon: L.divIcon({
            className: '',
            html: `<img src="start.png" style="width:${iconPx}px;height:${iconPx}px;transform:translate(-50%,-50%) rotate(${rotBlue}deg);position:absolute;left:50%;top:50%;">`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        }),
        zIndexOffset: 99999
    }).addTo(fenceLayerGroup);

    if (addHoverMarkers) {
        _addCornerModeToggle(cornerPt, 'double', theta);
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
        || parseFloat(document.getElementById('imPostSpacingConcrete')?.value)
        || parseFloat(document.getElementById('imSpacingSelectConcrete')?.value)
        || 2.5;

    // Read dual-pillar from concrete-specific checkbox (with cowboy fallback)
    const dualPillarCheckbox = document.getElementById('concreteDoubleCornerPost')
        || document.getElementById('doubleCornerPost');
    const useDualPillar = fenceOpts.doubleCorner
        ?? (dualPillarCheckbox ? dualPillarCheckbox.checked : false);

    const n = 0.15;
    const userScale = window._poleScale || 1.0;
    const iconPx = Math.max(40, 32 * userScale); // bigger so side-by-side pair is visible

    function drawPlanConcreteIcon(pt, iconUrl, rot) {
        L.marker(pt, {
            icon: L.divIcon({
                className: '',
                html: `<img src="${iconUrl}" style="width:${iconPx}px;height:${iconPx}px;transform:translate(-50%,-50%) rotate(${rot}deg);position:absolute;left:50%;top:50%;">`,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
            }),
            zIndexOffset: 99999
        }).addTo(planLayerGroup);
    }

    // Draw a matched end+start pair side-by-side at a corner/endpoint.
    // pt        = corner location
    // inB       = bearing of the segment ARRIVING at pt (the "closing" side)
    // outB      = bearing of the segment LEAVING pt (the "opening" side)
    //             Pass inB === outB for a true line-end (only one arm).
    function drawDualPair(pt, inB, outB) {
        // end.png faces INTO the arriving segment (channel toward inB reversed)
        const rotEnd   = ((inB + 180) % 360 + 360) % 360;
        // start.png faces INTO the departing segment (channel toward outB)
        const rotStart = ((outB % 360) + 360) % 360;
        // Offset the two icons along the fence line so they sit beside each other
        const gap = DOUBLE_CORNER_OFFSET > 0 ? DOUBLE_CORNER_OFFSET : 0.3;
        const ptEnd   = offPt(pt, inB,  gap / 2); // slide back along arriving arm
        const ptStart = offPt(pt, outB, gap / 2); // slide forward along departing arm
        drawPlanConcreteIcon(ptEnd,   'end.png',   rotEnd);
        drawPlanConcreteIcon(ptStart, 'start.png', rotStart);
    }

    const numSegs = pts.length - 1;
    let dAcc = 0;

    for (let i = 0; i < numSegs; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        let poleDists = [0];
        if (segLen > 0.5) {
            const calc = calcConcretePanels(segLen, m);
            calc.ticks.forEach(t => poleDists.push(t.pos));
        }
        poleDists.push(segLen);

        poleDists.forEach((dist, pIdx) => {
            const pt = interp(pts, dAcc + dist);
            const isTrueStart  = (i === 0 && pIdx === 0);
            const isTrueEnd    = (i === numSegs - 1 && pIdx === poleDists.length - 1);
            const isMidCorner  = (pIdx === poleDists.length - 1 && i < numSegs - 1);
            const isCornerSkip = (pIdx === 0 && i > 0);

            if (isCornerSkip) return;

            if (isTrueStart) {
                if (useDualPillar) {
                    // Line start: arriving from nowhere, departing along b
                    // Show end.png (the "closed" cap) + start.png (open into fence)
                    drawDualPair(pt, (b + 180) % 360, b);
                } else {
                    drawPlanPost(pt, b, true, n, 'concrete');
                }

            } else if (isTrueEnd) {
                if (useDualPillar) {
                    // Line end: arriving along b, no departure
                    drawDualPair(pt, b, (b + 180) % 360);
                } else {
                    drawPlanPost(pt, b, true, n, 'concrete');
                }

            } else if (isMidCorner) {
                if (useDualPillar) {
                    const nextB = bearing(pts[i + 1], pts[i + 2]);
                    // Corner: arriving along b, departing along nextB
                    drawDualPair(pt, b, nextB);
                } else {
                    drawPlanPost(pt, b, true, n, 'concrete');
                }

            } else {
                drawPlanPost(pt, b, false, n, 'concrete');
            }
        });

        for (let j = 0; j < poleDists.length - 1; j++) {
            const sPt = interp(pts, dAcc + poleDists[j]);
            const ePt = interp(pts, dAcc + poleDists[j + 1]);
            drawDimLine(sPt, ePt, 0.25, hav(sPt, ePt).toFixed(2) + 'm', '#000');
        }
        drawDimLine(p0, p1, 0.55, segLen.toFixed(2) + 'm', '#000');
        dAcc += segLen;
    }
}