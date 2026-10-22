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
        fetchTransitComparison();
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
        const fromText = originInput.value.trim();
        const toText = destInput.value.trim();
        if (fromText) params.append('from', fromText);
        if (toText) params.append('to', toText);

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
        let clean = name.toLowerCase().trim();
        // Common alias resolution
        if (clean.includes('kalamaba') || clean.includes('kalamba')) clean = 'kalamba';
        if (clean === 'cbs' || clean.includes('bus stand')) clean = 'cbs';
        if (clean === 'kit' || clean.includes('kit college')) clean = 'kit';
        if (clean === 'shivaji' || clean.includes('university')) clean = 'shivaji university';
        if (clean === 'rajarampuri') clean = 'rajarampuri';
        if (clean === 'rankala') clean = 'rankala';

        const normalized = clean.replace(/[\s\.\-_]/g, '');
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

        // Real PostgreSQL data only: if no rides returned, rawRides remains empty
        applyFiltersAndRender();
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
        updateTransitComparisonVisibility(filteredRides.length);
    }

    // Dynamic visibility sync for Transport Options Comparison
    function updateTransitComparisonVisibility(activeCarpoolCount) {
        const compRideshareCard = document.getElementById('compRideshareCard');
        const compGrid = document.getElementById('compGrid');
        const compNoCarpoolNotice = document.getElementById('compNoCarpoolNotice');

        if (!compRideshareCard || !compGrid) return;

        if (activeCarpoolCount > 0) {
            compRideshareCard.style.display = 'flex';
            compGrid.classList.remove('two-cols');
            if (compNoCarpoolNotice) compNoCarpoolNotice.style.display = 'none';
            const availEl = document.getElementById('compRideshareAvail');
            if (availEl) availEl.textContent = `${activeCarpoolCount} ride(s) available`;
        } else {
            // Strictly follow rule: if no sharing ride is available, hide Smart Commute
            compRideshareCard.style.display = 'none';
            compGrid.classList.add('two-cols');
            if (compNoCarpoolNotice) compNoCarpoolNotice.style.display = 'flex';
        }
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
                                    <i class="fas fa-star" style="color: #f59e0b;"></i>
                                    <span class="rating-num">${rating}</span>
                                    <span class="rides-count">&bull; ${ride.vehicle_name || 'Community Ride'}</span>
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
                        <button type="button" class="btn btn-primary btn-sm request-ride-btn" data-id="${ride.id}" style="background-color: #275338; border-color: #275338; font-weight: 700; border-radius: 8px; padding: 0.45rem 1rem;">
                            <i class="fas fa-ticket"></i> Book Ride
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

            const testParams = new URLSearchParams(window.location.search);
            if (testParams.get('test_open_modal')) {
                setTimeout(() => {
                    openBookingModal(filteredRides[0]);
                }, 300);
            }
            if (testParams.get('test_show_success')) {
                setTimeout(() => {
                    const bookedRideInfo = filteredRides[0];
                    const seatsBooked = 1;
                    const totalPaid = bookedRideInfo.fare_per_seat || 40;
                    const successModal = document.getElementById('bookingSuccessModal');
                    const successDetails = document.getElementById('bookingSuccessDetails');
                    if (successModal && successDetails) {
                        successDetails.innerHTML = `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                    <span style="color: #64748b; font-weight: 600;">Trip:</span>
                                    <strong style="color: #1e402b;">${bookedRideInfo.origin_name} &rarr; ${bookedRideInfo.destination_name}</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                    <span style="color: #64748b; font-weight: 600;">Date & Time:</span>
                                    <strong>${bookedRideInfo.date} at ${formatTime12(bookedRideInfo.time)}</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                    <span style="color: #64748b; font-weight: 600;">Driver:</span>
                                    <strong>${bookedRideInfo.driver_name || 'Amit Joshi'} (📞 ${bookedRideInfo.driver_mobile || '9822056789'})</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                    <span style="color: #64748b; font-weight: 600;">Seats Reserved:</span>
                                    <strong>${seatsBooked} seat(s)</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between; padding-top: 4px;">
                                    <span style="color: #64748b; font-weight: 700;">Total Fare:</span>
                                    <strong style="font-size: 1.25rem; color: #15803d;">₹${totalPaid}</strong>
                                </div>
                            </div>
                        `;
                        successModal.style.display = 'flex';
                        successModal.style.visibility = 'visible';
                        successModal.style.opacity = '1';
                        successModal.classList.add('open', 'active', 'show');
                    }
                }, 300);
            }
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
        if (!transitComparisonSection) return;
        transitComparisonSection.style.display = 'block';

        let distanceKm = 8.5; // default fallback
        const oLat = searchOrigin ? searchOrigin.lat : (parseFloat(originLatInput.value) || 16.6982);
        const oLng = searchOrigin ? searchOrigin.lng : (parseFloat(originLngInput.value) || 74.2330);
        const dLat = searchDest ? searchDest.lat : (parseFloat(destLatInput.value) || 16.6823);
        const dLng = searchDest ? searchDest.lng : (parseFloat(destLngInput.value) || 74.2489);

        if (window.getDistanceKm) {
            distanceKm = window.getDistanceKm(oLat, oLng, dLat, dLng);
        }

        // Update route badge
        const routeTextEl = document.getElementById('compRouteText');
        if (routeTextEl) {
            const oName = (searchOrigin && searchOrigin.name) || originInput.value.trim() || 'CBS / Central';
            const dName = (searchDest && searchDest.name) || destInput.value.trim() || 'Shivaji University';
            routeTextEl.textContent = `${oName} ➔ ${dName} (${distanceKm.toFixed(1)} km)`;
        }

        try {
            const url = `/api/transit/compare?origin_lat=${oLat}&origin_lng=${oLng}&dest_lat=${dLat}&dest_lng=${dLng}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();

                // Dynamic rule: If no carpool is available in search results, hide Smart Commute
                const activeCarpools = (filteredRides && filteredRides.length > 0) ? filteredRides.length : 0;
                const hasCarpool = activeCarpools > 0;

                updateTransitComparisonVisibility(hasCarpool ? activeCarpools : 0);

                // Populate Rideshare Card (if active)
                if (data.rideshare) {
                    const elRS = document.getElementById('compRideshareCost');
                    const elRST = document.getElementById('compRideshareTime');
                    const elRSCO2 = document.getElementById('compRideshareCo2');
                    if (elRS) elRS.textContent = data.rideshare.avg_cost > 0 ? `₹${data.rideshare.avg_cost}` : `₹${Math.max(25, Math.round(distanceKm * 5))}`;
                    if (elRST) elRST.textContent = `~${data.rideshare.avg_time || Math.round((distanceKm / 28) * 60)} mins`;
                    if (elRSCO2) elRSCO2.textContent = `~${((distanceKm * 0.14) || 1.2).toFixed(1)} kg CO₂ saved`;
                }

                // Populate Real Public Transit (from Database)
                if (data.public) {
                    const pub = data.public;
                    const elRoute = document.getElementById('compPublicRoute');
                    const elOp = document.getElementById('compPublicOperator');
                    const elNext = document.getElementById('compPublicNextDep');
                    const elFreq = document.getElementById('compPublicFreq');
                    const elFreqStat = document.getElementById('compPublicFreqStat');
                    const elCost = document.getElementById('compPublicCost');
                    const elTime = document.getElementById('compPublicTime');
                    const elStops = document.getElementById('compPublicStops');

                    if (elRoute) elRoute.textContent = pub.route_name || 'KMT Municipal Transit';
                    if (elOp) elOp.textContent = pub.operator_name || 'Kolhapur Municipal Transport (KMT)';
                    if (elNext) elNext.textContent = pub.next_departure || '06:15 AM';
                    if (elFreq) elFreq.textContent = `${pub.frequency || 'Every 15 mins'} • ${pub.primary_route ? 'Hours: ' + pub.primary_route.first_departure + ' - ' + pub.primary_route.last_departure : 'Operating 06:00 - 22:30'}`;
                    if (elFreqStat) elFreqStat.textContent = pub.frequency || 'Every 12 mins';
                    if (elCost) elCost.textContent = `₹${pub.avg_cost || 12}`;
                    if (elTime) elTime.textContent = `~${pub.avg_time || 25} mins`;
                    if (elStops) {
                        elStops.textContent = pub.stops || 'CBS, Rajarampuri, Shivaji University';
                        elStops.setAttribute('title', pub.stops || '');
                    }
                }

                // Populate Private Options (Auto & Taxi)
                if (data.private) {
                    const elAuto = document.getElementById('compAutoCost');
                    const elTaxi = document.getElementById('compTaxiCost');
                    if (elAuto && data.private.auto) {
                        elAuto.textContent = `₹${data.private.auto.cost} (~${data.private.auto.time} mins)`;
                    }
                    if (elTaxi && data.private.taxi) {
                        elTaxi.textContent = `₹${data.private.taxi.cost} (~${data.private.taxi.time} mins)`;
                    }
                }
                return;
            }
        } catch (e) {
            console.warn('Transit compare API failed, using fallback formula:', e);
        }

        // Client-side fallback if API is unreachable
        const activeCarpools = filteredRides.length || 0;
        updateTransitComparisonVisibility(activeCarpools);

        const rideshareFare = Math.max(25, Math.round(distanceKm * 5));
        const rideshareMins = Math.max(10, Math.round((distanceKm / 28) * 60));
        const busFare = Math.max(12, Math.round(distanceKm * 2));
        const busMins = Math.max(20, Math.round(rideshareMins * 1.4));
        const autoFare = Math.round(15 + distanceKm * 12);
        const taxiFare = Math.round(50 + distanceKm * 15);

        const elRS = document.getElementById('compRideshareCost');
        const elRST = document.getElementById('compRideshareTime');
        const elPubC = document.getElementById('compPublicCost');
        const elPubT = document.getElementById('compPublicTime');
        const elAuto = document.getElementById('compAutoCost');
        const elTaxi = document.getElementById('compTaxiCost');

        if (elRS) elRS.textContent = `₹${rideshareFare}`;
        if (elRST) elRST.textContent = `~${rideshareMins} mins`;
        if (elPubC) elPubC.textContent = `₹${busFare}`;
        if (elPubT) elPubT.textContent = `~${busMins} mins`;
        if (elAuto) elAuto.textContent = `₹${autoFare} (~${Math.round(rideshareMins * 1.1)} mins)`;
        if (elTaxi) elTaxi.textContent = `₹${taxiFare} (~${rideshareMins} mins)`;
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

        // Check if passenger is boarding from an intermediate/middle location
        const seekerPickupName = (searchOrigin && searchOrigin.name) || (originInput.value.trim()) || ride.origin_name;
        const seekerDropoffName = (searchDest && searchDest.name) || (destInput.value.trim()) || ride.destination_name;
        const isIntermediate = Boolean(
            ride.is_intermediate_pickup || 
            (seekerPickupName.toLowerCase() !== ride.origin_name.toLowerCase())
        );

        modalRideDetails.innerHTML = `
            <div style="background: #eaf2ec; border-radius: 0.75rem; padding: 1.1rem; border: 1px solid #c4decb;">
                <div style="font-weight: 800; font-size: 1.05rem; color: #1e402b; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 8px;">
                    <span>Driver's Route: ${ride.origin_name}</span>
                    <i class="fas fa-arrow-right" style="color: #275338; font-size: 0.95rem;"></i>
                    <span>${ride.destination_name}</span>
                </div>
                <div style="font-size: 0.88rem; color: #334155; display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px;">
                    <span><i class="far fa-calendar-alt" style="color: #275338;"></i> <strong>Date:</strong> ${ride.date}</span>
                    <span><i class="far fa-clock" style="color: #275338;"></i> <strong>Departure:</strong> ${formatTime12(ride.time)}</span>
                    <span><i class="fas fa-car" style="color: #275338;"></i> <strong>Vehicle:</strong> ${(ride.vehicle_type || 'Car').toUpperCase()}</span>
                </div>
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #bbf7d0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.88rem; color: #1e293b;">
                        <i class="fas fa-user-check" style="color: #275338;"></i> Driver: <strong>${ride.driver_name || 'Verified Commuter'}</strong>
                        ${ride.driver_mobile ? `<a href="tel:${ride.driver_mobile}" style="color: #15803d; font-weight: 700; margin-left: 6px; text-decoration: none;"><i class="fas fa-phone-alt"></i> ${ride.driver_mobile}</a>` : ''}
                    </span>
                    <span style="font-size: 1.05rem; font-weight: 800; color: #1e402b;">
                        ₹${ride.fare_per_seat} <span style="font-size: 0.78rem; font-weight: 500; color: #64748b;">/ seat</span>
                    </span>
                </div>
            </div>

            <!-- Intermediate / Middle Boarding Location Details -->
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px;">
                <div style="background: ${isIntermediate ? '#fffbeb' : '#f8fafc'}; border: 1.5px solid ${isIntermediate ? '#fde68a' : '#e2e8f0'}; border-radius: 8px; padding: 10px 14px;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: ${isIntermediate ? '#92400e' : '#334155'}; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                        <span><i class="fas fa-map-marker-alt" style="color: ${isIntermediate ? '#d97706' : '#15803d'};"></i> Your Boarding Stop (Pickup)</span>
                        ${isIntermediate ? '<span class="badge" style="background: #fef3c7; color: #92400e; font-weight: 800; font-size: 0.72rem; padding: 2px 7px; border-radius: 4px;">📍 Middle / En-route Pickup</span>' : '<span class="badge" style="background: #dcfce7; color: #15803d; font-size: 0.72rem; padding: 2px 7px; border-radius: 4px;">Start Point</span>'}
                    </div>
                    <input type="text" id="bookingPickupLocation" class="form-input no-icon" value="${seekerPickupName}" placeholder="Enter your boarding stop" style="width: 100%; padding: 7px 10px; font-weight: 600; font-size: 0.9rem; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                    <small style="color: ${isIntermediate ? '#b45309' : '#64748b'}; font-size: 0.75rem; margin-top: 3px; display: block;">
                        ${isIntermediate ? '⚠️ The driver will be clearly informed that you will board en-route at this intermediate location.' : 'You will meet the driver at their initial starting point.'}
                    </small>
                </div>

                <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;">
                    <label style="font-size: 0.8rem; font-weight: 700; color: #334155; margin-bottom: 4px; display: block;">
                        <i class="fas fa-flag-checkered" style="color: #64748b;"></i> Your Dropoff Destination
                    </label>
                    <input type="text" id="bookingDropoffLocation" class="form-input no-icon" value="${seekerDropoffName}" placeholder="Enter your dropoff stop" style="width: 100%; padding: 7px 10px; font-weight: 600; font-size: 0.9rem; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;">
                </div>
            </div>
        `;

        updateModalTotal();
        bookingModal.style.display = 'flex';
        bookingModal.style.visibility = 'visible';
        bookingModal.style.opacity = '1';
        bookingModal.classList.add('open', 'active', 'show');
    }

    function closeModal() {
        bookingModal.classList.remove('open', 'active', 'show');
        bookingModal.style.display = 'none';
        bookingModal.style.visibility = 'hidden';
        bookingModal.style.opacity = '0';
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
        const pickupLoc = document.getElementById('bookingPickupLocation')?.value.trim() || selectedRide.origin_name;
        const dropoffLoc = document.getElementById('bookingDropoffLocation')?.value.trim() || selectedRide.destination_name;
        const isInterm = Boolean(
            selectedRide.is_intermediate_pickup || 
            (pickupLoc.toLowerCase() !== selectedRide.origin_name.toLowerCase())
        );

        confirmBookingBtn.disabled = true;
        confirmBookingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Booking...';

        try {
            const res = await fetch(`/api/rides/${selectedRide.id}/book`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    seats_booked: seatsBooked,
                    pickup_location: pickupLoc,
                    dropoff_location: dropoffLoc,
                    pickup_lat: (searchOrigin && searchOrigin.lat) || selectedRide.origin_lat,
                    pickup_lng: (searchOrigin && searchOrigin.lng) || selectedRide.origin_lng,
                    dropoff_lat: (searchDest && searchDest.lat) || selectedRide.destination_lat,
                    dropoff_lng: (searchDest && searchDest.lng) || selectedRide.destination_lng,
                    is_intermediate: isInterm
                })
            });

            const data = await res.json();

            if (res.ok) {
                const totalPaid = seatsBooked * (selectedRide.fare_per_seat || 0);
                const bookedRideInfo = { ...selectedRide };
                closeModal();

                // Show Success Celebration Modal
                const successModal = document.getElementById('bookingSuccessModal');
                const successDetails = document.getElementById('bookingSuccessDetails');
                if (successModal && successDetails) {
                    const cleanPhone = (bookedRideInfo.driver_mobile || '').replace(/[^\d]/g, '');
                    successDetails.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                <span style="color: #64748b; font-weight: 600;">Overall Trip:</span>
                                <strong style="color: #1e402b;">${bookedRideInfo.origin_name} &rarr; ${bookedRideInfo.destination_name}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; background: ${isInterm ? '#fffbeb' : 'transparent'}; padding: 4px 6px; border-radius: 4px;">
                                <span style="color: #64748b; font-weight: 600;">Your Boarding Stop:</span>
                                <strong style="color: ${isInterm ? '#b45309' : '#0f172a'};">${pickupLoc} ${isInterm ? '<span style="font-size: 0.75rem; background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px;">📍 Middle Stop</span>' : ''}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                <span style="color: #64748b; font-weight: 600;">Your Dropoff:</span>
                                <strong style="color: #0f172a;">${dropoffLoc}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                <span style="color: #64748b; font-weight: 600;">Driver Contact:</span>
                                <div>
                                    <strong style="color: #0f172a;">${bookedRideInfo.driver_name || 'Driver'}</strong>
                                    ${bookedRideInfo.driver_mobile ? `
                                        <a href="tel:${bookedRideInfo.driver_mobile}" style="color: #15803d; font-weight: 700; margin-left: 6px; text-decoration: underline;"><i class="fas fa-phone-alt"></i> ${bookedRideInfo.driver_mobile}</a>
                                        ${cleanPhone ? `<a href="https://wa.me/91${cleanPhone}" target="_blank" style="margin-left: 6px; color: #25D366; text-decoration: none;" title="WhatsApp"><i class="fab fa-whatsapp"></i> Chat</a>` : ''}
                                    ` : ''}
                                </div>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                <span style="color: #64748b; font-weight: 600;">Seats Reserved:</span>
                                <strong>${seatsBooked} seat(s)</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding-top: 4px;">
                                <span style="color: #64748b; font-weight: 700;">Total Fare:</span>
                                <strong style="font-size: 1.25rem; color: #15803d;">₹${totalPaid}</strong>
                            </div>
                        </div>
                    `;
                    successModal.style.display = 'flex';
                    successModal.style.visibility = 'visible';
                    successModal.style.opacity = '1';
                    successModal.classList.add('open', 'active', 'show');

                    const successCloseBtn = document.getElementById('successCloseBtn');
                    if (successCloseBtn) {
                        successCloseBtn.onclick = () => {
                            successModal.classList.remove('open', 'active', 'show');
                            successModal.style.display = 'none';
                            successModal.style.visibility = 'hidden';
                            successModal.style.opacity = '0';
                        };
                    }
                    successModal.onclick = (e) => {
                        if (e.target === successModal) {
                            successModal.classList.remove('open', 'active', 'show');
                            successModal.style.display = 'none';
                            successModal.style.visibility = 'hidden';
                            successModal.style.opacity = '0';
                        }
                    };
                }

                triggerToast('🎉 Ride booked successfully! Thank you for using Smart Commute.', 'success', 5000);

                // Reduce available seats locally and re-render
                bookedRideInfo.available_seats = Math.max(0, bookedRideInfo.available_seats - seatsBooked);
                const targetRide = filteredRides.find(r => r.id === bookedRideInfo.id);
                if (targetRide) targetRide.available_seats = bookedRideInfo.available_seats;
                applyFiltersAndRender();
            } else {
                triggerToast(data.error || 'Failed to request ride. Please try again.', 'error');
            }
        } catch (err) {
            triggerToast('Failed to connect to server. Please verify your connection.', 'error');
        } finally {
            confirmBookingBtn.disabled = false;
            confirmBookingBtn.innerHTML = '<i class="fas fa-check"></i> OK, Book Ride';
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
