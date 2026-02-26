// ============================================
// COWBOY FENCE — corrected calculation
// ============================================
//
// Per the spec (Image 1 + Image 2):
//
// Inputs:
//   A_i  = length of side i (meters, from the drawn polyline)
//   B_i  = number of corner posts touching side i (0, 1, or 2)
//          B=0: free endpoint (start/end of whole line)
//          B=1: one corner (one end is an angle point)
//          B=2: both ends are angle points (interior segment)
//   n    = post cross-section size, entered in INCHES, converted: n = inches * 0.0254
//   m    = spacing between post centers (meters), default 2.5
//
// Per segment i:
//   usable_i = A_i - B_i * n
//   full_i   = floor(usable_i / m)
//   r_i      = usable_i - full_i * m          ← raw remainder
//
//   Find smallest integer a >= 1 s.t. remainder r > m/2, where:
//     r = (usable_i - m * (full_i - a + 1)) / a
//       = (m*(full_i - (full_i - a + 1)) + r_i) / a
//       = (m*(a-1) + r_i) / a
//   So: (m*(a-1) + r_i) / a > m/2
//       => 2*(m*(a-1) + r_i) > m*a
//       => 2*m*a - 2*m + 2*r_i > m*a
//       => m*a > 2*m - 2*r_i
//       => a > 2 - 2*r_i/m   (which is always >= 1 when r_i > 0)
//   So the SMALLEST valid a = ceil(2 - 2*r_i/m) if r_i > 0, else no split needed.
//   But a must be >= 1 and <= full_i (can't split more panels than we have).
//   If no valid a (e.g. usable < m), a = 1 and we just have r_i as the last piece.
//
// Panel layout for a segment:
//   - (full_i - a + 1) full panels of size m   [the "standard" ones, drawn as black]
//   - wait: actually the doc says: full_i - a + 1 ... hmm
//   Actually re-reading the formula box carefully:
//     r = (A_i - B_i*n  -  m*(floor((A_i-B_i*n)/m) - a + 1)) / a
//     => numerator = usable - m*(full - a + 1)
//     => numerator = usable - m*full + m*(a-1)
//     => numerator = r_raw + m*(a-1)
//   So r (split panel size) = (r_raw + m*(a-1)) / a
//
//   Number of standard panels = full - a + 1   -- wait that doesn't add up
//   Total panels = (full - a + 1) + a = full + 1? No...
//   
//   Let's think differently: we have `usable` meters total.
//   We want (total_panels - a) full panels of size m, plus a split panels of size r.
//   total = (total_panels - a)*m + a*r = usable
//   We choose a such that r > m/2.
//   From: (total_panels - a)*m + a*r = usable
//   If we set total_panels = full + 1 (we'll have one extra short panel that we split into a):
//     Wait, simplest reading: 
//     full = floor(usable/m), r_raw = usable mod m
//     If r_raw == 0: total = full standard panels, no split
//     If r_raw > 0:  we have full standard + 1 short (r_raw)
//                    but if r_raw < m/2, we "borrow" from the last standard panel
//                    and split (m + r_raw) into a=2 pieces of size (m+r_raw)/2
//                    This is essentially: find a such that split_size = r > m/2
//   
//   So: standard count = full - a + 1  ... but this seems off too.
//   Let me just go with: standard_count = full - (a-1), split_count = a
//   total = standard_count + split_count = full - a + 1 + a = full + 1
//   total_length = (full - a + 1)*m + a*r
//              = (full+1-a)*m + a*(r_raw + m*(a-1))/a
//              = (full+1-a)*m + r_raw + m*(a-1)
//              = full*m - (a-1)*m + r_raw + m*(a-1)
//              = full*m + r_raw = usable ✓
//
// So: standard = (full - a + 1) panels of size m
//     split    = a panels of size r = (r_raw + m*(a-1)) / a
//
// The split panels are placed at the END of the segment nearest to the user's start point.
// (Image 2: "Default: ใช้ แต่มุมผส ลำไย ออลดา ทกที่นหน้ที่ ตรงจรับกับที่ทิศที่ผู้ใช้ลาก")
//
// Warnings:
//   m < 1  → warn "too dense"
//   m > 3  → warn "too sparse"  
//   A_i - B_i*n < 0.5 → warn "side too short to fence"

let fenceLayerGroup = L.layerGroup().addTo(map);

const PRICE_PER_M = 850;

// Colours
const COL_NORMAL = '#1f2937';  // black — all fence beams (standard AND split, same color now)
const COL_SPLIT  = '#1f2937';  // same as normal — split panels no longer visually distinct in beam color
const COL_POST_NORMAL = '#1f2937'; // interior segment posts
const COL_POST_CORNER = '#a21caf'; // unused — replaced by red/blue for double corner

// ============================================
// GEOMETRY HELPERS
// ============================================
function hav(p1, p2) {
    const R = 6371000;
    const dLat = (p2[0]-p1[0])*Math.PI/180;
    const dLon = (p2[1]-p1[1])*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function totalLen(pts) {
    let t=0; for(let i=0;i<pts.length-1;i++) t+=hav(pts[i],pts[i+1]); return t;
}
function interp(pts, d) {
    let acc=0;
    for(let i=0;i<pts.length-1;i++){
        const s=hav(pts[i],pts[i+1]);
        if(acc+s>=d-1e-6){
            const t=Math.min(1,(d-acc)/s);
            return [pts[i][0]+t*(pts[i+1][0]-pts[i][0]), pts[i][1]+t*(pts[i+1][1]-pts[i][1])];
        }
        acc+=s;
    }
    return [...pts[pts.length-1]];
}
function bearing(p1,p2){
    const f1=p1[0]*Math.PI/180,f2=p2[0]*Math.PI/180,dl=(p2[1]-p1[1])*Math.PI/180;
    return Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl))*180/Math.PI;
}
function bearingAt(pts,d){
    let acc=0;
    for(let i=0;i<pts.length-1;i++){
        const s=hav(pts[i],pts[i+1]);
        if(acc+s>=d-1e-6) return bearing(pts[i],pts[i+1]);
        acc+=s;
    }
    return bearing(pts[pts.length-2],pts[pts.length-1]);
}
function offPt(ll,b,dist){
    const R=6371000,d=dist/R,rb=b*Math.PI/180;
    const f1=ll[0]*Math.PI/180,l1=ll[1]*Math.PI/180;
    const f2=Math.asin(Math.sin(f1)*Math.cos(d)+Math.cos(f1)*Math.sin(d)*Math.cos(rb));
    const l2=l1+Math.atan2(Math.sin(rb)*Math.sin(d)*Math.cos(f1),Math.cos(d)-Math.sin(f1)*Math.sin(f2));
    return [f2*180/Math.PI,l2*180/Math.PI];
}

// ============================================
// JUNCTION MAP — tracks which points are shared between lines
// ============================================
// ============================================
// CORNER MAP — every point that has an angle (internal corners + cross-line junctions)
// Stores for each corner point: array of {inwardBearing} for each arm of the corner
// ============================================
let cornerMap = new Map();

// Tracks which corners have been swapped (red/blue reversed)
// key = ptKey, value = true if swapped
const swappedCorners = new Map();

function ptKey(p) {
    return p[0].toFixed(5) + ',' + p[1].toFixed(5);
}

function buildCornerMap(allLinePointsArray) {
    cornerMap = new Map();

    function addArm(pt, bearingInward, bearingOutward) {
        const k = ptKey(pt);
        if (!cornerMap.has(k)) cornerMap.set(k, { pt, arms: [] });
        // Store both the inward bearing (away from corner into the line)
        // AND the outward bearing (direction from corner into the next segment)
        cornerMap.get(k).arms.push({ inward: bearingInward, outward: bearingOutward });
    }

    allLinePointsArray.forEach(linePoints => {
        if (linePoints.length < 2) return;
        for (let i = 0; i < linePoints.length; i++) {
            const pt = linePoints[i];
            if (i === 0) {
                // Start: inward = back (same as outward into line), outward = forward
                const fwd = bearing(linePoints[0], linePoints[1]);
                addArm(pt, fwd, fwd);
            } else if (i === linePoints.length - 1) {
                // End: inward = forward into line (back toward prev), outward = backward
                const bwd = bearing(linePoints[i], linePoints[i-1]);
                addArm(pt, bwd, bwd);
            } else {
                // Internal corner: two arms
                // Arm 0: the segment that came IN (from i-1 to i), outward = back toward i-1
                const backDir = bearing(linePoints[i], linePoints[i-1]);
                addArm(pt, backDir, backDir);
                // Arm 1: the segment going OUT (from i to i+1), outward = forward toward i+1
                const fwdDir = bearing(linePoints[i], linePoints[i+1]);
                addArm(pt, fwdDir, fwdDir);
            }
        }
    });

    for (const [k, entry] of cornerMap.entries()) {
        if (entry.arms.length < 2) cornerMap.delete(k);
    }
}

function isCornerPoint(p) {
    return cornerMap.has(ptKey(p));
}

// Return [arm_red, arm_blue] as outward bearing values, respecting swap state
// arm_red = incoming side (end of line 1), arm_blue = outgoing side (start of line 2)
// For an internal corner: arms[0].outward points BACK (into incoming seg), arms[1].outward points FORWARD (into outgoing seg)
function getCornerArms(entry) {
    const k = ptKey(entry.pt);
    const arms = entry.arms.slice(0, 2);
    // Default: arms[0] = incoming (red), arms[1] = outgoing (blue)
    // Swapped: arms[1] = incoming (red), arms[0] = outgoing (blue)
    if (swappedCorners.get(k)) {
        return [arms[1].outward, arms[0].outward]; // [redDir, blueDir]
    }
    return [arms[0].outward, arms[1].outward];
}

// Get the blue box offset distance (meters) — used for fence layout
const DOUBLE_CORNER_HALF = 0.40;
const DOUBLE_CORNER_OFFSET = DOUBLE_CORNER_HALF * 2; // 0.80m

// Draw double corner post: RED at corner apex (end of incoming line),
// BLUE offset inward along outgoing line (start of outgoing line).
// Returns { count } — count = 2 posts drawn.
function drawDoubleCornerPost(cornerPt, n, addHoverMarkers) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return { count: 0 };
    const arms = entry.arms.slice(0, 2);

    if (arms.length < 2) {
        drawPost(cornerPt, arms[0].outward, 'corner');
        return { count: 1 };
    }

    const [armRed, armBlue] = getCornerArms(entry);
    const halfSz = DOUBLE_CORNER_HALF;

    function drawColorSquare(latlng, b, color) {
        const rect = [
            offPt(offPt(latlng, b + 90, halfSz), b,       halfSz),
            offPt(offPt(latlng, b - 90, halfSz), b,       halfSz),
            offPt(offPt(latlng, b - 90, halfSz), b + 180, halfSz),
            offPt(offPt(latlng, b + 90, halfSz), b + 180, halfSz),
        ];
        L.polygon(rect, {
            color, weight: 2,
            fillColor: 'white', fillOpacity: 1, opacity: 1
        }).addTo(fenceLayerGroup);
    }

    // RED: at the corner apex (end of incoming line)
    drawColorSquare(cornerPt, armRed, '#dc2626');

    // BLUE: offset into outgoing line — this is the "first pillar" of that line
    const pt2 = offPt(cornerPt, armBlue, DOUBLE_CORNER_OFFSET);
    drawColorSquare(pt2, armBlue, '#2563eb');

    // Hover swap icon — a small ⇄ div marker that appears on hover via CSS
    if (addHoverMarkers) {
        const k = ptKey(cornerPt);

        const swapIcon = L.divIcon({
            className: '',
            html: `<div class="dc-swap-btn" data-k="${k}" title="Swap corner side">⇄</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const swapMarker = L.marker(cornerPt, {
            icon: swapIcon,
            zIndexOffset: 3000,
            interactive: true
        }).addTo(fenceLayerGroup);
    }

    return { count: 2 };
}

// ============================================
// DRAW FENCE
// ============================================
function drawFence(linePoints, m, n, splitAtStart, doubleCorner) {
    const numSegs = linePoints.length - 1;
    const closed = numSegs >= 3 && hav(linePoints[0], linePoints[linePoints.length-1]) < 0.5;

    let grandTotal = 0, totalPosts = 0, totalBeams = 0;
    const warnings = [];
    let cumulDist = 0;

    // For each corner point, determine which side is blue (outgoing) and which is red (incoming).
    // "blue side faces INTO segment si" means: the blue arm's outward direction is within 90°
    // of the direction FROM the corner INTO that segment.
    function blueArmFacesInto(cornerPt, towardPt) {
        const entry = cornerMap.get(ptKey(cornerPt));
        if (!entry || entry.arms.length < 2) return false;
        const k = ptKey(cornerPt);
        const arms = entry.arms.slice(0, 2);
        const isSwapped = swappedCorners.get(k) || false;
        // Blue is arms[1] by default, arms[0] if swapped
        const blueArm = isSwapped ? arms[0] : arms[1];
        const segDir = bearing(cornerPt, towardPt);
        const a  = ((blueArm.outward % 360) + 360) % 360;
        const b2 = ((segDir % 360) + 360) % 360;
        let diff = Math.abs(a - b2);
        if (diff > 180) diff = 360 - diff;
        return diff < 90;
    }

    for (let si = 0; si < numSegs; si++) {
        const p0 = linePoints[si], p1 = linePoints[si+1];
        const A_i = hav(p0, p1);

        // B_i counts corner posts at each end of this segment
        let B_i = 0;
        if (si > 0 || closed) B_i++;
        if (si < numSegs-1 || closed) B_i++;

        // Is the START of this segment a DC corner with blue pointing INTO this segment?
        const startIsDC = doubleCorner && isCornerPoint(p0) && blueArmFacesInto(p0, p1);
        // Is the END of this segment a DC corner with blue pointing INTO this segment (from the end)?
        const endIsDC   = doubleCorner && isCornerPoint(p1) && blueArmFacesInto(p1, p0);

        // leftOff: distance from p0 to the first pillar
        // - DC blue at start → blue box is first pillar at DOUBLE_CORNER_OFFSET
        // - Normal corner/endpoint → n/2
        // - Free endpoint (si=0, no corner) → 0
        const leftOff  = startIsDC ? DOUBLE_CORNER_OFFSET
                       : (B_i >= 1 ? n / 2 : 0);

        // rightOff: distance from p1 back to the last pillar
        // - DC blue at end → blue box is last pillar at DOUBLE_CORNER_OFFSET
        // - DC red at end (endsAtDC but blue faces other way) → red sits at apex, 0 extra offset
        // - Normal corner/endpoint → n/2
        const endsAtDC = doubleCorner && isCornerPoint(p1);
        const rightOff = endIsDC   ? DOUBLE_CORNER_OFFSET
                       : endsAtDC  ? 0
                       : (B_i >= 2 || (B_i >= 1 && si === numSegs - 1) ? n / 2 : 0);

        // Usable = space between first and last pillar where interior posts go
        // Total available for panels = A_i - leftOff - rightOff
        const panelSpace = A_i - leftOff - rightOff;

        if (panelSpace < 0.5) {
            warnings.push(`ด้านยาว ${A_i.toFixed(2)}m สั้นเกินไป`);
            cumulDist += A_i;
            const pts = [interp(linePoints, cumulDist - A_i), interp(linePoints, cumulDist)];
            L.polyline(pts, { color: '#f87171', weight: 4, opacity: 0.7, dashArray: '6,4' }).addTo(fenceLayerGroup);
            continue;
        }

        // Calculate panel layout — blue box is the first pillar so panels start fresh from it
        // Full m-spaced panels from leftOff, remainder adjusted at the far end
        const calc = calcPanels(panelSpace, m);

        grandTotal += A_i;

        // Build absolute tick positions (interior post positions)
        // Ticks are at leftOff + tick.pos along the cumulative line
        const absTicks = calc.ticks.map(t => ({
            dist: cumulDist + leftOff + t.pos,
            isSplit: t.isSplit
        }));

        const segStart = cumulDist;
        const segEnd   = cumulDist + A_i;

        // Panel boundaries: from leftOff to A_i-rightOff, split by interior ticks
        const panelStart = cumulDist + leftOff;
        const panelEnd   = cumulDist + A_i - rightOff;
        const allBounds  = [panelStart, ...absTicks.map(t => t.dist), panelEnd];

        const splitPanelFlags = [];
        for (let i = 0; i < allBounds.length - 1; i++) {
            splitPanelFlags.push(i >= calc.standardCount);
        }

        // Draw pre-panel gap (corner area before first pillar) as part of fence beam
        // From segment start to panelStart (corner/endpoint region)
        if (leftOff > 1e-4) {
            const pts = [];
            const steps = Math.max(2, Math.ceil(leftOff * 3));
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, segStart + leftOff * s / steps));
            L.polyline(pts, { color: COL_NORMAL, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        // Draw panels
        for (let i = 0; i < allBounds.length - 1; i++) {
            const d0 = allBounds[i], d1 = allBounds[i + 1];
            if (d1 - d0 < 1e-4) continue;
            const color = splitPanelFlags[i] ? COL_SPLIT : COL_NORMAL;
            const steps = Math.max(2, Math.ceil((d1 - d0) * 3));
            const pts = [];
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, d0 + (d1 - d0) * s / steps));
            L.polyline(pts, { color, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        // Draw post-panel gap (corner area after last pillar)
        if (rightOff > 1e-4) {
            const pts = [];
            const steps = Math.max(2, Math.ceil(rightOff * 3));
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, panelEnd + rightOff * s / steps));
            L.polyline(pts, { color: COL_NORMAL, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        // Draw interior posts
        for (let ti = 0; ti < absTicks.length; ti++) {
            const tick = absTicks[ti];
            const pt = interp(linePoints, tick.dist);
            const b  = bearingAt(linePoints, tick.dist);
            const isSplitPost = splitPanelFlags[ti] || splitPanelFlags[ti + 1];
            drawPost(pt, b, isSplitPost ? 'split' : 'normal');
        }

        // Draw start post (endpoint or corner) — skip if doubleCorner handles it
        if (!(doubleCorner && isCornerPoint(linePoints[si]))) {
            const startPt = interp(linePoints, cumulDist);
            const isCornerStart = (B_i >= 1 && si > 0) || (closed && si === 0);
            drawPost(startPt, bearingAt(linePoints, cumulDist + 0.01),
                     isCornerStart ? 'corner' : 'endpoint');
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

// Calculate panel layout for a given usable space.
// Returns ticks (interior post positions), standardCount, splitCount.
// Panels: full-m ones first, then adjusted ones at end if remainder exists.
function calcPanels(space, m) {
    if (space < 1e-4) return { ticks: [], standardCount: 0, splitCount: 0 };

    const full  = Math.floor(space / m);
    const r_raw = space - full * m;

    let splitCount, splitSize, standardCount;

    if (r_raw < 1e-3) {
        standardCount = full;
        splitCount    = 0;
        splitSize     = 0;
    } else {
        let a = 1;
        for (a = 1; a <= 3; a++) {
            const k = (r_raw + m * (a - 1)) / a;
            if (k >= m / 2 - 1e-6) break;
        }
        if (a > full + 1) a = full + 1;
        splitCount    = a;
        splitSize     = (r_raw + m * (a - 1)) / a;
        standardCount = (full + 1) - a;
    }

    const ticks = [];
    let pos = 0;
    for (let i = 0; i < standardCount; i++) {
        pos += m;
        if (pos < space - 1e-4) ticks.push({ pos, isSplit: false });
    }
    for (let i = 0; i < splitCount - 1; i++) {
        pos += splitSize;
        ticks.push({ pos, isSplit: true });
    }

    return { ticks, standardCount, splitCount };
}

// Draw a post:
// - 'normal' or 'split' interior posts → small filled circle dot
// - 'endpoint' → slightly larger circle
// - 'corner' → square (drawn separately by drawDoubleCornerPost, this handles single fallback)
function drawPost(latlng, b, type) {
    if (type === 'normal' || type === 'split') {
        // Small dot for interior segment posts
        L.circleMarker(latlng, {
            radius: 3,
            color: COL_POST_NORMAL,
            weight: 1,
            fillColor: '#fff',
            fillOpacity: 1,
            opacity: 1
        }).addTo(fenceLayerGroup);
        return;
    }

    if (type === 'endpoint') {
        // Slightly larger dot for line endpoints
        L.circleMarker(latlng, {
            radius: 4.5,
            color: COL_POST_NORMAL,
            weight: 1.5,
            fillColor: '#fff',
            fillOpacity: 1,
            opacity: 1
        }).addTo(fenceLayerGroup);
        return;
    }

    // 'corner' fallback (single corner, no doubleCorner mode) — small square
    const halfH = 0.45, halfW = 0.45;
    const rect = [
        offPt(offPt(latlng, b + 90, halfH), b,       halfW),
        offPt(offPt(latlng, b - 90, halfH), b,       halfW),
        offPt(offPt(latlng, b - 90, halfH), b + 180, halfW),
        offPt(offPt(latlng, b + 90, halfH), b + 180, halfW),
    ];
    L.polygon(rect, {
        color: '#6b7280',
        weight: 1.5,
        fillColor: 'white',
        fillOpacity: 1,
        opacity: 1
    }).addTo(fenceLayerGroup);
}

// ============================================
// VALIDATE + WARN
// ============================================
function validateInputs(m, nInches) {
    const msgs = [];
    if (m < 1)   msgs.push('⚠️ ระยะห่างน้อยกว่า 1 เมตร — รั้วแน่นเกินไป');
    if (m > 3)   msgs.push('⚠️ ระยะห่างมากกว่า 3 เมตร — รั้วห่างเกินไป');
    return msgs;
}

// Inject CSS for the swap icon button (done once)
(function injectSwapCSS() {
    if (document.getElementById('dc-swap-style')) return;
    const style = document.createElement('style');
    style.id = 'dc-swap-style';
    style.textContent = `
        .dc-swap-btn {
            width: 24px; height: 24px;
            line-height: 24px; text-align: center;
            font-size: 14px; font-weight: bold;
            background: white;
            border: 2px solid #2563eb;
            border-radius: 50%;
            color: #2563eb;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s;
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
            user-select: none;
        }
        .leaflet-marker-icon:hover .dc-swap-btn,
        .dc-swap-btn:hover {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);
})();

// Internal redraw — re-runs current fence calculation keeping swappedCorners state
function _redrawFence() {
    runFenceCalc();
}

// ============================================
// UI WIRING
// ============================================

// Fence type card selection
document.querySelectorAll('.fence-type-card').forEach(card => {
    card.addEventListener('click', function() {
        document.querySelectorAll('.fence-type-card').forEach(c=>c.classList.remove('active'));
        this.classList.add('active');
    });
});

// Beam select
document.getElementById('beamSelect').addEventListener('change', function() {
    document.querySelectorAll('.beam-spec-row').forEach(r=>r.classList.remove('active'));
    const row = document.querySelector(`.beam-spec-row[data-beam="${this.value}"]`);
    if (row) row.classList.add('active');
});

// Global click delegation for swap buttons (works even after layer redraw)
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.dc-swap-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const k = btn.getAttribute('data-k');
    if (k) {
        swappedCorners.set(k, !(swappedCorners.get(k) || false));
        runFenceCalc();
    }
});

// Core fence calculation and draw function
function runFenceCalc() {
    if (typeof allLines === 'undefined' || allLines.length === 0) return;

    const m       = parseFloat(document.getElementById('postSpacing').value) || 2.5;
    const nInches = parseFloat(document.getElementById('postSizeInches').value) || 6;
    const n       = nInches * 0.0254;
    const layers  = parseInt(document.getElementById('beamSelect').value) || 2;
    const doubleCorner = document.getElementById('doubleCornerPost')?.checked ?? false;

    const allWarnings = validateInputs(m, nInches);

    fenceLayerGroup.clearLayers();

    const validLines = allLines.filter(ld => ld.points.length >= 2);
    buildCornerMap(validLines.map(ld => ld.points));

    let grandTotal=0, grandPosts=0, grandBeams=0;

    validLines.forEach(ld => {
        const res = drawFence(ld.points, m, n, true, doubleCorner);
        grandTotal += res.grandTotal;
        grandPosts += res.totalPosts;
        grandBeams += res.totalBeams * layers;
        allWarnings.push(...res.warnings);
    });

    if (doubleCorner) {
        for (const [k, entry] of cornerMap.entries()) {
            const result = drawDoubleCornerPost(entry.pt, n, true);
            grandPosts += result.count;
        }
    }

    const price = Math.round(grandTotal * PRICE_PER_M);

    document.getElementById('resTotal').value = grandTotal.toFixed(2);
    document.getElementById('resPosts').value = grandPosts;
    document.getElementById('resBeams').value = grandBeams;
    document.getElementById('resPrice').value = price.toLocaleString();

    const warnEl = document.getElementById('fenceWarnings');
    if (allWarnings.length > 0) {
        warnEl.innerHTML = allWarnings.map(w=>`<div class="fw-item">${w}</div>`).join('');
        warnEl.style.display = 'block';
    } else {
        warnEl.style.display = 'none';
    }
}

// "คำนวนวัสดุ" — calculate and draw
document.getElementById('drawFenceBtn').addEventListener('click', function() {
    if (typeof allLines === 'undefined' || allLines.length === 0) {
        alert('กรุณาวาดเส้นก่อน');
        return;
    }
    runFenceCalc();
});

// "สร้างแผน" — clear
document.getElementById('clearFenceBtn').addEventListener('click', function() {
    fenceLayerGroup.clearLayers();
    swappedCorners.clear();
    ['resTotal','resPosts','resBeams','resPrice'].forEach(id => document.getElementById(id).value='');
    document.getElementById('fenceWarnings').style.display = 'none';
});