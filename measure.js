

// Measure tool variables
let measureActive = false;
let measurePoints = [];
let measureLine = null;
let measureMarkers = [];
let tempLine = null;

// Get measure tool elements
const measureBtn = document.getElementById('measureBtn');
const measureInfo = document.getElementById('measureInfo');
const measureDistance = document.getElementById('measureDistance');
const measureClear = document.getElementById('measureClear');

// ============================================
// MEASURE TOOL EVENT LISTENERS
// ============================================

// Toggle measure mode
measureBtn.addEventListener('click', function() {
    measureActive = !measureActive;
    
    if (measureActive) {
        this.classList.add('active');
        map.getContainer().style.cursor = 'crosshair';
        measureInfo.classList.add('active');
    } else {
        this.classList.remove('active');
        map.getContainer().style.cursor = '';
        clearMeasure();
    }
});

// Clear measurements
measureClear.addEventListener('click', function() {
    clearMeasure();
});

// ============================================
// MEASUREMENT FUNCTIONS
// ============================================

// Clear all measurements
function clearMeasure() {
    measurePoints = [];
    
    // Remove line
    if (measureLine) {
        map.removeLayer(measureLine);
        measureLine = null;
    }
    
    // Remove temp line
    if (tempLine) {
        map.removeLayer(tempLine);
        tempLine = null;
    }
    
    // Remove markers
    measureMarkers.forEach(marker => map.removeLayer(marker));
    measureMarkers = [];
    
    measureDistance.textContent = '0 m';
}

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Format distance for display
function formatDistance(meters) {
    if (meters < 1000) {
        return meters.toFixed(2) + ' m';
    } else {
        return (meters / 1000).toFixed(2) + ' km';
    }
}

// ============================================
// MAP INTERACTION FOR MEASUREMENT
// ============================================

// Map click handler
map.on('click', function(e) {
    if (measureActive) {
        const point = [e.latlng.lat, e.latlng.lng];
        measurePoints.push(point);
        
        // Add marker
        const marker = L.circleMarker([e.latlng.lat, e.latlng.lng], {
            radius: 5,
            fillColor: '#3b82f6',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map);
        measureMarkers.push(marker);
        
        // Draw line if we have 2 points
        if (measurePoints.length === 2) {
            // Remove temp line
            if (tempLine) {
                map.removeLayer(tempLine);
                tempLine = null;
            }
            
            // Draw permanent line
            measureLine = L.polyline(measurePoints, {
                color: '#3b82f6',
                weight: 3,
                opacity: 0.8
            }).addTo(map);
            
            // Calculate distance
            const distance = calculateDistance(
                measurePoints[0][0], measurePoints[0][1],
                measurePoints[1][0], measurePoints[1][1]
            );
            
            measureDistance.textContent = formatDistance(distance);
            
            // Add popup to line
            measureLine.bindPopup(`Distance: ${formatDistance(distance)}`).openPopup();
            
            // Reset for next measurement (keep in measure mode)
            measurePoints = [];
            measureMarkers.forEach(m => map.removeLayer(m));
            measureMarkers = [];
        }
    } else {
        // Regular marker adding when not in measure mode
        const newMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
        newMarker.bindPopup(`Coordinates:<br>Lat: ${e.latlng.lat.toFixed(4)}<br>Lng: ${e.latlng.lng.toFixed(4)}`);
    }
});

// Show temp line while moving mouse (only when 1 point placed)
map.on('mousemove', function(e) {
    if (measureActive && measurePoints.length === 1) {
        // Remove previous temp line
        if (tempLine) {
            map.removeLayer(tempLine);
        }
        
        // Draw temp line from first point to cursor
        tempLine = L.polyline([measurePoints[0], [e.latlng.lat, e.latlng.lng]], {
            color: '#3b82f6',
            weight: 2,
            opacity: 0.5,
            dashArray: '5, 10'
        }).addTo(map);
    }
});