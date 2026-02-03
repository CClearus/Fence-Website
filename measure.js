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

// Color palette for different lines
const colorPalette = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7'
];

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

// Toggle measure mode
measureBtn.addEventListener('click', function () {
    measureActive = !measureActive;

    if (measureActive) {
        this.classList.add('active');
        map.getContainer().style.cursor = 'crosshair';

        // Disable eraser mode
        if (eraserActive) {
            eraserActive = false;
            eraserBtn.classList.remove('active');
        }
    } else {
        this.classList.remove('active');
        map.getContainer().style.cursor = '';
        finishCurrentLine();
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
document.getElementById('toggleAngles').addEventListener('click', function () {
    anglesVisible = !anglesVisible;
    this.classList.toggle('active');
    
    allLines.forEach(lineData => {
        lineData.angleLabels.forEach(label => {
            if (anglesVisible && labelsVisible) {
                if (!map.hasLayer(label)) label.addTo(map);
            } else {
                if (map.hasLayer(label)) map.removeLayer(label);
            }
        });
    });
});

// Toggle measurements visibility
document.getElementById('toggleMeasurements').addEventListener('click', function () {
    measurementsVisible = !measurementsVisible;
    this.classList.toggle('active');
    
    allLines.forEach(lineData => {
        lineData.segmentLabels.forEach(label => {
            if (measurementsVisible && labelsVisible) {
                if (!map.hasLayer(label)) label.addTo(map);
            } else {
                if (map.hasLayer(label)) map.removeLayer(label);
            }
        });
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

    // Remove temp line
    if (tempLine) {
        map.removeLayer(tempLine);
        tempLine = null;
    }

    clearTempLabels();

    updateLineInfoBox();
}

// Finish current line
function finishCurrentLine() {
    if (currentLine) {
        currentLine.active = false;
        currentLine = null;
    }

    // Remove temp line
    if (tempLine) {
        map.removeLayer(tempLine);
        tempLine = null;
    }

    clearTempLabels();
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
            active: true
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

    // Redraw all labels for this line
    redrawLineLabels(lineData);
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

    // Remove from array
    allLines.splice(index, 1);

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
    if (!labelsVisible) return;

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
                const label = drawAngleLabel(lineData.points[i], angle, lineData.color, false);
                lineData.angleLabels.push(label);
            }
        } else {
            // For open lines
            // First point - show direction angle
            const firstAngle = getDirectionAngle(lineData.points[0], lineData.points[1]);
            const firstLabel = drawAngleLabel(lineData.points[0], firstAngle, lineData.color, false);
            lineData.angleLabels.push(firstLabel);

            // Middle points - show angle between segments
            for (let i = 1; i < lineData.points.length - 1; i++) {
                const angle = calculateAngle(
                    lineData.points[i - 1],
                    lineData.points[i],
                    lineData.points[i + 1]
                );
                const label = drawAngleLabel(lineData.points[i], angle, lineData.color, false);
                lineData.angleLabels.push(label);
            }

            // Last point - show direction angle
            if (lineData.points.length >= 2) {
                const lastIdx = lineData.points.length - 1;
                const lastAngle = getDirectionAngle(lineData.points[lastIdx - 1], lineData.points[lastIdx]);
                const lastLabel = drawAngleLabel(lineData.points[lastIdx], lastAngle, lineData.color, false);
                lineData.angleLabels.push(lastLabel);
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

// Calculate point for 90-degree snap (horizontal or vertical)
function getSnapPoint(startPoint, currentPoint) {
    const lat1 = startPoint[0];
    const lng1 = startPoint[1];
    const lat2 = currentPoint[0];
    const lng2 = currentPoint[1];

    const deltaLat = Math.abs(lat2 - lat1);
    const deltaLng = Math.abs(lng2 - lng1);

    // Snap to horizontal or vertical based on which is closer
    if (deltaLat > deltaLng) {
        // Snap to vertical (same longitude)
        return [lat2, lng1];
    } else {
        // Snap to horizontal (same latitude)
        return [lat1, lng2];
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
            <div class="line-summary-dist">${formatDistance(totalMeters)} / ${totalNi.toFixed(2)} นิ้ว</div>
            <div class="line-summary-meta">${points} point, ${segments} segments</div>
        `;
        stack.appendChild(item);
    });

    // Always scroll to top when a new card is added
    stack.scrollTop = 0;
}
    
    

// Update labels for preview
function updatePreviewLabels(previewPoints, color) {
    clearTempLabels();

    if (!labelsVisible) return;

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
        // Check if clicking near an existing marker
        const nearest = findNearestMarker(e.latlng);

        if (nearest) {
            // Clicking on an existing dot
            const dotPoint = [nearest.marker.getLatLng().lat, nearest.marker.getLatLng().lng];

            if (!currentLine) {
                // No active line - continue the line that this dot belongs to
                currentLine = nearest.lineData;
                currentLine.active = true;

                // Find which end of the line this dot is
                const firstPoint = currentLine.points[0];
                const lastPoint = currentLine.points[currentLine.points.length - 1];

                const isFirstPoint = (Math.abs(dotPoint[0] - firstPoint[0]) < 0.0001 &&
                    Math.abs(dotPoint[1] - firstPoint[1]) < 0.0001);
                const isLastPoint = (Math.abs(dotPoint[0] - lastPoint[0]) < 0.0001 &&
                    Math.abs(dotPoint[1] - lastPoint[1]) < 0.0001);

                if (isFirstPoint) {
                    // Continuing from the first point - need to reverse and add to end
                    currentLine.continueFromStart = true;
                } else if (isLastPoint) {
                    // Continuing from the last point - just add to end (normal)
                    currentLine.continueFromStart = false;
                } else {
                        // Clicking on a middle point - create a new branch segment
                        finishCurrentLine();
                        
                        // Create a new branch but keep same line data reference
                        const parentLine = nearest.lineData;
                        
                        // Initialize branches array if it doesn't exist
                        if (!parentLine.branches) {
                            parentLine.branches = [];
                        }
                        
                        // Create a new branch starting from this point
                        const newBranch = {
                            startPoint: dotPoint,
                            points: [dotPoint],
                            markers: [],
                            polyline: null
                        };
                        
                        parentLine.branches.push(newBranch);
                        
                        // Set current line to continue from this branch
                        currentLine = parentLine;
                        currentLine.active = true;
                        currentLine.activeBranch = newBranch;
                        
                        // Show measure info
                        measureInfo.classList.add('active');
                        const totalDistance = calculateTotalDistance(currentLine.points);
                    }
            } else {
                // Active line exists - connecting to a dot

                // Check if connecting to its own first point (closing shape)
                const firstPoint = currentLine.points[0];
                const isOwnFirstPoint = (Math.abs(dotPoint[0] - firstPoint[0]) < 0.0001 &&
                    Math.abs(dotPoint[1] - firstPoint[1]) < 0.0001);

                if (isOwnFirstPoint && currentLine.points.length >= 3) {
                    // Close the shape
                    currentLine.points.push(dotPoint);
                    currentLine.closed = true;

                    // Remove old polyline and create polygon
                    if (currentLine.polyline) {
                        map.removeLayer(currentLine.polyline);
                    }
                    currentLine.polyline = L.polygon(currentLine.points, {
                        color: currentLine.color,
                        weight: 3,
                        opacity: 0.8,
                        fillOpacity: 0.2
                    }).addTo(map);

redrawLineLabels(currentLine);
                    const totalDistance = calculateTotalDistance(currentLine.points);
                    const totalInches = metersToInches(totalDistance);
                    currentLine.polyline.bindPopup(`Distance: ${formatDistance(totalDistance)} / ${totalInches.toFixed(2)} inches<br>Enclosed Shape`);
                    updateLineInfoBox();
                    finishCurrentLine();
                    return;
                }

                // Connecting to another dot (could be same line or different)
                if (currentLine.continueFromStart) {
                    // We're drawing from the start, so prepend the point
                    currentLine.points.unshift(dotPoint);
                } else {
                    // Normal - add to end
                    currentLine.points.push(dotPoint);
                }

                // Update polyline
                if (tempLine) {
                    map.removeLayer(tempLine);
                    tempLine = null;
                }

                clearTempLabels();

                if (currentLine.polyline) {
                    map.removeLayer(currentLine.polyline);
                }

                currentLine.polyline = L.polyline(currentLine.points, {
                    color: currentLine.color,
                    weight: 3,
                    opacity: 0.8
                }).addTo(map);

redrawLineLabels(currentLine);
                const totalDistance = calculateTotalDistance(currentLine.points);
                const totalInches = metersToInches(totalDistance);
                currentLine.polyline.bindPopup(`Distance: ${formatDistance(totalDistance)} / ${totalInches.toFixed(2)} inches`);
                updateLineInfoBox();

                // Finish this line segment
                finishCurrentLine();
            }
        } else {
            // Clicking on empty space (not on a dot)
            if (!currentLine) {
                // Start new line
                startLine();
            }

            let clickPoint = [e.latlng.lat, e.latlng.lng];
                
                // Determine reference point for snapping
                let referencePoint;
                if (currentLine.activeBranch) {
                    // Branching - use last point of active branch
                    const branch = currentLine.activeBranch;
                    referencePoint = branch.points[branch.points.length - 1];
                } else if (currentLine.continueFromStart) {
                    referencePoint = currentLine.points[0];
                } else if (currentLine.points.length > 0) {
                    referencePoint = currentLine.points[currentLine.points.length - 1];
                }
                
                // Apply 90-degree snap if Shift is pressed and we have a reference point
                if (shiftPressed && referencePoint) {
                    clickPoint = getSnapPoint(referencePoint, clickPoint);
                }
                
                // Add point - handle branching
                if (currentLine.activeBranch) {
                    // Add to the active branch
                    currentLine.activeBranch.points.push(clickPoint);
                    const newMarker = addMarkerToLine(clickPoint, currentLine);
                    currentLine.activeBranch.markers.push(newMarker);
                } else if (currentLine.continueFromStart) {
                    currentLine.points.unshift(clickPoint);
                    const newMarker = addMarkerToLine(clickPoint, currentLine);
                    currentLine.markers.unshift(newMarker);
                } else {
                    currentLine.points.push(clickPoint);
                    const newMarker = addMarkerToLine(clickPoint, currentLine);
                    
                    // Set as start marker if this is the first point
                    if (currentLine.points.length === 1) {
                        currentLine.startMarker = newMarker;
                    }
                }

            // If we have at least 2 points, draw/update the polyline
            // Draw/update polylines
                if (currentLine.activeBranch && currentLine.activeBranch.points.length >= 2) {
                    // Drawing a branch
                    if (tempLine) {
                        map.removeLayer(tempLine);
                        tempLine = null;
                    }
                    
                    clearTempLabels();
                    
                    // Remove old branch polyline if exists
                    if (currentLine.activeBranch.polyline) {
                        map.removeLayer(currentLine.activeBranch.polyline);
                    }
                    
                    // Draw the branch polyline
                    currentLine.activeBranch.polyline = L.polyline(currentLine.activeBranch.points, {
                        color: currentLine.color,
                        weight: 3,
                        opacity: 0.8
                    }).addTo(map);
                    
                    // Redraw all labels for main line and branches
                    redrawLineLabels(currentLine);
                    
                    // Calculate total distance including branches
                    let totalDistance = calculateTotalDistance(currentLine.points);
                    if (currentLine.branches) {
                        currentLine.branches.forEach(branch => {
                            totalDistance += calculateTotalDistance(branch.points);
                        });
                    }
updateLineInfoBox();
                } else if (currentLine.points.length >= 2) {
                    // Drawing main line
                    if (tempLine) {
                        map.removeLayer(tempLine);
                        tempLine = null;
                    }
                    
                    clearTempLabels();
                    
                    if (currentLine.polyline) {
                        map.removeLayer(currentLine.polyline);
                    }
                    
                    currentLine.polyline = L.polyline(currentLine.points, {
                        color: currentLine.color,
                        weight: 3,
                        opacity: 0.8
                    }).addTo(map);
                    
                    // Redraw all labels
                    redrawLineLabels(currentLine);
                    
                    // Calculate and display total distance
// Calculate and display total distance
                    const totalDistance = calculateTotalDistance(currentLine.points);
                    
                    // Update popup
                    
                    // Update popup
                    const totalInches = metersToInches(totalDistance);
                    currentLine.polyline.bindPopup(`Distance: ${formatDistance(totalDistance)} / ${totalInches.toFixed(2)} inches`);
                    
                    // Update info box
                    updateLineInfoBox();
                }
        }
    } else if (!eraserActive) {
        // Regular marker adding when not in measure or eraser mode
        const newMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
        newMarker.bindPopup(`Coordinates:<br>Lat: ${e.latlng.lat.toFixed(4)}<br>Lng: ${e.latlng.lng.toFixed(4)}`);
    }
});

// Right-click to finish current line
map.on('contextmenu', function (e) {
    if (measureActive && currentLine) {
        L.DomEvent.preventDefault(e);
        finishCurrentLine();
    }
});

// Show temp line while moving mouse
// Show temp line while moving mouse
    map.on('mousemove', function (e) {
        if (measureActive && currentLine && currentLine.active) {
            // Remove previous temp line
            if (tempLine) {
                map.removeLayer(tempLine);
            }

let previewPoint = [e.latlng.lat, e.latlng.lng];
            
            // Determine reference point for preview
            let referencePoint;
            if (currentLine.activeBranch) {
                const branch = currentLine.activeBranch;
                referencePoint = branch.points[branch.points.length - 1];
            } else if (currentLine.continueFromStart && currentLine.points.length > 0) {
                referencePoint = currentLine.points[0];
            } else if (currentLine.points.length > 0) {
                referencePoint = currentLine.points[currentLine.points.length - 1];
            }

            // Apply 90-degree snap for preview if Shift is pressed
            if (shiftPressed && referencePoint) {
                previewPoint = getSnapPoint(referencePoint, previewPoint);
            }

            // Draw temp line from correct point to cursor
            let previewPoints;
            if (currentLine.activeBranch) {
                // Draw from the active branch
                previewPoints = [...currentLine.activeBranch.points, previewPoint];
            } else if (currentLine.continueFromStart) {
                previewPoints = [previewPoint, ...currentLine.points];
            } else {
                previewPoints = [...currentLine.points, previewPoint];
            }
            
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
