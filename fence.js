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
const halfSz = DOUBLE_CORNER_HALF * (window._poleScale || 1.0);

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
function drawFence(linePoints, m, n, splitAtStart, doubleCorner, lineColor) {
    lineColor = lineColor || '#3b82f6';
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
const leftOff  = startIsDC ? DOUBLE_CORNER_OFFSET : 0;

        // rightOff: distance from p1 back to the last pillar
        // - DC blue at end → blue box is last pillar at DOUBLE_CORNER_OFFSET
        // - DC red at end (endsAtDC but blue faces other way) → red sits at apex, 0 extra offset
        // - Normal corner/endpoint → n/2
        const endsAtDC = doubleCorner && isCornerPoint(p1);
const rightOff = endIsDC  ? DOUBLE_CORNER_OFFSET
               : endsAtDC ? 0
               : 0;

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
// Calculate panel layout — pole width n is factored into spacing
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
L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        // Draw panels
        for (let i = 0; i < allBounds.length - 1; i++) {
            const d0 = allBounds[i], d1 = allBounds[i + 1];
            if (d1 - d0 < 1e-4) continue;
            const steps = Math.max(2, Math.ceil((d1 - d0) * 3));
            const pts = [];
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, d0 + (d1 - d0) * s / steps));
            L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
        }

        // Draw post-panel gap (corner area after last pillar)
        if (rightOff > 1e-4) {
            const pts = [];
            const steps = Math.max(2, Math.ceil(rightOff * 3));
            for (let s = 0; s <= steps; s++) pts.push(interp(linePoints, panelEnd + rightOff * s / steps));
            L.polyline(pts, { color: lineColor, weight: 5, opacity: 0.75, lineJoin: 'round' }).addTo(fenceLayerGroup);
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

    const GAP_MIN = 1.0;
    const GAP_MAX = 3.0;

    // Determine number of interior poles k and clamp gap to valid range
    const fullCount0    = Math.floor(space / m + 1e-9);
    const remainder0    = space - fullCount0 * m;
    const totalPanels   = remainder0 < 1e-4 ? fullCount0 : fullCount0 + 1;
    let k               = Math.max(0, totalPanels - 1);
    const totalGapSpace = space;

    // Full panels at exactly m
    const fullCount = Math.floor(totalGapSpace / m + 1e-9);
const remainder = totalGapSpace - fullCount * m;  // 0 <= remainder < m

    const gaps = [];

    if (remainder < m * 0.01) {  // treat as perfect fit if remainder < 1% of spacing
        // Perfect fit — all panels exactly m
        for (let i = 0; i < totalPanels; i++) gaps.push(m);
    } else if (totalPanels <= 2) {
        // Not enough panels to do the standard+2 split — spread evenly
        const evenGap = totalGapSpace / totalPanels;
        for (let i = 0; i < totalPanels; i++) gaps.push(evenGap);
    } else {
        // Standard panels: (fullCount - 1) at exactly m
        const stdCount = fullCount - 1;
        for (let i = 0; i < stdCount; i++) gaps.push(m);
        // Last 2 panels: absorb (m + remainder) equally
        const endSize = (m + remainder) / 2;
        gaps.push(endSize);
        gaps.push(endSize);
    }

const standardCount = remainder < m * 0.01 ? totalPanels : Math.max(0, fullCount - 1);
    const splitCount    = remainder < m * 0.01 ? 0 : Math.min(2, totalPanels);

    // Build interior pole tick positions
    const ticks = [];
    let cursor = 0;
    for (let i = 0; i < k; i++) {
        cursor += gaps[i];
        if (cursor > 1e-4 && cursor < space - 1e-4) {
            ticks.push({ pos: cursor, isSplit: i >= standardCount - 1 });
        }
    }

    return { ticks, standardCount, splitCount, splitSize: gaps[gaps.length - 1], m };
}

// Draw a post:
// - 'normal' or 'split' interior posts → small filled circle dot
// - 'endpoint' → slightly larger circle
// - 'corner' → square (drawn separately by drawDoubleCornerPost, this handles single fallback)
function drawPost(latlng, b, type) {
const postW = 0.15; // Fixed display size ~15cm, visually represents 1m×1m pole
const postL = 0.15;

    // Make displayed square slightly bigger than actual pole for visibility
    const userScale = window._poleScale || 1.0;
    const SCALE = (type === 'endpoint' || type === 'corner' ? 1.6 : 5.4) * userScale;  // ← Fixed: added * operator
    const halfW = (postW * SCALE) / 2;
    const halfL = (postL * SCALE) / 2;

    let fillColor, strokeColor, strokeWeight;
    if (type === 'endpoint' || type === 'corner') {
        fillColor    = '#dc2626'; // red
        strokeColor  = '#ffffff';
        strokeWeight = 2;
    } else {
        fillColor    = '#ffffff'; // white interior post
        strokeColor  = '#1f2937';
        strokeWeight = 1.5;
    }

    const rect = [
        offPt(offPt(latlng, b + 90, halfW), b,       halfL),
        offPt(offPt(latlng, b - 90, halfW), b,       halfL),
        offPt(offPt(latlng, b - 90, halfW), b + 180, halfL),
        offPt(offPt(latlng, b + 90, halfW), b + 180, halfL),
    ];

    L.polygon(rect, {
        color: strokeColor,
        weight: strokeWeight,
        fillColor: fillColor,
        fillOpacity: 1,
        opacity: 1
    }).addTo(fenceLayerGroup);
}

// ============================================
// VALIDATE + WARN
// ============================================
function validateInputs(m, nInches) {
    const msgs = [];
    if (m < 1)   msgs.push('⚠️ ระยะห่างน้อยกว่า 1 เมตร — ปรับเป็น 1 เมตร');
    if (m > 3)   msgs.push('⚠️ ระยะห่างมากกว่า 3 เมตร — ปรับเป็น 3 เมตร');
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

// Fence type card selection (handled in HTML inline script, but also update here for safety)
document.querySelectorAll('.fence-type-card:not(.ftc-disabled)').forEach(card => {
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
// _swapClickSuppressed prevents the map.on('click') from firing after a swap
let _swapClickSuppressed = false;
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.dc-swap-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    // Suppress the Leaflet map click that bubbles through right after
    _swapClickSuppressed = true;
    setTimeout(() => { _swapClickSuppressed = false; }, 50);
    const k = btn.getAttribute('data-k');
    if (k) {
        swappedCorners.set(k, !(swappedCorners.get(k) || false));
        runFenceCalc();
    }
});

// Core fence calculation and draw function
// Core fence calculation and draw function
function runFenceCalc() {
    if (typeof allLines === 'undefined' || allLines.length === 0) return;

    // Read post dimensions from inputs (in inches → meters)
const n = 0; // Post size excluded from spacing calculation; visual only
    
    const layersInput = document.getElementById('beamSelect');
    const layers = layersInput ? parseInt(layersInput.value) || 2 : 2;
    const doubleCornerInput = document.getElementById('doubleCornerPost');
    const doubleCorner = doubleCornerInput ? doubleCornerInput.checked : false;

    // Determine the ACTIVE fence type from the sidebar
    const activeCard = document.querySelector('.sb-fence-card.active');
    const activeFenceType = activeCard ? activeCard.getAttribute('data-type') : 'cowboy';

    const allWarnings = [];
    if (fenceLayerGroup) fenceLayerGroup.clearLayers();

    // Group valid lines by fenceType
    const validLines = allLines.filter(ld => ld.points && ld.points.length >= 2);
    const cowboyLines = validLines.filter(ld => (ld.fenceType || activeFenceType) !== 'brick' && (ld.fenceType || activeFenceType) !== 'barbed');
    const brickLines = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'brick');
    const barbedLines = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'barbed');

    let grandTotal = 0, grandPosts = 0, grandBeams = 0;

    // ── Process COWBOY lines ──
    if (cowboyLines.length > 0) {
        const spacingInput = document.getElementById('postSpacing');
        const m_cowboy = Math.min(3, Math.max(1, spacingInput ? parseFloat(spacingInput.value) || 2.5 : 2.5));
        const useDoubleCorner = doubleCorner;

        buildCornerMap(cowboyLines.map(ld => ld.points));

        cowboyLines.forEach(ld => {
            const res = drawFence(ld.points, m_cowboy, n, true, useDoubleCorner, ld.color);
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
    }

    // ── Process BRICK lines ──
    if (brickLines.length > 0) {
        // Support both sidebar (page1) IDs and input_mode IDs
        const readVal = (id1, id2, fallback) => {
            const el = document.getElementById(id1) || document.getElementById(id2);
            return parseFloat(el ? el.value : fallback) || parseFloat(fallback);
        };

        const d = readVal('postSpacingBrick', 'imPostSpacingBrick', '2.5');
        const h = readVal('brickFenceHeight',  'imBrickFenceHeight',  '1.8');

        const brickPrice = readVal('brickPricePerPiece', 'imBrickPrice', '1.05');
        const ppm2       = readVal('brickPpm2',          'imBrickPpm2',  '135');

        // Beam mode: check user override first (imBrickBeamMode), then auto from h
        let n_beam, beamMode;
        const beamSel = document.getElementById('imBrickBeamMode');
        const beamOverride = beamSel ? beamSel.value : 'auto';

        if (beamOverride === '0') {
            n_beam = 0; beamMode = 'none';
        } else if (beamOverride === 'top') {
            n_beam = 1; beamMode = 'top';
        } else if (beamOverride === 'center') {
            n_beam = 1; beamMode = 'center';
        } else if (beamOverride === 'center+top') {
            n_beam = 2; beamMode = 'center+top';
        } else {
            // 'auto' — derive from h
            if (h <= 1.2)      { n_beam = 0; beamMode = 'none'; }
            else if (h < 1.8)  { n_beam = 1; beamMode = 'top'; }
            else if (h < 2.2)  { n_beam = 1; beamMode = 'center'; }
            else               { n_beam = 2; beamMode = 'center+top'; }
        }


        let totalBrickArea = 0;
        let totalBays = 0;
        let totalSpacingSum = 0;
        let totalPillarCount = 0;
        let segCount = 0;

        buildCornerMap(brickLines.map(ld => ld.points));

        // Map scale: we represent beam heights as lateral offsets perpendicular to fence.
        // On a 2D map, "height" can't be shown literally — instead we draw beam indicator
        // lines as SHORT perpendicular tick-dashes centered on the fence line at each bay,
        // resembling structural cross marks. Style varies by beamMode.
        //
        // Visual language:
        //   top beam    → small ▲ perpendicular tick at each bay center (orange)
        //   center beam → small ─ perpendicular tick at each bay center (amber)
        //   2 beams     → both symbols stacked (two ticks, different colors)

function drawBeamSymbol(bayStartPt, bayEndPt, segBearing, mode) {
    const midLat = (bayStartPt[0] + bayEndPt[0]) / 2;
    const midLon = (bayStartPt[1] + bayEndPt[1]) / 2;
    const mid = [midLat, midLon];
    const perpB = segBearing + 90;
    const tickHalf = 0.65;

    // top beam  = solid ORANGE  #ea580c  weight 3
    // center beam = solid BLUE  #2563eb  weight 3  (distinct from top)
    const drawTick = (pt, color, weight) => {
        const t1 = offPt(pt, perpB,       tickHalf);
        const t2 = offPt(pt, perpB + 180, tickHalf);
        L.polyline([t1, t2], { color, weight, opacity: 0.95, dashArray: null })
            .addTo(fenceLayerGroup);
        L.circleMarker(pt, {
            radius: 3, color, fillColor: color, fillOpacity: 1, weight: 1.5
        }).addTo(fenceLayerGroup);
    };

    if (mode === 'top') {
        // single solid orange tick at midpoint
        drawTick(mid, '#ea580c', 3);
    } else if (mode === 'center') {
        // single solid blue tick at midpoint
        drawTick(mid, '#2563eb', 3);
    } else if (mode === 'center+top') {
        // two ticks offset slightly along the fence so both are visible
        const offset = 0.32;
        const ptTop    = offPt(mid, segBearing,       offset); // top beam (orange)
        const ptCenter = offPt(mid, segBearing + 180, offset); // center beam (blue)
        drawTick(ptTop,    '#ea580c', 3); // orange = top
        drawTick(ptCenter, '#2563eb', 3); // blue   = center
    }
}

        brickLines.forEach(ld => {
            const pts = ld.points;
            const numSegs = pts.length - 1;
            let cumulDist = 0;

            for (let si = 0; si < numSegs; si++) {
                const p0 = pts[si], p1 = pts[si + 1];
                const A_i = hav(p0, p1);
                grandTotal += A_i;

                // r_i = ⌈A_i / d⌉  →  d' = A_i / r_i
                const r_i = Math.max(1, Math.ceil(A_i / d));
                const d_prime = A_i / r_i;

                totalBays += r_i;
                totalSpacingSum += d_prime;
                totalPillarCount += (r_i + 1);
                totalBrickArea += A_i * h;
                segCount++;

                const segB = bearing(p0, p1);

                // Draw wall line
                const steps = Math.max(2, Math.ceil(A_i * 4));
                const linePts = [];
                for (let s = 0; s <= steps; s++) {
                    linePts.push(interp(pts, cumulDist + A_i * s / steps));
                }
                L.polyline(linePts, { color: ld.color || '#b45309', weight: 5, opacity: 0.85 }).addTo(fenceLayerGroup);

                // Draw pillars + beam symbols per bay
                for (let bi = 0; bi < r_i; bi++) {
                    const distStart = cumulDist + bi * d_prime;
                    const distEnd   = cumulDist + (bi + 1) * d_prime;
                    const ptStart   = interp(pts, distStart);
                    const ptEnd     = interp(pts, Math.min(distEnd, cumulDist + A_i));

                    // Pillar at bay start
                    drawPost(ptStart, segB, bi === 0 ? 'endpoint' : 'normal');

                    // Beam symbol inside this bay (if any beams)
                    if (beamMode !== 'none') {
                        drawBeamSymbol(ptStart, ptEnd, segB, beamMode);
                    }
                }
                // Final pillar at segment end
                drawPost(interp(pts, cumulDist + A_i), segB,
                    si === numSegs - 1 ? 'endpoint' : 'normal');

                cumulDist += A_i;
            }

            grandPosts += totalPillarCount;
        });

        const brickCount    = totalBrickArea * ppm2;
        const beamCount     = totalBays * n_beam;
        grandBeams         += beamCount;

        const brickTotalPrice = brickCount * 1.05 * brickPrice;

        window._brickCalcResult = {
            totalPrice:  brickTotalPrice,
            brickCount:  brickCount,
            totalBays:   totalBays,
            avgSpacing:  segCount > 0 ? totalSpacingSum / segCount : d,
            beamCount:   beamCount,
            n_beam,
            beamMode,
            h
        };
    }

    // ── Process BARBED WIRE lines ──
    if (barbedLines.length > 0) {
        const spacingInput = document.getElementById('postSpacingBarbed');
        const m_barbed = Math.min(3, Math.max(1, spacingInput ? parseFloat(spacingInput.value) || 2.5 : 2.5));
        
        // Get barbed wire post size
const n_barbed = 0;
        
        const nBraceSolo = document.getElementById('nBraceSolo')?.checked ?? false;
        const nBraceDual = document.getElementById('nBraceDual')?.checked ?? false;
        const nBraceAngle = document.getElementById('nBraceAngle')?.checked ?? false;
        
        barbedLines.forEach(ld => {
            const res = drawBarbedWireFence(ld.points, { 
                nBraceSolo, 
                nBraceDual, 
                nBraceAngle,
                postSize: n_barbed,
                spacing: m_barbed
            });
            grandTotal += res.grandTotal;
            grandPosts += res.totalPosts;
        });
    }

const hasBrick = brickLines.length > 0;

    // ── Helper: write results to a given set of element IDs ──
    function writeResults(ids) {
        const totalInput = document.getElementById(ids.total);
        if (totalInput) totalInput.value = grandTotal.toFixed(2);

        const postsInput = document.getElementById(ids.posts);
        if (postsInput) postsInput.value = grandPosts;

        const beamsInput = document.getElementById(ids.beams);
        const beamsRow   = document.getElementById(ids.beamsRow);
        const beamsLabel = beamsInput?.closest('.sbr-row-item')?.querySelector('.sbr-label');
        const beamsUnit  = beamsInput?.closest('.sbr-field-row')?.querySelector('.sbr-unit');

        if (hasBrick && window._brickCalcResult) {
            const br = window._brickCalcResult;
            const brickCountWithWaste = Math.ceil(br.brickCount * 1.05);
            if (beamsInput)  beamsInput.value = brickCountWithWaste.toLocaleString('th-TH');
            if (beamsLabel)  beamsLabel.textContent = 'จำนวนอิฐ (รวม +5%)';
            if (beamsUnit)   beamsUnit.textContent  = 'ก้อน';
        } else {
            if (beamsInput)  beamsInput.value = grandBeams;
            if (beamsLabel)  beamsLabel.textContent = 'จำนวนคานที่ต้องใช้';
            if (beamsUnit)   beamsUnit.textContent  = 'อัน';
        }

        // Price
        const priceInput = document.getElementById(ids.price);
        if (priceInput) {
            if (hasBrick && window._brickCalcResult) {
                const br = window._brickCalcResult;
                const brickPrice = parseFloat(
                    (document.getElementById('brickPricePerPiece') || document.getElementById('imBrickPrice'))?.value
                ) || 1.05;
                const brickCount = Math.ceil(br.brickCount * 1.05);
                priceInput.value = (brickCount * brickPrice).toLocaleString('th-TH', { maximumFractionDigits: 0 });
            } else {
                const price = grandTotal * 850;
                priceInput.value = price.toLocaleString('th-TH', { maximumFractionDigits: 0 });
            }
        }

        // Warnings
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

    // Write to Page 1 (draw mode)
    writeResults({
        total:    'resTotal',
        posts:    'resPosts',
        beams:    'resBeams',
        beamsRow: null,
        price:    'resPriceDisplay',
        warnings: 'fenceWarnings'
    });

    // Write to Page 2 (input mode)
    writeResults({
        total:    'imResTotal',
        posts:    'imResPosts',
        beams:    'imResBeams',
        beamsRow: 'imResBeamsRow',
        price:    'imResPriceDisplay',
        warnings: 'imFenceWarnings'
    });
}

// ============================================
// BARBED WIRE FENCE — รั้วลวดหนาม
// ============================================
// Options (read from checkboxes):
//   nBraceSolo   — arrow markers at start & end (directional support posts)
//   nBraceDual   — cross markers every 50m along the fence
//   nBraceAngle  — double-post at every corner (same as ใช้เสา 2 ต้นที่มุมต่อ)

// ============================================
// BARBED WIRE FENCE — รั้วลวดหนาม
// ============================================
function drawBarbedWireFence(linePoints, options) {
    const { nBraceSolo, nBraceDual, nBraceAngle, postSize, spacing } = options;
    const n = postSize || (parseFloat(document.getElementById('postSizeWidthBarbed')?.value) || 6) * 0.0254;
    const m = spacing || Math.min(3, Math.max(1, parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5));
    const total = totalLen(linePoints);

    // Draw the wire lines (3 strands)
    const strandOffsets = [-0.3, 0, 0.3];
    strandOffsets.forEach((_, si) => {
        const pts = [];
        const steps = Math.max(4, Math.ceil(total * 4));
        for (let i = 0; i <= steps; i++) pts.push(interp(linePoints, total * i / steps));
        L.polyline(pts, {
            color: '#4b5563',
            weight: si === 1 ? 3 : 1.5,
            opacity: 0.85,
            dashArray: si === 1 ? null : '6,4'
        }).addTo(fenceLayerGroup);
    });

    // Draw regular line posts along the fence
    let d = 0;
    let postCount = 0;
    while (d <= total + 1e-4) {
        const pt = interp(linePoints, Math.min(d, total));
        const b = bearingAt(linePoints, Math.min(d, total));
        drawPost(pt, b, (d < 1e-3 || d >= total - 1e-3) ? 'endpoint' : 'normal');
        d += m;
        postCount++;
    }

    // N-BRACE SOLO — arrow markers at start and end
    if (nBraceSolo) {
        _drawNBraceArrow(linePoints[0], bearing(linePoints[0], linePoints[1]), 'start');
        const last = linePoints[linePoints.length - 1];
        const prev = linePoints[linePoints.length - 2];
        _drawNBraceArrow(last, bearing(prev, last), 'end');
    }

    // N-BRACE DUAL — cross markers every 50m
    if (nBraceDual) {
        let crossD = 50;
        while (crossD < total - 25) {
            const pt = interp(linePoints, crossD);
            const b = bearingAt(linePoints, crossD);
            _drawNBraceCross(pt, b);
            crossD += 50;
        }
    }

    // N-BRACE ANGLE — double post at each corner
    if (nBraceAngle) {
        buildCornerMap([linePoints]);
        for (const [k, entry] of cornerMap.entries()) {
            drawDoubleCornerPost(entry.pt, n, false);
        }
    }

    return { grandTotal: total, totalPosts: postCount };
}

// Draw a directional support-post arrow (N-brace solo indicator)
// direction: 'start' draws > pointing inward, 'end' draws < pointing inward
function _drawNBraceArrow(pt, b, direction) {
    const armLen = 1.5; // meters, length of each brace arm
    // Brace arms angle 45° off the fence on each side
    const bInward = direction === 'start' ? b : (b + 180);
    const arm1End = offPt(offPt(pt, bInward, armLen), bInward + 90, armLen);
    const arm2End = offPt(offPt(pt, bInward, armLen), bInward - 90, armLen);

    [arm1End, arm2End].forEach(armEnd => {
        L.polyline([pt, armEnd], {
            color: '#dc2626',
            weight: 3,
            opacity: 0.9,
            dashArray: '4,3'
        }).addTo(fenceLayerGroup);
    });

    // Small circle at the brace tip
    L.circleMarker(pt, {
        radius: 5,
        color: '#dc2626',
        fillColor: '#fca5a5',
        fillOpacity: 1,
        weight: 2
    }).addTo(fenceLayerGroup);
}

// Draw an X cross marker (N-brace dual, every 50m)
function _drawNBraceCross(pt, b) {
    const armLen = 1.2;
    const corners = [
        [offPt(pt, b + 45,  armLen), offPt(pt, b + 225, armLen)],
        [offPt(pt, b + 135, armLen), offPt(pt, b + 315, armLen)],
    ];
    corners.forEach(pair => {
        L.polyline(pair, {
            color: '#1d4ed8',
            weight: 2.5,
            opacity: 0.9
        }).addTo(fenceLayerGroup);
    });
    L.circleMarker(pt, {
        radius: 4,
        color: '#1d4ed8',
        fillColor: '#93c5fd',
        fillOpacity: 1,
        weight: 2
    }).addTo(fenceLayerGroup);
}

// "คำนวนวัสดุ" — calculate and draw

// "สร้างแผน" — clear
document.getElementById('clearFenceBtn')?.addEventListener('click', function() {
    fenceLayerGroup.clearLayers();
    swappedCorners.clear();
    ['resTotal','resPosts','resBeams','resPrice'].forEach(id => document.getElementById(id).value='');
    document.getElementById('fenceWarnings').style.display = 'none';
});

// ============================================
// คานทับหลัง — checkbox UI sync
// ============================================
function onBeamCbChange() {
    const cbTop    = document.getElementById('beamCbTop');
    const cbCenter = document.getElementById('beamCbCenter');
    const hidden   = document.getElementById('imBrickBeamMode');
    const label    = document.getElementById('beamAutoLabel');
    if (!cbTop || !cbCenter || !hidden) return;

    const top    = cbTop.checked;
    const center = cbCenter.checked;

    let mode;
    if (top && center)   mode = 'center+top';
    else if (top)        mode = 'top';
    else if (center)     mode = 'center';
    else                 mode = '0';

    hidden.value = mode;
    if (label) label.textContent = '(ปรับด้วยตนเอง — ยกเลิกอัตโนมัติ)';
    if (typeof runFenceCalc === 'function') runFenceCalc();
}

// Auto-tick checkboxes based on brick fence height — call after height changes
function syncBeamCheckboxesToHeight(h) {
    const cbTop    = document.getElementById('beamCbTop');
    const cbCenter = document.getElementById('beamCbCenter');
    const hidden   = document.getElementById('imBrickBeamMode');
    const label    = document.getElementById('beamAutoLabel');
    if (!cbTop || !cbCenter) return;

    let mode;
    if (h <= 1.2)      { mode = '0';          cbTop.checked = false; cbCenter.checked = false; }
    else if (h < 1.8)  { mode = 'top';        cbTop.checked = true;  cbCenter.checked = false; }
    else if (h < 2.2)  { mode = 'center';     cbTop.checked = false; cbCenter.checked = true;  }
    else               { mode = 'center+top'; cbTop.checked = true;  cbCenter.checked = true;  }

    if (hidden) hidden.value = mode;

    syncPillarSizeOptions(h);
}

function syncPillarSizeOptions(h) {
    const sel = document.getElementById('brickPillarSize');
    if (!sel) return;
    const prev = sel.value;
    let opts;
    if (h <= 1.5) {
        opts = [
            { value: '10x10', label: '10×10 ซม. (default)' },
            { value: '15x15', label: '15×15 ซม.' },
            { value: 'custom', label: 'กำหนดเอง…' }
        ];
    } else {
        opts = [
            { value: '15x15', label: '15×15 ซม. (default)' },
            { value: '20x20', label: '20×20 ซม.' },
            { value: 'custom', label: 'กำหนดเอง…' }
        ];
    }
    sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    // Restore previous selection if it still exists in new list
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    onPillarSizeChange(sel.value);
}

function onPillarSizeChange(val) {
    const customInput = document.getElementById('brickPillarCustom');
    const customLabel = document.getElementById('brickPillarCustomLabel');
    if (customInput) customInput.style.display = val === 'custom' ? '' : 'none';
    if (customLabel) customLabel.style.display = val === 'custom' ? '' : 'none';
}

// Init beam checkboxes on load
document.addEventListener('DOMContentLoaded', () => {
    const h = parseFloat(document.getElementById('brickFenceHeight')?.value) || 1.8;
    syncBeamCheckboxesToHeight(h);
});

function getDefaultPillarSize(h) {
    return h <= 1.5 ? '10x10' : '15x15';
}

function syncPillarSizeOptions(h) {
    const sel = document.getElementById('brickPillarSize');
    if (!sel) return;
    const current = sel.value;
    let opts;
    if (h <= 1.5) {
        opts = [
            { value: '10x10', label: '10×10 ซม. (default)' },
            { value: '15x15', label: '15×15 ซม.' },
            { value: 'custom', label: 'กำหนดเอง…' }
        ];
    } else {
        opts = [
            { value: '15x15', label: '15×15 ซม. (default)' },
            { value: '20x20', label: '20×20 ซม.' },
            { value: 'custom', label: 'กำหนดเอง…' }
        ];
    }
    sel.innerHTML = opts.map(o =>
        `<option value="${o.value}">${o.label}</option>`
    ).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
    onPillarSizeChange(sel.value);
}

function onPillarSizeChange(val) {
    const customInput = document.getElementById('brickPillarCustom');
    const customLabel = document.getElementById('brickPillarCustomLabel');
    if (customInput) customInput.style.display = val === 'custom' ? '' : 'none';
    if (customLabel) customLabel.style.display = val === 'custom' ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    const h = parseFloat(document.getElementById('brickFenceHeight')?.value) || 1.8;
    syncBeamCheckboxesToHeight(h);
    syncPillarSizeOptions(h);
});