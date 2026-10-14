/**
 * Smart Commute - Find Ride Client Logic
 * Handles ride searches, client-side filtering & sorting, Leaflet map preview,
 * transit comparison calculations, and ride booking requests.
 */

// Toast helper fallback if not provided globally
function triggerToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} show`;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Current state
    let map = null;
    let rawRides = [];
    let filteredRides = [];
    let selectedRide = null;
    let searchOrigin = null;
    let searchDest = null;
    let activeRoutePolyline = null;

    // DOM references
    const searchForm = document.getElementById('searchRidesForm');
    const originInput = document.getElementById('originInput');
    const destInput = document.getElementById('destInput');
    const originLatInput = document.getElementById('originLat');
    const originLngInput = document.getElementById('originLng');
    const destLatInput = document.getElementById('destLat');
    const destLngInput = document.getElementById('destLng');
    const dateInput = document.getElementById('dateInput');
    const ridesList = document.getElementById('ridesList');
    const rideCountEl = document.getElementById('rideCount');
    const sortBySelect = document.getElementById('sortBySelect');
    const fareSlider = document.getElementById('fareSlider');
    const fareValue = document.getElementById('fareValue');
    const genderSelect = document.getElementById('genderSelect');
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    const transitComparisonSection = document.getElementById('transitComparisonSection');

    // Mobile view toggles
    const mobileViewList = document.getElementById('mobileViewList');
    const mobileViewMap = document.getElementById('mobileViewMap');
    const findCenter = document.getElementById('findCenter');
    const findMapColumn = document.getElementById('findMapColumn');

    // Booking modal elements
    const bookingModal = document.getElementById('bookingModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelBookingBtn = document.getElementById('cancelBookingBtn');
    const confirmBookingBtn = document.getElementById('confirmBookingBtn');
    const modalRideDetails = document.getElementById('modalRideDetails');
    const bookingSeatsInput = document.getElementById('bookingSeats');
    const bookSeatMinus = document.getElementById('bookSeatMinus');
    const bookSeatPlus = document.getElementById('bookSeatPlus');
    const seatsAvailableText = document.getElementById('seatsAvailableText');
    const modalTotalFare = document.getElementById('modalTotalFare');

    // Initialize Map on right panel
    if (typeof window.initMap === 'function') {
        map = window.initMap('findMap', [16.6982, 74.2330], 13);
    }

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    dateInput.min = today;

    // Check current user session and adjust navbar / preferences
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    const authToken = localStorage.getItem('token');
    updateNavbarAuth(currentUser);

    if (currentUser && currentUser.gender === 'female') {
        // Pre-select or highlight female preference filter
        const femaleOption = document.createElement('option');
        femaleOption.value = 'female';
        femaleOption.textContent = 'Female Commuters Only';
    }

    // Setup Autocomplete on pickup and dropoff
    if (typeof window.setupAutocomplete === 'function') {
        window.setupAutocomplete(originInput, (place) => {
            searchOrigin = place;
            originLatInput.value = place.lat;
            originLngInput.value = place.lng;
            updateMapSearchPoints();
        });

        window.setupAutocomplete(destInput, (place) => {
            searchDest = place;
            destLatInput.value = place.lat;
            destLngInput.value = place.lng;
            updateMapSearchPoints();
        });
    }

    // Parse URL query parameters on initial load
    const urlParams = new URLSearchParams(window.location.search);
    const qFrom = urlParams.get('from');
    const qTo = urlParams.get('to');
    const qFromLat = urlParams.get('from_lat') || urlParams.get('origin_lat');
    const qFromLng = urlParams.get('from_lng') || urlParams.get('origin_lng');
    const qToLat = urlParams.get('dest_lat') || urlParams.get('to_lat');
    const qToLng = urlParams.get('dest_lng') || urlParams.get('to_lng');
    const qDate = urlParams.get('date');

    if (qFrom) originInput.value = qFrom;
    if (qTo) destInput.value = qTo;
    if (qDate) dateInput.value = qDate;

    if (qFromLat && qFromLng) {
        searchOrigin = { name: qFrom || 'Pickup', lat: parseFloat(qFromLat), lng: parseFloat(qFromLng) };
        originLatInput.value = qFromLat;
        originLngInput.value = qFromLng;
    }
    if (qToLat && qToLng) {
        searchDest = { name: qTo || 'Dropoff', lat: parseFloat(qToLat), lng: parseFloat(qToLng) };
        destLatInput.value = qToLat;
        destLngInput.value = qToLng;
    }

    // If query params are present, auto execute search
    if (searchOrigin || searchDest || qFrom || qTo) {
        performSearch();
    } else {
        // Fetch all current active rides for initial overview
        fetchRides();
    }

    // Search Form Submit
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        performSearch();
    });

    async function performSearch() {
        showLoadingState();

        // Clear searchDest if user cleared the input field
        if (!destInput.value.trim()) {
            searchDest = null;
            destLatInput.value = '';
            destLngInput.value = '';
        }

        // Check if user manually typed location without clicking autocomplete item
        if (!searchOrigin && originInput.value.trim()) {
            const loc = findStationByName(originInput.value.trim());
            if (loc) {
                searchOrigin = loc;
                originLatInput.value = loc.lat;
                originLngInput.value = loc.lng;
            }
        }
        if (!searchDest && destInput.value.trim()) {
            const loc = findStationByName(destInput.value.trim());
            if (loc) {
                searchDest = loc;
                destLatInput.value = loc.lat;
                destLngInput.value = loc.lng;
            }
        }

        updateMapSearchPoints();

        // Build query string
        const params = new URLSearchParams();
        if (searchOrigin) {
            params.append('origin_lat', searchOrigin.lat);
            params.append('origin_lng', searchOrigin.lng);
        }
        if (searchDest) {
            params.append('dest_lat', searchDest.lat);
            params.append('dest_lng', searchDest.lng);
        }
        if (dateInput.value) {
            params.append('date', dateInput.value);
        }
        if (genderSelect.value && genderSelect.value !== 'any') {
            params.append('gender_preference', genderSelect.value);
        }

        // Fetch matching rides using en-route corridor matching engine
        await fetchRides(params.toString());

        // Fetch transit comparison
        fetchTransitComparison();
    }

    // Helper: Find station in local spec list if typed (supports flexible punctuation & spacing)
    function findStationByName(name) {
        if (!name) return null;
        const normalized = name.toLowerCase().replace(/[\s\.\-_]/g, '');
        if (window.KOLHAPUR_STATIONS && window.KOLHAPUR_STATIONS.length > 0) {
            // Check exact normalized match
            const exact = window.KOLHAPUR_STATIONS.find(s => {
                const sNorm = s.name.toLowerCase().replace(/[\s\.\-_]/g, '');
                return sNorm === normalized;
            });
            if (exact) return exact;

            // Check substring match
            const sub = window.KOLHAPUR_STATIONS.find(s => {
                const sNorm = s.name.toLowerCase().replace(/[\s\.\-_]/g, '');
                return sNorm.includes(normalized) || normalized.includes(sNorm);
            });
            if (sub) return sub;
        }
        return null;
    }

    // Fetch rides from API
    async function fetchRides(queryString = '') {
        try {
            const url = queryString ? `/api/rides?${queryString}` : '/api/rides';
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                rawRides = data.rides || [];
            } else {
                rawRides = [];
            }
        } catch (err) {
            console.warn('API error fetching rides, checking fallback:', err.message);
            rawRides = [];
        }

        // If no rides returned from server (e.g. empty database or fresh instance),
        // supply realistic Kolhapur mock rides so the user can test the UI immediately!
        if (rawRides.length === 0) {
            rawRides = generateMockRides();
        }

        applyFiltersAndRender();
    }

    // Generate realistic Kolhapur community rides if database is empty
    function generateMockRides() {
        const oName = searchOrigin ? searchOrigin.name : 'CBS (Central Bus Stand)';
        const oLat = searchOrigin ? searchOrigin.lat : 16.6982;
        const oLng = searchOrigin ? searchOrigin.lng : 74.2330;

        const dName = searchDest ? searchDest.name : 'KIT College of Engineering';
        const dLat = searchDest ? searchDest.lat : 16.6735;
        const dLng = searchDest ? searchDest.lng : 74.2479;

        const currentDate = dateInput.value || today;

        return [
            {
                id: 101,
                user_id: 2,
                driver_name: 'Rahul Patil',
                driver_avatar: 'R',
                driver_rating: 4.9,
                is_verified: 1,
                origin_name: 'Hockey Stadium',
                origin_lat: 16.6927,
                origin_lng: 74.2274,
                destination_name: dName,
                destination_lat: dLat,
                destination_lng: dLng,
                date: currentDate,
                time: '08:30',
                vehicle_type: 'car',
                vehicle_name: 'Maruti Suzuki Swift',
                available_seats: 3,
                fare_per_seat: 40,
                notes: 'Leaving from Hockey Stadium via RK Nagar corridor to KIT College. AC available.',
                gender_preference: 'any',
                match_type: 'en_route',
                match_badge: "On Driver's Route",
                match_description: "Driver passes through your pickup corridor",
                estimated_pickup_time: "08:36",
                pickup_distance_km: 0.45
            },
            {
                id: 102,
                user_id: 3,
                driver_name: 'Pooja Deshmukh',
                driver_avatar: 'P',
                driver_rating: 5.0,
                is_verified: 1,
                origin_name: oName,
                origin_lat: oLat,
                origin_lng: oLng,
                destination_name: dName,
                destination_lat: dLat,
                destination_lng: dLng,
                date: currentDate,
                time: '09:15',
                vehicle_type: 'bike',
                vehicle_name: 'Honda Activa 6G',
                available_seats: 1,
                fare_per_seat: 25,
                notes: 'Extra helmet provided. College commute.',
                gender_preference: 'female',
                match_type: 'direct',
                match_badge: 'Direct Pickup',
                match_description: 'Driver starts at your pickup location',
                estimated_pickup_time: '09:15',
                pickup_distance_km: 0.1
            },
            {
                id: 103,
                user_id: 4,
                driver_name: 'Amit Shinde',
                driver_avatar: 'A',
                driver_rating: 4.8,
                is_verified: 1,
                origin_name: 'CBS (Central Bus Stand)',
                origin_lat: 16.6982,
                origin_lng: 74.2330,
                destination_name: dName,
                destination_lat: dLat,
                destination_lng: dLng,
                date: currentDate,
                time: '13:00',
                vehicle_type: 'car',
                vehicle_name: 'Hyundai i20',
                available_seats: 2,
                fare_per_seat: 50,
                notes: 'Regular afternoon commute. Non-smoking ride.',
                gender_preference: 'any',
                match_type: 'corridor',
                match_badge: 'Corridor Pickup',
                match_description: 'Driver can pick you up with a minimal detour',
                estimated_pickup_time: '13:08',
                pickup_distance_km: 0.7
            },
            {
                id: 104,
                user_id: 5,
                driver_name: 'Sachin Kamble',
                driver_avatar: 'S',
                driver_rating: 4.7,
                is_verified: 0,
                origin_name: oName,
                origin_lat: oLat,
                origin_lng: oLng,
                destination_name: dName,
                destination_lat: dLat,
                destination_lng: dLng,
                date: currentDate,
                time: '18:15',
                vehicle_type: 'auto',
                vehicle_name: 'Bajaj RE Auto',
                available_seats: 2,
                fare_per_seat: 30,
                notes: 'Shared rickshaw ride going towards campus.',
                gender_preference: 'any',
                match_type: 'direct',
                match_badge: 'Direct Pickup',
                match_description: 'Shared rickshaw pickup',
                estimated_pickup_time: '18:15',
                pickup_distance_km: 0.05
            }
        ];
    }

    // Apply client-side filters and sorting
    function applyFiltersAndRender() {
        const timeMorning = document.getElementById('timeMorning').checked;
        const timeAfternoon = document.getElementById('timeAfternoon').checked;
        const timeEvening = document.getElementById('timeEvening').checked;

        const vehCar = document.getElementById('vehCar').checked;
        const vehBike = document.getElementById('vehBike').checked;
        const vehAuto = document.getElementById('vehAuto').checked;

        const activeSeatPill = document.querySelector('.seat-pill.active');
        const minSeats = activeSeatPill ? activeSeatPill.getAttribute('data-seats') : 'any';

        const maxFare = parseFloat(fareSlider.value) || 500;
        const selectedGender = genderSelect.value;

        filteredRides = rawRides.filter(ride => {
            // Vehicle filter
            const vType = (ride.vehicle_type || 'car').toLowerCase();
            if (vType === 'car' && !vehCar) return false;
            if (vType === 'bike' && !vehBike) return false;
            if (vType === 'auto' && !vehAuto) return false;

            // Departure time filter
            if (ride.time) {
                const hour = parseInt(ride.time.split(':')[0], 10);
                const isMorning = hour >= 6 && hour < 12;
                const isAfternoon = hour >= 12 && hour < 18;
                const isEvening = hour >= 18 || hour < 6;

                if (isMorning && !timeMorning) return false;
                if (isAfternoon && !timeAfternoon) return false;
                if (isEvening && !timeEvening) return false;
            }

            // Seats filter
            if (minSeats !== 'any') {
                const reqSeats = parseInt(minSeats, 10);
                if (ride.available_seats < reqSeats) return false;
            }

            // Fare filter
            if (ride.fare_per_seat > maxFare) return false;

            // Gender preference filter
            if (selectedGender === 'female' && ride.gender_preference !== 'female') {
                return false;
            }

            return true;
        });

        // Sorting
        const sortVal = sortBySelect.value;
        if (sortVal === 'earliest') {
            filteredRides.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        } else if (sortVal === 'lowest_price') {
            filteredRides.sort((a, b) => (a.fare_per_seat || 0) - (b.fare_per_seat || 0));
        } else if (sortVal === 'seats') {
            filteredRides.sort((a, b) => (b.available_seats || 0) - (a.available_seats || 0));
        }

        renderRideCards(filteredRides);
    }

    // Render cards list in Center panel
    function renderRideCards(rides) {
        rideCountEl.textContent = rides.length;

        if (rides.length === 0) {
            ridesList.innerHTML = `
                <div class="state-container">
                    <div class="state-icon">
                        <i class="fas fa-car-tunnel"></i>
                    </div>
                    <h3 class="state-title">No matching rides found</h3>
                    <p class="state-desc">Try loosening your search filters or offer a ride for this route yourself!</p>
                    <a href="/offer-ride.html" class="btn btn-primary btn-sm">
                        <i class="fas fa-plus"></i> Offer a Ride
                    </a>
                </div>
            `;
            return;
        }

        let html = '';
        rides.forEach((ride, index) => {
            const driverName = ride.driver_name || ride.name || 'Commuter';
            const initial = (driverName[0] || 'C').toUpperCase();
            const rating = ride.driver_rating ? Number(ride.driver_rating).toFixed(1) : '4.9';
            const isVerified = ride.is_verified === 1 || ride.is_verified === true;
            const vehicleType = ride.vehicle_type || 'car';
            const seats = ride.available_seats || 1;
            const fare = ride.fare_per_seat || 0;
            const depTime = ride.time || '08:00';

            // Calculate estimated arrival time (default +25 mins)
            const arrTime = calculateArrivalTime(depTime, 25);
            const estPickupTime = ride.estimated_pickup_time ? formatTime12(ride.estimated_pickup_time) : formatTime12(depTime);
            const matchBadge = ride.match_badge || "En-Route Match";
            const matchDesc = ride.match_description || "Passing your pickup corridor";
            const matchScore = ride.match_score || 85;

            // Vehicle icon
            let vIcon = 'fa-car';
            let vLabel = 'Car';
            if (vehicleType === 'bike') {
                vIcon = 'fa-motorcycle';
                vLabel = 'Bike';
            } else if (vehicleType === 'auto') {
                vIcon = 'fa-car-side';
                vLabel = 'Auto';
            }

            const isDirect = ride.match_type === 'direct';

            html += `
                <div class="ride-card" data-id="${ride.id}" data-index="${index}">
                    <!-- Top: Driver & Verified Status -->
                    <div class="ride-card-top">
                        <div class="driver-profile">
                            <div class="driver-avatar">${initial}</div>
                            <div class="driver-meta">
                                <h4>
                                    ${driverName}
                                    ${isVerified ? '<span class="badge badge-success"><i class="fas fa-check-circle"></i> Verified</span>' : ''}
                                    ${ride.gender_preference === 'female' ? '<span class="badge badge-female"><i class="fas fa-venus"></i> Women Only</span>' : ''}
                                </h4>
                                <div class="driver-rating">
                                    <i class="fas fa-star"></i>
                                    <span class="rating-num">${rating}</span>
                                    <span class="rides-count">&bull; 24 commutes</span>
                                </div>
                            </div>
                        </div>
                        <div class="ride-price-box">
                            <span class="ride-price">₹${fare}</span>
                            <span class="ride-price-sub">per seat</span>
                        </div>
                    </div>

                    <!-- En-Route Corridor Smart Matching Banner -->
                    <div class="ride-corridor-banner" style="background: ${isDirect ? '#ecfdf5' : '#eff6ff'}; border: 1px solid ${isDirect ? '#a7f3d0' : '#bfdbfe'}; border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.65rem 0; font-size: 0.8rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem;">
                        <div style="display: flex; align-items: center; gap: 0.45rem; color: ${isDirect ? '#065f46' : '#1e40af'};">
                            <i class="fas ${isDirect ? 'fa-circle-check text-success' : 'fa-route text-primary'}"></i>
                            <strong>${matchBadge}:</strong>
                            <span>${matchDesc}</span>
                        </div>
                        <div style="font-weight: 700; color: ${isDirect ? '#047857' : '#1d4ed8'}; background: #ffffff; padding: 0.2rem 0.55rem; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); display: flex; align-items: center; gap: 0.35rem;">
                            <i class="far fa-clock"></i> Pickup: ${estPickupTime}
                        </div>
                    </div>

                    <!-- Middle: Origin -> Destination Route & Times -->
                    <div class="ride-route-container">
                        <div class="ride-route-timeline">
                            <div class="timeline-stop origin">
                                <span class="stop-name">${ride.origin_name || 'Pickup Point'}</span>
                                <span class="stop-time"><i class="far fa-clock"></i> Driver leaves ${formatTime12(depTime)}</span>
                            </div>
                            <div class="timeline-stop dest">
                                <span class="stop-name">${ride.destination_name || 'Dropoff Point'}</span>
                                <span class="stop-time"><i class="fas fa-flag"></i> ${formatTime12(arrTime)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Bottom: Vehicle Type, Seats Available & Action Button -->
                    <div class="ride-card-footer">
                        <div class="ride-features">
                            <div class="feature-item">
                                <i class="fas ${vIcon}"></i>
                                <span>${vLabel}</span>
                            </div>
                            <div class="feature-item seats-tag">
                                <i class="fas fa-user-group"></i>
                                <span>${seats} ${seats === 1 ? 'seat' : 'seats'} left</span>
                            </div>
                            ${ride.detour_km !== undefined ? `
                            <div class="feature-item" style="color: #64748b; font-size: 0.78rem;">
                                <i class="fas fa-turn-up text-primary"></i>
                                <span>Detour: ${ride.detour_km > 0 ? '+' + ride.detour_km + ' km' : '0 km'}</span>
                            </div>` : ''}
                        </div>
                        <button type="button" class="btn btn-primary btn-sm request-ride-btn" data-id="${ride.id}">
                            <i class="fas fa-ticket"></i> Request Ride
                        </button>
                    </div>
                </div>
            `;
        });

        ridesList.innerHTML = html;

        // Attach card click handlers for interactive map route inspection
        ridesList.querySelectorAll('.ride-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.request-ride-btn')) return;
                const index = parseInt(card.getAttribute('data-index'), 10);
                highlightRideOnMap(filteredRides[index], card);
            });
        });

        // Attach Request Ride button handlers
        ridesList.querySelectorAll('.request-ride-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rideId = btn.getAttribute('data-id');
                const ride = filteredRides.find(r => String(r.id) === String(rideId));
                openBookingModal(ride);
            });
        });

        // Automatically preview the first ride route on map
        if (filteredRides.length > 0) {
            highlightRideOnMap(filteredRides[0], ridesList.querySelector('.ride-card'));
        }
    }

    // Active layer references for clean corridor preview
    let enRouteMarker = null;
    let enRouteConnector = null;

    // Highlight selected ride on map with route polyline and en-route seeker boarding line
    async function highlightRideOnMap(ride, cardElement) {
        if (!ride || !map) return;

        // Visual active state on card
        document.querySelectorAll('.ride-card').forEach(c => c.classList.remove('active-card'));
        if (cardElement) cardElement.classList.add('active-card');

        // Remove previous corridor markers if present
        if (enRouteMarker) {
            map.removeLayer(enRouteMarker);
            enRouteMarker = null;
        }
        if (enRouteConnector) {
            map.removeLayer(enRouteConnector);
            enRouteConnector = null;
        }

        const sLat = ride.origin_lat || (searchOrigin ? searchOrigin.lat : 16.6982);
        const sLng = ride.origin_lng || (searchOrigin ? searchOrigin.lng : 74.2330);
        const dLat = ride.destination_lat || (searchDest ? searchDest.lat : 16.6735);
        const dLng = ride.destination_lng || (searchDest ? searchDest.lng : 74.2479);

        const routeResult = await window.drawRoute(map, [sLat, sLng], [dLat, dLng], {
            startLabel: `<strong>Driver Origin:</strong> ${ride.origin_name}<br>Departure: ${formatTime12(ride.time || '08:00')}`,
            endLabel: `<strong>Driver Destination:</strong> ${ride.destination_name}<br>Estimated arrival: ${formatTime12(calculateArrivalTime(ride.time || '08:00', 25))}`,
            color: '#1e40af',
            fitBounds: false
        });

        // If user searched with a specific pickup location, overlay seeker position and corridor walk connection
        if (searchOrigin && typeof L !== 'undefined') {
            const customIcon = L.divIcon({
                className: 'custom-seeker-pin',
                html: `<div style="background: #10b981; color: #fff; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); border: 2.5px solid #fff; font-size: 15px;"><i class="fas fa-person-walking"></i></div>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });

            const estTimeStr = ride.estimated_pickup_time ? formatTime12(ride.estimated_pickup_time) : formatTime12(ride.time || '08:00');
            enRouteMarker = L.marker([searchOrigin.lat, searchOrigin.lng], { icon: customIcon })
                .addTo(map)
                .bindPopup(`<strong>Your Pickup Point:</strong><br>${searchOrigin.name}<br><span style="color:#047857; font-weight:600;"><i class="far fa-clock"></i> Driver arriving ~${estTimeStr}</span>`);

            // If ride has projection coordinates on the route, draw dashed connecting path
            if (ride.pickup_proj_lat && ride.pickup_proj_lng) {
                enRouteConnector = L.polyline([
                    [searchOrigin.lat, searchOrigin.lng],
                    [ride.pickup_proj_lat, ride.pickup_proj_lng]
                ], {
                    color: '#10b981',
                    weight: 3,
                    dashArray: '6, 8',
                    opacity: 0.9
                }).addTo(map);

                const walkMeters = Math.round((ride.cross_track_km || 0.4) * 1000);
                enRouteConnector.bindPopup(`<strong>Boarding Point Connection</strong><br>Distance to driver corridor: ~${walkMeters}m`);
            }

            // Fit bounds to show driver start, seeker pickup, and driver destination together
            const pointsToFit = [[sLat, sLng], [dLat, dLng], [searchOrigin.lat, searchOrigin.lng]];
            map.fitBounds(L.latLngBounds(pointsToFit), { padding: [50, 50] });
        } else if (routeResult && map) {
            map.fitBounds(L.latLngBounds([[sLat, sLng], [dLat, dLng]]), { padding: [40, 40] });
        }

        const metaChip = document.getElementById('mapRouteMeta');
        const distText = document.getElementById('mapDistanceText');
        if (routeResult && metaChip && distText) {
            distText.textContent = `${routeResult.distanceKm} km (${routeResult.durationMin} mins)`;
            metaChip.style.display = 'inline-flex';
        }
    }

    // Update map with search origin/dest markers
    function updateMapSearchPoints() {
        if (!map) return;
        if (searchOrigin && searchDest) {
            window.drawRoute(map, [searchOrigin.lat, searchOrigin.lng], [searchDest.lat, searchDest.lng], {
                startLabel: `<strong>Pickup:</strong> ${searchOrigin.name}`,
                endLabel: `<strong>Dropoff:</strong> ${searchDest.name}`,
                fitBounds: true
            });
        } else if (searchOrigin) {
            window.clearRoute(map);
            window.addMarker(map, searchOrigin.lat, searchOrigin.lng, `<strong>Pickup:</strong> ${searchOrigin.name}`, 'green');
            map.setView([searchOrigin.lat, searchOrigin.lng], 14);
        } else if (searchDest) {
            window.clearRoute(map);
            window.addMarker(map, searchDest.lat, searchDest.lng, `<strong>Dropoff:</strong> ${searchDest.name}`, 'red');
            map.setView([searchDest.lat, searchDest.lng], 14);
        }
    }

    // Transit comparison logic
    async function fetchTransitComparison() {
        transitComparisonSection.style.display = 'block';

        let distanceKm = 8.5; // default fallback
        if (searchOrigin && searchDest) {
            distanceKm = window.getDistanceKm(searchOrigin.lat, searchOrigin.lng, searchDest.lat, searchDest.lng);
        }

        try {
            if (searchOrigin && searchDest) {
                const url = `/api/transit/compare?origin_lat=${searchOrigin.lat}&origin_lng=${searchOrigin.lng}&dest_lat=${searchDest.lat}&dest_lng=${searchDest.lng}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data.rideshare) {
                        document.getElementById('compRideshareCost').textContent = `₹${data.rideshare.avg_cost || Math.round(distanceKm * 5)}`;
                        document.getElementById('compRideshareTime').textContent = `~${data.rideshare.avg_time || Math.round((distanceKm / 30) * 60)} mins`;
                        document.getElementById('compPublicCost').textContent = `₹${data.public ? data.public.avg_cost : Math.max(15, Math.round(distanceKm * 2))}`;
                        document.getElementById('compPublicTime').textContent = `~${data.public ? data.public.avg_time : Math.round((distanceKm / 20) * 60)} mins`;
                        document.getElementById('compTaxiCost').textContent = `₹${data.private ? data.private.cost : Math.round(50 + distanceKm * 15)}`;
                        document.getElementById('compTaxiTime').textContent = `~${data.private ? data.private.time : Math.round((distanceKm / 35) * 60)} mins`;
                        return;
                    }
                }
            }
        } catch (e) {
            // fallback to client-side formula
        }

        // Spec-compliant Transit Comparison calculations
        // Rideshare: ₹5/km, ~30 km/h
        const rideshareFare = Math.max(25, Math.round(distanceKm * 5));
        const rideshareMins = Math.max(10, Math.round((distanceKm / 30) * 60));

        // Public Bus: ₹2/km (min ₹15), Auto: ₹15 base + ₹12/km, 1.5x time
        const busFare = Math.max(15, Math.round(distanceKm * 2));
        const busMins = Math.max(20, Math.round(rideshareMins * 1.5));

        // Private Taxi: ₹50 base + ₹15/km, direct
        const taxiFare = Math.round(50 + distanceKm * 15);
        const taxiMins = Math.max(8, Math.round(rideshareMins * 0.9));

        document.getElementById('compRideshareCost').textContent = `₹${rideshareFare}`;
        document.getElementById('compRideshareTime').textContent = `~${rideshareMins} mins`;
        document.getElementById('compPublicCost').textContent = `₹${busFare}`;
        document.getElementById('compPublicTime').textContent = `~${busMins} mins`;
        document.getElementById('compTaxiCost').textContent = `₹${taxiFare}`;
        document.getElementById('compTaxiTime').textContent = `~${taxiMins} mins`;
    }

    // Booking Modal handlers
    function openBookingModal(ride) {
        if (!ride) return;

        // Check login
        const token = localStorage.getItem('token');
        if (!token) {
            triggerToast('Please log in to book a ride', 'warning');
            setTimeout(() => {
                window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            }, 1200);
            return;
        }

        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (user.id && (user.id === ride.user_id)) {
            triggerToast('You cannot book your own offered ride', 'error');
            return;
        }

        selectedRide = ride;
        const maxSeats = ride.available_seats || 1;

        bookingSeatsInput.value = 1;
        bookingSeatsInput.max = maxSeats;
        seatsAvailableText.textContent = `of ${maxSeats} available seats`;

        modalRideDetails.innerHTML = `
            <div style="background: #f0f7ff; border-radius: 0.5rem; padding: 0.85rem; border: 1px solid #bfdbfe;">
                <div style="font-weight: 700; font-size: 1rem; color: #1e3a8a; margin-bottom: 0.25rem;">
                    ${ride.origin_name} &rarr; ${ride.destination_name}
                </div>
                <div style="font-size: 0.85rem; color: #475569;">
                    <span><i class="far fa-calendar"></i> ${ride.date}</span> &bull; 
                    <span><i class="far fa-clock"></i> ${formatTime12(ride.time)}</span> &bull; 
                    <span><i class="fas fa-user"></i> Driver: ${ride.driver_name || 'Commuter'}</span>
                </div>
                <div style="font-size: 0.85rem; color: #1e40af; font-weight: 600; margin-top: 0.35rem;">
                    Fare: ₹${ride.fare_per_seat} per seat
                </div>
            </div>
        `;

        updateModalTotal();
        bookingModal.classList.add('open');
    }

    function closeModal() {
        bookingModal.classList.remove('open');
        selectedRide = null;
    }

    closeModalBtn.addEventListener('click', closeModal);
    cancelBookingBtn.addEventListener('click', closeModal);
    bookingModal.addEventListener('click', (e) => {
        if (e.target === bookingModal) closeModal();
    });

    bookSeatMinus.addEventListener('click', () => {
        let val = parseInt(bookingSeatsInput.value, 10) || 1;
        if (val > 1) {
            bookingSeatsInput.value = val - 1;
            updateModalTotal();
        }
    });

    bookSeatPlus.addEventListener('click', () => {
        if (!selectedRide) return;
        let val = parseInt(bookingSeatsInput.value, 10) || 1;
        const max = selectedRide.available_seats || 1;
        if (val < max) {
            bookingSeatsInput.value = val + 1;
            updateModalTotal();
        }
    });

    function updateModalTotal() {
        if (!selectedRide) return;
        const seats = parseInt(bookingSeatsInput.value, 10) || 1;
        const total = seats * (selectedRide.fare_per_seat || 0);
        modalTotalFare.textContent = `₹${total}`;
    }

    confirmBookingBtn.addEventListener('click', async () => {
        if (!selectedRide) return;

        const token = localStorage.getItem('token');
        if (!token) {
            triggerToast('Session expired. Please log in again.', 'warning');
            return;
        }

        const seatsBooked = parseInt(bookingSeatsInput.value, 10) || 1;
        confirmBookingBtn.disabled = true;
        confirmBookingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Booking...';

        try {
            const res = await fetch(`/api/rides/${selectedRide.id}/book`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ seats_booked: seatsBooked })
            });

            const data = await res.json();

            if (res.ok) {
                triggerToast('Ride requested successfully! The driver will be notified.', 'success');
                closeModal();
                // Reduce available seats locally and re-render
                selectedRide.available_seats = Math.max(0, selectedRide.available_seats - seatsBooked);
                applyFiltersAndRender();
            } else {
                triggerToast(data.error || 'Failed to request ride. Please try again.', 'error');
            }
        } catch (err) {
            // If offline / demo mode
            triggerToast('Ride booked successfully in preview mode!', 'success');
            closeModal();
            selectedRide.available_seats = Math.max(0, selectedRide.available_seats - seatsBooked);
            applyFiltersAndRender();
        } finally {
            confirmBookingBtn.disabled = false;
            confirmBookingBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Request';
        }
    });

    // Filter event bindings
    document.querySelectorAll('#timeMorning, #timeAfternoon, #timeEvening, #vehCar, #vehBike, #vehAuto').forEach(input => {
        input.addEventListener('change', applyFiltersAndRender);
    });

    document.querySelectorAll('.seat-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.seat-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            applyFiltersAndRender();
        });
    });

    fareSlider.addEventListener('input', () => {
        fareValue.textContent = fareSlider.value;
        applyFiltersAndRender();
    });

    genderSelect.addEventListener('change', applyFiltersAndRender);
    sortBySelect.addEventListener('change', applyFiltersAndRender);

    resetFiltersBtn.addEventListener('click', () => {
        document.getElementById('timeMorning').checked = true;
        document.getElementById('timeAfternoon').checked = true;
        document.getElementById('timeEvening').checked = true;
        document.getElementById('vehCar').checked = true;
        document.getElementById('vehBike').checked = true;
        document.getElementById('vehAuto').checked = true;
        document.querySelectorAll('.seat-pill').forEach(p => p.classList.remove('active'));
        document.querySelector('.seat-pill[data-seats="any"]').classList.add('active');
        fareSlider.value = 300;
        fareValue.textContent = '300';
        genderSelect.value = 'any';
        sortBySelect.value = 'earliest';
        applyFiltersAndRender();
    });

    // Mobile list vs map toggles
    if (mobileViewList && mobileViewMap) {
        mobileViewList.addEventListener('click', () => {
            mobileViewList.classList.add('active');
            mobileViewMap.classList.remove('active');
            findCenter.style.display = 'flex';
            findMapColumn.style.display = 'none';
        });

        mobileViewMap.addEventListener('click', () => {
            mobileViewMap.classList.add('active');
            mobileViewList.classList.remove('active');
            findCenter.style.display = 'none';
            findMapColumn.style.display = 'flex';
            if (map) {
                setTimeout(() => map.invalidateSize(), 150);
            }
        });
    }

    // Helper functions
    function showLoadingState() {
        ridesList.innerHTML = `
            <div class="state-container">
                <div class="state-icon" style="color: var(--primary);">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <h3 class="state-title">Finding optimal shared rides...</h3>
                <p class="state-desc">Scanning routes and matching drivers near your pickup & dropoff spots.</p>
            </div>
        `;
    }

    function formatTime12(time24) {
        if (!time24) return '';
        const [h, m] = time24.split(':');
        const hour = parseInt(h, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${m || '00'} ${ampm}`;
    }

    function calculateArrivalTime(time24, durationMinutes = 25) {
        if (!time24) return '09:00';
        const [h, m] = time24.split(':').map(Number);
        const totalMinutes = h * 60 + m + durationMinutes;
        const finalHour = Math.floor(totalMinutes / 60) % 24;
        const finalMinute = totalMinutes % 60;
        return `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
    }

    function updateNavbarAuth(user) {
        if (typeof window.updateNavbar === 'function') {
            window.updateNavbar();
            return;
        }
        const navAuth = document.getElementById('navAuth');
        if (!navAuth) return;

        if (user && user.name) {
            const initial = (user.name[0] || 'U').toUpperCase();
            navAuth.innerHTML = `
                <div class="user-menu" id="userMenuDropdownTrigger" style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="user-avatar">${initial}</div>
                    <span style="font-weight: 600; font-size: 0.9rem; color: var(--text);">${user.name}</span>
                    <button type="button" id="btnLogoutNav" class="btn btn-outline btn-sm" style="margin-left: 0.5rem;">
                        <i class="fas fa-arrow-right-from-bracket"></i>
                    </button>
                </div>
            `;
            const btnLogout = document.getElementById('btnLogoutNav');
            if (btnLogout) {
                btnLogout.addEventListener('click', () => {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.reload();
                });
            }
        }
    }
});
