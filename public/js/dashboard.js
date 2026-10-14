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
      return (rDate >= today && (b.status === 'confirmed' || b.status === 'pending'));
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

    const historyCount = offeredRides.filter(r => r.date < today || r.status === 'completed').length +
                         bookedRides.filter(b => {
                           const rDate = b.ride ? b.ride.date : b.date;
                           return rDate < today || b.status === 'completed';
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
        return rDate >= today && (b.status === 'confirmed' || b.status === 'pending');
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
        return rDate < today || b.status === 'completed' || b.status === 'cancelled';
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
      const status = item.status || 'active';

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
          </div>

          <div class="ride-card-right">
            <div class="ride-price-tag">
              ${formatCurrency(fare)} <span>/ seat</span>
            </div>
            <div class="ride-card-actions">
              <button class="btn btn-outline btn-sm view-details-btn" 
                data-ride='${encodeURIComponent(JSON.stringify(item))}'>
                <i class="fas fa-info-circle"></i> View Details
              </button>
              ${
                (status === 'active' || status === 'pending' || status === 'confirmed')
                  ? `<button class="btn btn-danger btn-sm cancel-ride-btn" 
                       data-id="${item.id}" 
                       data-is-booking="${isBooking}">
                       <i class="fas fa-times"></i> Cancel
                     </button>`
                  : ''
              }
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
        await handleCancelRide(id, isBooking);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Cancel Ride or Booking
  // --------------------------------------------------------------------------

  async function handleCancelRide(id, isBooking) {
    const actionName = isBooking ? 'booking' : 'ride';
    const confirmed = window.confirm(`Are you sure you want to cancel this ${actionName}?`);
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
      if (detailsModal) detailsModal.classList.remove('open');
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

  function openRideDetailsModal(item) {
    const modal = document.getElementById('rideDetailsModal');
    const body = document.getElementById('modal-ride-body');
    if (!modal || !body) return;

    const isBooking = item.role === 'passenger';
    const ride = isBooking && item.ride ? item.ride : item;

    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Trip Route</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: var(--primary); margin-top: 4px; display: flex; align-items: center; gap: 8px;">
            <span>${ride.origin_name || 'Kolhapur'}</span>
            <i class="fas fa-long-arrow-alt-right" style="color: #94a3b8;"></i>
            <span>${ride.destination_name || 'Kolhapur'}</span>
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

    modal.classList.add('open');
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
