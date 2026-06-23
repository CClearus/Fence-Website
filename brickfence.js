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

function calcBrick(brickLines) {
    let grandTotal = 0, grandPosts = 0, grandBeams = 0;
    const allWarnings = [];

    const readVal = (id1, id2, fallback) => {
        const el = document.getElementById(id1) || document.getElementById(id2);
        return parseFloat(el ? el.value : fallback) || parseFloat(fallback);
    };

    const d = readVal('postSpacingBrick', 'imPostSpacingBrick', '2.5');
    const h = readVal('brickFenceHeight', 'imBrickFenceHeight', '1.8');
    const brickPrice = readVal('brickPricePerPiece', 'imBrickPrice', '1.05');
    const ppm2 = readVal('brickPpm2', 'imBrickPpm2', '135');

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

    let totalBrickArea = 0, totalBays = 0, totalSpacingSum = 0, totalPillarCount = 0, segCount = 0;
    buildCornerMap(brickLines.map(ld => ld.points));

    brickLines.forEach(ld => {
        const pts = ld.points;
        const numSegs = pts.length - 1;
        let cumulDist = 0;

        for (let si = 0; si < numSegs; si++) {
            const p0 = pts[si], p1 = pts[si + 1];
            const A_i = hav(p0, p1);
            grandTotal += A_i;

const r_i = Math.ceil(A_i / d);
const dPrime = A_i / r_i;
const gaps = [];
for (let i = 0; i < r_i; i++) gaps.push(dPrime);

            totalBays += gaps.length;
            totalSpacingSum += A_i;
            totalPillarCount += gaps.length + 1;
            totalBrickArea += A_i * h;
            segCount++;

            const segB = bearing(p0, p1);
            const steps = Math.max(2, Math.ceil(A_i * 4));
            const linePts = [];
            for (let s = 0; s <= steps; s++) linePts.push(interp(pts, cumulDist + A_i * s / steps));
            
            L.polyline(linePts, { color: ld.color || '#b45309', weight: 5, opacity: 0.85 }).addTo(fenceLayerGroup);

            let cursor = cumulDist;
            for (let bi = 0; bi < gaps.length; bi++) {
                const ptStart = interp(pts, cursor);
                const ptEnd = interp(pts, cursor + gaps[bi]);

                drawPost(ptStart, segB, (si === 0 && bi === 0) ? 'endpoint' : 'normal');
                if (beamMode !== 'none') drawBeamSymbol(ptStart, ptEnd, segB, beamMode);
                cursor += gaps[bi];
            }
            drawPost(interp(pts, cumulDist + A_i), segB, si === numSegs - 1 ? 'endpoint' : 'normal');
            cumulDist += A_i;
        }
        grandPosts += totalPillarCount;
    });

    const brickCount = totalBrickArea * ppm2;
    const beamCount = totalBays * n_beam;
    grandBeams += beamCount;

    window._brickCalcResult = { 
        totalPrice: brickCount * brickPrice,
        brickCount: brickCount,
        totalBays: totalBays,
        avgSpacing: segCount > 0 ? totalSpacingSum / totalBays : d,
        beamCount: beamCount,
        n_beam, beamMode, h
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
    
    const d = parseFloat((document.getElementById('postSpacingBrick') || document.getElementById('imPostSpacingBrick'))?.value) || 2.5;
    const h = parseFloat((document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value) || 1.8;
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

const r_i = Math.ceil(A_i / d);
const dPrime = A_i / r_i;
const gaps = [];
for (let i = 0; i < r_i; i++) gaps.push(dPrime);

        const steps = Math.max(2, Math.ceil(A_i * 4));
        const wallPts = [];
        for (let s = 0; s <= steps; s++) wallPts.push(interp(pts, cumulDist + A_i * s / steps));
        L.polyline(wallPts, { color: '#92400e', weight: 5, opacity: 1 }).addTo(planLayerGroup);

        const pillarPositions = [];
        let cursor = cumulDist;
        for (let bi = 0; bi < gaps.length; bi++) {
            const distStart = cursor;
            const distEnd = cursor + gaps[bi];
            const ptStart = interp(pts, distStart);
            const ptEnd = interp(pts, distEnd);
            
const isStartOfLine = (si === 0 && bi === 0);
            drawPlanPost(ptStart, segB, isStartOfLine, 0.15);
            pillarPositions.push({ dist: distStart, pt: ptStart });

            if (beamMode !== 'none') {
                _drawPlanBeamSymbol(ptStart, ptEnd, segB, beamMode);
            }
            cursor = distEnd;
        }
        
        const finalPt = interp(pts, cumulDist + A_i);
const isFinalCorner = (si === numSegs - 1); 
drawPlanPost(finalPt, segB, isFinalCorner, 0.15);
        pillarPositions.push({ dist: cumulDist + A_i, pt: finalPt });

        for (let bi = 0; bi < pillarPositions.length - 1; bi++) {
            const pStart = pillarPositions[bi].pt;
            const pEnd = pillarPositions[bi + 1].pt;
            const bayLen = hav(pStart, pEnd);
            const offset = 0.3 + (bi % 2) * 0.15;
            drawDimLine(pStart, pEnd, offset, bayLen.toFixed(2) + 'm', '#92400e');
        }

        drawDimLine(p0, p1, 0.8, A_i.toFixed(2) + 'm', '#92400e');
        cumulDist += A_i;
    }
}