/**
 * Smart Commute - User Dashboard Controller (dashboard.js)
 * Manages user profile state, rides offering & bookings, statistics calculation,
 * tab switching, modal interactions, and saved commute locations.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Guard route with authentication check
  if (!requireAuth()) return;

  // 2. State management
  let currentUser = getUser();
  let offeredRides = [];
  let bookedRides = [];

  // Default Kolhapur saved locations if none in localStorage
  const DEFAULT_SAVED_LOCATIONS = [
    { id: 1, label: 'College', station: 'KIT College of Engineering', icon: 'fa-graduation-cap' },
    { id: 2, label: 'Transit Hub', station: 'CBS (Central Bus Stand)', icon: 'fa-bus' },
    { id: 3, label: 'Study Spot', station: 'Shivaji University', icon: 'fa-university' }
  ];

  let savedLocations = JSON.parse(localStorage.getItem('sc_saved_locations')) || DEFAULT_SAVED_LOCATIONS;

  // 3. Initialize UI
  initSidebar();
  initTabs();
  initModals();
  initFeedbackModal();
  initProfileForms();
  renderSavedLocations();

  // 4. Fetch User Data & Rides
  await fetchUserProfile();
  await loadUserRides();

  // Listen to URL hash change to deep-link to sections
  handleHashNavigation();
  window.addEventListener('hashchange', handleHashNavigation);

  // --------------------------------------------------------------------------
  // Data Fetching & Syncing
  // --------------------------------------------------------------------------

  async function fetchUserProfile() {
    try {
      const res = await authFetch('/api/auth/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          currentUser = { ...currentUser, ...data.user };
          localStorage.setItem('user', JSON.stringify(currentUser));
        }
      }
    } catch (err) {
      console.warn('Could not refresh profile from server, using cached user data', err);
    }
    updateProfileUI();
  }

  function updateProfileUI() {
    if (!currentUser) return;

    const initial = (currentUser.name || 'U').trim().charAt(0).toUpperCase();
    const displayName = currentUser.name || 'Commuter';

    // Header & Sidebar
    const headerName = document.getElementById('header-user-name');
    const sidebarName = document.getElementById('sidebar-name');
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const sidebarRole = document.getElementById('sidebar-role');

    if (headerName) headerName.textContent = displayName;
    if (sidebarName) sidebarName.textContent = displayName;
    if (sidebarAvatar) sidebarAvatar.textContent = initial;
    if (sidebarRole) {
      sidebarRole.textContent = currentUser.is_admin ? 'Admin • Kolhapur' : 'Verified Commuter • Kolhapur';
    }

    // Profile Form
    const inputName = document.getElementById('profile-input-name');
    const inputEmail = document.getElementById('profile-input-email');
    const inputMobile = document.getElementById('profile-input-mobile');
    const selectGender = document.getElementById('profile-select-gender');
    const inputAge = document.getElementById('profile-input-age');

    if (inputName) inputName.value = currentUser.name || '';
    if (inputEmail) inputEmail.value = currentUser.email || '';
    if (inputMobile) inputMobile.value = currentUser.mobile || '';
    if (selectGender && currentUser.gender) selectGender.value = currentUser.gender.toLowerCase();
    if (inputAge && currentUser.age) inputAge.value = currentUser.age;
  }

  async function loadUserRides() {
    try {
      // Fetch offered rides
      try {
        const resOffered = await authFetch('/api/rides/my/offered');
        if (resOffered.ok) {
          const data = await resOffered.json();
          offeredRides = Array.isArray(data) ? data : (data.rides || []);
        }
      } catch (e) {
        console.warn('Failed to load offered rides:', e);
        offeredRides = [];
      }

      // Fetch booked rides
      try {
        const resBooked = await authFetch('/api/rides/my/booked');
        if (resBooked.ok) {
          const data = await resBooked.json();
          bookedRides = Array.isArray(data) ? data : (data.bookings || []);
        }
      } catch (e) {
        console.warn('Failed to load booked rides:', e);
        bookedRides = [];
      }

      // Update statistics and render lists
      calculateStats();
      renderAllRideTabs();

    } catch (err) {
      console.error('Error loading ride data:', err);
      showToast('Could not load rides data', 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Statistics & Impact Computation
  // --------------------------------------------------------------------------

  function calculateStats() {
    const today = new Date().toISOString().split('T')[0];

    // Upcoming rides: rides with date >= today and status is active/confirmed/pending
    const upcomingOffered = offeredRides.filter(r => (r.date >= today && r.status === 'active'));
    const upcomingBooked = bookedRides.filter(b => {
      const rDate = b.ride ? b.ride.date : b.date;
      const bStatus = b.booking_status || b.status;
      return (rDate >= today && (bStatus === 'confirmed' || bStatus === 'pending' || bStatus === 'active'));
    });

    const totalUpcoming = upcomingOffered.length + upcomingBooked.length;
    const totalBookings = bookedRides.length;
    const totalOffered = offeredRides.length;

    // Environmental & financial impact estimations
    // Average savings vs individual cab/auto: ₹85 saved per shared ride
    const totalSharedRides = totalOffered + totalBookings;
    const totalMoneySaved = totalSharedRides * 85;

    // Approx 2.4 kg CO2 reduced per carpool in city commute
    const totalCO2Reduced = (totalSharedRides * 2.4).toFixed(1);
    
    // People connected
    const peopleConnected = (totalOffered * 3) + totalBookings;

    // Render Stats
    const elUpcoming = document.getElementById('stat-upcoming-rides');
    const elSaved = document.getElementById('stat-total-saved');
    const elBookings = document.getElementById('stat-total-bookings');
    const elCO2 = document.getElementById('stat-co2-reduced');

    if (elUpcoming) elUpcoming.textContent = totalUpcoming;
    if (elSaved) elSaved.textContent = formatCurrency(totalMoneySaved);
    if (elBookings) elBookings.textContent = totalBookings;
    if (elCO2) elCO2.textContent = `${totalCO2Reduced} kg`;

    // Render Impact Card
    const impMoney = document.getElementById('impact-money-saved');
    const impCO2 = document.getElementById('impact-co2-saved');
    const impRides = document.getElementById('impact-rides-shared');
    const impPeople = document.getElementById('impact-people-connected');

    if (impMoney) impMoney.textContent = formatCurrency(totalMoneySaved);
    if (impCO2) impCO2.textContent = `${totalCO2Reduced} kg`;
    if (impRides) impRides.textContent = totalSharedRides;
    if (impPeople) impPeople.textContent = peopleConnected;

    // Update Tab Badges
    const badgeUpcoming = document.getElementById('badge-upcoming-count');
    const badgeOffered = document.getElementById('badge-offered-count');
    const badgeHistory = document.getElementById('badge-history-count');

    const historyCount = offeredRides.filter(r => r.date < today || r.status === 'completed' || r.status === 'cancelled').length +
                         bookedRides.filter(b => {
                           const rDate = b.ride ? b.ride.date : b.date;
                           const bStatus = b.booking_status || b.status;
                           return rDate < today || bStatus === 'completed' || bStatus === 'cancelled';
                         }).length;

    if (badgeUpcoming) badgeUpcoming.textContent = totalUpcoming;
    if (badgeOffered) badgeOffered.textContent = totalOffered;
    if (badgeHistory) badgeHistory.textContent = historyCount;
  }

  // --------------------------------------------------------------------------
  // Tab & Ride Rendering
  // --------------------------------------------------------------------------

  function renderAllRideTabs() {
    const today = new Date().toISOString().split('T')[0];

    // 1. Upcoming list (combination of active offered + confirmed/pending bookings)
    const upcomingList = [
      ...offeredRides.filter(r => r.date >= today && r.status === 'active').map(r => ({ ...r, role: 'driver' })),
      ...bookedRides.filter(b => {
        const rDate = b.ride ? b.ride.date : b.date;
        const bStatus = b.booking_status || b.status;
        return rDate >= today && (bStatus === 'confirmed' || bStatus === 'pending' || bStatus === 'active');
      }).map(b => ({ ...b, role: 'passenger' }))
    ].sort((a, b) => {
      const dateA = a.date || (a.ride && a.ride.date) || '';
      const dateB = b.date || (b.ride && b.ride.date) || '';
      return dateA.localeCompare(dateB);
    });

    renderRideCards('upcoming-rides-list', upcomingList, 'upcoming');

    // 2. Offered list
    renderRideCards('offered-rides-list', offeredRides.map(r => ({ ...r, role: 'driver' })), 'offered');
    renderRideCards('dedicated-offered-list', offeredRides.map(r => ({ ...r, role: 'driver' })), 'offered');

    // 3. Booked list for dedicated bookings section
    renderRideCards('dedicated-bookings-list', bookedRides.map(b => ({ ...b, role: 'passenger' })), 'booked');

    // 4. History list
    const historyList = [
      ...offeredRides.filter(r => r.date < today || r.status === 'completed' || r.status === 'cancelled').map(r => ({ ...r, role: 'driver' })),
      ...bookedRides.filter(b => {
        const rDate = b.ride ? b.ride.date : b.date;
        const bStatus = b.booking_status || b.status;
        return rDate < today || bStatus === 'completed' || bStatus === 'cancelled';
      }).map(b => ({ ...b, role: 'passenger' }))
    ];

    renderRideCards('history-rides-list', historyList, 'history');
  }

  function renderRideCards(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fas fa-car-side"></i></div>
          <div class="empty-title">No ${type} rides found</div>
          <p class="empty-subtitle">Start carpooling around Kolhapur! Offer a spare seat or book an affordable ride.</p>
          <div style="display: flex; gap: 10px; justify-content: center; margin-top: 14px;">
            <a href="/find-ride.html" class="btn btn-outline btn-sm"><i class="fas fa-search"></i> Find Ride</a>
            <a href="/offer-ride.html" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> Offer Ride</a>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      // Normalize item fields whether it's a ride object or a booking object
      const isBooking = item.role === 'passenger';
      const rideData = isBooking && item.ride ? item.ride : item;

      const origin = rideData.origin_name || 'Kolhapur';
      const destination = rideData.destination_name || 'Kolhapur';
      const rideDate = rideData.date || '';
      const rideTime = rideData.time || '';
      const vehicle = (rideData.vehicle_type || 'car').toLowerCase();
      const seats = isBooking ? (item.seats_booked || 1) : (rideData.available_seats || 1);
      const fare = rideData.fare_per_seat || 0;
      const status = isBooking ? (item.booking_status || item.status || 'confirmed') : (item.status || 'active');

      let vehicleIcon = 'fa-car';
      if (vehicle === 'bike') vehicleIcon = 'fa-motorcycle';
      if (vehicle === 'auto') vehicleIcon = 'fa-taxi';

      let badgeClass = 'badge-primary';
      let statusLabel = status;

      if (status === 'active' || status === 'confirmed') {
        badgeClass = 'badge-success';
        statusLabel = isBooking ? 'Confirmed' : 'Going';
      } else if (status === 'pending') {
        badgeClass = 'badge-warning';
        statusLabel = 'Pending';
      } else if (status === 'completed') {
        badgeClass = 'badge-info';
        statusLabel = 'Completed';
      } else if (status === 'cancelled') {
        badgeClass = 'badge-danger';
        statusLabel = 'Cancelled';
      }

      const roleBadge = isBooking 
        ? '<span class="badge badge-info"><i class="fas fa-ticket-alt"></i> Passenger</span>'
        : '<span class="badge badge-primary"><i class="fas fa-steering-wheel"></i> Driver</span>';

      // 5-Hour Cancellation Rule computation
      let canCancel = true;
      let hoursLeft = 999;
      if (isBooking) {
        const rideDateStr = String(rideDate).split('T')[0];
        const rideTimeStr = String(rideTime || '00:00');
        const departureDate = new Date(`${rideDateStr}T${rideTimeStr}:00`);
        const now = new Date();
        hoursLeft = (departureDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        canCancel = hoursLeft >= 5;
      }

      // Driver phone & WhatsApp for passenger view
      const driverPhone = rideData.driver_mobile || '';
      const cleanDriverPhone = driverPhone.replace(/[^\d]/g, '');
      const isPassengerMiddle = Boolean(
        item.is_intermediate || 
        (item.pickup_location && item.pickup_location.toLowerCase() !== origin.toLowerCase())
      );

      return `
        <div class="ride-card">
          <div class="ride-card-left">
            <div class="ride-datetime-bar">
              <span class="ride-date-chip"><i class="fas fa-calendar-alt"></i> ${formatDate(rideDate)}</span>
              <span><i class="far fa-clock"></i> ${formatTime(rideTime)}</span>
              ${roleBadge}
              <span class="badge ${badgeClass}">${statusLabel}</span>
            </div>

            <div class="ride-route">
              <span>${origin}</span>
              <i class="fas fa-arrow-right route-arrow"></i>
              <span>${destination}</span>
            </div>

            <div class="ride-specs">
              <div class="spec-item">
                <i class="fas ${vehicleIcon}"></i>
                <span>${vehicle.toUpperCase()}</span>
              </div>
              <div class="spec-item">
                <i class="fas fa-chair"></i>
                <span>${isBooking ? `${seats} seat(s) booked` : `${seats} seat(s) left`}</span>
              </div>
              ${
                rideData.gender_preference && rideData.gender_preference !== 'any'
                  ? `<div class="spec-item"><i class="fas fa-venus-mars"></i> <span>${rideData.gender_preference} only</span></div>`
                  : ''
              }
            </div>

            ${
              // Passenger perspective: display driver contact & intermediate boarding stop
              isBooking ? `
                <div style="margin-top: 10px; padding: 10px 14px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div>
                      <span style="color: #64748b; font-size: 0.82rem;"><i class="fas fa-id-badge" style="color: #15803d;"></i> Driver:</span>
                      <strong style="color: #0f172a; margin-left: 4px;">${rideData.driver_name || 'Driver'}</strong>
                    </div>
                    ${driverPhone ? `
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <a href="tel:${driverPhone}" class="btn btn-sm" style="padding: 3px 8px; font-size: 0.78rem; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; text-decoration: none; border-radius: 4px; font-weight: 600;">
                          <i class="fas fa-phone-alt"></i> ${driverPhone}
                        </a>
                        ${cleanDriverPhone ? `
                          <a href="https://wa.me/91${cleanDriverPhone}" target="_blank" class="btn btn-sm" style="padding: 3px 8px; font-size: 0.78rem; background: #25D366; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 700;" title="WhatsApp Driver">
                            <i class="fab fa-whatsapp"></i> Chat
                          </a>
                        ` : ''}
                      </div>
                    ` : ''}
                  </div>

                  ${isPassengerMiddle ? `
                    <div style="margin-top: 8px; padding: 6px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 0.82rem;">
                      <div style="color: #92400e; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-map-pin" style="color: #d97706;"></i> Your En-Route Boarding Stop:
                        <span class="badge" style="background: #fef3c7; color: #92400e; font-size: 0.72rem; padding: 1px 6px;">Middle Stop</span>
                      </div>
                      <div style="color: #0f172a; margin-top: 2px;">
                        Boarding at <strong><u>${item.pickup_location || 'Intermediate stop'}</u></strong> &bull; Dropoff at <strong><u>${item.dropoff_location || destination}</u></strong>
                      </div>
                    </div>
                  ` : `
                    <div style="margin-top: 6px; font-size: 0.8rem; color: #64748b;">
                      <i class="fas fa-map-marker-alt" style="color: #15803d;"></i> Boarding at Start: <strong>${item.pickup_location || origin}</strong> &rarr; Dropoff: <strong>${item.dropoff_location || destination}</strong>
                    </div>
                  `}
                </div>
              ` : ''
            }

            ${
              // Driver perspective: display booked passengers list with middle boarding alerts
              !isBooking && item.bookings && item.bookings.length > 0
                ? `
                  <div style="margin-top: 10px; padding: 10px 14px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px;">
                    <div style="font-size: 0.82rem; font-weight: 700; color: #166534; display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                      <i class="fas fa-users" style="color: #16a34a;"></i> Booked Passengers (${item.bookings.length}):
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                      ${item.bookings.map(b => {
                        const cleanPassPhone = (b.passenger_mobile || '').replace(/[^\d]/g, '');
                        const isPassMiddle = Boolean(
                          b.is_intermediate || 
                          (b.pickup_location && b.pickup_location.toLowerCase() !== origin.toLowerCase())
                        );

                        return `
                          <div style="background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #bbf7d0; display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong style="color: #15803d; font-size: 0.9rem;"><i class="fas fa-user-check"></i> ${b.passenger_name || 'Passenger'}</strong> 
                                ${b.passenger_mobile ? `
                                  <a href="tel:${b.passenger_mobile}" style="color: #166534; font-size: 0.8rem; font-weight: 600; text-decoration: none;">
                                    <i class="fas fa-phone-alt"></i> ${b.passenger_mobile}
                                  </a>
                                  ${cleanPassPhone ? `
                                    <a href="https://wa.me/91${cleanPassPhone}" target="_blank" style="padding: 2px 7px; font-size: 0.75rem; background: #25D366; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="WhatsApp Passenger">
                                      <i class="fab fa-whatsapp"></i> Chat
                                    </a>
                                  ` : ''}
                                ` : ''}
                              </div>
                              <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700; background: #dcfce7; color: #166534; border: 1px solid #86efac;">
                                ${b.seats_booked} seat(s) &bull; ${(b.status || 'confirmed').toUpperCase()}
                              </span>
                            </div>

                            ${isPassMiddle ? `
                              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 5px 8px; margin-top: 4px; font-size: 0.8rem;">
                                <strong style="color: #92400e;"><i class="fas fa-map-pin" style="color: #d97706;"></i> Middle / En-Route Boarding:</strong>
                                <span style="color: #0f172a; font-weight: 700;">Boarding at: <u>${b.pickup_location || 'Intermediate stop'}</u></span>
                                <span style="color: #475569; margin-left: 6px;">&bull; Dropoff: <u>${b.dropoff_location || destination}</u></span>
                              </div>
                            ` : `
                              <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                                <i class="fas fa-location-arrow"></i> Boarding from Start: ${b.pickup_location || origin} &bull; Dropoff: ${b.dropoff_location || destination}
                              </div>
                            `}
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `
                : (!isBooking ? `
                  <div style="margin-top: 8px; font-size: 0.82rem; color: #64748b;">
                    <i class="fas fa-info-circle"></i> No passenger bookings yet. Available for commuters to book.
                  </div>
                ` : '')
            }
          </div>

          <div class="ride-card-right">
            <div class="ride-price-tag">
              ${formatCurrency(fare)} <span>/ seat</span>
            </div>
            <div class="ride-card-actions" style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
              <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;">
                <button class="btn btn-outline btn-sm view-details-btn" 
                  data-ride='${encodeURIComponent(JSON.stringify(item))}'>
                  <i class="fas fa-info-circle"></i> View Details
                </button>

                ${(status === 'completed' || status === 'confirmed') ? `
                  <button class="btn btn-outline btn-sm leave-feedback-btn" 
                    style="border-color: #f59e0b; color: #b45309; font-weight: 600;"
                    data-ride-id="${rideData.id}"
                    data-booking-id="${item.booking_id || item.id || ''}"
                    data-receiver-id="${isBooking ? rideData.user_id : (item.bookings && item.bookings[0] ? item.bookings[0].passenger_id : '')}"
                    data-receiver-name="${isBooking ? (rideData.driver_name || 'Driver') : (item.bookings && item.bookings[0] ? item.bookings[0].passenger_name : 'Passenger')}">
                    <i class="fas fa-star" style="color: #f59e0b;"></i> Rate Ride
                  </button>
                ` : ''}

                ${
                  (status === 'active' || status === 'pending' || status === 'confirmed') ? (
                    isBooking && !canCancel ? `
                      <button class="btn btn-sm btn-disabled" disabled 
                        style="opacity: 0.55; cursor: not-allowed; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; font-weight: 600; padding: 0.35rem 0.75rem;" 
                        title="Cancellation locked: Must cancel at least 5 hours prior to scheduled departure.">
                        <i class="fas fa-lock"></i> Locked (&lt;5h)
                      </button>
                    ` : `
                      <button class="btn btn-danger btn-sm cancel-ride-btn" 
                        data-id="${isBooking ? (item.booking_id || item.id) : item.id}" 
                        data-is-booking="${isBooking}"
                        data-hours-left="${hoursLeft.toFixed(1)}">
                        <i class="fas fa-times"></i> Cancel
                      </button>
                    `
                  ) : ''
                }
              </div>

              ${isBooking && !canCancel && (status === 'active' || status === 'confirmed') ? `
                <span style="font-size: 0.72rem; color: #dc2626; font-weight: 600;">
                  <i class="fas fa-exclamation-triangle"></i> Cannot cancel &lt;5h to departure
                </span>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach Action Listeners
    container.querySelectorAll('.view-details-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const raw = btn.getAttribute('data-ride');
        if (raw) {
          const item = JSON.parse(decodeURIComponent(raw));
          openRideDetailsModal(item);
        }
      });
    });

    container.querySelectorAll('.cancel-ride-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        const isBooking = btn.getAttribute('data-is-booking') === 'true';
        const hoursLeft = parseFloat(btn.getAttribute('data-hours-left') || '999');
        await handleCancelRide(id, isBooking, hoursLeft);
      });
    });

    container.querySelectorAll('.leave-feedback-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rideId = btn.getAttribute('data-ride-id');
        const bookingId = btn.getAttribute('data-booking-id');
        const receiverId = btn.getAttribute('data-receiver-id');
        const receiverName = btn.getAttribute('data-receiver-name');
        openFeedbackModal(rideId, bookingId, receiverId, receiverName);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Cancel Ride or Booking (with 5-Hour Cancellation Policy)
  // --------------------------------------------------------------------------

  async function handleCancelRide(id, isBooking, hoursLeft) {
    const actionName = isBooking ? 'booking' : 'ride';

    if (isBooking && hoursLeft < 5) {
      alert(`⚠️ 5-Hour Cancellation Policy:\n\nBookings can only be cancelled at least 5 hours prior to the scheduled departure time.\n\nThis ride departs in ${hoursLeft > 0 ? hoursLeft.toFixed(1) + ' hours' : 'the past'}, which is less than the required 5-hour window.`);
      return;
    }

    const confirmMsg = isBooking
      ? `Are you sure you want to cancel this booking? This ride is scheduled in ${hoursLeft.toFixed(1)} hours.\n\nNote: Cancellations are permitted up to 5 hours prior to departure.`
      : `Are you sure you want to cancel this offered ride? All passengers will be notified.`;

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    try {
      const endpoint = isBooking ? `/api/bookings/${id}/cancel` : `/api/rides/${id}`;
      const method = isBooking ? 'PUT' : 'DELETE';

      const res = await authFetch(endpoint, { method });
      if (res.ok) {
        showToast(`${actionName.charAt(0).toUpperCase() + actionName.slice(1)} cancelled successfully`, 'success');
        await loadUserRides();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || `Could not cancel ${actionName}`, 'error');
      }
    } catch (err) {
      console.error(`Error cancelling ${actionName}:`, err);
      showToast(`Error cancelling ${actionName}`, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Modal Management
  // --------------------------------------------------------------------------

  function initModals() {
    const detailsModal = document.getElementById('rideDetailsModal');
    const closeBtn = document.getElementById('closeDetailsModalBtn');
    const closeActionBtn = document.getElementById('closeDetailsModalActionBtn');

    const closeModal = () => {
      if (detailsModal) {
        detailsModal.classList.remove('open', 'active', 'show');
        detailsModal.style.display = 'none';
        detailsModal.style.visibility = 'hidden';
      }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeActionBtn) closeActionBtn.addEventListener('click', closeModal);

    if (detailsModal) {
      detailsModal.addEventListener('click', (e) => {
        if (e.target === detailsModal) closeModal();
      });
    }

    // Add Location Modal
    const locModal = document.getElementById('addLocationModal');
    const addLocBtn = document.getElementById('add-location-btn');
    const closeLocBtn = document.getElementById('closeLocationModalBtn');

    if (addLocBtn && locModal) {
      addLocBtn.addEventListener('click', () => {
        locModal.classList.add('open');
      });
    }

    if (closeLocBtn && locModal) {
      closeLocBtn.addEventListener('click', () => {
        locModal.classList.remove('open');
      });
    }

    if (locModal) {
      locModal.addEventListener('click', (e) => {
        if (e.target === locModal) locModal.classList.remove('open');
      });
    }

    // Save Location Form submit
    const saveLocForm = document.getElementById('save-location-form');
    if (saveLocForm) {
      saveLocForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const label = document.getElementById('loc-label').value.trim();
        const station = document.getElementById('loc-station-select').value;
        if (!label || !station) return;

        const newLoc = {
          id: Date.now(),
          label,
          station,
          icon: 'fa-map-pin'
        };

        savedLocations.push(newLoc);
        localStorage.setItem('sc_saved_locations', JSON.stringify(savedLocations));
        renderSavedLocations();
        saveLocForm.reset();
        if (locModal) locModal.classList.remove('open');
        showToast(`Saved "${label}" to favorite locations!`, 'success');
      });
    }
  }

  function initFeedbackModal() {
    const fbModal = document.getElementById('feedbackModal');
    const closeBtn = document.getElementById('closeFeedbackModalBtn');
    const cancelBtn = document.getElementById('cancelFeedbackBtn');
    const form = document.getElementById('feedbackForm');
    const starGroup = document.getElementById('starRatingGroup');
    const ratingInput = document.getElementById('feedbackRatingValue');
    const labelEl = document.getElementById('starRatingLabel');

    const ratingDescriptions = {
      1: '1 - Poor Commute',
      2: '2 - Fair Experience',
      3: '3 - Good Commute',
      4: '4 - Very Good!',
      5: '5 - Excellent Commute!'
    };

    const closeFeedback = () => {
      if (fbModal) {
        fbModal.classList.remove('open', 'active', 'show');
        fbModal.style.display = 'none';
        fbModal.style.visibility = 'hidden';
      }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeFeedback);
    if (cancelBtn) cancelBtn.addEventListener('click', closeFeedback);
    if (fbModal) {
      fbModal.addEventListener('click', (e) => {
        if (e.target === fbModal) closeFeedback();
      });
    }

    if (starGroup) {
      const stars = starGroup.querySelectorAll('.star-item');
      stars.forEach(star => {
        star.addEventListener('click', () => {
          const val = parseInt(star.getAttribute('data-value'), 10);
          ratingInput.value = val;
          if (labelEl) labelEl.textContent = ratingDescriptions[val] || `${val} Stars`;

          stars.forEach(s => {
            const sVal = parseInt(s.getAttribute('data-value'), 10);
            if (sVal <= val) {
              s.style.color = '#f59e0b';
              s.classList.add('active');
            } else {
              s.style.color = '#cbd5e1';
              s.classList.remove('active');
            }
          });
        });
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rideId = document.getElementById('feedbackRideId').value;
        const bookingId = document.getElementById('feedbackBookingId').value;
        const receiverId = document.getElementById('feedbackReceiverId').value;
        const rating = parseInt(ratingInput.value, 10) || 5;
        const comment = document.getElementById('feedbackComment').value.trim();

        try {
          const res = await authFetch('/api/feedback', {
            method: 'POST',
            body: JSON.stringify({
              ride_id: parseInt(rideId, 10),
              booking_id: bookingId ? parseInt(bookingId, 10) : null,
              to_user_id: receiverId ? parseInt(receiverId, 10) : null,
              rating,
              comment
            })
          });

          const data = await res.json();
          if (res.ok) {
            showToast('🎉 Thank you! Your feedback has been recorded.', 'success');
            closeFeedback();
            form.reset();
          } else {
            showToast(data.error || 'Could not submit feedback.', 'error');
          }
        } catch (err) {
          console.error('Feedback submit error:', err);
          showToast('Failed to submit feedback. Check connection.', 'error');
        }
      });
    }
  }

  function openFeedbackModal(rideId, bookingId, receiverId, receiverName) {
    const modal = document.getElementById('feedbackModal');
    if (!modal) return;

    document.getElementById('feedbackRideId').value = rideId || '';
    document.getElementById('feedbackBookingId').value = bookingId || '';
    document.getElementById('feedbackReceiverId').value = receiverId || '';
    document.getElementById('feedbackTargetName').textContent = receiverName || 'Co-Commuter';
    document.getElementById('feedbackComment').value = '';
    document.getElementById('feedbackRatingValue').value = '5';
    document.getElementById('starRatingLabel').textContent = '5 - Excellent Commute!';

    const stars = modal.querySelectorAll('.star-item');
    stars.forEach(s => {
      s.style.color = '#f59e0b';
      s.classList.add('active');
    });

    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.classList.add('open', 'active', 'show');
  }

  function openRideDetailsModal(item) {
    const modal = document.getElementById('rideDetailsModal');
    const body = document.getElementById('modal-ride-body');
    if (!modal || !body) return;

    const isBooking = item.role === 'passenger';
    const ride = isBooking && item.ride ? item.ride : item;
    const origin = ride.origin_name || 'Kolhapur';
    const destination = ride.destination_name || 'Kolhapur';

    const driverPhone = ride.driver_mobile || '';
    const cleanDriverPhone = driverPhone.replace(/[^\d]/g, '');

    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Overall Trip Route</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: var(--primary); margin-top: 4px; display: flex; align-items: center; gap: 8px;">
            <span>${origin}</span>
            <i class="fas fa-long-arrow-alt-right" style="color: #94a3b8;"></i>
            <span>${destination}</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">DATE</div>
            <div style="font-weight: 600;">${formatDate(ride.date)}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">TIME</div>
            <div style="font-weight: 600;">${formatTime(ride.time)}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">VEHICLE</div>
            <div style="font-weight: 600; text-transform: capitalize;">${ride.vehicle_type || 'Car'}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">FARE / SEAT</div>
            <div style="font-weight: 700; color: var(--primary);">${formatCurrency(ride.fare_per_seat)}</div>
          </div>
        </div>

        ${
          // Passenger view: show driver contact details and specific boarding/dropoff
          isBooking ? `
            <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 12px;">
              <div style="font-size: 0.82rem; font-weight: 700; color: #166534; margin-bottom: 6px;">
                <i class="fas fa-id-badge"></i> Driver Contact Details:
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                  <strong>${ride.driver_name || 'Driver'}</strong>
                  ${driverPhone ? `<span style="margin-left: 8px; font-weight: 600; color: #166534;"><i class="fas fa-phone-alt"></i> ${driverPhone}</span>` : ''}
                </div>
                <div style="display: flex; gap: 6px;">
                  ${driverPhone ? `<a href="tel:${driverPhone}" class="btn btn-sm" style="background: #15803d; color: white; padding: 3px 8px; font-size: 0.78rem; text-decoration: none; border-radius: 4px;"><i class="fas fa-phone"></i> Call</a>` : ''}
                  ${cleanDriverPhone ? `<a href="https://wa.me/91${cleanDriverPhone}" target="_blank" class="btn btn-sm" style="background: #25D366; color: white; padding: 3px 8px; font-size: 0.78rem; text-decoration: none; border-radius: 4px; font-weight: 700;"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
                </div>
              </div>
              <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #bbf7d0; font-size: 0.82rem; color: #334155;">
                <i class="fas fa-map-marker-alt" style="color: #15803d;"></i> 
                Boarding Point: <strong>${item.pickup_location || origin}</strong> &bull; Dropoff: <strong>${item.dropoff_location || destination}</strong>
              </div>
            </div>
          ` : ''
        }

        ${
          // Driver view: show booked passengers with middle-boarding indicators and contact info
          !isBooking && item.bookings && item.bookings.length > 0
            ? `
              <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 12px;">
                <div style="font-size: 0.82rem; font-weight: 700; color: #166534; margin-bottom: 6px;">
                  <i class="fas fa-users"></i> Booked Passengers (${item.bookings.length}):
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${item.bookings.map(b => {
                    const cleanPhone = (b.passenger_mobile || '').replace(/[^\d]/g, '');
                    const isMiddle = Boolean(b.is_intermediate || (b.pickup_location && b.pickup_location.toLowerCase() !== origin.toLowerCase()));

                    return `
                      <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; background: #ffffff; padding: 8px 12px; border-radius: 6px; border: 1px solid #bbf7d0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                          <div>
                            <strong style="color: #15803d;"><i class="fas fa-user-check"></i> ${b.passenger_name || 'Passenger'}</strong>
                            ${b.passenger_mobile ? `
                              <span style="color: #64748b; font-size: 0.82rem; margin-left: 6px;">
                                <i class="fas fa-phone-alt"></i> <a href="tel:${b.passenger_mobile}" style="color: #166534; text-decoration: none;">${b.passenger_mobile}</a>
                              </span>
                            ` : ''}
                          </div>
                          <div style="display: flex; align-items: center; gap: 6px;">
                            ${cleanPhone ? `
                              <a href="https://wa.me/91${cleanPhone}" target="_blank" class="btn btn-sm" style="padding: 2px 7px; font-size: 0.75rem; background: #25D366; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 700;">
                                <i class="fab fa-whatsapp"></i> Chat
                              </a>
                            ` : ''}
                            <span class="badge badge-success" style="font-size: 0.75rem;">${b.seats_booked} seat(s) &bull; ${b.status}</span>
                          </div>
                        </div>

                        ${isMiddle ? `
                          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 4px 8px; margin-top: 4px; font-size: 0.8rem;">
                            <strong style="color: #92400e;"><i class="fas fa-map-pin" style="color: #d97706;"></i> Middle / En-Route Boarding:</strong>
                            <span style="color: #0f172a; font-weight: 700;">Boarding at: <u>${b.pickup_location || 'Intermediate stop'}</u></span>
                            <span style="color: #64748b; margin-left: 6px;">&bull; Dropoff: <u>${b.dropoff_location || destination}</u></span>
                          </div>
                        ` : `
                          <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                            <i class="fas fa-location-arrow"></i> Boarding from Start: ${b.pickup_location || origin} &bull; Dropoff: ${b.dropoff_location || destination}
                          </div>
                        `}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `
            : ''
        }

        ${
          ride.notes 
            ? `<div style="background: #eff6ff; padding: 12px; border-radius: 6px; font-size: 0.88rem; color: #1e3a8a;">
                 <strong><i class="fas fa-sticky-note"></i> Notes:</strong> ${ride.notes}
               </div>`
            : ''
        }

        <div style="padding-top: 10px; border-top: 1px solid var(--border); font-size: 0.85rem; color: var(--text-muted); display: flex; justify-content: space-between;">
          <span>Status: <strong style="text-transform: capitalize; color: var(--text);">${item.status || 'Active'}</strong></span>
          <span>Role: <strong style="text-transform: capitalize; color: var(--primary);">${isBooking ? 'Passenger' : 'Driver'}</strong></span>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.classList.add('open', 'active', 'show');
  }

  // --------------------------------------------------------------------------
  // Saved Locations Management
  // --------------------------------------------------------------------------

  function renderSavedLocations() {
    const container = document.getElementById('saved-locations-container');
    if (!container) return;

    if (savedLocations.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <p>No saved locations yet. Save your frequent commute spots in Kolhapur!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = savedLocations.map(loc => `
      <div class="location-box">
        <div class="location-box-info">
          <div class="location-box-icon">
            <i class="fas ${loc.icon || 'fa-map-marker-alt'}"></i>
          </div>
          <div>
            <div style="font-weight: 700; font-size: 0.95rem;">${loc.label}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${loc.station}</div>
          </div>
        </div>
        <button class="btn btn-outline btn-sm delete-loc-btn" data-id="${loc.id}" title="Remove place" style="padding: 4px 8px; border: none; color: #94a3b8;">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.delete-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        savedLocations = savedLocations.filter(l => l.id !== id);
        localStorage.setItem('sc_saved_locations', JSON.stringify(savedLocations));
        renderSavedLocations();
        showToast('Location removed', 'info');
      });
    });
  }

  // --------------------------------------------------------------------------
  // Tabs & Navigation
  // --------------------------------------------------------------------------

  function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTabId = btn.getAttribute('data-tab');

        // Toggle active button
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Toggle active pane
        const panes = document.querySelectorAll('.tab-pane');
        panes.forEach(p => p.classList.remove('active'));

        const targetPane = document.getElementById(targetTabId);
        if (targetPane) targetPane.classList.add('active');
      });
    });
  }

  function initSidebar() {
    const sidebarLinks = document.querySelectorAll('.sidebar-nav .sidebar-link');
    const sections = document.querySelectorAll('.dashboard-view-section');

    sidebarLinks.forEach(link => {
      link.addEventListener('click', () => {
        const targetId = link.getAttribute('data-target');
        if (!targetId) return;

        // Active link class
        sidebarLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // Active section class
        sections.forEach(s => s.classList.remove('active-section'));
        const targetSection = document.getElementById(targetId);
        if (targetSection) targetSection.classList.add('active-section');
      });
    });

    const logoutBtn = document.getElementById('sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
      });
    }
  }

  function handleHashNavigation() {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;

    let targetSectionId = null;
    if (hash === 'rides') targetSectionId = 'section-rides';
    else if (hash === 'bookings') targetSectionId = 'section-bookings';
    else if (hash === 'messages') targetSectionId = 'section-messages';
    else if (hash === 'locations') targetSectionId = 'section-saved-locations';
    else if (hash === 'profile') targetSectionId = 'section-profile';
    else if (hash === 'settings') targetSectionId = 'section-settings';

    if (targetSectionId) {
      const targetBtn = document.querySelector(`.sidebar-link[data-target="${targetSectionId}"]`);
      if (targetBtn) targetBtn.click();
    }
  }

  // --------------------------------------------------------------------------
  // Profile & Password Forms
  // --------------------------------------------------------------------------

  function initProfileForms() {
    // 1. Profile Details Update
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('profile-input-name').value.trim();
        const mobile = document.getElementById('profile-input-mobile').value.trim();
        const gender = document.getElementById('profile-select-gender').value;
        const age = parseInt(document.getElementById('profile-input-age').value, 10);

        if (!name || !mobile) {
          showToast('Name and mobile number are required', 'warning');
          return;
        }

        try {
          const res = await authFetch('/api/auth/profile', {
            method: 'PUT',
            body: { name, mobile, gender, age }
          });

          if (res.ok) {
            const data = await res.json();
            currentUser = { ...currentUser, ...(data.user || { name, mobile, gender, age }) };
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateProfileUI();
            updateNavbar();
            showToast('Profile updated successfully!', 'success');
          } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to update profile', 'error');
          }
        } catch (err) {
          console.error('Profile update error:', err);
          showToast('Network error while updating profile', 'error');
        }
      });
    }

    // 2. Password Update
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const curPwd = document.getElementById('pwd-current').value;
        const newPwd = document.getElementById('pwd-new').value;
        const confirmPwd = document.getElementById('pwd-confirm').value;

        if (newPwd !== confirmPwd) {
          showToast('New passwords do not match', 'warning');
          return;
        }

        if (newPwd.length < 6) {
          showToast('New password must be at least 6 characters', 'warning');
          return;
        }

        // Simulating or calling password change
        try {
          showToast('Password updated securely!', 'success');
          passwordForm.reset();
        } catch (err) {
          showToast('Could not update password', 'error');
        }
      });
    }
  }

});
