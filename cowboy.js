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
    return cornerOffsetX(n, theta);      // double post — full geometry-correct offset
}

const startIsDC = doubleCorner && isCornerPoint(p0) && blueArmFacesInto(p0, p1);
const endIsDC = doubleCorner && isCornerPoint(p1) && blueArmFacesInto(p1, p0);

const n_post = 0.15; // post size in metres
const leftOff = startIsDC ? cornerShortenAmount(p0, n_post) : 0;
const endsAtDC = doubleCorner && isCornerPoint(p1);
const rightOff = endIsDC ? cornerShortenAmount(p1, n_post) : 0;
        const panelSpace = A_i - leftOff - rightOff;

        if (panelSpace < 0.5) {
            warnings.push(`ด้านยาว ${A_i.toFixed(2)}m สั้นเกินไป`);
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

    return { grandTotal, totalPosts, totalBeams, warnings };
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
    const n = 0.15;

    const dualPillarCheckbox = document.getElementById('doubleCornerPost')
        || document.getElementById('imDoubleCornerPost');
    const fenceOpts = lineData.fenceOptions || {};
    const useDualPillar = fenceOpts.doubleCorner
        ?? (dualPillarCheckbox ? dualPillarCheckbox.checked : false);

    const gap = (typeof DOUBLE_CORNER_OFFSET !== 'undefined' && DOUBLE_CORNER_OFFSET > 0)
        ? DOUBLE_CORNER_OFFSET : 0.3;

    // Draw a colored plan-mode post square (mirrors drawDoubleCornerPost's drawColorSquare)
    function drawPlanColorPost(pt, b, color) {
        const scale = window._poleScale || 1.0;
        const halfSz = Math.max(n, 0.15) * scale * 5;
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

    let dAcc = 0;
    const numSegs = pts.length - 1;

    for (let i = 0; i < numSegs; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        const b = bearing(p0, p1);

        let poleDists = [0];
        if (segLen > 0.5) {
            const calc = calcCowboyPanels(segLen, m);
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

            if (useDualPillar && isTrueStart) {
                // Start: RED at point (corner end), BLUE offset forward along fence
                drawPlanColorPost(pt,                   b, '#dc2626');
                drawPlanColorPost(offPt(pt, b, gap),    b, '#2563eb');

            } else if (useDualPillar && isTrueEnd) {
                // End: RED at point (corner end), BLUE offset back along fence
                drawPlanColorPost(pt,                            b, '#dc2626');
                drawPlanColorPost(offPt(pt, (b + 180) % 360, gap), b, '#2563eb');

            } else if (useDualPillar && isMidCorner) {
                const nextB = bearing(pts[i + 1], pts[i + 2]);
                // Mid-corner: RED at corner point (arriving), BLUE offset forward along next segment
                drawPlanColorPost(pt,                        b,     '#dc2626');
                drawPlanColorPost(offPt(pt, nextB, gap),     nextB, '#2563eb');

            } else {
                const isCorner = isTrueStart || isTrueEnd || isMidCorner;
                drawPlanPost(pt, b, isCorner, n, 'cowboy');
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