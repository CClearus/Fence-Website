// ============================================
// BARBED WIRE FENCE — Calculation and Drawing
// ============================================

function _showSharpAngleToast(count, extraPosts, spacing) {
    const old = document.getElementById('sharpAngleToast');
    if (old) old.remove();
    if (window._sharpToastTimer) clearTimeout(window._sharpToastTimer);
    
    const toast = document.createElement('div');
    toast.id = 'sharpAngleToast';
    toast.innerHTML = `
        <span style="font-size:15px;line-height:1;">🔶</span>
        <span>พบมุม &lt;60° จำนวน <strong>${count}</strong> มุม<br>
        เพิ่มเสา <strong>${extraPosts}</strong> ต้น · เพิ่มระยะ <strong>${(extraPosts * spacing).toFixed(1)}</strong> ม.</span>
        <button onclick="document.getElementById('sharpAngleToast').remove()"
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

    window._sharpToastTimer = setTimeout(() => {
        const t = document.getElementById('sharpAngleToast');
        if (t) {
            t.style.cssText += 'transition:opacity 0.4s;opacity:0;';
            setTimeout(() => { const t2 = document.getElementById('sharpAngleToast'); if (t2) t2.remove(); }, 400);
        }
    }, 6000);
}

function calcBarbed(barbedLines, m_barbed, n_barbed, nBraceSolo, nBraceDual, nBraceAngle) {
    let grandTotal = 0, grandPosts = 0;
    const allWarnings = [];
    let totalSharpAngles = 0, totalExtraSections = 0, totalExtraLength = 0;

    barbedLines.forEach(ld => {
        const linePoints = ld.points;
        const n = n_barbed || (parseFloat(document.getElementById('postSizeWidthBarbed')?.value) || 6) * 0.0254;
        const m = m_barbed || Math.min(3, Math.max(1, parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5));
        const total = totalLen(linePoints);

        function interiorAngleAt(i) {
            if (i <= 0 || i >= linePoints.length - 1) return 180;
            const bIn = bearing(linePoints[i - 1], linePoints[i]);
            const bOut = bearing(linePoints[i], linePoints[i + 1]);
            let diff = ((bOut - bIn + 540) % 360) - 180;
            return 180 - Math.abs(diff);
        }

        const sharpCorners = [];
        for (let i = 1; i < linePoints.length - 1; i++) {
            const ang = interiorAngleAt(i);
            if (ang < 60) {
                let distToCorner = 0;
                for (let k = 0; k < i; k++) distToCorner += hav(linePoints[k], linePoints[k + 1]);
                sharpCorners.push({ idx: i, angle: ang, dist: distToCorner });
            }
        }

        // All intermediate vertex corners (any bend, not just sharp)
        const allCorners = [];
        for (let i = 1; i < linePoints.length - 1; i++) {
            let distToCorner = 0;
            for (let k = 0; k < i; k++) distToCorner += hav(linePoints[k], linePoints[k + 1]);
            allCorners.push({ idx: i, dist: distToCorner });
        }

        // Draw wire strands
        const strandOffsets = [-0.3, 0, 0.3];
        strandOffsets.forEach((_, si) => {
            const pts = [];
            const steps = Math.max(4, Math.ceil(total * 4));
            for (let i = 0; i <= steps; i++) pts.push(interp(linePoints, total * i / steps));
            L.polyline(pts, {
                color: '#4b5563', weight: si === 1 ? 3 : 1.5, opacity: 0.85, dashArray: si === 1 ? null : '6,4'
            }).addTo(fenceLayerGroup);
        });

        // Highlight sharp corners
        sharpCorners.forEach(({ idx }) => {
            L.circleMarker(linePoints[idx], {
                radius: 10, color: '#f97316', weight: 3,
                fillColor: '#fed7aa', fillOpacity: 0.55, opacity: 1
            }).addTo(fenceLayerGroup);
        });

        // Draw posts
        let d = 0, postCount = 0;
        while (d <= total + 1e-4) {
            const pt = interp(linePoints, Math.min(d, total));
            const b = bearingAt(linePoints, Math.min(d, total));
            drawPost(pt, b, (d < 1e-3 || d >= total - 1e-3) ? 'endpoint' : 'normal');
            d += m;
            postCount++;
        }

        let extraPosts = 0, extraLength = 0;
        sharpCorners.forEach(({ idx, dist }) => {
            const extraDist = Math.max(0, dist - m);
            if (extraDist > 1e-3) {
                drawPost(interp(linePoints, extraDist), bearingAt(linePoints, extraDist), 'normal');
                extraPosts++; extraLength += m;
            }
        });
        postCount += extraPosts;

        // ── N-Brace symbol helpers (map mode) ──

        // ANGLE: purple diamond ◇ — intermediate corners only
        function drawNBraceAngleMap(pt, b) {
            const sz = 1.5;
            const top    = offPt(pt, b,       sz);
            const bottom = offPt(pt, b + 180, sz);
            const left   = offPt(pt, b + 90,  sz);
            const right  = offPt(pt, b - 90,  sz);
            L.polyline([top, right, bottom, left, top], {
                color: '#7c3aed', weight: 2.5, opacity: 0.9
            }).addTo(fenceLayerGroup);
            L.circleMarker(pt, {
                radius: 5, color: '#7c3aed', fillColor: '#ede9fe', fillOpacity: 1, weight: 2
            }).addTo(fenceLayerGroup);
        }

        // DUAL: blue X ✕ — mid-line every 50 m only
        function drawNBraceDualMap(pt, b) {
            const sz = 1.5;
            const p1 = offPt(offPt(pt, b + 90, sz), b,       sz);
            const p2 = offPt(offPt(pt, b - 90, sz), b + 180, sz);
            const p3 = offPt(offPt(pt, b - 90, sz), b,       sz);
            const p4 = offPt(offPt(pt, b + 90, sz), b + 180, sz);
            L.polyline([p1, p2], { color: '#1d4ed8', weight: 2.5, opacity: 0.9 }).addTo(fenceLayerGroup);
            L.polyline([p3, p4], { color: '#1d4ed8', weight: 2.5, opacity: 0.9 }).addTo(fenceLayerGroup);
            L.circleMarker(pt, {
                radius: 5, color: '#1d4ed8', fillColor: '#93c5fd', fillOpacity: 1, weight: 2
            }).addTo(fenceLayerGroup);
        }

        // SOLO: red V-arrow ↗↘ — endpoints only, drawn LAST so always on top
        function drawNBraceSoloMap(pt, b, direction) {
            const armLen = 1.5;
            const bInward = direction === 'start' ? b : (b + 180);
            const arm1End = offPt(offPt(pt, bInward, armLen), bInward + 90, armLen);
            const arm2End = offPt(offPt(pt, bInward, armLen), bInward - 90, armLen);
            [arm1End, arm2End].forEach(armEnd => {
                L.polyline([pt, armEnd], {
                    color: '#dc2626', weight: 3, opacity: 0.9, dashArray: '4,3'
                }).addTo(fenceLayerGroup);
            });
            L.circleMarker(pt, {
                radius: 5, color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 1, weight: 2
            }).addTo(fenceLayerGroup);
        }

        // Draw order: angle → dual → solo (solo always renders on top)

        if (nBraceAngle) {
            // intermediate vertex corners only — never endpoints
            allCorners.forEach(({ dist }) => {
                drawNBraceAngleMap(interp(linePoints, dist), bearingAt(linePoints, dist));
            });
        }

        if (nBraceDual) {
            // every 50 m intervals only — never endpoints
            let crossD = 50;
            while (crossD < total - 1) {
                drawNBraceDualMap(interp(linePoints, crossD), bearingAt(linePoints, crossD));
                crossD += 50;
            }
        }

        if (nBraceSolo) {
            // endpoints only — always drawn last so red wins
            drawNBraceSoloMap(linePoints[0], bearing(linePoints[0], linePoints[1]), 'start');
            const last = linePoints[linePoints.length - 1];
            const prev = linePoints[linePoints.length - 2];
            drawNBraceSoloMap(last, bearing(prev, last), 'end');
        }

        grandTotal += total + extraLength;
        grandPosts += postCount;
        totalSharpAngles += sharpCorners.length;
        totalExtraSections += extraPosts;
        totalExtraLength += extraLength;
    });

    if (totalSharpAngles > 0) {
        _showSharpAngleToast(totalSharpAngles, totalExtraSections, m_barbed);
    }

    return { grandTotal, grandPosts, grandBeams: 0, warnings: allWarnings };
}

// ============================================
// BARBED WIRE FENCE — Plan Mode Drawing
// ============================================
function drawPlanBarbedLine(lineData, idx) {
    const pts = lineData.points;
    if (!pts || pts.length < 2) return;
    const m = Math.min(3, Math.max(1, parseFloat(document.getElementById('postSpacingBarbed')?.value) || 2.5));
    const total = totalLen(pts);

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

    // All intermediate vertex corners (any bend)
    const allCorners = [];
    for (let i = 1; i < pts.length - 1; i++) {
        let distToCorner = 0;
        for (let k = 0; k < i; k++) distToCorner += hav(pts[k], pts[k + 1]);
        allCorners.push({ idx: i, dist: distToCorner });
    }

    const GAP = 0.25;
    const cutPoints = [];
    sharpCorners.forEach(({ dist }) => {
        cutPoints.push({ gapStart: Math.max(0, dist - GAP), gapEnd: Math.min(total, dist + GAP) });
    });

    const wireSegments = [];
    let cursor = 0;
    cutPoints.forEach(({ gapStart, gapEnd }) => {
        if (gapStart > cursor + 0.01) wireSegments.push([cursor, gapStart]);
        cursor = gapEnd;
    });
    if (cursor < total - 0.01) wireSegments.push([cursor, total]);
    if (wireSegments.length === 0) wireSegments.push([0, total]);

    // Draw wire strands
    const strandOffsets = [-0.3, 0, 0.3];
    strandOffsets.forEach((_, si) => {
        wireSegments.forEach(([segFrom, segTo]) => {
            const steps = Math.max(3, Math.ceil((segTo - segFrom) * 4));
            const wPts = [];
            for (let i = 0; i <= steps; i++) {
                wPts.push(interp(pts, segFrom + (segTo - segFrom) * i / steps));
            }
            L.polyline(wPts, {
                color: '#4b5563',
                weight: si === 1 ? 3 : 1.5,
                opacity: 0.85,
                dashArray: si === 1 ? null : '6,4'
            }).addTo(planLayerGroup);
        });
    });

    // Highlight sharp corners
    sharpCorners.forEach(({ idx }) => {
        L.circleMarker(pts[idx], {
            radius: 10, color: '#f97316', weight: 3,
            fillColor: '#fed7aa', fillOpacity: 0.55, opacity: 1
        }).addTo(planLayerGroup);
    });

    // Draw posts
    const postPositions = [];
    let d = 0;
    while (d <= total + 1e-4) {
        const pt = interp(pts, Math.min(d, total));
        const b = bearingAt(pts, Math.min(d, total));
        const isEnd = d < 1e-3 || d >= total - 1e-3;
drawPlanPost(pt, b, isEnd, 0.15, 'barbed');
        postPositions.push({ dist: d, pt, b });
        d += m;
    }

    sharpCorners.forEach(({ dist }) => {
        const extraDist = Math.max(0, dist - m);
        if (extraDist > 1e-3) {
const pt = interp(pts, extraDist);
            const b = bearingAt(pts, extraDist);
            drawPlanPost(pt, b, false, 0.15, 'barbed');
        }
    });

    // Line label
    L.marker(pts[0], {
        icon: L.divIcon({
            className: '',
            html: `<div style="font-size:12px;font-weight:bold;color:#374151;background:#f9fafb;padding:4px 8px;border:2px solid #4b5563;white-space:nowrap;border-radius:2px;box-shadow:2px 2px 0px rgba(0,0,0,0.1);">Line ${idx + 1} (ลวดหนาม)</div>`,
            iconSize: null, iconAnchor: [0, 0]
        }),
        zIndexOffset: 1600
    }).addTo(planLayerGroup);

    // Span dimension lines
    for (let i = 0; i < postPositions.length - 1; i++) {
        const p0 = postPositions[i].pt;
        const p1 = postPositions[i + 1].pt;
        const spanLen = hav(p0, p1);
        const offset = 0.3 + (i % 2) * 0.15;
        drawDimLine(p0, p1, offset, spanLen.toFixed(2) + 'm', '#374151');
    }

    // Segment dimension lines
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = hav(p0, p1);
        drawDimLine(p0, p1, 0.8, segLen.toFixed(2) + 'm', '#374151');
    }

    const nbSolo  = (document.getElementById('nBraceSolo')  || document.getElementById('imNBraceSolo'))?.checked  ?? false;
    const nbDual  = (document.getElementById('nBraceDual')  || document.getElementById('imNBraceDual'))?.checked  ?? false;
    const nbAngle = (document.getElementById('nBraceAngle') || document.getElementById('imNBraceAngle'))?.checked ?? false;

    // ── N-Brace symbol helpers (plan mode) ──

    // ANGLE: purple diamond ◇ — intermediate corners only
    function drawNBraceAnglePlan(pt, b) {
        const sz = 0.4;
        const top    = offPt(pt, b,       sz);
        const bottom = offPt(pt, b + 180, sz);
        const left   = offPt(pt, b + 90,  sz);
        const right  = offPt(pt, b - 90,  sz);
        L.polyline([top, right, bottom, left, top], {
            color: '#7c3aed', weight: 2, opacity: 0.9
        }).addTo(planLayerGroup);
        L.circleMarker(pt, {
            radius: 5, color: '#7c3aed', fillColor: '#ede9fe', fillOpacity: 1, weight: 1.5
        }).addTo(planLayerGroup);
    }

    // DUAL: blue X ✕ — mid-line every 50 m only
    function drawNBraceDualPlan(pt, b) {
        const sz = 0.4;
        const p1 = offPt(offPt(pt, b + 90, sz), b,       sz);
        const p2 = offPt(offPt(pt, b - 90, sz), b + 180, sz);
        const p3 = offPt(offPt(pt, b - 90, sz), b,       sz);
        const p4 = offPt(offPt(pt, b + 90, sz), b + 180, sz);
        L.polyline([p1, p2], { color: '#1d4ed8', weight: 1.5, opacity: 0.9 }).addTo(planLayerGroup);
        L.polyline([p3, p4], { color: '#1d4ed8', weight: 1.5, opacity: 0.9 }).addTo(planLayerGroup);
        L.circleMarker(pt, {
            radius: 5, color: '#1d4ed8', fillColor: '#93c5fd', fillOpacity: 1, weight: 1.5
        }).addTo(planLayerGroup);
    }

    // SOLO: red V-arrow ↗↘ — endpoints only, drawn LAST so always on top
    function drawNBraceSoloPlan(pt, b, direction) {
        const sz = 0.4;
        const bInward = direction === 'start' ? b : (b + 180);
        const arm1End = offPt(offPt(pt, bInward, sz), bInward + 90, sz);
        const arm2End = offPt(offPt(pt, bInward, sz), bInward - 90, sz);
        [arm1End, arm2End].forEach(armEnd => {
            L.polyline([pt, armEnd], {
                color: '#dc2626', weight: 2, opacity: 0.9, dashArray: '4,3'
            }).addTo(planLayerGroup);
        });
        L.circleMarker(pt, {
            radius: 5, color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 1, weight: 1.5
        }).addTo(planLayerGroup);
    }

    // Draw order: angle → dual → solo (solo always renders on top)

if (nbAngle) {
        // intermediate vertex corners only — never endpoints
        allCorners.forEach(({ dist }) => {
            drawNBraceAnglePlan(interp(pts, dist), bearingAt(pts, dist));
        });
    }

    // ── Draw angle symbols at every intermediate vertex ──
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1];
        const vertex = pts[i];
        const next = pts[i + 1];

        const bIn  = bearing(prev, vertex);
        const bOut = bearing(vertex, next);

        // Interior angle (always 0–180)
        let diff = ((bOut - bIn + 540) % 360) - 180;
        const interiorAngle = 180 - Math.abs(diff);
        const angleDeg = Math.round(interiorAngle);

        // Which side is the outside of the bend?
        // diff > 0 = right turn, outside is left (+90); diff < 0 = left turn, outside is right (-90)
        const outsideSide = diff > 0 ? -90 : 90;

        const radius = 0.35;
        const isRight = Math.abs(interiorAngle - 90) < 5;

        if (isRight) {
            // Square corner symbol
            const boxSz = radius * 0.75;
            const c1 = offPt(vertex, bIn + 180, boxSz);           // back along incoming
            const c2 = offPt(c1, bOut, boxSz);                    // across to corner
            const c3 = offPt(vertex, bOut, boxSz);                // forward along outgoing
            L.polyline([c1, c2, c3], {
                color: '#2563eb', weight: 1.5, opacity: 0.9
            }).addTo(planLayerGroup);
            L.polygon([vertex, c1, c2, c3], {
                color: 'transparent', fillColor: '#3b82f6', fillOpacity: 0.15
            }).addTo(planLayerGroup);
        } else {
            // Arc symbol — sweep from incoming direction to outgoing direction on outside
            const steps = 20;
            const arcPts = [];
            // Start angle: pointing back along incoming from vertex
            let startA = (bIn + 180) % 360;
            // End angle: pointing forward along outgoing from vertex
            let endA = bOut % 360;

            // Sweep the short way around (interior side)
            let sweep = ((endA - startA) + 360) % 360;
            if (sweep > 180) sweep -= 360;  // take the short arc

            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                arcPts.push(offPt(vertex, startA + sweep * t, radius));
            }
            L.polyline(arcPts, {
                color: '#2563eb', weight: 1.5, opacity: 0.9
            }).addTo(planLayerGroup);
            L.circleMarker(vertex, {
                radius: 2.5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1, weight: 1
            }).addTo(planLayerGroup);
        }

        // Angle label — placed on the outside of the bend
        const bisectA = (bIn + 180 + (((bOut - (bIn + 180) + 540) % 360) / 2)) % 360;
        const labelPt = offPt(vertex, bisectA, radius + 0.35);
        L.marker(labelPt, {
            icon: L.divIcon({
                className: '',
                html: `<div style="font-size:10px;font-weight:700;color:#1e40af;background:rgba(255,255,255,0.92);padding:2px 4px;border:1px solid #93c5fd;border-radius:2px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.1);">${angleDeg}°</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            }),
            zIndexOffset: 1700
        }).addTo(planLayerGroup);
    }


    if (nbDual) {
        // every 50 m intervals only — never endpoints
        for (let dist = 50; dist < total - 1; dist += 50) {
            drawNBraceDualPlan(interp(pts, dist), bearingAt(pts, dist));
        }
    }

    if (nbSolo) {
        // endpoints only — always drawn last so red wins
        drawNBraceSoloPlan(pts[0], bearingAt(pts, 0), 'start');
        drawNBraceSoloPlan(pts[pts.length - 1], bearingAt(pts, total), 'end');
    }
}