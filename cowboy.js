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
    // Posts are priced in two tiers (see the cowboy price spec): normal
    // mid-line spacing posts vs. posts sitting at a corner (whether a
    // single Mode-1 bisector post or the two Mode-2/plain-duel dual posts
    // — the spec doesn't distinguish those, both count as "เสาเข้ามุม").
    // totalPosts stays the combined total for backward-compat display.
    let grandTotal = 0, totalPosts = 0, normalPosts = 0, cornerPosts = 0, totalBeams = 0;
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

function cornerShortenAmount(cornerPt, n, armBearing) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return 0;
    const [a1, a2] = getCornerArms(entry); // a1 = armRed, a2 = armBlue
    const theta = cornerAngle(a1, a2);
    const nonSquareActive = _isNonSquareActive('cowboy');
    if (!nonSquareActive) {
        // Plain "duel" (square-corner) mode — see drawDoubleCornerPost in
        // fence.js. Red sits AT the vertex (clears only n/2 along its own
        // arm), blue sits offset by a full post-width n further out along
        // ITS OWN arm (clears n + n/2 along that arm). Which arm this call
        // is shortening is passed in as armBearing by the caller, so we
        // match it against the (swap-aware) red/blue arms to know which
        // clearance applies. This is a separate calculation from Mode 1/
        // Mode 2 below and never runs at the same time as them.
        if (typeof armBearing === 'number') {
            const angTo = (b) => { let d = Math.abs(((b - armBearing) % 360 + 360) % 360); if (d > 180) d = 360 - d; return d; };
            const isBlueArm = angTo(a2) < angTo(a1);
            return isBlueArm ? n + n / 2 : n / 2;
        }
        return n / 2; // fallback if the caller couldn't identify the arm
    }
    const mode = getCornerMode(cornerPt, theta, 'cowboy');
    if (mode === 'single') return n / 2; // Mode 1: bisector post at vertex
    return getDualCornerOffset(n, theta); // Mode 2: posts offset by angle formula
}

// This is where the SINGLE (non-dual) corner post actually gets drawn on
// the map for cowboy fences — drawDoubleCornerPost (fence.js) is only ever
// called when doubleCorner/useDoubleCorner is true, so whenever a corner is
// in single-post mode (plain square mode, OR non-square Mode 1) the two
// segments meeting there each independently fall through to a plain
// drawPost() call below, using their own local tangent bearing. Mode 1
// needs that bearing to be the bisector of the corner's two arms instead —
// otherwise the post just sits flush with whichever segment happens to be
// iterated, i.e back to the old "face along one arm" look. Only rewrites
// the bearing for a real two-arm corner in non-square Mode 1; plain square
// mode and true (non-corner) endpoints fall through to fallbackBearing
// unchanged.
function cornerPostBearing(cornerPt, fallbackBearing) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry || entry.arms.length < 2) return fallbackBearing;
    const nonSquareActive = _isNonSquareActive('cowboy');
    if (!nonSquareActive) return fallbackBearing;
    const [armRed, armBlue] = getCornerArms(entry);
    const theta = cornerAngle(armRed, armBlue);
    const mode = getCornerMode(cornerPt, theta, 'cowboy');
    if (mode !== 'single') return fallbackBearing; // Mode 2 draws its own dual posts elsewhere
    return bisectorBearing(armRed, armBlue);
}

const startIsDC = doubleCorner && isCornerPoint(p0);
const endIsDC = doubleCorner && isCornerPoint(p1);

const n_post = 0.15; // post size in metres
// Each corner's clearance depends on which of its two arms THIS segment
// is — pass the segment's own outward-from-corner bearing so
// cornerShortenAmount can match it against the (swap-aware) red/blue
// arms and return the right amount for that side.
const leftOff = startIsDC ? cornerShortenAmount(p0, n_post, bearing(p0, p1)) : 0;
const endsAtDC = doubleCorner && isCornerPoint(p1);
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
            const startBearing = isCornerStart
                ? cornerPostBearing(linePoints[si], bearingAt(linePoints, cumulDist + 0.01))
                : bearingAt(linePoints, cumulDist + 0.01);
            drawPost(startPt, startBearing, isCornerStart ? 'corner' : 'endpoint');
            if (isCornerStart) cornerPosts++; else normalPosts++;
        }

        normalPosts += calc.ticks.length;
        totalPosts += calc.ticks.length + 1;
        totalBeams += calc.standardCount + calc.splitCount;
        cumulDist += A_i;
    }

    if (!closed) {
        const last = linePoints[linePoints.length - 1];
        const prev = linePoints[linePoints.length - 2];
        if (!(doubleCorner && isCornerPoint(last))) {
            const isLastCorner = isCornerPoint(last);
            const lastBearing = isLastCorner
                ? cornerPostBearing(last, bearing(prev, last))
                : bearing(prev, last);
            drawPost(last, lastBearing, 'endpoint');
            if (isLastCorner) cornerPosts++; else normalPosts++;
            totalPosts++;
        }
    }

    return { grandTotal, totalPosts, normalPosts, cornerPosts, totalBeams, warnings, segGeom };
}

function calcCowboy(cowboyLines, m_cowboy, n, useDoubleCorner, layers) {
    let grandTotal = 0, grandPosts = 0, normalPosts = 0, cornerPosts = 0, grandBeams = 0;
    const allWarnings = [];

    buildCornerMap(cowboyLines.map(ld => ld.points));

    cowboyLines.forEach(ld => {
        const res = drawCowboyFence(ld.points, m_cowboy, n, true, useDoubleCorner, ld.color);
        grandTotal += res.grandTotal;
        grandPosts += res.totalPosts;
        normalPosts += res.normalPosts;
        cornerPosts += res.cornerPosts;
        grandBeams += res.totalBeams * layers;
        if (res.warnings) allWarnings.push(...res.warnings);
        // Plan Mode reuses this verbatim — no separate recalculation there.
        ld._cowboyPlanGeom = res.segGeom;
    });

    if (useDoubleCorner) {
        for (const [k, entry] of cornerMap.entries()) {
            const result = drawDoubleCornerPost(entry.pt, n, true);
            grandPosts += result.count;
            cornerPosts += result.count; // dual (or single-fallback) corner posts always price as "เสาเข้ามุม"
        }
    }

    return { grandTotal, grandPosts, normalPosts, cornerPosts, grandBeams, warnings: allWarnings };
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

    const m = parseFloat(_activeCornerCheckbox('postSpacing', 'imPostSpacing')?.value) || 2.5;
    const n = parseFloat(_activeCornerCheckbox('postSizeCowboy', 'imPostSizeCowboy')?.value) || 0.15;

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

        // Only the very first post of the WHOLE line gets a footprint-length
        // label — every post on the line is the same size, so repeating it
        // once per side was still noise once a shape had more than one side.
        if (i === 0) {
            poleDists.slice(0, 1).forEach(dist => {
                drawPostLengthLabel(pts, dAcc + dist, n, '#000');
            });
        }

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

function drawPlanCowboyCorners() {
    if (typeof cornerMap === 'undefined' || cornerMap.size === 0) return;

    const dualPillarCheckbox = _activeCornerCheckbox('doubleCornerPost', 'imDoubleCornerPost');
    const nonSquareActive = _isNonSquareActive('cowboy');
    const mode2Radio = _activeCornerCheckbox('cornerMode2', 'imCornerModeDouble');

    const useDualPillar = nonSquareActive
        ? (mode2Radio ? mode2Radio.checked : false)
        : (dualPillarCheckbox ? dualPillarCheckbox.checked : false);
    const n = 0.15;

    for (const [, entry] of cornerMap.entries()) {
        const arms = entry.arms.slice(0, 2);

if (arms.length < 2) {
    const armRed0 = arms[0].outward;
    drawPlanPost(entry.pt, armRed0, true, n, 'cowboy');
    continue;
}

if (!useDualPillar) {
    // Single-post corner. In plain square mode (non-square OFF) this
    // stays flush with armRed, same as before. In non-square Mode 1
    // (useDualPillar is false here because mode2Radio is unchecked) the
    // post should instead face the bisector of the two arms — this branch
    // used to always draw armRed and `continue`, which meant the
    // mode==='single' bisector code further down was dead: useDualPillar
    // being false skipped straight past it before it could ever run.
    const [armRed, armBlue] = getCornerArms(entry);
    const bearingToUse = nonSquareActive ? bisectorBearing(armRed, armBlue) : armRed;
    drawPlanPost(entry.pt, bearingToUse, true, n, 'cowboy');
    continue;
}

        const [armRed, armBlue] = getCornerArms(entry);
        const theta = cornerAngle(armRed, armBlue);

        if (nonSquareActive) {
            const mode = getCornerMode(entry.pt, theta, 'cowboy');
if (mode === 'single') {
    // Mode 1 only: rotate to the bisector between the two arms, mirroring
    // the same fix in fence.js's drawDoubleCornerPost. Mode 2 below (offset
    // dual posts) and the non-nonSquare single-post branch above are
    // untouched.
    const singleBearing = bisectorBearing(armRed, armBlue);
    drawPlanPost(entry.pt, singleBearing, true, n, 'cowboy');
} else {
                // Mode 2 — both posts offset along each arm by angle formula,
                // each rotated to face ITS OWN line direction (armRed/armBlue)
                // instead of a shared bisector angle, so the post edges stay
                // flush with the actual fence line the user drew — matches
                // the map-mode fix in fence.js's drawDoubleCornerPost.
                const offset = getDualCornerOffset(n, theta); // true physical offset — used for the label only
                // drawPlanColorPost renders posts at visualN = n·scale·3 (oversized
                // for visibility), not the real n — so positioning them using the
                // real `offset` made the oversized squares overlap instead of
                // mitring flush at the corner like the real hardware would. Run
                // the SAME formula on the inflated visual size (offset scales
                // linearly with n) to get a render offset the oversized squares
                // actually meet at, mirroring how the plain "duel" branch below
                // already separates render position from the labeled true value.
                const scale = window._poleScale || 1.0;
                const visualN = Math.max(n, 0.15) * scale * 3;
                const renderOffset = getDualCornerOffset(visualN, theta);
                const redPt  = offPt(entry.pt, armRed,  renderOffset);
                const bluePt = offPt(entry.pt, armBlue, renderOffset);
                drawPlanColorPost(redPt,  armRed,  '#dc2626', n);
                drawPlanColorPost(bluePt, armBlue, '#2563eb', n);
                if (typeof drawDimLine === 'function') {
                    const redSign  = cornerDimOutwardSign(armRed,  armBlue);
                    const blueSign = cornerDimOutwardSign(armBlue, armRed);
                    drawDimLine(entry.pt, redPt,  redSign  * 0.2, offset.toFixed(2) + 'm', '#dc2626');
                    drawDimLine(entry.pt, bluePt, blueSign * 0.2, offset.toFixed(2) + 'm', '#2563eb');
                }
            }
} else {
            // Mirrors the map view's plain "duel" (square-corner) layout
            // (see drawDoubleCornerPost in fence.js): red sits ON the
            // vertex, rotated flush with its own arm; blue sits one
            // post-width out along ITS OWN arm, rotated flush with that
            // line. Independent of the non-square Mode 1/Mode 2 branch
            // above — never runs at the same time as it.
            //
            // drawPlanColorPost rendefs posts oversized for visibility
            // (visualN = n·scale·3, not the true n), so positioning blue
            // using the raw physical n makes the two squares overlap on
            // screen. renderOffset matches that same oversized footprint
            // so blue just touches red instead — the dimension label below
            // still reports the true physical clearance (n), not the
            // inflated render distance.
            const scale = window._poleScale || 1.0;
            const renderOffset = Math.max(n, 0.15) * scale * 3;
            const blueBearing = (typeof forcedPerpendicularBearing === 'function')
                ? forcedPerpendicularBearing(armRed, armBlue)
                : armBlue; // fallback if fence.js hasn't loaded yet
            const redPt  = entry.pt;
            const bluePt = offPt(entry.pt, blueBearing, renderOffset);
            drawPlanColorPost(redPt,  armRed,     '#dc2626', n);
            drawPlanColorPost(bluePt, blueBearing, '#2563eb', n);
            if (typeof drawDimLine === 'function') {
                const blueSign = cornerDimOutwardSign(armBlue, armRed);
                drawDimLine(entry.pt, bluePt, blueSign * 0.2, n.toFixed(2) + 'm', '#2563eb');
            }
        }
    }
}