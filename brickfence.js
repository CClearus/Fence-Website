// ============================================
// BRICK FENCE — Calculation and Drawing
// ============================================

function drawBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLon = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid = [midLat, midLon];
    const perpB = segBearing + 90;
    const tickHalf = 0.65;
    
    const drawTick = (pt, color, weight) => {
        const t1 = offPt(pt, perpB, tickHalf);
        const t2 = offPt(pt, perpB + 180, tickHalf);
        L.polyline([t1, t2], { color, weight, opacity: 0.95, dashArray: null }).addTo(fenceLayerGroup);
        L.circleMarker(pt, { radius: 3, color, fillColor: color, fillOpacity: 1, weight: 1.5 }).addTo(fenceLayerGroup);
    };

    if (mode === 'top') {
        drawTick(mid, '#ea580c', 3);
    } else if (mode === 'center') {
        drawTick(mid, '#2563eb', 3);
    } else if (mode === 'center+top') {
        const offset = 0.32;
        drawTick(offPt(mid, segBearing, offset), '#ea580c', 3);
        drawTick(offPt(mid, segBearing + 180, offset), '#2563eb', 3);
    }
}

// ── "Cut corner" warning toast — same visual language as barbed wire's
// _showSharpAngleToast, but for a segment that's too short (after its
// corner pillars eat into it) to fit a real course of brick. ──
function _showBrickTooShortToast(count, totalLenSkipped) {
    const old = document.getElementById('brickTooShortToast');
    if (old) old.remove();
    if (window._brickShortToastTimer) clearTimeout(window._brickShortToastTimer);

    const toast = document.createElement('div');
    toast.id = 'brickTooShortToast';
    toast.innerHTML = `
        <span style="font-size:15px;line-height:1;">🧱</span>
        <span>พบช่วงรั้วอิฐที่สั้นเกินไป <strong>${count}</strong> ช่วง<br>
        รวมความยาวที่ข้ามไป <strong>${totalLenSkipped.toFixed(1)}</strong> ม.</span>
        <button onclick="document.getElementById('brickTooShortToast').remove()"
            style="background:none;border:none;cursor:pointer;font-size:16px;line-height:1;
            color:#92400e;padding:0;margin-left:4px;flex-shrink:0;">✕</button>
    `;
    toast.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:9999;
        display:flex; align-items:center; gap:10px;
        background:#fffbeb; border:1.5px solid #f59e0b;
        border-radius:10px; padding:10px 14px;
        box-shadow:0 4px 16px rgba(0,0,0,0.13);
        font-size:12px; color:#92400e; max-width:240px;
        animation: sharpToastIn 0.25s ease;
    `;
    document.body.appendChild(toast);

    if (!document.getElementById('sharpToastStyle')) {
        const s = document.createElement('style');
        s.id = 'sharpToastStyle';
        s.textContent = `@keyframes sharpToastIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`;
        document.head.appendChild(s);
    }

    window._brickShortToastTimer = setTimeout(() => {
        const t = document.getElementById('brickTooShortToast');
        if (t) {
            t.style.cssText += 'transition:opacity 0.4s;opacity:0;';
            setTimeout(() => { const t2 = document.getElementById('brickTooShortToast'); if (t2) t2.remove(); }, 400);
        }
    }, 6000);
}

// ── "Sharp corner" warning toast — same system as barbed wire's
// _showSharpAngleToast: a corner pillar alone can't take the lateral
// load of a <60° bend, so an extra pillar goes into cost/materials
// just before it (not rendered on the map). ──
function _showBrickSharpAngleToast(count, extraPosts, spacing) {
    const old = document.getElementById('brickSharpAngleToast');
    if (old) old.remove();
    if (window._brickSharpToastTimer) clearTimeout(window._brickSharpToastTimer);

    const toast = document.createElement('div');
    toast.id = 'brickSharpAngleToast';
    toast.innerHTML = `
        <span style="font-size:15px;line-height:1;">🔶</span>
        <span>พบมุม &lt;60° จำนวน <strong>${count}</strong> มุม<br>
        เพิ่มเสา <strong>${extraPosts}</strong> ต้น · เพิ่มระยะ <strong>${(extraPosts * spacing).toFixed(1)}</strong> ม.</span>
        <button onclick="document.getElementById('brickSharpAngleToast').remove()"
            style="background:none;border:none;cursor:pointer;font-size:16px;line-height:1;
            color:#92400e;padding:0;margin-left:4px;flex-shrink:0;">✕</button>
    `;
    toast.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:9999;
        display:flex; align-items:center; gap:10px;
        background:#fffbeb; border:1.5px solid #f59e0b;
        border-radius:10px; padding:10px 14px;
        box-shadow:0 4px 16px rgba(0,0,0,0.13);
        font-size:12px; color:#92400e; max-width:240px;
        animation: sharpToastIn 0.25s ease;
    `;
    document.body.appendChild(toast);

    if (!document.getElementById('sharpToastStyle')) {
        const s = document.createElement('style');
        s.id = 'sharpToastStyle';
        s.textContent = `@keyframes sharpToastIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`;
        document.head.appendChild(s);
    }

    window._brickSharpToastTimer = setTimeout(() => {
        const t = document.getElementById('brickSharpAngleToast');
        if (t) {
            t.style.cssText += 'transition:opacity 0.4s;opacity:0;';
            setTimeout(() => { const t2 = document.getElementById('brickSharpAngleToast'); if (t2) t2.remove(); }, 400);
        }
    }, 6000);
}

// Same corner-direction rule barbed wire's plan mode uses: a clean 90°
// bend faces straight through along the incoming line, anything else
// (any angle, all 360° of it) faces the bisector of the interior angle.
function _brickBisectorBearing(bIn, bOut) {
    let diff = ((bOut - bIn + 540) % 360) - 180;
    const interiorAngle = 180 - Math.abs(diff);
    if (Math.abs(interiorAngle - 90) < 5) return bIn;
    return (bIn + 180 + (((bOut - (bIn + 180) + 540) % 360) / 2)) % 360;
}

function calcBrick(brickLines) {
    let grandTotal = 0, grandPosts = 0, grandBeams = 0;
    const allWarnings = [];
    let totalTooShort = 0, totalTooShortLen = 0;
    let totalSharpAngles = 0, totalExtraSections = 0, totalExtraLength = 0;

    const readVal = (id1, id2, fallback) => {
        const el = document.getElementById(id1) || document.getElementById(id2);
        return parseFloat(el ? el.value : fallback) || parseFloat(fallback);
    };

    const d = readVal('imPostSpacingBrick', 'postSpacingBrick', '2.5');
    const h = readVal('brickFenceHeight', 'imBrickFenceHeight', '1.8');
    const brickPrice = readVal('brickPricePerPiece', 'imBrickPrice', '1.05');
    const ppm2 = readVal('brickPpm2', 'imBrickPpm2', '135');
    // Pillar footprint — used to shorten a segment where it meets a corner
    // pillar, so brick coursing stops at the pillar face instead of
    // overlapping it. Falls back to a sane default if no UI field exists.
    const n_post = Math.max(0.1, Math.min(0.4, readVal('imBrickPostSize', 'brickPostSize', '0.2')));
    const MIN_PANEL = Math.max(0.5, d * 0.2);

    let n_beam, beamMode;
    const beamSel = document.getElementById('imBrickBeamMode') || document.getElementById('brickBeamMode');
    const beamOverride = beamSel ? beamSel.value : 'auto';

    if (beamOverride === '0' || beamOverride === 'none') { n_beam = 0; beamMode = 'none'; }
    else if (beamOverride === 'top') { n_beam = 1; beamMode = 'top'; }
    else if (beamOverride === 'center') { n_beam = 1; beamMode = 'center'; }
    else if (beamOverride === 'center+top') { n_beam = 2; beamMode = 'center+top'; }
    else {
        if (h <= 1.2) { n_beam = 0; beamMode = 'none'; }
        else if (h < 1.8) { n_beam = 1; beamMode = 'top'; }
        else if (h < 2.2) { n_beam = 1; beamMode = 'center'; }
        else { n_beam = 2; beamMode = 'center+top'; }
    }

    let totalBrickArea = 0, totalBays = 0, totalSpacingSum = 0, segCount = 0;

    // ── 360°-aware corner map across ALL brick lines ──
    // Any bend within a line, or a point shared between two different brick
    // lines, is registered here exactly once — this is what lets an L- or
    // U-shaped brick fence drawn as several lines still behave like one
    // continuous fence with real pillars at its shared corners, at any
    // angle, instead of only ever meeting other brick lines at 90°.
    buildCornerMap(brickLines.map(ld => ld.points));

    const isBrickCorner = (pt) => {
        if (typeof cornerMap === 'undefined') return false;
        const entry = cornerMap.get(ptKey(pt));
        return !!(entry && entry.arms && entry.arms.length >= 2);
    };
    const cornerShortenAmount = (pt) => isBrickCorner(pt) ? n_post / 2 : 0;

    brickLines.forEach((ld, lineIdx) => {
        const pts = ld.points;
        const numSegs = pts.length - 1;
        let cumulDist = 0;
        let linePosts = 0;
        const segGeomList = [];

        // ── Sharp (<60°) intermediate corners — same rule barbed wire
        // uses. A brick corner pillar already sits at the vertex itself
        // (drawn in the unified corner-pillar pass below), but a bend
        // this tight still needs an extra pillar's worth of material
        // just before it to take the lateral load. ──
        function interiorAngleAt(i) {
            if (i <= 0 || i >= pts.length - 1) return 180;
            const bIn = bearing(pts[i - 1], pts[i]);
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

        for (let si = 0; si < numSegs; si++) {
            const p0 = pts[si], p1 = pts[si + 1];
            const A_i = hav(p0, p1);
            const segB = bearing(p0, p1);

            const leftOff = cornerShortenAmount(p0);
            const rightOff = cornerShortenAmount(p1);
            const panelSpace = A_i - leftOff - rightOff;
            segCount++;

            // ── Cut corner: the fence here is too small to fit a real
            // course of brick between its two corner pillars. Flag it and
            // skip building it — it's marked with a dashed warning line
            // instead of counting as built fence, exactly like a too-short
            // panel does for cowboy fence. ──
            if (panelSpace < MIN_PANEL) {
                allWarnings.push(`⚠️ กำแพงอิฐ เส้นที่ ${lineIdx + 1} ด้านที่ ${si + 1}: เหลือระยะก่อสร้างจริง ${panelSpace.toFixed(2)} ม. สั้นเกินไป (ต้องไม่ต่ำกว่า ${MIN_PANEL.toFixed(2)} ม.) — ข้ามช่วงนี้`);
                segGeomList.push({ A_i, leftOff, rightOff, bounds: [0, A_i], tooShort: true, dPrime: 0, r_i: 0 });
                totalTooShort++; totalTooShortLen += A_i;

                const dashSteps = Math.max(2, Math.ceil(A_i * 3));
                const dashPts = [];
                for (let s = 0; s <= dashSteps; s++) dashPts.push(interp(pts, cumulDist + A_i * s / dashSteps));
                L.polyline(dashPts, { color: '#f87171', weight: 4, opacity: 0.7, dashArray: '6,4' }).addTo(fenceLayerGroup);

                if (!isBrickCorner(p0)) { drawPost(p0, segB, 'endpoint'); linePosts++; }
                if (si === numSegs - 1 && !isBrickCorner(p1)) { drawPost(p1, segB, 'endpoint'); linePosts++; }

                cumulDist += A_i;
                continue;
            }

            grandTotal += A_i;

            const r_i = Math.ceil(panelSpace / d);
            const dPrime = panelSpace / r_i;

            totalBays += r_i;
            totalSpacingSum += panelSpace;
            totalBrickArea += panelSpace * h;
            linePosts += Math.max(0, r_i - 1); // interior bay-boundary pillars only

            // Draw the whole built wall — corner stub(s) + main coursing —
            // as one continuous line; only the bay boundaries below differ.
            const wholeSteps = Math.max(2, Math.ceil(A_i * 4));
            const wallPts = [];
            for (let s = 0; s <= wholeSteps; s++) wallPts.push(interp(pts, cumulDist + A_i * s / wholeSteps));
            L.polyline(wallPts, { color: ld.color || '#b45309', weight: 5, opacity: 0.85 }).addTo(fenceLayerGroup);

            let cursor = cumulDist + leftOff;
            for (let bi = 0; bi < r_i; bi++) {
                const ptStart = interp(pts, cursor);
                const ptEnd = interp(pts, cursor + dPrime);
                if (bi > 0) drawPost(ptStart, segB, 'normal'); // bi===0 sits on the corner pillar — drawn once, below
                if (beamMode !== 'none') drawBeamSymbol(ptStart, ptEnd, segB, beamMode);
                cursor += dPrime;
            }

            // Genuinely free (non-corner) line endpoints still need their
            // own pillar drawn here — an open end of a line was never
            // registered in the corner map at all.
            if (!isBrickCorner(p0)) { drawPost(interp(pts, cumulDist), segB, 'endpoint'); linePosts++; }
            if (si === numSegs - 1 && !isBrickCorner(p1)) { drawPost(interp(pts, cumulDist + A_i), segB, 'endpoint'); linePosts++; }

            // Bounds used by Plan Mode for labeling: [0, leftOff, ...main
            // bay boundaries..., A_i-rightOff, A_i]. The 0→leftOff and
            // (A_i-rightOff)→A_i pieces are the corner stubs — genuinely
            // different lengths from the repeating d-spaced bays.
            const bounds = [0, leftOff];
            for (let bi = 1; bi < r_i; bi++) bounds.push(leftOff + bi * dPrime);
            bounds.push(A_i - rightOff, A_i);
            segGeomList.push({ A_i, leftOff, rightOff, bounds, tooShort: false, dPrime, r_i });

            cumulDist += A_i;
        }

        // ── Extra reinforcement pillar at each sharp corner (cost/material
        // only — not drawn on the map). ──
        let extraPosts = 0, extraLength = 0;
        sharpCorners.forEach(({ idx, dist }) => {
            const extraDist = Math.max(0, dist - d);
            if (extraDist > 1e-3) {
                extraPosts++; extraLength += d;
            }
        });
        linePosts += extraPosts;
        grandTotal += extraLength;
        totalSharpAngles += sharpCorners.length;
        totalExtraSections += extraPosts;
        totalExtraLength += extraLength;

        grandPosts += linePosts;
        // Plan Mode reuses this verbatim — same corner-shortened bounds,
        // same too-short flags — instead of recalculating spacing itself.
        ld._brickPlanGeom = segGeomList;
    });

    // ── Unified corner-pillar pass ──
    // Draw every registered corner exactly once (a bend within a line, or a
    // point shared between two different brick lines), oriented to the
    // bisector of its two arms — straight through at a clean 90°, angled
    // otherwise, at any angle around the full 360°.
    if (typeof cornerMap !== 'undefined') {
        for (const [, entry] of cornerMap.entries()) {
            if (!entry.arms || entry.arms.length < 2) continue;
            const a1 = entry.arms[0].outward, a2 = entry.arms[1].outward;
            const bIn = (a1 + 180) % 360;
            const b = _brickBisectorBearing(bIn, a2);
            drawPost(entry.pt, b, 'corner');
            grandPosts++;
        }
    }

    if (totalTooShort > 0) {
        _showBrickTooShortToast(totalTooShort, totalTooShortLen);
    }
    if (totalSharpAngles > 0) {
        _showBrickSharpAngleToast(totalSharpAngles, totalExtraSections, d);
    }

    const brickCount = totalBrickArea * ppm2;
    const beamCount = totalBays * n_beam;
    grandBeams += beamCount;

    window._brickCalcResult = { 
        totalPrice: brickCount * brickPrice,
        brickCount: brickCount,
        totalBays: totalBays,
        avgSpacing: totalBays > 0 ? totalSpacingSum / totalBays : d,
        beamCount: beamCount,
        n_beam, beamMode, h,
        tooShortCount: totalTooShort,
        tooShortLength: totalTooShortLen,
        sharpAngleCount: totalSharpAngles,
        sharpAngleExtraPosts: totalExtraSections,
        sharpAngleExtraLength: totalExtraLength
    };

    return { grandTotal, grandPosts, grandBeams, warnings: allWarnings, hasBrick: true };
}

// ============================================
// BRICK FENCE — Plan Mode Drawing
// ============================================
function _drawPlanBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLon = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid = [midLat, midLon];
    const perpB = segBearing + 90;
    const tickHalf = 0.28;
    
    const drawTick = (pt, color, dashed) => {
        const t1 = offPt(pt, perpB, tickHalf);
        const t2 = offPt(pt, perpB + 180, tickHalf);
        L.polyline([t1, t2], { color, weight: 2.5, opacity: 0.95, dashArray: dashed ? '4,3' : null }).addTo(planLayerGroup);
        L.circleMarker(pt, { radius: 2.5, color, fillColor: color, fillOpacity: 1, weight: 1.5 }).addTo(planLayerGroup);
    };

    if (mode === 'top') {
        drawTick(mid, '#ea580c', false);
    } else if (mode === 'center') {
        drawTick(mid, '#d97706', true);
    } else if (mode === 'center+top') {
        const offset = 0.28;
        const ptA = offPt(mid, segBearing, offset);
        const ptB = offPt(mid, segBearing + 180, offset);
        drawTick(ptA, '#d97706', true);
        drawTick(ptB, '#ea580c', false);
    }
}

function drawPlanBrickLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;

    const d = Math.min(5, Math.max(0.5, parseFloat((document.getElementById('imPostSpacingBrick') || document.getElementById('postSpacingBrick'))?.value) || 2.5));
    const h = parseFloat((document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value) || 1.8;
    const n_post = Math.max(0.1, Math.min(0.4, parseFloat((document.getElementById('imBrickPostSize') || document.getElementById('brickPostSize'))?.value) || 0.2));
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

    // Reuse the exact geometry the map-mode calculation already produced —
    // same corner-shortened bounds, same too-short flags — rather than
    // recalculating spacing here from scratch (mirrors cowboy fence's
    // drawPlanCowboyLine / _cowboyPlanGeom pattern), so plan mode can never
    // drift from what the map actually built.
    const geom = lineData._brickPlanGeom;

    let cumulDist = 0;
    const numSegs = pts.length - 1;

    for (let si = 0; si < numSegs; si++) {
        const p0 = pts[si], p1 = pts[si + 1];
        const A_i = hav(p0, p1);
        const segB = bearing(p0, p1);
        const g = geom && geom[si];

        let leftOff = 0, rightOff = 0, dPrime = d, r_i = Math.max(1, Math.ceil(A_i / d)), bounds, tooShort = false;
        if (g) {
            leftOff = g.leftOff; rightOff = g.rightOff; dPrime = g.dPrime; r_i = g.r_i;
            bounds = g.bounds; tooShort = g.tooShort;
        } else {
            // Fallback if map-mode geometry hasn't run yet — no corner
            // shortening info available, so treat the whole segment as one
            // block of standard bays.
            r_i = Math.max(1, Math.ceil(A_i / d));
            dPrime = A_i / r_i;
            bounds = [0];
            for (let bi = 1; bi < r_i; bi++) bounds.push(bi * dPrime);
            bounds.push(A_i);
        }

        if (tooShort) {
            const dashSteps = Math.max(2, Math.ceil(A_i * 3));
            const dashPts = [];
            for (let s = 0; s <= dashSteps; s++) dashPts.push(interp(pts, cumulDist + A_i * s / dashSteps));
            L.polyline(dashPts, { color: '#f87171', weight: 4, opacity: 0.7, dashArray: '6,4' }).addTo(planLayerGroup);
            drawDimLine(p0, p1, outwardOffset(pts, p0, p1, 1.4), A_i.toFixed(2) + 'm (สั้นเกินไป)', '#dc2626');
            cumulDist += A_i;
            continue;
        }

        const wallSteps = Math.max(2, Math.ceil(A_i * 4));
        const wallPts = [];
        for (let s = 0; s <= wallSteps; s++) wallPts.push(interp(pts, cumulDist + A_i * s / wallSteps));
        L.polyline(wallPts, { color: '#92400e', weight: 5, opacity: 1 }).addTo(planLayerGroup);

        // Interior bay pillars — true ends / corners are drawn once below.
        for (let bi = 1; bi < r_i; bi++) {
            const dist = leftOff + bi * dPrime;
            drawPlanPost(interp(pts, cumulDist + dist), segB, false, 0.15, 'brick');
        }

        if (beamMode !== 'none') {
            let cursor = cumulDist + leftOff;
            for (let bi = 0; bi < r_i; bi++) {
                const ptStart = interp(pts, cursor);
                const ptEnd = interp(pts, cursor + dPrime);
                _drawPlanBeamSymbol(ptStart, ptEnd, segB, beamMode);
                cursor += dPrime;
            }
        }

        // True free ends of the line (always drawn — a shared corner with
        // another brick line is separately drawn by that line's own corner
        // pass below, same as barbed wire never de-duplicating shared
        // endpoints across lines).
        if (si === 0) drawPlanPost(interp(pts, cumulDist), segB, true, 0.15, 'brick');
        if (si === numSegs - 1) drawPlanPost(interp(pts, cumulDist + A_i), segB, true, 0.15, 'brick');

        // ── Dimension labels ──
        // Standard d-spaced bays repeat identically, so only the FIRST one
        // per side gets a label. Corner stub segments (the leftover bit
        // between a corner pillar and the first/last full bay) are a
        // genuinely different length, so each one always gets its own
        // label — same "label every special segment, once per repeat"
        // rule cowboy fence uses for its split panels.
        let labeledStandard = false;
        for (let bi = 0; bi < bounds.length - 1; bi++) {
            const from = bounds[bi], to = bounds[bi + 1];
            const len = to - from;
            if (len < 1e-4) continue;
            const isStub = Math.abs(len - dPrime) > 0.01;
            if (!isStub) {
                if (labeledStandard) continue;
                labeledStandard = true;
            }
            const sPt = interp(pts, cumulDist + from);
            const ePt = interp(pts, cumulDist + to);
            drawDimLine(sPt, ePt, 0.3, len.toFixed(2) + 'm', '#92400e');
        }

drawDimLine(p0, p1, outwardOffset(pts, p0, p1, 1.4), A_i.toFixed(2) + 'm', '#92400e');

        // First 2 post footprint-length labels for this side (bounds[0] is
        // the start, bounds[1] the first bay boundary), mirrored to the
        // inner side (opposite the outward full-length label above).
        [bounds[0], bounds[1]].filter(v => v !== undefined).slice(0, 2).forEach(dist => {
            drawPostLengthLabel(pts, cumulDist + dist, n_post, '#92400e');
        });

        cumulDist += A_i;
    }

    // ── Corner pillars — same direction rule as barbed wire's plan mode:
    // a clean 90° bend faces straight through, any other angle (anywhere
    // in the full 360°) faces the bisector of the interior angle. ──
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1], vertex = pts[i], next = pts[i + 1];
        const bIn = bearing(prev, vertex), bOut = bearing(vertex, next);
        const postBearing = _brickBisectorBearing(bIn, bOut);
        drawPlanPost(vertex, postBearing, true, 0.15, 'brick');
    }
}