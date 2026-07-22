// ============================================
// FENCE CORE & COORDINATOR
// ============================================

// ── Globals ──────────────────────────────────
let fenceLayerGroup = L.layerGroup().addTo(map);
const PRICE_PER_M = 850;

// ── Default prices per fence type (baht/meter, except brick which is baht/piece) ──
const FENCE_PRICE_DEFAULTS = {
    cowboy: 850,
    barbed: 850,
    concrete: 850
};

// ── Cowboy fence: granular per-post / per-beam pricing ──────────────────────
// Post price depends on which layer count (2/3/4 ชั้น) is selected. Beam
// price only has a known reference value at the 2.5 m spacing; any other
// spacing (2.0 m or a custom value) has no default and is left for the user
// to fill in manually.
const COWBOY_POST_PRICE_DEFAULTS = { '2': 414, '3': 495, '4': 576 };
const COWBOY_BEAM_PRICE_BY_SPACING = { '2.5': 303 };

// Syncs the "ราคาเสาต้นละ" input to the default price for whichever post
// layer (2/3/4 ชั้น) is currently selected. Called whenever beamSelect
// changes, and once on page load. Overwrites any manual edit — same
// behavior as updateBrickDefaults() does for brick price on brick-type
// change — so the ↺ reset button and simply re-picking the same layer both
// land on the same known-good default.
window.syncCowboyPostPrice = function () {
    const sel = _activeCornerCheckbox('beamSelect', 'imBeamSelect');
    const priceEl = _activeCornerCheckbox('cowboyPostPrice', 'imCowboyPostPrice');
    if (!sel || !priceEl) return;
    const def = COWBOY_POST_PRICE_DEFAULTS[sel.value];
    if (def !== undefined) priceEl.value = def;
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

// Corner posts (a post sitting at a corner — see cowboy.js's cornerPosts
// tally) have no independent reference price of their own, so the ↺ reset
// just re-syncs to the same per-layer default as a plain post — a safe
// starting point the user can bump up manually for a beefier corner post.
window.syncCowboyCornerPostPrice = function () {
    const sel = _activeCornerCheckbox('beamSelect', 'imBeamSelect');
    const priceEl = _activeCornerCheckbox('cowboyCornerPostPrice', 'imCowboyCornerPostPrice');
    if (!sel || !priceEl) return;
    const def = COWBOY_POST_PRICE_DEFAULTS[sel.value];
    if (def !== undefined) priceEl.value = def;
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

// Syncs the "ราคาคานละ" input to the reference price for the currently
// selected spacing. Only 2.5 m has a known reference price — switching to
// 2.0 m or "กำหนดเอง…" (custom) clears the field so the user must enter a
// price themselves (there's no made-up default to fall back on for those).
window.syncCowboyBeamPrice = function () {
    const sel = _activeCornerCheckbox('spacingSelect', 'imSpacingSelect');
    const priceEl = _activeCornerCheckbox('cowboyBeamPrice', 'imCowboyBeamPrice');
    if (!sel || !priceEl) return;
    const def = COWBOY_BEAM_PRICE_BY_SPACING[sel.value];
    priceEl.value = (def !== undefined) ? def : '';
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

// ── Spacing lockout state ────────────────────────────────────────────────────
// Tracks whether the user has clicked "ยืนยัน / ดำเนินการต่อ" to ignore the
// tier-2 (m > 3) soft warning.  Reset to false whenever the spacing changes.
window._spacingOverride = false;

// ── Draw-tool lockout helpers ────────────────────────────────────────────────
// Lock/unlock the measure button, eraser, clear-all, and map click.
// Accepts a reason string for the data attribute so multiple callers can
// co-exist without stepping on each other.
window._spacingLocked = false;
function _applyDrawLock(locked) {
    window._spacingLocked = locked;
    const ids = ['measureBtn', 'eraserBtn', 'clearAllBtn'];
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (locked) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.pointerEvents = 'none';
        } else {
            // Only re-enable if the tab-switch code hasn't locked them for its
            // own reason (Tab 2 active).  Peek at the tab state.
            const tab2Active = document.getElementById('sbPage2')?.style.display !== 'none';
            if (!tab2Active) {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            }
        }
    });
    // Also block map drawing by stopping active measure mode
    if (locked && typeof measureActive !== 'undefined' && measureActive) {
        const mBtn = document.getElementById('measureBtn');
        if (mBtn) mBtn.click(); // toggle off
    }
}

// Returns the checkbox that actually reflects the user's current choice:
// Page 2's (imId) when Input Mode is active, Page 1's (pageId) otherwise.
// Falls back to whichever one exists if the tab state can't be read.
//
// This is the general-purpose fix for a whole class of bugs: Page 1's
// fields always exist in the DOM (just hidden, never removed, when Input
// Mode is shown), so a naive `document.getElementById(pageId) ||
// document.getElementById(imId)` ALWAYS resolves to Page 1's element and
// silently ignores whatever the user typed/toggled in Input Mode. Use this
// helper (not raw `||`) for every page1/im id pair, not just corner
// checkboxes — the name is legacy but the logic is generic.
function _activeCornerCheckbox(pageId, imId) {
    if (isInputModeActive()) {
        return document.getElementById(imId) || document.getElementById(pageId);
    }
    return document.getElementById(pageId) || document.getElementById(imId);
}

// Is the Input Mode tab (Page 2 — "ระบบกรอกข้อมูล") currently the visible
// one? Shared by _activeCornerCheckbox and _isNonSquareActive.
function isInputModeActive() {
    const page2El = document.getElementById('sbPage2');
    return page2El ? page2El.style.display !== 'none' : false;
}

// Whether non-square (non-90°) corner mode is active for a given fence type
// ('cowboy' or 'concrete'). Page 1 gates its Mode 1/Mode 2 corner-mode
// radios behind an explicit "โหมดมุมไม่ตั้งฉาก" toggle; Input Mode has no
// such toggle of its own — its corner-mode radios (imCornerModeDouble/
// imCornerModeSingle, or the concrete equivalents) are always shown and
// always meaningful — so being on the Input Mode tab with this type
// currently selected there counts as non-square being active. Otherwise
// falls back to Page 1's real toggle checkbox.
function _isNonSquareActive(type) {
    if (isInputModeActive()) {
        const activeCard = document.querySelector('#imFenceCards .sb-fence-card.active');
        const imType = activeCard ? activeCard.getAttribute('data-type') : null;
        if (imType === type) return true;
    }
    const id = type === 'concrete' ? 'nonSquareModeConcrete' : 'nonSquareMode';
    const cb = document.getElementById(id);
    return cb ? cb.checked : false;
}

// ── Post-spacing validation (3 tiers from design spec) ──────────────────────
// Returns objects: { type: 'hard'|'soft'|'ok', message: string }
// Tier 1 (hard): m < 1  — red, locks system
// Tier 2 (soft): m > 3  — yellow, locks until user clicks "ดำเนินการต่อ"
// Tier 3 (hard): panelSpace < 0.5 — produced per-segment in draw functions
function validatePostSpacing(m) {
    if (isNaN(m) || m < 1) {
        return { type: 'hard', message: 'ระยะห่างระหว่างเสาต้องมีมาตรฐานอย่างน้อย <b>1 เมตร</b> — กรุณากรอกใหม่' };
    }
    if (m > 3 && !window._spacingOverride) {
        return { type: 'soft', message: 'ระยะห่าง <b>' + m.toFixed(2) + ' ม.</b> อาจทำให้รั้วไม่แข็งแรง — ต้องการดำเนินการต่อหรือไม่?' };
    }
    return { type: 'ok', message: '' };
}
window.validatePostSpacing = validatePostSpacing;

// Resets a fence type's price input(s) back to their default value.
// Called by the small "↺" reset button next to each price field.
window.resetFencePrice = function (type) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    if (type === 'cowboyPost') {
        // Reset "ราคาเสาต้นละ" back to the default for whichever post layer
        // (2/3/4 ชั้น) is currently selected.
        if (typeof syncCowboyPostPrice === 'function') syncCowboyPostPrice();
    } else if (type === 'cowboyCornerPost') {
        if (typeof syncCowboyCornerPostPrice === 'function') syncCowboyCornerPostPrice();
    } else if (type === 'cowboyBeam') {
        // Reset "ราคาคานละ" back to the reference price for the currently
        // selected spacing (only defined at 2.5 m — otherwise clears it).
        if (typeof syncCowboyBeamPrice === 'function') syncCowboyBeamPrice();
    } else if (type === 'barbed') {
        setVal('barbedPricePerM', FENCE_PRICE_DEFAULTS.barbed);
        setVal('imBarbedPricePerM', FENCE_PRICE_DEFAULTS.barbed);
    } else if (type === 'concrete') {
        setVal('concretePricePerM', FENCE_PRICE_DEFAULTS.concrete);
        setVal('imConcretePricePerM', FENCE_PRICE_DEFAULTS.concrete);
    } else if (type === 'brick') {
        // Brick's default depends on which brick type is selected, so
        // re-sync from the brick catalogue rather than a flat constant.
        if (typeof updateBrickDefaults === 'function') updateBrickDefaults();
        if (typeof imUpdateBrickDefaults === 'function') imUpdateBrickDefaults();
    }

    if (typeof runFenceCalc === 'function') runFenceCalc();
};

let cornerMap = new Map();
const swappedCorners = new Map();

// ── Geometry Helpers ─────────────────────────
function hav(p1, p2) {
    const R = 6371000;
    const dLat = (p2[0]-p1[0])*Math.PI/180;
    const dLon = (p2[1]-p1[1])*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function totalLen(pts) {
    let t = 0;
    for(let i = 0; i < pts.length - 1; i++) t += hav(pts[i], pts[i+1]);
    return t;
}

function interp(pts, d) {
    let acc = 0;
    for(let i = 0; i < pts.length - 1; i++){
        const s = hav(pts[i], pts[i+1]);
        if(acc + s >= d - 1e-6){
            const t = Math.min(1, (d - acc) / s);
            return [pts[i][0] + t * (pts[i+1][0] - pts[i][0]), pts[i][1] + t * (pts[i+1][1] - pts[i][1])];
        }
        acc += s;
    }
    return [...pts[pts.length-1]];
}

function bearing(p1, p2) {
    const f1 = p1[0]*Math.PI/180, f2 = p2[0]*Math.PI/180, dl = (p2[1]-p1[1])*Math.PI/180;
    return Math.atan2(Math.sin(dl)*Math.cos(f2), Math.cos(f1)*Math.sin(f2) - Math.sin(f1)*Math.cos(f2)*Math.cos(dl)) * 180/Math.PI;
}

// Correct circular mean of two bearings — NOT (a+b)/2. A plain arithmetic
// average is wrong as soon as the two bearings straddle the 0°/360° wrap
// (e.g. 350° and 10°, whose true bisector is 0°): (350+10)/2 = 180, which
// is the bisector rotated a full 180° from correct. This was the root
// cause of single/bisector corner posts occasionally rendering rotated
// the wrong way instead of as a clean square. Works by summing the two
// bearings as unit vectors and taking the angle of the result, which
// always lands on the bisector of the smaller (interior) angle between
// them — exactly what a corner post needs.
function bisectorBearing(a, b) {
    const ar = a * Math.PI / 180, br = b * Math.PI / 180;
    const x = Math.cos(ar) + Math.cos(br);
    const y = Math.sin(ar) + Math.sin(br);
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return a; // degenerate: arms exactly opposite (180° apart)
    return Math.atan2(y, x) * 180 / Math.PI;
}

function bearingAt(pts, d) {
    let acc = 0;
    for(let i = 0; i < pts.length - 1; i++){
        const s = hav(pts[i], pts[i+1]);
        if(acc + s >= d - 1e-6) return bearing(pts[i], pts[i+1]);
        acc += s;
    }
    return bearing(pts[pts.length-2], pts[pts.length-1]);
}

function offPt(ll, b, dist) {
    const R = 6371000, d = dist/R, rb = b * Math.PI/180;
    const f1 = ll[0]*Math.PI/180, l1 = ll[1]*Math.PI/180;
    const f2 = Math.asin(Math.sin(f1)*Math.cos(d) + Math.cos(f1)*Math.sin(d)*Math.cos(rb));
    const l2 = l1 + Math.atan2(Math.sin(rb)*Math.sin(d)*Math.cos(f1), Math.cos(d) - Math.sin(f1)*Math.sin(f2));
    return [f2 * 180/Math.PI, l2 * 180/Math.PI];
}

function ptKey(p) { return p[0].toFixed(5) + ',' + p[1].toFixed(5); }

function buildCornerMap(allLinePointsArray) {
    cornerMap = new Map();
    function addArm(pt, bearingInward, bearingOutward) {
        const k = ptKey(pt);
        if (!cornerMap.has(k)) cornerMap.set(k, { pt, arms: [] });
        cornerMap.get(k).arms.push({ inward: bearingInward, outward: bearingOutward });
    }
    allLinePointsArray.forEach(linePoints => {
        if (linePoints.length < 2) return;
        for (let i = 0; i < linePoints.length; i++) {
            const pt = linePoints[i];
            if (i === 0) addArm(pt, bearing(linePoints[0], linePoints[1]), bearing(linePoints[0], linePoints[1]));
            else if (i === linePoints.length - 1) addArm(pt, bearing(linePoints[i], linePoints[i-1]), bearing(linePoints[i], linePoints[i-1]));
            else {
                addArm(pt, bearing(linePoints[i], linePoints[i-1]), bearing(linePoints[i], linePoints[i-1]));
                addArm(pt, bearing(linePoints[i], linePoints[i+1]), bearing(linePoints[i], linePoints[i+1]));
            }
        }
    });
    for (const [k, entry] of cornerMap.entries()) {
        if (entry.arms.length < 2) cornerMap.delete(k);
    }
}

function isCornerPoint(p) { return cornerMap.has(ptKey(p)); }

function getCornerArms(entry) {
    const k = ptKey(entry.pt);
    const arms = entry.arms.slice(0, 2);
    return swappedCorners.get(k) ? [arms[1].outward, arms[0].outward] : [arms[0].outward, arms[1].outward];
}

const DOUBLE_CORNER_HALF = 0.40;
const DOUBLE_CORNER_OFFSET = DOUBLE_CORNER_HALF * 2; // legacy fallback only

// Returns angle θ (degrees) at a corner between two arriving bearings
function cornerAngle(armBearing1, armBearing2) {
    let diff = Math.abs(armBearing1 - armBearing2) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff; // interior angle in degrees
}

// Returns the exact double-corner offset x for post size n and corner angle θ (degrees)
// x = n / (2·tan(θ/2)) + n/2
// Shared "how much bigger than a normal pillar" size for dual-corner posts.
// Used both when drawing the post AND when computing its clearance/offset,
// so the two never drift out of sync.
const DUAL_POST_SIZE_MULTIPLIER = 1.8;

// Purely visual — how big the red/blue dual-corner posts are actually DRAWN.
// Kept separate from DUAL_POST_SIZE_MULTIPLIER (which drives the clearance
// offset / panel-shortening math) so bumping the on-screen size doesn't also
// push the posts further apart. Normal in-line posts use baseScale 5.4 and
// corner-type posts use baseScale 1.6 (see drawPost), so 5.4/1.6 makes a
// dual-corner post render the same on-screen size as a normal white pillar.
const DUAL_POST_VISUAL_MULTIPLIER = 5.4 / 1.6;

function cornerOffsetX(n, thetaDeg) {
    const half = (thetaDeg / 2) * Math.PI / 180;
    if (Math.abs(Math.tan(half)) < 1e-6) return n; // fallback for 0° (straight)
    return n / (2 * Math.tan(half)) + n / 2;
}

// Single source of truth for how far the "blue" dual-corner post sits from
// the corner point. Both the post drawing (drawDoubleCornerPost) and the
// fence-line/panel shortening (cornerShortenAmount in cowboy.js) MUST use
// this exact same value, or the panel will stop short at the wrong spot
// relative to where the post is actually drawn.
// For a corner dimension line running along one arm (ownArmBearing), returns
// +1 or -1 to pick whichever perpendicular side sits away from the OTHER
// arm. Used to push the x-offset labels out to the flanks of a corner
// instead of into the notch between the two arms, where they'd overlap the
// angle bisector, dashed guide lines, and each other.
function cornerDimOutwardSign(ownArmBearing, otherArmBearing) {
    const perpPlus = ((ownArmBearing + 90) % 360 + 360) % 360;
    const otherNorm = ((otherArmBearing % 360) + 360) % 360;
    let diff = Math.abs(perpPlus - otherNorm);
    if (diff > 180) diff = 360 - diff;
    return diff > 90 ? 1 : -1; // >90° away from the other arm = the outward side
}

function getDualCornerOffset(n, thetaDeg) {
    const userScale = window._poleScale || 1.0;
    const minVisualClearance = 0.35 * DUAL_POST_SIZE_MULTIPLIER * userScale; // scaled to match the pillar size
    return Math.max(cornerOffsetX(n, thetaDeg), minVisualClearance);
}

// Duel mode (square corner) always assumes a right angle, but the two arms
// as actually drawn on the map are rarely EXACTLY 90° apart — a hand-drawn
// corner might be 88° or 93°. Using the real armBlue bearing for rendering
// then makes the blue post look "rotated" relative to red instead of
// sitting flush at a clean right angle. This snaps blue's RENDER bearing
// to the nearest exact multiple of 90° from armRed (picking whichever of
// +90°/−90° actually sits closer to the real armBlue direction, so it
// still picks the correct side). Only used for rendering (post rotation +
// offset direction) — never for the physical arm-identity matching in
// cornerShortenAmount, which must keep using the real bearings.
function forcedPerpendicularBearing(armRed, armBlue) {
    const plus90 = ((armRed + 90) % 360 + 360) % 360;
    const minus90 = ((armRed - 90) % 360 + 360) % 360;
    const diff = (a, b) => { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; };
    return diff(plus90, armBlue) <= diff(minus90, armBlue) ? plus90 : minus90;
}

// The duel (square-corner) posts are drawn oversized for visibility — see
// DUAL_POST_VISUAL_MULTIPLIER above — so positioning the blue post using
// the true physical post width n makes the two squares overlap on screen
// (the render is ~3.4× bigger than n). This returns the post's ACTUAL
// rendered footprint (matches drawPost's own SCALE math exactly), so the
// blue post can be placed one full rendered-width from the vertex and
// just touch red without overlapping — purely a rendering position, not
// used for the physical panel-shortening math (that stays real n/cowboy.js).
function dualPostFootprint(n) {
    const userScale = window._poleScale || 1.0;
    return n * 1.6 * userScale * DUAL_POST_VISUAL_MULTIPLIER;
}

// Returns the corner mode for a given corner point.
// Reads per-corner overrides from window._cornerModes map, falls back to the
// global Mode 1 / Mode 2 radio selection for the given fence TYPE.
// Returns 'single' or 'double'. If angle < 120° and mode would be 'single', falls back to 'double'.
//
// `type` is 'cowboy' or 'concrete' — cowboy and concrete are separate fence
// systems with their own independent Mode 1/Mode 2 radios (#cornerMode1 /
// #cornerMode2 vs #cornerMode1Concrete / #cornerMode2Concrete), so both the
// per-corner override key AND the global fallback must be scoped per type.
// Sharing a single un-scoped lookup here (the old bug) meant the radios
// never actually changed anything: the code fell through to a global
// setting that didn't exist, silently defaulting to Mode 2 (double) always.
function getCornerMode(cornerPt, thetaDeg, type) {
    type = (type === 'concrete') ? 'concrete' : 'cowboy';
    const k = type + ':' + ptKey(cornerPt);
    const perCorner = window._cornerModes && window._cornerModes.get(k);
    if (perCorner) {
        if (perCorner === 'single' && thetaDeg < 120) return 'double'; // enforce angle limit
        return perCorner;
    }
    // Global default — driven by the Mode 1 / Mode 2 radio buttons via
    // setCornerModeSelection() in index.html, which writes into this map
    // whenever the user picks a radio (or toggles non-square mode on).
    if (!window._globalCornerModeByType) window._globalCornerModeByType = { cowboy: 'double', concrete: 'double' };
    const globalMode = window._globalCornerModeByType[type] || 'double';
    if (globalMode === 'single' && thetaDeg < 120) return 'double';
    return globalMode;
}

// Initialize per-corner mode store (keys are "type:latlngkey")
if (!window._cornerModes) window._cornerModes = new Map();
// Initialize per-type global default (mirrors the Mode 1 / Mode 2 radios)
if (!window._globalCornerModeByType) window._globalCornerModeByType = { cowboy: 'double', concrete: 'double' };

function drawDoubleCornerPost(cornerPt, n, addHoverMarkers) {
    const entry = cornerMap.get(ptKey(cornerPt));
    if (!entry) return { count: 0 };
    const arms = entry.arms.slice(0, 2);
    if (arms.length < 2) {
        drawPost(cornerPt, arms[0].outward, 'corner');
        return { count: 1 };
    }

    const [armRed, armBlue] = getCornerArms(entry);
    const theta = cornerAngle(armRed, armBlue);
    const k = ptKey(cornerPt);

    const nonSquareActive = _isNonSquareActive('cowboy');

    // This is the COWBOY-specific double-corner-post function, so it always
    // reads/writes the 'cowboy' side of the type-scoped corner mode store
    // (see getCornerMode in this file). Concrete has its own parallel
    // function, drawConcreteDoubleCornerPost, in concrete.js.
    if (nonSquareActive) {
        const mode = getCornerMode(cornerPt, theta, 'cowboy');
if (mode === 'single') {
    // Mode 1 only: rotate the single bisector post to face the middle of
    // the angle between the two arms, rather than sitting flush with
    // armRed. Mode 2 (dual offset posts) and the plain 90° "duel" branch
    // below are untouched — they still use armRed / their own arm bearing.
    const singleBearing = bisectorBearing(armRed, armBlue);
    drawPost(cornerPt, singleBearing, 'corner');
    if (addHoverMarkers) _addCornerModeToggle(cornerPt, 'single', theta, undefined, undefined, 'cowboy');
    return { count: 1 };
}
        // Mode 2 — posts offset along their own arm away from the vertex,
        // each rotated to face ITS OWN line direction (armRed/armBlue) so
        // the post edges stay flush with the actual fence line the user
        // drew, instead of both sharing one fixed bisector angle that only
        // looks right for the specific corner angle it was computed from.
        const offset = getDualCornerOffset(n, theta);
        drawPost(offPt(cornerPt, armRed,  offset), armRed,  'corner', '#dc2626', '#ffffff', DUAL_POST_VISUAL_MULTIPLIER);
        drawPost(offPt(cornerPt, armBlue, offset), armBlue, 'corner', '#2563eb', '#ffffff', DUAL_POST_VISUAL_MULTIPLIER);
        if (addHoverMarkers) {
            _addCornerModeToggle(cornerPt, 'double', theta, armRed, armBlue, 'cowboy');
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

// ── Plain "duel" fence corner (square / 90°) ─────────────────────────────
    // This branch only ever runs when the non-square checkbox is OFF, so it
    // always assumes a right-angle corner. It is intentionally its own
    // self-contained code path — separate from Mode 1 (single bisector post)
    // and Mode 2 (both arms offset by the angle formula) above, which only
    // run when non-square mode is active — so edits here can never bleed
    // into those two modes.
    //
    // Geometry: the RED post sits exactly ON the vertex, rotated so it lies
    // flush along ITS OWN arm (armRed) — the fence is "on the line". The
    // BLUE post sits one post-width (n) further out along ITS OWN arm
    // (armBlue), also rotated flush with that line. On a true 90° corner,
    // red's footprint already extends n/2 past the vertex in the blue
    // arm's direction, and blue's near edge sits at n − n/2 = n/2 too — so
    // the two posts meet flush without overlapping.
    //
    // Which arm is "red" and which is "blue" comes entirely from
    // getCornerArms() above, which already respects swappedCorners — so
    // clicking the ⇄ swap button flips red/blue here automatically, and
    // cornerShortenAmount() (cowboy.js) picks up the same swapped arms when
    // it recalculates each side's fence-shortening distance.
    const blueBearing = forcedPerpendicularBearing(armRed, armBlue); // always exactly 90° from red, for rendering only
    const blueOffset = dualPostFootprint(n); // rendered post width — keeps red/blue touching, not overlapping, on screen
    const redPt  = cornerPt;
    const bluePt = offPt(cornerPt, blueBearing, blueOffset);

    drawPost(redPt,  armRed,      'corner', '#dc2626', '#ffffff', DUAL_POST_VISUAL_MULTIPLIER);
    drawPost(bluePt, blueBearing, 'corner', '#2563eb', '#ffffff', DUAL_POST_VISUAL_MULTIPLIER);

    if (addHoverMarkers) {
        // No single/double mode toggle here — that toggle belongs only to
        // the non-square Mode 1/Mode 2 corners above. Showing it on a duel
        // (square) corner would let its state leak into non-square mode
        // when the user later switches, which is exactly the overlap this
        // separation is meant to prevent.
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

// Renders a small toggle button on the corner to switch single/double mode.
// Placed on the OUTWARD bisector (opposite side from the two posts) so it
// doesn't sit on top of the red/blue pillars.
function _addCornerModeToggle(cornerPt, currentMode, thetaDeg, armRed, armBlue, type) {
    type = (type === 'concrete') ? 'concrete' : 'cowboy';
    const k = ptKey(cornerPt);
    const canSingle = thetaDeg >= 120;
    const label = currentMode === 'double' ? '1️⃣' : '2️⃣';
    const title = currentMode === 'double'
        ? (canSingle ? 'Switch to single post' : `ต้องการมุม ≥ 120° (ปัจจุบัน ${thetaDeg.toFixed(0)}°)`)
        : 'Switch to double post';
    const btnHtml = `<div class="dc-mode-btn" data-k="${k}" data-type="${type}" data-theta="${thetaDeg.toFixed(1)}"
        title="${title}" style="cursor:${canSingle||currentMode==='single'?'pointer':'not-allowed'};
        opacity:${canSingle||currentMode==='single'?1:0.4};font-size:14px;background:#fff;
        border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;
        border:1.5px solid #6b7280;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${label}</div>`;
    // Place it opposite the bisector of the two arms so it clears both posts
    const outwardBisector = (typeof armRed === 'number' && typeof armBlue === 'number')
        ? bisectorBearing(armRed, armBlue) + 180
        : 0;
    L.marker(offPt(cornerPt, outwardBisector, 0.6), {
        icon: L.divIcon({ className: '', html: btnHtml, iconSize: [22, 22], iconAnchor: [11, 11] }),
        zIndexOffset: 3100, interactive: true
    }).addTo(fenceLayerGroup);
}

function drawPost(latlng, b, type, borderColorOverride, fillColorOverride, sizeMultiplier) {
    const postW = 0.15, postL = 0.15;
    const userScale = window._poleScale || 1.0;
    const baseScale = (type === 'endpoint' || type === 'corner' ? 1.6 : 5.4) * userScale;
    const SCALE = baseScale * (sizeMultiplier || 1);
    const halfW = (postW * SCALE) / 2, halfL = (postL * SCALE) / 2;

    const isCorner = type === 'endpoint' || type === 'corner';
    const rect = [
        offPt(offPt(latlng, b + 90, halfW), b, halfL),
        offPt(offPt(latlng, b - 90, halfW), b, halfL),
        offPt(offPt(latlng, b - 90, halfW), b + 180, halfL),
        offPt(offPt(latlng, b + 90, halfW), b + 180, halfL),
    ];

    L.polygon(rect, {
        color: borderColorOverride || (isCorner ? '#ffffff' : '#1f2937'),
        weight: isCorner ? 2 : 1.5,
        fillColor: fillColorOverride || (isCorner ? '#dc2626' : '#ffffff'),
        fillOpacity: 1, opacity: 1
    }).addTo(fenceLayerGroup);
}

// ── UI Wiring & Core Calculation ─────────────
(function injectSwapCSS() {
    if (document.getElementById('dc-swap-style')) return;
    const style = document.createElement('style');
    style.id = 'dc-swap-style';
    style.textContent = `.dc-swap-btn { width: 24px; height: 24px; line-height: 24px; text-align: center; font-size: 14px; font-weight: bold; background: white; border: 2px solid #2563eb; border-radius: 50%; color: #2563eb; cursor: pointer; opacity: 0; transition: opacity 0.15s; box-shadow: 0 1px 4px rgba(0,0,0,0.25); user-select: none; } .leaflet-marker-icon:hover .dc-swap-btn, .dc-swap-btn:hover { opacity: 1; }`;
    document.head.appendChild(style);
})();

let _swapClickSuppressed = false;
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.dc-swap-btn');
    if (!btn) return;
    e.stopPropagation(); e.preventDefault();
    _swapClickSuppressed = true;
    setTimeout(() => { _swapClickSuppressed = false; }, 50);
    const k = btn.getAttribute('data-k');
    if (k) {
        swappedCorners.set(k, !(swappedCorners.get(k) || false));
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }
});

function runFenceCalc() {
    if (typeof allLines === 'undefined' || allLines.length === 0) return;

    const layersInput = _activeCornerCheckbox('beamSelect', 'imBeamSelect');
    const layers = layersInput ? parseInt(layersInput.value) || 2 : 2;

    const concreteLayersInput = _activeCornerCheckbox('concreteLayerSelect', 'imConcreteLayerSelect');
    const concreteLayers = concreteLayersInput ? parseInt(concreteLayersInput.value) || 2 : layers;

    const activeCard = document.querySelector('.sb-fence-card.active');
    const activeFenceType = activeCard ? activeCard.getAttribute('data-type') : 'cowboy';

    const validLines = allLines.filter(ld => ld.points && ld.points.length >= 2);
    const concreteLines = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'concrete');
    const brickLines    = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'brick');
    const barbedLines   = validLines.filter(ld => (ld.fenceType || activeFenceType) === 'barbed');
    const cowboyLines   = validLines.filter(ld => {
        const t = ld.fenceType || activeFenceType;
        return t !== 'brick' && t !== 'barbed' && t !== 'concrete';
    });

    // Cowboy/concrete double-corner: read the checkbox belonging to whichever
    // tab is actually active — see _activeCornerCheckbox/_isNonSquareActive.
    // Input Mode's Mode2 radio id differs from Page 1's (imCornerModeDouble
    // vs cornerMode2, imConcreteCornerModeDouble vs cornerMode2Concrete) —
    // pairing the wrong ids here meant Input Mode's radio choice was never
    // actually read even once the tab-awareness itself was fixed.
const cowboyDcEl = _activeCornerCheckbox('doubleCornerPost', 'imDoubleCornerPost');
const cowboyMode2 = _activeCornerCheckbox('cornerMode2', 'imCornerModeDouble');
const cowboyDoubleCorner = _isNonSquareActive('cowboy')
    ? (cowboyMode2 ? cowboyMode2.checked : false)
    : (cowboyDcEl ? cowboyDcEl.checked : false);

    // Concrete double-corner: read its own separate checkbox
const concreteDcEl = _activeCornerCheckbox('concreteDoubleCornerPost', 'imConcreteDoubleCorner');
const concreteDcMode2 = _activeCornerCheckbox('cornerMode2Concrete', 'imConcreteCornerModeDouble');
const concreteDoubleCorner = _isNonSquareActive('concrete')
    ? (concreteDcMode2 ? concreteDcMode2.checked : false)
    : (concreteDcEl ? concreteDcEl.checked : false);

    // ── Spacing validation — collect typed results ───────────────────────────
    // spacingValidations: [{ type:'hard'|'soft'|'ok', message }]
    const spacingValidations = [];

    // Helper: read raw spacing value for a fence type — tab-aware (id1 =
    // Page 1's id, id2 = Input Mode's), see _activeCornerCheckbox.
    function rawSpacing(id1, id2) {
        const el = _activeCornerCheckbox(id1, id2);
        return el ? parseFloat(el.value) : NaN;
    }

    const allWarnings = [];
    // Tier-3 warnings (panelSpace < 0.5) come from draw functions — collected below
    const segmentWarnings = []; // hard-lock tier-3

    if (fenceLayerGroup) fenceLayerGroup.clearLayers();
    let grandTotal = 0, grandPosts = 0, grandBeams = 0, grandPrice = 0;
    let hasBrick = false;

    if (cowboyLines.length > 0) {
        const m_raw = rawSpacing('postSpacing', 'imPostSpacing');
        const vResult = validatePostSpacing(isNaN(m_raw) ? 0 : m_raw);
        if (vResult.type !== 'ok') spacingValidations.push(vResult);
        const m_cowboy = Math.min(3, Math.max(1, isNaN(m_raw) ? 2.5 : m_raw));
        const res = calcCowboy(cowboyLines, m_cowboy, 0.15, cowboyDoubleCorner, layers);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        // Granular pricing per the cowboy price spec: normal post price +
        // corner post price (a post sitting at a corner — single Mode-1
        // bisector post or the Mode-2/plain-duel pair — costs differently
        // from a plain mid-line post) + beam price (depends on spacing).
        // Missing/blank fields just contribute 0 — the user may fill in
        // only the ones relevant to their fence.
        const postPriceEl = _activeCornerCheckbox('cowboyPostPrice', 'imCowboyPostPrice');
        const cornerPostPriceEl = _activeCornerCheckbox('cowboyCornerPostPrice', 'imCowboyCornerPostPrice');
        const beamPriceEl = _activeCornerCheckbox('cowboyBeamPrice', 'imCowboyBeamPrice');
        const cowboyPostPrice = parseFloat(postPriceEl?.value) || 0;
        const cowboyCornerPostPrice = parseFloat(cornerPostPriceEl?.value) || 0;
        const cowboyBeamPrice = parseFloat(beamPriceEl?.value) || 0;
        grandPrice += res.normalPosts * cowboyPostPrice + res.cornerPosts * cowboyCornerPostPrice + res.grandBeams * cowboyBeamPrice;
        // Separate tier-3 (segment too short) from other warnings
        res.warnings.forEach(w => segmentWarnings.push(w));
    }

    if (concreteLines.length > 0) {
        const m_raw = rawSpacing('postSpacingConcrete', 'imPostSpacingConcrete');
        const vResult = validatePostSpacing(isNaN(m_raw) ? 0 : m_raw);
        if (vResult.type !== 'ok') spacingValidations.push(vResult);
        const m_concrete = Math.min(3, Math.max(1, isNaN(m_raw) ? 2.5 : m_raw));
        const res = calcConcrete(concreteLines, m_concrete, 0.15, concreteDoubleCorner, concreteLayers);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        const priceEl = _activeCornerCheckbox('concretePricePerM', 'imConcretePricePerM');
        const concretePrice = parseFloat(priceEl?.value) || FENCE_PRICE_DEFAULTS.concrete;
        grandPrice += res.grandTotal * concretePrice;
        res.warnings.forEach(w => segmentWarnings.push(w));
    }

    if (brickLines.length > 0) {
        const res = calcBrick(brickLines);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        allWarnings.push(...res.warnings);
        hasBrick = res.hasBrick;
    }

    if (barbedLines.length > 0) {
        const m_raw = rawSpacing('postSpacingBarbed', 'imPostSpacingBarbed');
        const vResult = validatePostSpacing(isNaN(m_raw) ? 0 : m_raw);
        if (vResult.type !== 'ok') spacingValidations.push(vResult);
        const m_barbed = Math.min(3, Math.max(1, isNaN(m_raw) ? 2.5 : m_raw));
        const nBraceSolo  = _activeCornerCheckbox('nBraceSolo',  'imNBraceSolo')?.checked  ?? false;
        const nBraceDual  = _activeCornerCheckbox('nBraceDual',  'imNBraceDual')?.checked  ?? false;
        const nBraceAngle = _activeCornerCheckbox('nBraceAngle', 'imNBraceAngle')?.checked ?? false;
        const res = calcBarbed(barbedLines, m_barbed, 0, nBraceSolo, nBraceDual, nBraceAngle);
        grandTotal += res.grandTotal; grandPosts += res.grandPosts; grandBeams += res.grandBeams;
        const priceEl = _activeCornerCheckbox('barbedPricePerM', 'imBarbedPricePerM');
        const barbedPrice = parseFloat(priceEl?.value) || FENCE_PRICE_DEFAULTS.barbed;
        grandPrice += res.grandTotal * barbedPrice;
        res.warnings.forEach(w => segmentWarnings.push(w));
    }
    updateBarbedPostBreakdown(barbedLines.length > 0);

    // ── Determine overall lock state ─────────────────────────────────────────
    // Hard lock: any tier-1 (m<1) or tier-3 (panelSpace<0.5) violation
    // Soft lock: any tier-2 (m>3) without override, no hard violations
    const hasHard = spacingValidations.some(v => v.type === 'hard') || segmentWarnings.length > 0;
    const hasSoft = !hasHard && spacingValidations.some(v => v.type === 'soft');
    const shouldLock = hasHard || hasSoft;
    _applyDrawLock(shouldLock);

    // Build final warnings list for display
    spacingValidations.forEach(v => allWarnings.push({ type: v.type, message: v.message }));
    segmentWarnings.forEach(w => allWarnings.push({ type: 'hard', message: w }));

    function writeResults(ids) {
        const totalInput = document.getElementById(ids.total);
        if (totalInput) totalInput.value = grandTotal.toFixed(2);

        const postsInput = document.getElementById(ids.posts);
        if (postsInput) postsInput.value = grandPosts;

        const beamsInput = document.getElementById(ids.beams);
        const beamsLabel = beamsInput?.closest('.sbr-row-item')?.querySelector('.sbr-label');
        const beamsUnit  = beamsInput?.closest('.sbr-field-row')?.querySelector('.sbr-unit');

        if (hasBrick && window._brickCalcResult) {
            const br = window._brickCalcResult;
            const brickCountWithWaste = Math.ceil(br.brickCount * 1.05);
            if (beamsInput) beamsInput.value = brickCountWithWaste.toLocaleString('th-TH');
            if (beamsLabel) beamsLabel.textContent = 'จำนวนอิฐ (รวม +5%)';
            if (beamsUnit)  beamsUnit.textContent  = 'ก้อน';
        } else {
            if (beamsInput) beamsInput.value = grandBeams;
            if (beamsLabel) beamsLabel.textContent = 'จำนวนคานที่ต้องใช้';
            if (beamsUnit)  beamsUnit.textContent  = 'อัน';
        }

        const priceInput = document.getElementById(ids.price);
        if (priceInput) {
            let totalPrice = grandPrice;
            if (hasBrick && window._brickCalcResult) {
                const br = window._brickCalcResult;
                const brickPrice = parseFloat(_activeCornerCheckbox('brickPricePerPiece', 'imBrickPrice')?.value) || 1.05;
                const brickCount = Math.ceil(br.brickCount * 1.05);
                totalPrice += brickCount * brickPrice;
            }
            priceInput.value = totalPrice.toLocaleString('th-TH', { maximumFractionDigits: 0 });
            // Page 1's big green "hero" price readout is a separate animated
            // mirror of this hidden input — only drive it from the page-1
            // call (ids.price === 'resPriceDisplay'), not Input Mode's, since
            // both would otherwise fight over the same shared hero element.
            if (ids.price === 'resPriceDisplay') {
                setPriceHeroValue(priceInput.value);
                updatePriceHeroSub();
            }
        }

        const warnEl = document.getElementById(ids.warnings);
        if (warnEl) {
            if (allWarnings.length > 0) {
                warnEl.innerHTML = allWarnings.map(w => {
                    const isHard = w.type === 'hard';
                    const isSoft = w.type === 'soft';
                    const cls = isHard ? 'fw-item fw-hard' : isSoft ? 'fw-item fw-soft' : 'fw-item';
                    const btn = isSoft
                        ? `<button class="fw-override-btn" onclick="window._spacingOverride=true;if(typeof runFenceCalc==='function')runFenceCalc();">ดำเนินการต่อ →</button>`
                        : '';
                    return `<div class="${cls}">⚠️ ${w.message}${btn}</div>`;
                }).join('');
                warnEl.style.display = 'block';
            } else {
                warnEl.style.display = 'none';
            }
        }
    }

    writeResults({ total: 'resTotal', posts: 'resPosts', beams: 'resBeams', price: 'resPriceDisplay', warnings: 'fenceWarnings' });
    writeResults({ total: 'imResTotal', posts: 'imResPosts', beams: 'imResBeams', price: 'imResPriceDisplay', warnings: 'imFenceWarnings' });
}

// ── Animated price "hero" display ────────────────────────────────────────
// Renders the big green price number (see .sb-price-hero-card in index.html)
// with a per-digit roll animation whenever it changes — each character
// position that actually changed slides out the old digit and slides in the
// new one (odometer-style), sliding upward when the price increases and
// downward when it decreases. Purely a rendered mirror of resPriceDisplay
// (the plain hidden input writeResults() writes to); never itself read by
// any calculation.
let _priceHeroPrev = null;
function setPriceHeroValue(text) {
    const el = document.getElementById('priceHeroValue');
    if (!el) return;
    const prev = _priceHeroPrev;
    _priceHeroPrev = text;
    if (prev === text) return;
    if (prev === null) { el.textContent = text; return; } // first render — no animation to play

    const prevNum = parseFloat(String(prev).replace(/[^0-9.-]/g, '')) || 0;
    const nextNum = parseFloat(String(text).replace(/[^0-9.-]/g, '')) || 0;
    const goingUp = nextNum >= prevNum;

    const len = Math.max(prev.length, text.length);
    const prevPadded = String(prev).padStart(len, ' ');
    const nextPadded = String(text).padStart(len, ' ');

    el.innerHTML = '';
    for (let i = 0; i < len; i++) {
        const oldCh = prevPadded[i];
        const newCh = nextPadded[i];
        const slot = document.createElement('span');
        slot.className = 'phv-slot';

        const faceNew = document.createElement('span');
        faceNew.className = 'phv-face';
        faceNew.textContent = newCh === ' ' ? ' ' : newCh;

        if (oldCh !== newCh && oldCh !== ' ') {
            const faceOld = document.createElement('span');
            faceOld.className = 'phv-face';
            faceOld.textContent = oldCh === ' ' ? ' ' : oldCh;
            faceNew.style.transform = goingUp ? 'translateY(100%)' : 'translateY(-100%)';
            faceNew.style.opacity = '0';
            slot.appendChild(faceOld);
            slot.appendChild(faceNew);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    faceOld.style.transform = goingUp ? 'translateY(-100%)' : 'translateY(100%)';
                    faceOld.style.opacity = '0';
                    faceNew.style.transform = 'translateY(0)';
                    faceNew.style.opacity = '1';
                });
            });
            setTimeout(() => { if (faceOld.parentNode) faceOld.remove(); }, 500);
        } else {
            slot.appendChild(faceNew);
        }
        el.appendChild(slot);
    }

    // Brief pulse on the whole price section to reinforce the change.
    const section = document.getElementById('sbphPriceSection');
    if (section) {
        section.classList.remove('sbph-pulse');
        void section.offsetWidth; // restart the animation
        section.classList.add('sbph-pulse');
    }
}

// Small "X บาท/หน่วย" line under the big price, reflecting whichever fence
// type is currently active in the sidebar (more than one type of line can
// be drawn at once — grandPrice already sums all of them; this is just a
// readable per-unit reminder, not a separate calculation).
function updatePriceHeroSub() {
    const el = document.getElementById('priceHeroSub');
    if (!el) return;
    const activeCard = document.querySelector('.sb-fence-card.active');
    const type = activeCard ? activeCard.getAttribute('data-type') : 'cowboy';
    const val = (id) => { const e = document.getElementById(id); return e ? parseFloat(e.value) : NaN; };
    const fmt = (n) => isNaN(n) ? null : n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

    const parts = [];
    if (type === 'cowboy') {
        const post = fmt(val('cowboyPostPrice'));
        const beam = fmt(val('cowboyBeamPrice'));
        if (post) parts.push(`${post} บาท/ต้น`);
        if (beam) parts.push(`${beam} บาท/คาน`);
    } else if (type === 'concrete') {
        const perM = fmt(val('concretePricePerM'));
        if (perM) parts.push(`${perM} บาท/ม.`);
    } else if (type === 'barbed') {
        const perM = fmt(val('barbedPricePerM'));
        if (perM) parts.push(`${perM} บาท/ม.`);
    } else if (type === 'brick') {
        const piece = fmt(val('brickPricePerPiece'));
        if (piece) parts.push(`${piece} บาท/ก้อน`);
    }
    el.textContent = parts.length ? parts.join(' · ') : '—';
}

// Barbed-wire-only colored post-count breakdown, shown under "จำนวนเสาที่
// ต้องใช้": normal segment posts (black) + N-Brace solo (red) + dual (blue)
// + angle (red) = total. Reads window._barbedCalcResult, set by calcBarbed
// (barb.js) on every recalculation — purely a UI readout, not used by any
// calculation itself.
function updateBarbedPostBreakdown(hasBarbed) {
    const el = document.getElementById('resPostsBreakdown');
    if (!el) return;
    const r = window._barbedCalcResult;
    if (!hasBarbed || !r) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.innerHTML =
        `<span style="color:#1f2937;">${r.normalPosts}</span>` +
        ` + <span style="color:#dc2626;">${r.soloPosts}</span>` +
        ` + <span style="color:#1d4ed8;">${r.dualPosts}</span>` +
        ` + <span style="color:#dc2626;">${r.anglePosts}</span>` +
        ` = <strong style="color:#1f2937;">${r.totalPosts}</strong>`;
    el.style.display = 'block';
}

// Shared UI Helpers
window.onBeamCbChange = function() {
    const cbTop = document.getElementById('beamCbTop') || document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('beamCbCenter') || document.getElementById('imBeamCbCenter');
    const hidden = document.getElementById('imBrickBeamMode') || document.getElementById('brickBeamMode');
    if (!cbTop || !cbCenter || !hidden) return;
    
    let mode = (cbTop.checked && cbCenter.checked) ? 'center+top' : (cbTop.checked ? 'top' : (cbCenter.checked ? 'center' : '0'));
    hidden.value = mode;
    if (typeof runFenceCalc === 'function') runFenceCalc();
};

window.syncBeamCheckboxesToHeight = function(h) {
    const cbTop = document.getElementById('beamCbTop') || document.getElementById('imBeamCbTop');
    const cbCenter = document.getElementById('beamCbCenter') || document.getElementById('imBeamCbCenter');
    const hidden = document.getElementById('imBrickBeamMode') || document.getElementById('brickBeamMode');
    if (!cbTop || !cbCenter) return;
    
    let mode;
    if (h <= 1.2) { mode = '0'; cbTop.checked = false; cbCenter.checked = false; }
    else if (h < 1.8) { mode = 'top'; cbTop.checked = true; cbCenter.checked = false; }
    else if (h < 2.2) { mode = 'center'; cbTop.checked = false; cbCenter.checked = true; }
    else { mode = 'center+top'; cbTop.checked = true; cbCenter.checked = true; }

    if (hidden) hidden.value = mode;
    if (typeof syncPillarSizeOptions === 'function') syncPillarSizeOptions(h);
};

window.syncPillarSizeOptions = function(h) {
    const sel = document.getElementById('brickPillarSize') || document.getElementById('imBrickPillarSize');
    if (!sel) return;
    const current = sel.value;
    const opts = h <= 1.5 ? 
        [{ value: '10x10', label: '10×10 ซม. (default)' }, { value: '15x15', label: '15×15 ซม.' }, { value: 'custom', label: 'กำหนดเอง…' }] :
        [{ value: '15x15', label: '15×15 ซม. (default)' }, { value: '20x20', label: '20×20 ซม.' }, { value: 'custom', label: 'กำหนดเอง…' }];
    
    sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
    if (typeof onPillarSizeChange === 'function') onPillarSizeChange(sel.value);
};

window.onPillarSizeChange = function(val) {
    const customInput = document.getElementById('brickPillarCustom') || document.getElementById('imBrickPillarCustom');
    const customLabel = document.getElementById('brickPillarCustomLabel') || document.getElementById('imBrickPillarCustomLabel');
    if (customInput) customInput.style.display = val === 'custom' ? '' : 'none';
    if (customLabel) customLabel.style.display = val === 'custom' ? '' : 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    const h = parseFloat((document.getElementById('brickFenceHeight') || document.getElementById('imBrickFenceHeight'))?.value) || 1.8;
    if (typeof syncBeamCheckboxesToHeight === 'function') syncBeamCheckboxesToHeight(h);
    if (typeof syncPillarSizeOptions === 'function') syncPillarSizeOptions(h);
});

document.addEventListener('click', function(e) {
    const btn = e.target.closest('.dc-mode-btn');
    if (!btn) return;
    const type = (btn.dataset.type === 'concrete') ? 'concrete' : 'cowboy';
    const k = type + ':' + btn.dataset.k;
    const theta = parseFloat(btn.dataset.theta);
    if (!window._cornerModes) window._cornerModes = new Map();
    const cur = window._cornerModes.get(k) || 'double';
    const next = cur === 'double' ? 'single' : 'double';
    if (next === 'single' && theta < 120) return; // angle too sharp
    window._cornerModes.set(k, next);
    if (typeof runFenceCalc === 'function') runFenceCalc();
});

document.getElementById('clearFenceBtn')?.addEventListener('click', function() {
    fenceLayerGroup.clearLayers();
    swappedCorners.clear();
    ['resTotal','resPosts','resBeams','resPrice','imResTotal','imResPosts','imResBeams','imResPriceDisplay'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const fw1 = document.getElementById('fenceWarnings');
    const fw2 = document.getElementById('imFenceWarnings');
    if (fw1) fw1.style.display = 'none';
    if (fw2) fw2.style.display = 'none';
});

// ── Fence type labels & per-line option snapshot ─────
const FENCE_TYPE_LABELS = {
    cowboy: 'รั้วคาวบอย',
    barbed: 'รั้วลวดหนาม',
    brick: 'รั้วอิฐ',
    concrete: 'รั้วคอนกรีตสำเร็จรูป'
};

// Snapshot the option inputs relevant to a fence type, so each line
// remembers the settings that were active when it was drawn.
function captureFenceOptions(fenceType) {
    // Tab-aware — see _activeCornerCheckbox. This runs at the moment a line
    // is drawn/finalized, so it must read whichever tab (Page 1 or Input
    // Mode) the user is actually drawing from, not always Page 1's fields.
    const val = (id1, id2) => {
        const el = _activeCornerCheckbox(id1, id2);
        return el ? el.value : undefined;
    };
    const checked = (id1, id2) => {
        const el = _activeCornerCheckbox(id1, id2);
        return el ? el.checked : false;
    };

    if (fenceType === 'barbed') {
        return {
            spacing: val('postSpacingBarbed', 'imPostSpacingBarbed'),
            nBraceSolo: checked('nBraceSolo', 'imNBraceSolo'),
            nBraceDual: checked('nBraceDual', 'imNBraceDual'),
            nBraceAngle: checked('nBraceAngle', 'imNBraceAngle')
        };
    }
    if (fenceType === 'concrete') {
        const spacingSel    = _activeCornerCheckbox('spacingSelectConcrete', 'imSpacingSelectConcrete');
        const spacingCustom = _activeCornerCheckbox('postSpacingConcrete', 'imPostSpacingConcrete');
        const spacing = (spacingSel?.value === 'custom')
            ? parseFloat(spacingCustom?.value) || 2.5
            : parseFloat(spacingSel?.value)    || 2.5;
        const layers = parseInt(_activeCornerCheckbox('concreteLayerSelect', 'imConcreteLayerSelect')?.value) || 2;
        // Fixed id typo: the actual Input Mode element is "imConcreteDoubleCorner"
        // (no "Post" suffix) — the old lookup for "imConcreteDoubleCornerPost"
        // never matched anything, and even then was shadowed by the always-
        // present Page 1 checkbox. Use the tab-aware helper instead.
        const doubleCorner = _activeCornerCheckbox('concreteDoubleCornerPost', 'imConcreteDoubleCorner')?.checked || false;
        return { postSpacing: spacing, layers, doubleCorner };
    }

    if (fenceType === 'brick') {
        return {
            spacing: val('postSpacingBrick', 'imPostSpacingBrick'),
            height: val('brickFenceHeight', 'imBrickFenceHeight'),
            beamMode: val('brickBeamMode', 'imBrickBeamMode'),
            pillarSize: val('brickPillarSize', 'imBrickPillarSize')
        };
    }
    // cowboy (default)
    const dcEl = _activeCornerCheckbox('doubleCornerPost', 'imDoubleCornerPost');
    return {
        spacing: val('postSpacing', 'imPostSpacing'),
        doubleCorner: dcEl ? dcEl.checked : false,
        layers: val('beamSelect', 'imBeamSelect')
    };
}

// Build a short label describing a saved line's fence type + options
function getFenceSummaryLabel(ld) {
    const type = ld.fenceType || 'cowboy';
    const typeName = FENCE_TYPE_LABELS[type] || type;
    const opt = ld.fenceOptions || {};
    const parts = [];

    if (type === 'barbed') {
        if (opt.nBraceSolo)  parts.push('N-Brace เดี่ยว');
        if (opt.nBraceDual)  parts.push('N-Brace คู่');
        if (opt.nBraceAngle) parts.push('N-Brace มุม');
        if (opt.spacing)     parts.push(`เสาห่าง ${opt.spacing} ม.`);
    } else if (type === 'brick') {
        if (opt.height)     parts.push(`สูง ${opt.height} ม.`);
        if (opt.pillarSize) parts.push(`เสา ${opt.pillarSize} ซม.`);
        const beamLabels = { top: 'คานบน', center: 'คานกลาง', 'center+top': 'คานบน+กลาง', '0': 'ไม่มีคาน', none: 'ไม่มีคาน' };
        if (opt.beamMode && beamLabels[opt.beamMode]) parts.push(beamLabels[opt.beamMode]);
    } else {
        if (opt.spacing)      parts.push(`เสาห่าง ${opt.spacing} ม.`);
        if (opt.doubleCorner) parts.push('เสามุมคู่');
        if (opt.layers)       parts.push(`${opt.layers} ลอน`);
    }

    return parts.length ? `${typeName} • ${parts.join(' · ')}` : typeName;
}

// ── Auto-recalculate on every change ─────────────────
let _fenceRecalcTimer = null;
function scheduleFenceRecalc() {
    clearTimeout(_fenceRecalcTimer);
    _fenceRecalcTimer = setTimeout(() => {
        if (typeof runFenceCalc === 'function') runFenceCalc();
    }, 100);
}

// Delegated listener: any input/select/checkbox change anywhere in the
// left sidebar (Page 1 fence options AND Input-Mode page options)
// triggers a recalculation — no "Simulate" button needed anymore.
function wireFenceOptionAutoCalc() {
    const sidebar = document.querySelector('.left-sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('input', function (e) {
        if (e.target.matches('input, select, textarea')) {
            scheduleFenceRecalc();
        }
    });

    sidebar.addEventListener('change', function (e) {
        if (e.target.matches('input, select, textarea')) {
            scheduleFenceRecalc();
        }
    });
}

document.addEventListener('DOMContentLoaded', wireFenceOptionAutoCalc);