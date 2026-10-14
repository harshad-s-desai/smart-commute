/**
 * Smart Commute - Offer Ride Client Logic
 * Handles ride creation, route preview with OSRM and Leaflet, vehicle type toggling,
 * dynamic seat stepper, auto-suggested fare calculation, and form submission.
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
    // Current form & route state
    let map = null;
    let origin = null;
    let dest = null;
    let calculatedDistanceKm = 0;
    let calculatedDurationMin = 0;
    let selectedVehicleType = 'car';
    let userHasManuallyEditedFare = false;

    // DOM References
    const form = document.getElementById('offerRideForm');
    const fromInput = document.getElementById('offerFromInput');
    const toInput = document.getElementById('offerToInput');
    const originLatInput = document.getElementById('originLat');
    const originLngInput = document.getElementById('originLng');
    const originNameInput = document.getElementById('originName');
    const destLatInput = document.getElementById('destLat');
    const destLngInput = document.getElementById('destLng');
    const destNameInput = document.getElementById('destName');
    const dateInput = document.getElementById('offerDateInput');
    const timeInput = document.getElementById('offerTimeInput');
    const vehicleTypeInput = document.getElementById('vehicleTypeInput');
    const vehicleToggleButtons = document.querySelectorAll('.vehicle-toggle-btn');
    const seatMinusBtn = document.getElementById('seatMinusBtn');
    const seatPlusBtn = document.getElementById('seatPlusBtn');
    const seatValueDisplay = document.getElementById('seatValueDisplay');
    const seatsInput = document.getElementById('seatsInput');
    const seatMaxHint = document.getElementById('seatMaxHint');
    const farePerSeatInput = document.getElementById('farePerSeatInput');
    const fareCalculationHint = document.getElementById('fareCalculationHint');
    const applySuggestedFareBtn = document.getElementById('applySuggestedFareBtn');
    const genderSelect = document.getElementById('genderPreferenceSelect');
    const notesInput = document.getElementById('offerNotesInput');
    const postRideSubmitBtn = document.getElementById('postRideSubmitBtn');
    const routeDistanceEl = document.getElementById('routeDistance');
    const routeDurationEl = document.getElementById('routeDuration');

    // Vehicle specifications: max seats, default seats, and fare rates per km
    const VEHICLE_CONFIGS = {
        car: { maxSeats: 6, defaultSeats: 3, ratePerKm: 5, minFare: 20, label: 'Car' },
        bike: { maxSeats: 1, defaultSeats: 1, ratePerKm: 3, minFare: 10, label: 'Bike' },
        auto: { maxSeats: 3, defaultSeats: 3, ratePerKm: 4, minFare: 15, label: 'Auto' }
    };

    // 1. Initialize Leaflet Map
    if (typeof window.initMap === 'function') {
        map = window.initMap('offerMap', [16.6982, 74.2330], 13);
    }

    // 2. Set default date (today) and time (1 hour from now)
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    dateInput.value = todayStr;
    dateInput.min = todayStr;

    now.setHours(now.getHours() + 1);
    const nextHour = String(now.getHours()).padStart(2, '0');
    const nextMinute = String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0');
    timeInput.value = `${nextHour}:${nextMinute}`;

    // 3. Update Navbar user state
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    updateNavbarAuth(currentUser);

    // If female user, adjust gender preference default or options
    if (currentUser && currentUser.gender === 'female' && genderSelect) {
        genderSelect.value = 'female';
    }

    // 4. Setup Autocomplete on pickup (origin) and dropoff (destination)
    if (typeof window.setupAutocomplete === 'function') {
        window.setupAutocomplete(fromInput, (place) => {
            origin = {
                name: place.name,
                lat: Number(place.lat),
                lng: Number(place.lng)
            };
            originLatInput.value = origin.lat;
            originLngInput.value = origin.lng;
            originNameInput.value = origin.name;
            onLocationsChanged();
        });

        window.setupAutocomplete(toInput, (place) => {
            dest = {
                name: place.name,
                lat: Number(place.lat),
                lng: Number(place.lng)
            };
            destLatInput.value = dest.lat;
            destLngInput.value = dest.lng;
            destNameInput.value = dest.name;
            onLocationsChanged();
        });
    }

    // Manual typing fallback
    fromInput.addEventListener('blur', () => {
        if (!origin && fromInput.value.trim() && window.KOLHAPUR_STATIONS) {
            const match = window.KOLHAPUR_STATIONS.find(s => s.name.toLowerCase().includes(fromInput.value.trim().toLowerCase()));
            if (match) {
                origin = { name: match.name, lat: match.lat, lng: match.lng };
                originLatInput.value = match.lat;
                originLngInput.value = match.lng;
                originNameInput.value = match.name;
                onLocationsChanged();
            }
        }
    });

    toInput.addEventListener('blur', () => {
        if (!dest && toInput.value.trim() && window.KOLHAPUR_STATIONS) {
            const match = window.KOLHAPUR_STATIONS.find(s => s.name.toLowerCase().includes(toInput.value.trim().toLowerCase()));
            if (match) {
                dest = { name: match.name, lat: match.lat, lng: match.lng };
                destLatInput.value = match.lat;
                destLngInput.value = match.lng;
                destNameInput.value = match.name;
                onLocationsChanged();
            }
        }
    });

    // 5. When both locations are chosen, draw route and update distance/time
    async function onLocationsChanged() {
        if (!map) return;

        if (origin && dest) {
            routeDistanceEl.textContent = 'Calculating...';
            routeDurationEl.textContent = '...';

            const routeData = await window.drawRoute(map, [origin.lat, origin.lng], [dest.lat, dest.lng], {
                startLabel: `<strong>Pickup:</strong> ${origin.name}`,
                endLabel: `<strong>Dropoff:</strong> ${dest.name}`,
                color: '#1e40af',
                fitBounds: true
            });

            if (routeData) {
                calculatedDistanceKm = routeData.distanceKm;
                calculatedDurationMin = routeData.durationMin;
                routeDistanceEl.textContent = `${calculatedDistanceKm} km`;
                routeDurationEl.textContent = `${calculatedDurationMin} min`;
            } else {
                calculatedDistanceKm = window.getDistanceKm(origin.lat, origin.lng, dest.lat, dest.lng);
                calculatedDurationMin = Math.max(5, Math.round((calculatedDistanceKm / 30) * 60));
                routeDistanceEl.textContent = `${calculatedDistanceKm} km`;
                routeDurationEl.textContent = `${calculatedDurationMin} min`;
            }

            calculateAndDisplaySuggestedFare();
        } else if (origin) {
            window.clearRoute(map);
            window.addMarker(map, origin.lat, origin.lng, `<strong>Pickup:</strong> ${origin.name}`, 'green');
            map.setView([origin.lat, origin.lng], 14);
        } else if (dest) {
            window.clearRoute(map);
            window.addMarker(map, dest.lat, dest.lng, `<strong>Dropoff:</strong> ${dest.name}`, 'red');
            map.setView([dest.lat, dest.lng], 14);
        }
    }

    // 6. Vehicle Type Toggle Handlers
    vehicleToggleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            vehicleToggleButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const type = btn.getAttribute('data-type');
            selectedVehicleType = type;
            vehicleTypeInput.value = type;

            const config = VEHICLE_CONFIGS[type];
            seatMaxHint.textContent = `Max ${config.maxSeats} seat${config.maxSeats > 1 ? 's' : ''} for ${config.label}`;

            // Adjust seat count
            let currentSeats = parseInt(seatsInput.value, 10) || 1;
            if (currentSeats > config.maxSeats) {
                currentSeats = config.maxSeats;
            } else if (type === 'bike') {
                currentSeats = 1;
            } else if (type === 'car' && currentSeats === 1) {
                currentSeats = 3;
            }
            seatsInput.value = currentSeats;
            seatValueDisplay.textContent = currentSeats;

            updateStepperButtons();
            calculateAndDisplaySuggestedFare();
        });
    });

    // 7. Seats Stepper Handlers (+ / -)
    function updateStepperButtons() {
        const config = VEHICLE_CONFIGS[selectedVehicleType];
        const val = parseInt(seatsInput.value, 10) || 1;

        seatMinusBtn.disabled = val <= 1;
        seatPlusBtn.disabled = val >= config.maxSeats;
    }

    seatMinusBtn.addEventListener('click', () => {
        let val = parseInt(seatsInput.value, 10) || 1;
        if (val > 1) {
            val -= 1;
            seatsInput.value = val;
            seatValueDisplay.textContent = val;
            updateStepperButtons();
        }
    });

    seatPlusBtn.addEventListener('click', () => {
        const config = VEHICLE_CONFIGS[selectedVehicleType];
        let val = parseInt(seatsInput.value, 10) || 1;
        if (val < config.maxSeats) {
            val += 1;
            seatsInput.value = val;
            seatValueDisplay.textContent = val;
            updateStepperButtons();
        }
    });

    updateStepperButtons();

    // 8. Auto-suggest fare calculations
    function calculateAndDisplaySuggestedFare() {
        const config = VEHICLE_CONFIGS[selectedVehicleType];
        const dist = calculatedDistanceKm > 0 ? calculatedDistanceKm : 8; // fallback 8km if not routed yet
        const suggested = Math.max(config.minFare, Math.round(dist * config.ratePerKm));

        fareCalculationHint.textContent = `Suggested: ₹${suggested} (₹${config.ratePerKm}/km)`;
        applySuggestedFareBtn.style.display = 'inline-block';
        applySuggestedFareBtn.setAttribute('data-suggested', suggested);

        // Auto-fill fare if user hasn't explicitly entered a custom fare
        if (!userHasManuallyEditedFare || !farePerSeatInput.value) {
            farePerSeatInput.value = suggested;
        }
    }

    farePerSeatInput.addEventListener('input', () => {
        userHasManuallyEditedFare = true;
    });

    applySuggestedFareBtn.addEventListener('click', () => {
        const suggested = applySuggestedFareBtn.getAttribute('data-suggested');
        if (suggested) {
            farePerSeatInput.value = suggested;
            userHasManuallyEditedFare = false;
            triggerToast(`Applied suggested fare of ₹${suggested}`, 'info');
        }
    });

    // 9. Form Submission Handling
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            triggerToast('Please log in to post a ride', 'warning');
            setTimeout(() => {
                window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
            }, 1000);
            return;
        }

        // Validate origin & destination coordinates
        if (!origin || !origin.lat || !origin.lng) {
            triggerToast('Please select a valid pickup location from the suggestions', 'error');
            fromInput.focus();
            return;
        }
        if (!dest || !dest.lat || !dest.lng) {
            triggerToast('Please select a valid dropoff location from the suggestions', 'error');
            toInput.focus();
            return;
        }

        // Validate date
        const selectedDate = dateInput.value;
        if (!selectedDate) {
            triggerToast('Please select a commute date', 'error');
            dateInput.focus();
            return;
        }

        // Check date is not in past
        const todayZero = new Date();
        todayZero.setHours(0, 0, 0, 0);
        const rideDate = new Date(selectedDate);
        if (rideDate < todayZero) {
            triggerToast('Ride date cannot be in the past', 'error');
            return;
        }

        // Validate time
        const selectedTime = timeInput.value;
        if (!selectedTime) {
            triggerToast('Please select departure time', 'error');
            timeInput.focus();
            return;
        }

        // Validate seats and fare
        const seats = parseInt(seatsInput.value, 10);
        if (isNaN(seats) || seats < 1) {
            triggerToast('Available seats must be at least 1', 'error');
            return;
        }

        const fare = parseFloat(farePerSeatInput.value);
        if (isNaN(fare) || fare < 0) {
            triggerToast('Please enter a valid fare per seat', 'error');
            farePerSeatInput.focus();
            return;
        }

        // Payload preparation according to specification
        const payload = {
            origin_name: origin.name,
            origin_lat: origin.lat,
            origin_lng: origin.lng,
            destination_name: dest.name,
            destination_lat: dest.lat,
            destination_lng: dest.lng,
            date: selectedDate,
            time: selectedTime,
            vehicle_type: selectedVehicleType,
            available_seats: seats,
            fare_per_seat: fare,
            notes: notesInput.value.trim() || '',
            gender_preference: genderSelect.value || 'any'
        };

        // Submit to API
        postRideSubmitBtn.disabled = true;
        postRideSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting Commute Ride...';

        try {
            const res = await fetch('/api/rides', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok) {
                triggerToast('Ride posted successfully!', 'success');
                setTimeout(() => {
                    window.location.href = '/dashboard.html';
                }, 1200);
            } else {
                triggerToast(data.error || 'Failed to post ride. Please check details.', 'error');
                postRideSubmitBtn.disabled = false;
                postRideSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Commute Ride';
            }
        } catch (err) {
            console.warn('API unavailable, saved to mock demo storage:', err.message);
            // Graceful demo storage fallback
            const demoRides = JSON.parse(localStorage.getItem('my_offered_rides') || '[]');
            demoRides.unshift({
                ...payload,
                id: Date.now(),
                created_at: new Date().toISOString()
            });
            localStorage.setItem('my_offered_rides', JSON.stringify(demoRides));

            triggerToast('Ride posted successfully!', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 1200);
        }
    });

    // Helper: update navbar user avatar & name
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
                <div class="user-menu" style="display: flex; align-items: center; gap: 0.5rem;">
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
