/**
 * Smart Commute - Map Utility Module (Leaflet + OpenStreetMap + OSRM + Nominatim)
 * Provides comprehensive map rendering, geocoding, autocomplete, and routing.
 */

// Preset Kolhapur stations from specification (used as instant local cache & fallback)
const KOLHAPUR_STATIONS = [
    { name: "KIT College of Engineering", lat: 16.6735, lng: 74.2479, type: "college" },
    { name: "DY Patil College", lat: 16.6950, lng: 74.2440, type: "college" },
    { name: "Shivaji University", lat: 16.6823, lng: 74.2489, type: "college" },
    { name: "Rajaram College", lat: 16.6987, lng: 74.2315, type: "college" },
    { name: "Vivekanand College", lat: 16.7041, lng: 74.2264, type: "college" },
    { name: "Bharati Vidyapeeth", lat: 16.6654, lng: 74.2569, type: "college" },
    { name: "Government Polytechnic", lat: 16.6920, lng: 74.2350, type: "college" },
    { name: "Willingdon College", lat: 16.6990, lng: 74.2290, type: "college" },
    { name: "Chh. Shahu Central Library", lat: 16.6965, lng: 74.2310, type: "landmark" },
    { name: "Hockey Stadium", lat: 16.6927, lng: 74.2274, type: "landmark" },
    { name: "RK Nagar", lat: 16.7069, lng: 74.2193, type: "area" },
    { name: "Rankala Lake", lat: 16.6876, lng: 74.2195, type: "landmark" },
    { name: "Mahalaxmi Temple", lat: 16.6992, lng: 74.2268, type: "landmark" },
    { name: "CBS (Central Bus Stand)", lat: 16.6982, lng: 74.2330, type: "transport_hub" },
    { name: "Kolhapur Railway Station", lat: 16.6889, lng: 74.2355, type: "transport_hub" },
    { name: "Shahupuri", lat: 16.6960, lng: 74.2403, type: "area" },
    { name: "Rajarampuri", lat: 16.7025, lng: 74.2329, type: "area" },
    { name: "Tarabai Park", lat: 16.6899, lng: 74.2297, type: "area" },
    { name: "Dabholkar Corner", lat: 16.6972, lng: 74.2348, type: "landmark" },
    { name: "Bindu Chowk", lat: 16.6995, lng: 74.2288, type: "landmark" },
    { name: "Nagala Park", lat: 16.7017, lng: 74.2186, type: "area" },
    { name: "Laxmipuri", lat: 16.6940, lng: 74.2367, type: "area" },
    { name: "Sykes Extension", lat: 16.7052, lng: 74.2313, type: "area" },
    { name: "Kalamba", lat: 16.6759, lng: 74.2241, type: "area" },
    { name: "Morewadi", lat: 16.6612, lng: 74.2528, type: "area" },
    { name: "Uchgaon", lat: 16.6558, lng: 74.2654, type: "area" },
    { name: "Shiroli MIDC", lat: 16.6884, lng: 74.3167, type: "area" },
    { name: "Kadamwadi", lat: 16.7102, lng: 74.2245, type: "area" },
    { name: "New Palace", lat: 16.6937, lng: 74.2253, type: "landmark" },
    { name: "Kolhapur Airport", lat: 16.6640, lng: 74.2894, type: "transport_hub" }
];

// Default Kolhapur center coordinates
const DEFAULT_CENTER = [16.6982, 74.2330];
const DEFAULT_ZOOM = 13;

/**
 * Initialize Leaflet map with OpenStreetMap tiles
 * @param {string} containerId - Element ID of map container
 * @param {Array<number>} [center] - [lat, lng]
 * @param {number} [zoom] - Initial zoom level
 * @returns {L.Map} Leaflet map instance
 */
function initMap(containerId, center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM) {
    const el = document.getElementById(containerId);
    if (!el) {
        console.error(`Map container #${containerId} not found`);
        return null;
    }

    // Clean up if already initialized
    if (el._leaflet_id && el._leaflet_map) {
        el._leaflet_map.remove();
    }

    const map = L.map(containerId, {
        center: center,
        zoom: zoom,
        zoomControl: true,
        attributionControl: true
    });

    // OpenStreetMap standard tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Layer groups for routes and custom markers
    map._routesLayerGroup = L.layerGroup().addTo(map);
    map._markersLayerGroup = L.layerGroup().addTo(map);

    el._leaflet_map = map;
    return map;
}

/**
 * Create a custom SVG marker pin
 * @param {string} color - Hex color or CSS color
 * @param {string} iconClass - FontAwesome icon class
 * @returns {L.DivIcon}
 */
function createPinIcon(color = '#1e40af', iconClass = 'fa-map-pin') {
    return L.divIcon({
        className: 'custom-map-pin-wrapper',
        html: `
            <div class="custom-map-pin" style="background-color: ${color};">
                <i class="fas ${iconClass}"></i>
            </div>
            <div class="custom-map-pin-pulse" style="border-color: ${color};"></div>
        `,
        iconSize: [36, 42],
        iconAnchor: [18, 42],
        popupAnchor: [0, -38]
    });
}

/**
 * Add a styled marker to the map
 * @param {L.Map} map - Leaflet map
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} label - Popup HTML/text
 * @param {string} color - Marker color ('green', 'red', 'blue', hex)
 * @param {string} [icon] - Font Awesome icon class
 * @returns {L.Marker} Leaflet Marker
 */
function addMarker(map, lat, lng, label = '', color = '#1e40af', icon = 'fa-location-dot') {
    if (!map) return null;

    let pinColor = color;
    let pinIcon = icon;

    if (color === 'green' || color === 'origin') {
        pinColor = '#10b981';
        pinIcon = 'fa-play';
    } else if (color === 'red' || color === 'dest' || color === 'destination') {
        pinColor = '#ef4444';
        pinIcon = 'fa-flag-checkered';
    } else if (color === 'blue' || color === 'primary') {
        pinColor = '#1e40af';
        pinIcon = 'fa-location-dot';
    } else if (color === 'accent' || color === 'cyan') {
        pinColor = '#06b6d4';
        pinIcon = 'fa-car';
    }

    const pin = createPinIcon(pinColor, pinIcon);
    const marker = L.marker([lat, lng], { icon: pin });

    if (label) {
        marker.bindPopup(`
            <div class="map-popup-card">
                ${label}
            </div>
        `, { maxWidth: 280, className: 'custom-leaflet-popup' });
    }

    if (map._markersLayerGroup) {
        map._markersLayerGroup.addLayer(marker);
    } else {
        marker.addTo(map);
    }

    return marker;
}

/**
 * Clear all routes and route markers from map
 * @param {L.Map} map
 */
function clearRoute(map) {
    if (!map) return;
    if (map._routesLayerGroup) {
        map._routesLayerGroup.clearLayers();
    }
    if (map._markersLayerGroup) {
        map._markersLayerGroup.clearLayers();
    }
}

/**
 * Fetch route from OSRM and draw route polyline
 * @param {L.Map} map - Leaflet map instance
 * @param {Array<number>|Object} startLatLng - [lat, lng] or {lat, lng}
 * @param {Array<number>|Object} endLatLng - [lat, lng] or {lat, lng}
 * @param {Object} [options] - Optional configurations
 * @returns {Promise<{polyline: L.Polyline, distanceKm: number, durationMin: number, coordinates: Array}>}
 */
async function drawRoute(map, startLatLng, endLatLng, options = {}) {
    if (!map) return null;

    const startLat = Array.isArray(startLatLng) ? startLatLng[0] : startLatLng.lat;
    const startLng = Array.isArray(startLatLng) ? startLatLng[1] : (startLatLng.lng || startLatLng.lon);
    const endLat = Array.isArray(endLatLng) ? endLatLng[0] : endLatLng.lat;
    const endLng = Array.isArray(endLatLng) ? endLatLng[1] : (endLatLng.lng || endLatLng.lon);

    if (options.clear !== false) {
        clearRoute(map);
    }

    // Add Start and End markers
    if (options.addMarkers !== false) {
        addMarker(map, startLat, startLng, options.startLabel || '<strong>Pickup / Origin</strong>', 'green');
        addMarker(map, endLat, endLng, options.endLabel || '<strong>Dropoff / Destination</strong>', 'red');
    }

    let coords = [];
    let distanceKm = 0;
    let durationMin = 0;

    const routeColor = options.color || '#1e40af';
    const routeWeight = options.weight || 5;
    const routeOpacity = options.opacity || 0.85;

    try {
        // OSRM expects coordinates in order: longitude,latitude;longitude,latitude
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
        
        // Timeout after 4 seconds to gracefully fall back
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(osrmUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data.routes && data.routes.length > 0) {
                const primaryRoute = data.routes[0];
                distanceKm = Number((primaryRoute.distance / 1000).toFixed(1));
                durationMin = Math.round(primaryRoute.duration / 60);

                // GeoJSON coordinates are [lng, lat], Leaflet polyline requires [lat, lng]
                coords = primaryRoute.geometry.coordinates.map(pt => [pt[1], pt[0]]);
            }
        }
    } catch (err) {
        console.warn('OSRM route fetch failed or timed out. Falling back to straight route geometry.', err.message);
    }

    // Fallback: If OSRM route was not retrieved, draw direct polyline and calculate Haversine distance
    if (!coords || coords.length === 0) {
        coords = [
            [startLat, startLng],
            [endLat, endLng]
        ];
        distanceKm = getDistanceKm(startLat, startLng, endLat, endLng);
        // Estimate 30 km/h average city speed
        durationMin = Math.max(5, Math.round((distanceKm / 30) * 60));
    }

    // Draw route polyline with background glow outline for great contrast
    const outlinePolyline = L.polyline(coords, {
        color: '#ffffff',
        weight: routeWeight + 3,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    });

    const routePolyline = L.polyline(coords, {
        color: routeColor,
        weight: routeWeight,
        opacity: routeOpacity,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: options.dashArray || null
    });

    if (map._routesLayerGroup) {
        map._routesLayerGroup.addLayer(outlinePolyline);
        map._routesLayerGroup.addLayer(routePolyline);
    } else {
        outlinePolyline.addTo(map);
        routePolyline.addTo(map);
    }

    if (options.fitBounds !== false) {
        map.fitBounds(routePolyline.getBounds(), {
            padding: options.padding || [40, 40],
            maxZoom: 16
        });
    }

    return {
        polyline: routePolyline,
        distanceKm: distanceKm,
        durationMin: durationMin,
        coordinates: coords
    };
}

/**
 * Geocode search using Nominatim API for Indian locations with Kolhapur bias
 * @param {string} query
 * @returns {Promise<Array<{name: string, lat: number, lng: number, type: string, display_name: string}>>}
 */
async function geocodeSearch(query) {
    if (!query || query.trim().length < 2) return [];

    const cleanQuery = query.trim();
    // Bias search to Kolhapur region viewbox: 74.10,16.60 to 74.35,16.80
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=6&countrycodes=in&viewbox=74.10,16.80,74.35,16.60&bounded=0`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept-Language': 'en' }
        });
        clearTimeout(timer);

        if (!res.ok) return [];

        const data = await res.json();
        return data.map(item => ({
            name: item.display_name.split(',')[0].trim(),
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            type: item.type || 'place'
        }));
    } catch (err) {
        console.warn('Nominatim geocode failed:', err.message);
        return [];
    }
}

/**
 * Setup autocomplete dropdown on location input elements.
 * Combines local station database (/api/stations/search) and Nominatim geocoding.
 * Displays stations first, then external places.
 * 
 * @param {HTMLInputElement} inputElement
 * @param {Function} onSelect - Callback called with {name, lat, lng, type}
 */
function setupAutocomplete(inputElement, onSelect) {
    if (!inputElement) return;

    // Ensure parent wrapper has relative positioning
    const parent = inputElement.parentElement;
    if (parent && !parent.classList.contains('autocomplete-wrapper')) {
        parent.classList.add('autocomplete-wrapper');
    }

    // Create or locate dropdown element
    let dropdown = parent ? parent.querySelector('.autocomplete-dropdown') : null;
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown';
        dropdown.style.display = 'none';
        if (parent) {
            parent.appendChild(dropdown);
        } else {
            document.body.appendChild(dropdown);
        }
    }

    let debounceTimer = null;
    let selectedIndex = -1;
    let currentResults = [];

    // Helper to get type icon
    function getStationIcon(type) {
        switch (type) {
            case 'college':
            case 'school':
                return 'fa-graduation-cap text-primary';
            case 'transport_hub':
                return 'fa-bus-simple text-warning';
            case 'landmark':
                return 'fa-landmark text-success';
            case 'area':
                return 'fa-city text-info';
            default:
                return 'fa-location-dot text-muted';
        }
    }

    // Helper to format category title
    function formatStationType(type) {
        switch (type) {
            case 'college': return 'College / Campus';
            case 'transport_hub': return 'Transit Hub';
            case 'landmark': return 'Landmark';
            case 'area': return 'Neighborhood';
            default: return 'Location';
        }
    }

    // Fetch matching stations from backend or fallback array
    async function searchStations(q) {
        const queryLower = q.toLowerCase();
        try {
            const res = await fetch(`/api/stations/search?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const json = await res.json();
                if (json.stations && Array.isArray(json.stations) && json.stations.length > 0) {
                    return json.stations;
                }
            }
        } catch (e) {
            // Backend offline or error; fall through to local stations array
        }

        // Match from local cache
        return KOLHAPUR_STATIONS.filter(s => 
            s.name.toLowerCase().includes(queryLower) || 
            (s.type && s.type.toLowerCase().includes(queryLower))
        );
    }

    // Render dropdown items
    function renderDropdown(stations, places) {
        currentResults = [];
        selectedIndex = -1;

        if (stations.length === 0 && places.length === 0) {
            dropdown.innerHTML = `
                <div class="autocomplete-empty">
                    <i class="fas fa-search-location"></i> No matching locations found
                </div>
            `;
            dropdown.style.display = 'block';
            return;
        }

        let html = '';

        if (stations.length > 0) {
            html += `<div class="autocomplete-header"><i class="fas fa-star text-warning"></i> Commute Hubs & Stations</div>`;
            stations.forEach(item => {
                const idx = currentResults.length;
                currentResults.push({
                    name: item.name,
                    lat: Number(item.lat),
                    lng: Number(item.lng),
                    type: item.type || 'station'
                });
                html += `
                    <div class="autocomplete-item" data-index="${idx}">
                        <div class="autocomplete-item-icon">
                            <i class="fas ${getStationIcon(item.type)}"></i>
                        </div>
                        <div class="autocomplete-item-text">
                            <div class="autocomplete-item-name">${item.name}</div>
                            <div class="autocomplete-item-sub">${formatStationType(item.type)} &bull; Kolhapur</div>
                        </div>
                        <span class="badge badge-sm badge-info">Popular</span>
                    </div>
                `;
            });
        }

        if (places.length > 0) {
            html += `<div class="autocomplete-header"><i class="fas fa-map-pin"></i> Other Locations</div>`;
            places.forEach(item => {
                // Avoid duplicating items already matched in stations
                const isDuplicate = currentResults.some(r => 
                    r.name.toLowerCase() === item.name.toLowerCase() ||
                    getDistanceKm(r.lat, r.lng, item.lat, item.lng) < 0.2
                );
                if (!isDuplicate) {
                    const idx = currentResults.length;
                    currentResults.push({
                        name: item.name,
                        lat: Number(item.lat),
                        lng: Number(item.lng),
                        type: 'place'
                    });
                    html += `
                        <div class="autocomplete-item" data-index="${idx}">
                            <div class="autocomplete-item-icon">
                                <i class="fas fa-location-dot text-muted"></i>
                            </div>
                            <div class="autocomplete-item-text">
                                <div class="autocomplete-item-name">${item.name}</div>
                                <div class="autocomplete-item-sub">${item.display_name.slice(0, 55)}...</div>
                            </div>
                        </div>
                    `;
                }
            });
        }

        dropdown.innerHTML = html;
        dropdown.style.display = 'block';

        // Add click events to items
        dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(el.getAttribute('data-index'), 10);
                selectItem(idx);
            });
        });
    }

    function selectItem(idx) {
        if (idx >= 0 && idx < currentResults.length) {
            const item = currentResults[idx];
            inputElement.value = item.name;
            dropdown.style.display = 'none';
            if (typeof onSelect === 'function') {
                onSelect(item);
            }
        }
    }

    // Input handler with debouncing
    inputElement.addEventListener('input', () => {
        const query = inputElement.value.trim();
        clearTimeout(debounceTimer);

        if (query.length < 2) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';
            currentResults = [];
            return;
        }

        dropdown.innerHTML = `
            <div class="autocomplete-loading">
                <i class="fas fa-spinner fa-spin"></i> Searching locations...
            </div>
        `;
        dropdown.style.display = 'block';

        debounceTimer = setTimeout(async () => {
            try {
                // Concurrently query stations and Nominatim
                const [stations, places] = await Promise.all([
                    searchStations(query),
                    query.length >= 3 ? geocodeSearch(query) : Promise.resolve([])
                ]);
                renderDropdown(stations.slice(0, 5), places.slice(0, 4));
            } catch (err) {
                console.error('Autocomplete error:', err);
                dropdown.style.display = 'none';
            }
        }, 280);
    });

    // Keyboard navigation
    inputElement.addEventListener('keydown', (e) => {
        if (dropdown.style.display === 'none' || currentResults.length === 0) return;

        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'Enter') {
            if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
                e.preventDefault();
                selectItem(selectedIndex);
            }
        } else if (e.key === 'Escape') {
            dropdown.style.display = 'none';
        }
    });

    function highlightItem(items, index) {
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!parent.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

/**
 * Fit map to show all markers or coordinates
 * @param {L.Map} map
 * @param {Array<L.Marker|Array<number>>} markersOrCoords
 */
function fitBounds(map, markersOrCoords) {
    if (!map || !markersOrCoords || markersOrCoords.length === 0) return;

    const latLngs = markersOrCoords.map(item => {
        if (item.getLatLng) {
            return item.getLatLng();
        } else if (Array.isArray(item)) {
            return L.latLng(item[0], item[1]);
        } else if (item.lat && item.lng) {
            return L.latLng(item.lat, item.lng);
        }
        return null;
    }).filter(Boolean);

    if (latLngs.length > 0) {
        const bounds = L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
}

/**
 * Calculate distance in km between two lat/lng points using Haversine Formula
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in kilometers rounded to 1 decimal place
 */
function getDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
}

// Attach utilities to window for global access
window.initMap = initMap;
window.addMarker = addMarker;
window.drawRoute = drawRoute;
window.clearRoute = clearRoute;
window.geocodeSearch = geocodeSearch;
window.setupAutocomplete = setupAutocomplete;
window.fitBounds = fitBounds;
window.getDistanceKm = getDistanceKm;
window.KOLHAPUR_STATIONS = KOLHAPUR_STATIONS;
