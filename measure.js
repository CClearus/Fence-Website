// Measure tool variables   
let measureActive = false;
let eraserActive = false;
let labelsVisible = true;
let allLines = [];
let currentLine = null;
let tempLine = null;
let shiftPressed = false;
let tempAngleLabels = [];
let tempSegmentLabels = [];

// Fence type tracking
let selectedFenceType = null;
function isCowboyFence() { return selectedFenceType === 'cowboy'; }

// Max 1 connection per dot (counts how many lines use this point as endpoint)
function countDotConnections(point) {
    let count = 0;
    allLines.forEach(ld => {
        if (ld.points.length === 0) return;
        const first = ld.points[0], last = ld.points[ld.points.length - 1];
        if (Math.abs(point[0]-first[0]) < 0.0001 && Math.abs(point[1]-first[1]) < 0.0001) count++;
        else if (Math.abs(point[0]-last[0]) < 0.0001 && Math.abs(point[1]-last[1]) < 0.0001) count++;
    });
    return count;
}

// Color palette for different lines
const colorPalette = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7'
];

// Track fence type selection
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.fence-type-card').forEach(card => {
        card.addEventListener('click', function() {
            selectedFenceType = this.getAttribute('data-type');
        });
    });
    const activeCard = document.querySelector('.fence-type-card.active');
    if (activeCard) selectedFenceType = activeCard.getAttribute('data-type');
});

// Get measure tool elements
const measureBtn = document.getElementById('measureBtn');
const eraserBtn = document.getElementById('eraserBtn');
const toggleLabelsBtn = document.getElementById('toggleLabelsBtn');
const measureInfo = document.getElementById('measureInfo');
const lineInfoContent = document.getElementById('lineInfoContent');
const lineInfoClose = document.getElementById('lineInfoClose'); // This may be null

// ============================================
// MEASURE TOOL EVENT LISTENERS
// ============================================

// Track Shift key state
document.addEventListener('keydown', function (e) {
    if (e.key === 'Shift') {
        shiftPressed = true;
    }
});

document.addEventListener('keyup', function (e) {
    if (e.key === 'Shift') {
        shiftPressed = false;
    }
});

// Toggle measure mode — requires fence type to be selected first
measureBtn.addEventListener('click', function () {
    if (!selectedFenceType) {
        const grid = document.querySelector('.fence-type-grid');
        if (grid) { grid.style.outline = '2px solid #ef4444'; setTimeout(() => grid.style.outline = '', 1200); }
        return;
    }
    measureActive = !measureActive;
    if (measureActive) {
        this.classList.add('active');
        map.getContainer().style.cursor = 'crosshair';
        if (eraserActive) { eraserActive = false; eraserBtn.classList.remove('active'); }
    } else {
        stopDrawMode();
    }
});

// Toggle eraser mode
eraserBtn.addEventListener('click', function () {
    eraserActive = !eraserActive;

    if (eraserActive) {
        this.classList.add('active');
        map.getContainer().style.cursor = 'pointer';

        // Disable measure mode
        if (measureActive) {
            measureActive = false;
            measureBtn.classList.remove('active');
            finishCurrentLine();
        }
    } else {
        this.classList.remove('active');
        map.getContainer().style.cursor = '';
    }
});

// Toggle labels visibility
// Track individual toggle states
let anglesVisible = true;
let measurementsVisible = true;

// Toggle label dropdown
toggleLabelsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const labelDropdown = document.getElementById('labelDropdown');
    labelDropdown.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
    const labelDropdown = document.getElementById('labelDropdown');
    if (!e.target.closest('.custom-label-control')) {
        labelDropdown.classList.remove('active');
    }
});

// Toggle angles visibility
// Toggle angles visibility
document.getElementById('toggleAngles').addEventListener('click', function () {
    anglesVisible = !anglesVisible;
    this.classList.toggle('active');
    
    allLines.forEach(lineData => {
        // Toggle main line angle labels
        if (lineData.angleLabels) {
            lineData.angleLabels.forEach(label => {
                if (anglesVisible && labelsVisible) {
                    if (!map.hasLayer(label)) label.addTo(map);
                } else {
                    if (map.hasLayer(label)) map.removeLayer(label);
                }
            });
        }
        
        // Toggle branch angle labels
        if (lineData.branches) {
            lineData.branches.forEach(branch => {
                if (branch.angleLabels) {
                    branch.angleLabels.forEach(label => {
                        if (anglesVisible && labelsVisible) {
                            if (!map.hasLayer(label)) label.addTo(map);
                        } else {
                            if (map.hasLayer(label)) map.removeLayer(label);
                        }
                    });
                }
            });
        }
    });
});

// Toggle measurements visibility
// Toggle measurements visibility
document.getElementById('toggleMeasurements').addEventListener('click', function () {
    measurementsVisible = !measurementsVisible;
    this.classList.toggle('active');
    
    allLines.forEach(lineData => {
        // Toggle main line segment labels
        if (lineData.segmentLabels) {
            lineData.segmentLabels.forEach(label => {
                if (measurementsVisible && labelsVisible) {
                    if (!map.hasLayer(label)) label.addTo(map);
                } else {
                    if (map.hasLayer(label)) map.removeLayer(label);
                }
            });
        }
        
        // Toggle branch segment labels
        if (lineData.branches) {
            lineData.branches.forEach(branch => {
                if (branch.segmentLabels) {
                    branch.segmentLabels.forEach(label => {
                        if (measurementsVisible && labelsVisible) {
                            if (!map.hasLayer(label)) label.addTo(map);
                        } else {
                            if (map.hasLayer(label)) map.removeLayer(label);
                        }
                    });
                }
            });
        }
    });
});

// Initially set toggle options as active
document.getElementById('toggleAngles').classList.add('active');
document.getElementById('toggleMeasurements').classList.add('active');



// Close line info box
// Close line info box
if (lineInfoClose) {
    lineInfoClose.addEventListener('click', function () {
        lineInfoBox.style.display = 'none';
    });
}

// ============================================
// COLOR MANAGEMENT
// ============================================

function getNextColor() {
    return colorPalette[allLines.length % colorPalette.length];
}

// ============================================
// ANGLE CALCULATION AND DISPLAY
// ============================================

// Calculate angle between two vectors
function calculateAngle(point1, point2, point3) {
    // Vector from point2 to point1
    const v1 = {
        lat: point1[0] - point2[0],
        lng: point1[1] - point2[1]
    };

    // Vector from point2 to point3
    const v2 = {
        lat: point3[0] - point2[0],
        lng: point3[1] - point2[1]
    };

    // Calculate angle using dot product
    const dot = v1.lat * v2.lat + v1.lng * v2.lng;
    const mag1 = Math.sqrt(v1.lat * v1.lat + v1.lng * v1.lng);
    const mag2 = Math.sqrt(v2.lat * v2.lat + v2.lng * v2.lng);

    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    const angleDeg = angleRad * (180 / Math.PI);

    return angleDeg;
}

// Calculate direction angle of a line segment
function getDirectionAngle(point1, point2) {
    const dx = point2[1] - point1[1];
    const dy = point2[0] - point1[0];
    return Math.atan2(dy, dx) * (180 / Math.PI);
}

// Draw angle label
function drawAngleLabel(point, angle, color, isTemp = false) {
    const angleText = `${Math.round(angle)}°`;
    const label = L.marker(point, {
        icon: L.divIcon({
            className: 'angle-label',
            html: `<div style="background: ${isTemp ? 'rgba(255,255,255,0.85)' : 'white'}; padding: 3px 7px; border-radius: 4px; border: 2px solid ${color}; font-size: 12px; font-weight: bold; color: ${color}; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: inline-block; min-width: fit-content;">${angleText}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, -10]
        }),
        zIndexOffset: 2000,
        pane: 'markerPane'
    }).addTo(map);

    return label;
}


// Clear temporary labels
function clearTempLabels() {
    tempAngleLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    tempAngleLabels = [];

    tempSegmentLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    tempSegmentLabels = [];
}

// ============================================
// MARKER DETECTION
// ============================================

// Find nearest marker to a click point
// Find nearest marker to a click point
function findNearestMarker(clickLatLng, maxDistance = 20) {
    let nearestMarker = null;
    let minDistance = maxDistance;
    let nearestMarkerIndex = -1;

    allLines.forEach(lineData => {
        lineData.markers.forEach((marker, markerIndex) => {
            const markerPoint = map.latLngToContainerPoint(marker.getLatLng());
            const clickPoint = map.latLngToContainerPoint(clickLatLng);

            const distance = Math.sqrt(
                Math.pow(markerPoint.x - clickPoint.x, 2) +
                Math.pow(markerPoint.y - clickPoint.y, 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearestMarkerIndex = markerIndex;
                nearestMarker = {
                    marker: marker,
                    lineData: lineData,
                    latlng: marker.getLatLng(),
                    pointIndex: markerIndex  // Track which point in the line this is
                };
            }
        });
    });

    return nearestMarker;
}

// ============================================
// MEASUREMENT FUNCTIONS
// ============================================

// Clear all measurements
function clearMeasure() {
    // Remove all lines and markers
    allLines.forEach(lineData => {
        if (lineData.polyline) {
            map.removeLayer(lineData.polyline);
        }
        lineData.markers.forEach(marker => {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
        lineData.angleLabels.forEach(label => {
            if (map.hasLayer(label)) {
                map.removeLayer(label);
            }
        });
        lineData.segmentLabels.forEach(label => {
            if (map.hasLayer(label)) {
                map.removeLayer(label);
            }
        });
    });
    allLines = [];
    currentLine = null;
    _clearFenceLayer();

    // Remove temp line
    if (tempLine) {
        map.removeLayer(tempLine);
        tempLine = null;
    }

    clearTempLabels();

    updateLineInfoBox();
}

// Finish current line — keeps draw mode active for next line
function finishCurrentLine() {
    if (currentLine) {
        currentLine.active = false;
        currentLine.continueFromStart = false;
        currentLine.activeBranch = null;
        currentLine = null;
    }
    if (tempLine) { map.removeLayer(tempLine); tempLine = null; }
    clearTempLabels();
}

// Fully stop draw mode
function stopDrawMode() {
    finishCurrentLine();
    measureActive = false;
    const btn = document.getElementById('measureBtn');
    if (btn) btn.classList.remove('active');
    map.getContainer().style.cursor = '';
}

// Clear fence layer helper
function _clearFenceLayer() {
    if (typeof fenceLayerGroup !== 'undefined') {
        fenceLayerGroup.clearLayers();
        ['resTotal','resPosts','resBeams','resPrice'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const warnEl = document.getElementById('fenceWarnings');
        if (warnEl) warnEl.style.display = 'none';
    }
}

// Start or continue a line
function startLine(fromPoint = null, existingLine = null) {
    if (existingLine) {
        // Continue existing line
        currentLine = existingLine;
        currentLine.active = true;
    } else {
        // Create new line
        currentLine = {
            color: getNextColor(),
            points: fromPoint ? [fromPoint] : [],
            polyline: null,
            markers: [],
            angleLabels: [],
            segmentLabels: [],
            active: true,
            continueFromStart: false,
            activeBranch: null,
            fenceType: selectedFenceType
        };
        allLines.push(currentLine);

        // Add first marker if starting with a point
        if (fromPoint) {
            addMarkerToLine(fromPoint, currentLine);
        }
    }
}

// Add marker to a line
function addMarkerToLine(point, lineData) {
    const marker = L.circleMarker(point, {
        radius: 6,
        fillColor: lineData.color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
        className: 'measure-endpoint'
    }).addTo(map);

    // Only add hover effects, NO click handler here
    marker.on('mouseover', function () {
        if (measureActive || eraserActive) {
            marker.setStyle({ radius: 8 });
        }
    });

    marker.on('mouseout', function () {
        marker.setStyle({ radius: 6 });
    });

    lineData.markers.push(marker);
    return marker;
}

// Remove segment from line
function removeSegment(lineData, clickedMarker) {
    const markerIndex = lineData.markers.indexOf(clickedMarker);
    if (markerIndex === -1) return;

    // Remove the point
    lineData.points.splice(markerIndex, 1);

    // Remove the marker
    if (map.hasLayer(clickedMarker)) {
        map.removeLayer(clickedMarker);
    }
    lineData.markers.splice(markerIndex, 1);

    // If line has less than 2 points, remove the entire line
    if (lineData.points.length < 2) {
        removeLine(lineData);
        return;
    }

    // Update the polyline
    lineData.polyline.setLatLngs(lineData.points);

    redrawLineLabels(lineData);
    _clearFenceLayer();
    updateLineInfoBox();
}

// Remove entire line
function removeLine(lineData) {
    const index = allLines.indexOf(lineData);
    if (index === -1) return;

    // Remove polyline
    if (lineData.polyline && map.hasLayer(lineData.polyline)) {
        map.removeLayer(lineData.polyline);
    }

    // Remove markers
    lineData.markers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });

    // Remove labels
    lineData.angleLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    lineData.segmentLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });

    allLines.splice(index, 1);
    _clearFenceLayer();
    updateLineInfoBox();
}

// Redraw all labels for a line
function redrawLineLabels(lineData) {
    // Clear existing labels
    lineData.angleLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    lineData.angleLabels = [];

    lineData.segmentLabels.forEach(label => {
        if (map.hasLayer(label)) {
            map.removeLayer(label);
        }
    });
    lineData.segmentLabels = [];

    // Only draw labels if they're supposed to be visible
// Only draw labels if they're supposed to be visible
if (!labelsVisible) return;

// Store whether we should draw each type
const shouldDrawAngles = anglesVisible && labelsVisible;
const shouldDrawMeasurements = measurementsVisible && labelsVisible;

    // For closed shapes, don't duplicate the last point
    const pointCount = lineData.closed ? lineData.points.length - 1 : lineData.points.length;

    // Draw angle labels at ALL points
    if (pointCount >= 2) {
        if (lineData.closed) {
            // For closed shapes, calculate angles including wraparound
            for (let i = 0; i < pointCount; i++) {
                const prevIdx = (i - 1 + pointCount) % pointCount;
                const nextIdx = (i + 1) % pointCount;
                const angle = calculateAngle(
                    lineData.points[prevIdx],
                    lineData.points[i],
                    lineData.points[nextIdx]
                );
if (shouldDrawAngles) {
    const label = drawAngleLabel(lineData.points[i], angle, lineData.color, false);
    lineData.angleLabels.push(label);
}
            }
        } else {
            // For open lines
            // First point - show direction angle
// For open lines
            // First point - show direction angle
            if (shouldDrawAngles) {
                const firstAngle = getDirectionAngle(lineData.points[0], lineData.points[1]);
                const firstLabel = drawAngleLabel(lineData.points[0], firstAngle, lineData.color, false);
                lineData.angleLabels.push(firstLabel);
            }

            // Middle points - show angle between segments
            for (let i = 1; i < lineData.points.length - 1; i++) {
                const angle = calculateAngle(
                    lineData.points[i - 1],
                    lineData.points[i],
                    lineData.points[i + 1]
                );
                if (shouldDrawAngles) {
                    const label = drawAngleLabel(lineData.points[i], angle, lineData.color, false);
                    lineData.angleLabels.push(label);
                }
            }

            // Last point - show direction angle
            if (lineData.points.length >= 2) {
                const lastIdx = lineData.points.length - 1;
                const lastAngle = getDirectionAngle(lineData.points[lastIdx - 1], lineData.points[lastIdx]);
                if (shouldDrawAngles) {
                    const lastLabel = drawAngleLabel(lineData.points[lastIdx], lastAngle, lineData.color, false);
                    lineData.angleLabels.push(lastLabel);
                }
            }
        }
    }

    // Redraw segment length labels
    const segmentCount = lineData.closed ? pointCount : lineData.points.length - 1;
    for (let i = 0; i < segmentCount; i++) {
        const nextIdx = lineData.closed ? (i + 1) % pointCount : i + 1;

        const distance = calculateDistance(
            lineData.points[i][0], lineData.points[i][1],
            lineData.points[nextIdx][0], lineData.points[nextIdx][1]
        );

        // Calculate midpoint
        const midLat = (lineData.points[i][0] + lineData.points[nextIdx][0]) / 2;
        const midLng = (lineData.points[i][1] + lineData.points[nextIdx][1]) / 2;

const distanceText = formatDistance(distance);
        if (shouldDrawMeasurements) {
            const label = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'segment-label',
                    html: `<div style="background: white; padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; color: ${lineData.color}; white-space: nowrap; border: 2px solid ${lineData.color}; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: inline-block; min-width: fit-content;">${distanceText}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 5]
                }),
                zIndexOffset: 1000
            }).addTo(map);

            lineData.segmentLabels.push(label);
        }
    }
}

// Redraw all labels for branches
// Redraw all labels for branches
function redrawBranchLabels(lineData) {
    if (!lineData.branches || !labelsVisible) return;
    const shouldDrawAngles = anglesVisible && labelsVisible;
const shouldDrawMeasurements = measurementsVisible && labelsVisible;

    lineData.branches.forEach(branch => {
        // Clear existing branch labels
        if (branch.angleLabels) {
            branch.angleLabels.forEach(label => {
                if (map.hasLayer(label)) map.removeLayer(label);
            });
        }
        if (branch.segmentLabels) {
            branch.segmentLabels.forEach(label => {
                if (map.hasLayer(label)) map.removeLayer(label);
            });
        }

        branch.angleLabels = [];
        branch.segmentLabels = [];

        if (branch.points.length < 1) return;

        // Find the branch point in the main line
        const branchPoint = branch.points[0];
        let branchPointIndex = -1;

        for (let i = 0; i < lineData.points.length; i++) {
            if (Math.abs(lineData.points[i][0] - branchPoint[0]) < 0.0001 &&
                Math.abs(lineData.points[i][1] - branchPoint[1]) < 0.0001) {
                branchPointIndex = i;
                break;
            }
        }

        // Draw angle at the branch starting point (showing angle between main line and branch)
        if (branchPointIndex !== -1 && branch.points.length >= 2) {
            // Get the points before and after on the main line
            if (branchPointIndex > 0 && branchPointIndex < lineData.points.length - 1) {
                const prevMainPoint = lineData.points[branchPointIndex - 1];
                const nextMainPoint = lineData.points[branchPointIndex + 1];
                const nextBranchPoint = branch.points[1];

                // Calculate the three angles
                const angle1 = calculateAngle(prevMainPoint, branchPoint, nextBranchPoint);
                const angle2 = calculateAngle(nextBranchPoint, branchPoint, nextMainPoint);
                const angle3 = calculateAngle(prevMainPoint, branchPoint, nextMainPoint);

                // Calculate direction angles to position labels correctly
                const dir1 = getDirectionAngle(branchPoint, prevMainPoint);
                const dir2 = getDirectionAngle(branchPoint, nextBranchPoint);
                const dir3 = getDirectionAngle(branchPoint, nextMainPoint);

                // Calculate bisector angles for label positioning
                const bisector1 = (dir1 + dir2) / 2;
                const bisector2 = (dir2 + dir3) / 2;
                const bisector3 = (dir3 + dir1) / 2;

                const offsetDistance = 0.00008; // Offset distance for labels

                // Position label 1 (between prev main and branch)
                const offset1Lat = branchPoint[0] + offsetDistance * Math.sin(bisector1 * Math.PI / 180);
                const offset1Lng = branchPoint[1] + offsetDistance * Math.cos(bisector1 * Math.PI / 180);

                // Position label 2 (between branch and next main)
                const offset2Lat = branchPoint[0] + offsetDistance * Math.sin(bisector2 * Math.PI / 180);
                const offset2Lng = branchPoint[1] + offsetDistance * Math.cos(bisector2 * Math.PI / 180);

                // Position label 3 (between next main and prev main - the continuing angle)
                const offset3Lat = branchPoint[0] + offsetDistance * Math.sin(bisector3 * Math.PI / 180);
                const offset3Lng = branchPoint[1] + offsetDistance * Math.cos(bisector3 * Math.PI / 180);

if (shouldDrawAngles) {
                    const label1 = drawAngleLabel([offset1Lat, offset1Lng], angle1, lineData.color, false);
                    const label2 = drawAngleLabel([offset2Lat, offset2Lng], angle2, lineData.color, false);
                    const label3 = drawAngleLabel([offset3Lat, offset3Lng], angle3, lineData.color, false);

                    branch.angleLabels.push(label1, label2, label3);
                }
            }
        }

        // Draw angles for other points along the branch
// Draw angles for other points along the branch
        if (branch.points.length >= 2) {
            // Middle points on the branch
            for (let i = 1; i < branch.points.length - 1; i++) {
                const angle = calculateAngle(
                    branch.points[i - 1],
                    branch.points[i],
                    branch.points[i + 1]
                );
                if (shouldDrawAngles) {
                    const label = drawAngleLabel(branch.points[i], angle, lineData.color, false);
                    branch.angleLabels.push(label);
                }
            }

            // Last point - show direction angle
            if (branch.points.length >= 2) {
                const lastIdx = branch.points.length - 1;
                const lastAngle = getDirectionAngle(branch.points[lastIdx - 1], branch.points[lastIdx]);
                if (shouldDrawAngles) {
                    const lastLabel = drawAngleLabel(branch.points[lastIdx], lastAngle, lineData.color, false);
                    branch.angleLabels.push(lastLabel);
                }
            }
        }

        // Draw segment length labels for branches
// Draw segment length labels for branches
        for (let i = 0; i < branch.points.length - 1; i++) {
            const distance = calculateDistance(
                branch.points[i][0], branch.points[i][1],
                branch.points[i + 1][0], branch.points[i + 1][1]
            );

            const midLat = (branch.points[i][0] + branch.points[i + 1][0]) / 2;
            const midLng = (branch.points[i][1] + branch.points[i + 1][1]) / 2;

            const distanceText = formatDistance(distance);
            if (shouldDrawMeasurements) {
                const label = L.marker([midLat, midLng], {
                    icon: L.divIcon({
                        className: 'segment-label',
                        html: `<div style="background: white; padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; color: ${lineData.color}; white-space: nowrap; border: 2px solid ${lineData.color}; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: inline-block; min-width: fit-content;">${distanceText}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 5]
                    }),
                    zIndexOffset: 1000
                }).addTo(map);

                branch.segmentLabels.push(label);
            }
        }
    });
}

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate total distance for a line with multiple segments
function calculateTotalDistance(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        total += calculateDistance(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    }
    return total;
}

// Format distance for display
function formatDistance(meters) {
    if (meters < 1000) {
        return meters.toFixed(2) + ' m';
    } else {
        return (meters / 1000).toFixed(2) + ' km';
    }
}

// Convert meters to inches
function metersToInches(meters) {
    return meters * 39.3701;
}

// Calculate point for 90-degree snap.
// For cowboy fence (2+ points already placed): snaps perpendicular to the LAST segment direction.
// For Shift-snap with only 1 point: snaps to global horizontal/vertical.
function getSnapPoint(startPoint, currentPoint, prevPoint) {
    if (prevPoint) {
        // Snap 90° relative to the previous segment (prevPoint → startPoint)
        // The new segment must be perpendicular to the last one.
        // prevSegment direction vector (in lat/lng space):
        const dx = startPoint[1] - prevPoint[1]; // lng component
        const dy = startPoint[0] - prevPoint[0]; // lat component

        // Perpendicular directions to the previous segment: (−dy, dx) and (dy, −dx)
        // Project currentPoint onto the perpendicular line through startPoint
        // Perpendicular unit vector: (-dy, dx) normalized
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 1e-10) {
            // Previous segment has zero length, fall back to global snap
        } else {
            const px = -dy / len; // perpendicular direction in lng
            const py =  dx / len; // perpendicular direction in lat

            // Project (currentPoint - startPoint) onto the perpendicular direction
            const relLat = currentPoint[0] - startPoint[0];
            const relLng = currentPoint[1] - startPoint[1];
            const t = relLat * py + relLng * px;

            // Snapped point = startPoint + t * perpendicular
            return [startPoint[0] + t * py, startPoint[1] + t * px];
        }
    }

    // Global horizontal/vertical snap (Shift key, or only 1 point placed)
    const lat1 = startPoint[0], lng1 = startPoint[1];
    const lat2 = currentPoint[0], lng2 = currentPoint[1];
    const deltaLat = Math.abs(lat2 - lat1);
    const deltaLng = Math.abs(lng2 - lng1);
    if (deltaLat > deltaLng) {
        return [lat2, lng1]; // vertical
    } else {
        return [lat1, lng2]; // horizontal
    }
}

// Update line info box
// Update line info box
function updateLineInfoBox() {
    const stack = document.getElementById('lineSummaryStack');
    const measureInfo = document.getElementById('measureInfo');
    stack.innerHTML = '';

    if (allLines.length === 0) {
        measureInfo.classList.remove('active');
        return;
    }

    measureInfo.classList.add('active');

    allLines.forEach((lineData, index) => {
        let totalMeters = calculateTotalDistance(lineData.points);
        let points = lineData.closed ? lineData.points.length - 1 : lineData.points.length;
        let segments = lineData.closed ? lineData.points.length - 1 : lineData.points.length - 1;

        if (lineData.branches) {
            lineData.branches.forEach(branch => {
                totalMeters += calculateTotalDistance(branch.points);
                points += branch.points.length - 1;
                segments += branch.points.length - 1;
            });
        }

        const totalNi = metersToInches(totalMeters);

        const item = document.createElement('div');
        item.className = 'line-summary-item';
        item.style.borderLeftColor = lineData.color;
        item.innerHTML = `
            <div class="line-summary-title" style="color:${lineData.color};">Line ${index + 1}</div>
            <div class="line-summary-dist">${formatDistance(totalMeters)} / ${(totalMeters * 3.28084).toFixed(2)} ft</div>
            <div class="line-summary-meta">${points} point, ${segments} segments</div>
        `;
        stack.appendChild(item);
    });

    // Always scroll to top when a new card is added
    stack.scrollTop = 0;
}



// Update labels for preview
// Update labels for preview
function updatePreviewLabels(previewPoints, color) {
    clearTempLabels();

    if (!labelsVisible) return;

    // Check if we're branching from a middle point
    let isBranchPreview = false;
    let branchPointIndex = -1;

    if (currentLine && currentLine.activeBranch && previewPoints.length >= 2) {
        isBranchPreview = true;
        const branchPoint = previewPoints[0];

        // Find branch point in main line
        for (let i = 0; i < currentLine.points.length; i++) {
            if (Math.abs(currentLine.points[i][0] - branchPoint[0]) < 0.0001 &&
                Math.abs(currentLine.points[i][1] - branchPoint[1]) < 0.0001) {
                branchPointIndex = i;
                break;
            }
        }
    }

    // If this is a branch preview, show the angles at the branch point
    if (isBranchPreview && branchPointIndex !== -1 && branchPointIndex > 0 && branchPointIndex < currentLine.points.length - 1) {
        const prevMainPoint = currentLine.points[branchPointIndex - 1];
        const branchPoint = previewPoints[0];
        const nextMainPoint = currentLine.points[branchPointIndex + 1];
        const previewPoint = previewPoints[previewPoints.length - 1];

        // Calculate the three angles
        const angle1 = calculateAngle(prevMainPoint, branchPoint, previewPoint);
        const angle2 = calculateAngle(previewPoint, branchPoint, nextMainPoint);
        const angle3 = calculateAngle(prevMainPoint, branchPoint, nextMainPoint);

        // Calculate direction angles for positioning
        const dir1 = getDirectionAngle(branchPoint, prevMainPoint);
        const dir2 = getDirectionAngle(branchPoint, previewPoint);
        const dir3 = getDirectionAngle(branchPoint, nextMainPoint);

        // Calculate bisector angles
        const bisector1 = (dir1 + dir2) / 2;
        const bisector2 = (dir2 + dir3) / 2;
        const bisector3 = (dir3 + dir1) / 2;

        const offsetDistance = 0.00008;

        // Position labels
        const offset1Lat = branchPoint[0] + offsetDistance * Math.sin(bisector1 * Math.PI / 180);
        const offset1Lng = branchPoint[1] + offsetDistance * Math.cos(bisector1 * Math.PI / 180);

        const offset2Lat = branchPoint[0] + offsetDistance * Math.sin(bisector2 * Math.PI / 180);
        const offset2Lng = branchPoint[1] + offsetDistance * Math.cos(bisector2 * Math.PI / 180);

        const offset3Lat = branchPoint[0] + offsetDistance * Math.sin(bisector3 * Math.PI / 180);
        const offset3Lng = branchPoint[1] + offsetDistance * Math.cos(bisector3 * Math.PI / 180);

        const label1 = drawAngleLabel([offset1Lat, offset1Lng], angle1, color, true);
        const label2 = drawAngleLabel([offset2Lat, offset2Lng], angle2, color, true);
        const label3 = drawAngleLabel([offset3Lat, offset3Lng], angle3, color, true);

        tempAngleLabels.push(label1, label2, label3);
    } else {
        // Normal preview (not branching)
        // Show angle at each intermediate point (preview)
        for (let i = 1; i < previewPoints.length - 1; i++) {
            const angle = calculateAngle(previewPoints[i - 1], previewPoints[i], previewPoints[i + 1]);
            const label = drawAngleLabel(previewPoints[i], angle, color, true);
            tempAngleLabels.push(label);
        }

        // Show angle at the preview endpoint (if we have at least 2 points)
        if (previewPoints.length >= 2) {
            const lastIdx = previewPoints.length - 1;
            const dirAngle = getDirectionAngle(previewPoints[lastIdx - 1], previewPoints[lastIdx]);
            const label = drawAngleLabel(previewPoints[lastIdx], dirAngle, color, true);
            tempAngleLabels.push(label);
        }
    }

    // Show segment lengths for all segments including preview
    for (let i = 0; i < previewPoints.length - 1; i++) {
        const distance = calculateDistance(
            previewPoints[i][0], previewPoints[i][1],
            previewPoints[i + 1][0], previewPoints[i + 1][1]
        );

        // Calculate midpoint
        const midLat = (previewPoints[i][0] + previewPoints[i + 1][0]) / 2;
        const midLng = (previewPoints[i][1] + previewPoints[i + 1][1]) / 2;

        const distanceText = formatDistance(distance);
        const label = L.marker([midLat, midLng], {
            icon: L.divIcon({
                className: 'segment-label',
                html: `<div style="background: rgba(255,255,255,0.85); padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; color: ${color}; white-space: nowrap; border: 2px solid ${color}; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: inline-block; min-width: fit-content;">${distanceText}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 5]
            }),
            zIndexOffset: 2000,
            pane: 'markerPane'
        }).addTo(map);

        tempSegmentLabels.push(label);
    }
}

// ============================================
// MAP INTERACTION FOR MEASUREMENT
// ============================================

// Map click handler
map.on('click', function (e) {
    if (measureActive) {
        const nearest = findNearestMarker(e.latlng);

        if (nearest) {
            // ── Clicked on an existing dot ──
            const dotPoint = [nearest.marker.getLatLng().lat, nearest.marker.getLatLng().lng];
            const hitLine  = nearest.lineData;
            const hitFirst = hitLine.points[0];
            const hitLast  = hitLine.points[hitLine.points.length - 1];
            const isHitEndpoint = (
                (Math.abs(dotPoint[0]-hitFirst[0]) < 0.0001 && Math.abs(dotPoint[1]-hitFirst[1]) < 0.0001) ||
                (Math.abs(dotPoint[0]-hitLast[0])  < 0.0001 && Math.abs(dotPoint[1]-hitLast[1])  < 0.0001)
            );

            if (!currentLine) {
                // ── No active drawing — resume existing line from this endpoint ──
                if (!isHitEndpoint) return;
                if (countDotConnections(dotPoint) >= 2) return;

                currentLine = hitLine;
                currentLine.active = true;
                currentLine.activeBranch = null;
                currentLine.continueFromStart = false;

                const clickedFirst = Math.abs(dotPoint[0]-hitFirst[0]) < 0.0001 &&
                                     Math.abs(dotPoint[1]-hitFirst[1]) < 0.0001;
                if (clickedFirst) {
                    currentLine.points.reverse();
                    currentLine.markers.reverse();
                }
                return;
            }

            // ── Active line — connecting to a dot ──

            // Cowboy: snap connection to 90° relative to previous segment
            let connectPoint = dotPoint;
            if (isCowboyFence() && currentLine.points.length >= 2) {
                const refPt  = currentLine.points[currentLine.points.length - 1];
                const prevPt = currentLine.points[currentLine.points.length - 2];
                const snapped = getSnapPoint(refPt, dotPoint, prevPt);
                const snapDist = Math.sqrt(Math.pow(snapped[0]-dotPoint[0],2)+Math.pow(snapped[1]-dotPoint[1],2));
                if (snapDist > 0.0002) return;
                connectPoint = snapped;
            }

            // Check if closing own shape
            const ownFirst = currentLine.points[0];
            const isClosing = Math.abs(dotPoint[0]-ownFirst[0]) < 0.0001 && Math.abs(dotPoint[1]-ownFirst[1]) < 0.0001;

            if (isClosing && currentLine.points.length >= 3) {
                currentLine.points.push(ownFirst);
                currentLine.closed = true;
                if (currentLine.polyline) map.removeLayer(currentLine.polyline);
                currentLine.polyline = L.polygon(currentLine.points, { color: currentLine.color, weight: 3, opacity: 0.8, fillOpacity: 0.2 }).addTo(map);
                redrawLineLabels(currentLine);
                const td = calculateTotalDistance(currentLine.points);
                currentLine.polyline.bindPopup(`Distance: ${formatDistance(td)} / ${metersToInches(td).toFixed(2)} in<br>Enclosed Shape`);
                updateLineInfoBox();
                finishCurrentLine();
                return;
            }

            if (!isClosing) {
                if (!isHitEndpoint) return;
                if (countDotConnections(dotPoint) >= 2) return;
            }

            currentLine.points.push(connectPoint);
            addMarkerToLine(connectPoint, currentLine);
            _redrawCurrentPolyline();

        } else {
            // ── Clicked empty space — add new point ──
            if (!currentLine) startLine();

            let clickPoint = [e.latlng.lat, e.latlng.lng];
            const refPt = currentLine.points.length > 0 ? currentLine.points[currentLine.points.length - 1] : null;

            // Cowboy: force 90° from 2nd segment onward (relative to prev segment); Shift: always snap
            if (refPt && (shiftPressed || (isCowboyFence() && currentLine.points.length >= 2))) {
                const prevPt = currentLine.points.length >= 2 ? currentLine.points[currentLine.points.length - 2] : null;
                clickPoint = getSnapPoint(refPt, clickPoint, prevPt);
            }

            currentLine.points.push(clickPoint);
            const newMarker = addMarkerToLine(clickPoint, currentLine);
            if (currentLine.points.length === 1) currentLine.startMarker = newMarker;
            _redrawCurrentPolyline();
        }

    } else if (!eraserActive) {
        const newMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
        newMarker.bindPopup(`Coordinates:<br>Lat: ${e.latlng.lat.toFixed(4)}<br>Lng: ${e.latlng.lng.toFixed(4)}`);
    }
});

function _redrawCurrentPolyline() {
    if (!currentLine || currentLine.points.length < 2) return;
    if (tempLine) { map.removeLayer(tempLine); tempLine = null; }
    clearTempLabels();
    if (currentLine.polyline) map.removeLayer(currentLine.polyline);
    currentLine.polyline = L.polyline(currentLine.points, { color: currentLine.color, weight: 3, opacity: 0.8 }).addTo(map);
    redrawLineLabels(currentLine);
    const td = calculateTotalDistance(currentLine.points);
    currentLine.polyline.bindPopup(`Distance: ${formatDistance(td)} / ${metersToInches(td).toFixed(2)} in`);
    updateLineInfoBox();
}

// Right-click: finish current line or stop draw mode
map.on('contextmenu', function (e) {
    if (measureActive) {
        L.DomEvent.preventDefault(e);
        if (currentLine) { finishCurrentLine(); }
        else { stopDrawMode(); }
    }
});

// Show temp line while moving mouse
map.on('mousemove', function (e) {
    if (measureActive && currentLine && currentLine.active) {
        if (tempLine) { map.removeLayer(tempLine); }

        let previewPoint = [e.latlng.lat, e.latlng.lng];

        const referencePoint = currentLine.points.length > 0
            ? currentLine.points[currentLine.points.length - 1] : null;

        // Snap: cowboy forces 90° from 2nd segment (relative to prev segment), Shift always snaps
        if (referencePoint && (shiftPressed || (isCowboyFence() && currentLine.points.length >= 2))) {
            const prevPt = currentLine.points.length >= 2 ? currentLine.points[currentLine.points.length - 2] : null;
            previewPoint = getSnapPoint(referencePoint, previewPoint, prevPt);
        }

        const previewPoints = [...currentLine.points, previewPoint];

        tempLine = L.polyline(previewPoints, {
            color: currentLine.color,
            weight: 2,
            opacity: 0.5,
            dashArray: '5, 10'
        }).addTo(map);

        // Update preview labels (this will show both angle and distance)
        updatePreviewLabels(previewPoints, currentLine.color);

        // Update distance display in measure info box
    }
});

map.on('click', function (e) {
    if (eraserActive) {
        const nearest = findNearestMarker(e.latlng);
        if (nearest) {
            L.DomEvent.stopPropagation(e);
            removeSegment(nearest.lineData, nearest.marker);
        }
    }
});

// Add at the very end of measure.js

console.log('Measure tool elements check:');
console.log('measureBtn:', measureBtn);
console.log('eraserBtn:', eraserBtn);
console.log('toggleLabelsBtn:', toggleLabelsBtn);
console.log('measureInfo:', measureInfo);

// Force re-attach event listeners
if (measureBtn) {
    console.log('Measure button found, attaching click handler');
    measureBtn.style.pointerEvents = 'auto';
} else {
    console.error('measureBtn not found!');
}

if (eraserBtn) {
    console.log('Eraser button found');
    eraserBtn.style.pointerEvents = 'auto';
} else {
    console.error('eraserBtn not found!');
}

if (toggleLabelsBtn) {
    console.log('Toggle labels button found');
    toggleLabelsBtn.style.pointerEvents = 'auto';
} else {
    console.error('toggleLabelsBtn not found!');
}

const clearAllBtn = document.getElementById('clearAllBtn');
if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function () {
        clearMeasure();
    });
}