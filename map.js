

// Initialize the map
const map = L.map('map').setView([13.7563, 100.5018], 13);

// Define different map layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    minZoom: 3
});

const satelliteEsri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    minZoom: 3
});

const satelliteGoogle = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '© Google',
    maxZoom: 21,
    minZoom: 3
});

const hybridGoogle = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '© Google',
    maxZoom: 21,
    minZoom: 3
});

const hybridEsriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri'
});

const labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
    attribution: '© CartoDB'
});

// Add default layer
osmLayer.addTo(map);

const hybridEsri = L.layerGroup([hybridEsriSat, labelsLayer]);

// Store all layers
const layers = {
    'road': osmLayer,
    'satellite-google': satelliteGoogle,
    'satellite-esri': satelliteEsri,
    'hybrid-google': hybridGoogle,
    'hybrid-esri': hybridEsri
};

let currentLayer = 'road';
let searchMarker = null;

// Add scale control
L.control.scale({
    imperial: true,
    metric: true
}).addTo(map);

// ============================================
// LAYER CONTROL FUNCTIONALITY
// ============================================

const layerToggle = document.getElementById('layerToggle');
const layerDropdown = document.getElementById('layerDropdown');
const layerOptions = document.querySelectorAll('.layer-option');

layerToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    layerDropdown.classList.toggle('active');
});

document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-layer-control')) {
        layerDropdown.classList.remove('active');
    }
    if (!e.target.closest('.search-container')) {
        searchResults.classList.remove('active');
    }
});

layerOptions.forEach(option => {
    option.addEventListener('click', function() {
        const layerType = this.getAttribute('data-layer');
        
        map.removeLayer(layers[currentLayer]);
        layers[layerType].addTo(map);
        currentLayer = layerType;
        
        layerOptions.forEach(opt => opt.classList.remove('active'));
        this.classList.add('active');
        layerDropdown.classList.remove('active');
    });
});

// ============================================
// SEARCH FUNCTIONALITY
// ============================================

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');

let searchTimeout;

// Search as user types
searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const query = this.value.trim();
    
    if (query.length < 3) {
        searchResults.classList.remove('active');
        return;
    }
    
    searchTimeout = setTimeout(() => searchPlaces(query), 500);
});

// Search on button click
searchBtn.addEventListener('click', function() {
    const query = searchInput.value.trim();
    if (query.length >= 3) {
        searchPlaces(query);
    }
});

// Search on Enter key
searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const query = this.value.trim();
        if (query.length >= 3) {
            searchPlaces(query);
        }
    }
});

// Search function using Nominatim OpenStreetMap
async function searchPlaces(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
        );
        const results = await response.json();
        
        displaySearchResults(results);
    } catch (error) {
        console.error('Search error:', error);
        searchResults.innerHTML = '<div class="search-result-item"><div class="result-name">Search failed. Please try again.</div></div>';
        searchResults.classList.add('active');
    }
}

// Display search results
function displaySearchResults(results) {
    searchResults.innerHTML = '';
    
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item"><div class="result-name">No results found</div></div>';
        searchResults.classList.add('active');
        return;
    }
    
    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
            <div class="result-name">${result.display_name.split(',')[0]}</div>
            <div class="result-address">${result.display_name}</div>
        `;
        
        item.addEventListener('click', () => {
            flyToLocation(parseFloat(result.lat), parseFloat(result.lon), result.display_name);
            searchResults.classList.remove('active');
            searchInput.value = result.display_name.split(',')[0];
        });
        
        searchResults.appendChild(item);
    });
    
    searchResults.classList.add('active');
}

// Fly to selected location
function flyToLocation(lat, lng, name) {
    // Remove previous search marker
    if (searchMarker) {
        map.removeLayer(searchMarker);
    }
    
    // Fly to location with smooth animation
    map.flyTo([lat, lng], 17, {
        duration: 1.5
    });
    
    // Add marker at location
    searchMarker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    }).addTo(map);
    
    searchMarker.bindPopup(`<strong>${name.split(',')[0]}</strong><br>${name}`).openPopup();
}