/**
 * Smart Commute - Common Application Script (app.js)
 * Shared utilities for authentication, API requests, notifications, UI helpers, and navbar management.
 */

// API Base URL - relative for same origin
const API_BASE = '';

/**
 * Retrieve the JWT token from localStorage.
 * @returns {string|null} JWT token or null if not found
 */
function getToken() {
  return localStorage.getItem('token') || null;
}

/**
 * Retrieve the logged-in user object from localStorage.
 * @returns {object|null} User object or null
 */
function getUser() {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (err) {
    console.error('Failed to parse user from localStorage:', err);
    return null;
  }
}

/**
 * Check whether a user is currently authenticated.
 * @returns {boolean} True if token exists
 */
function isLoggedIn() {
  return Boolean(getToken());
}

/**
 * Log out the user: clears auth data and redirects to homepage.
 */
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('redirect_after_login');
  showToast('Logged out successfully', 'info');
  setTimeout(() => {
    window.location.href = '/';
  }, 300);
}

/**
 * Wrapper around standard fetch() that automatically attaches Bearer JWT authorization.
 * Handles automatic JSON serialization for object bodies and redirects on 401 Unauthorized.
 * 
 * @param {string} url - API endpoint URL or path
 * @param {object} options - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} Standard fetch Response promise
 */
async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Handle JSON serialization if body is a plain object
  if (
    options.body &&
    typeof options.body === 'object' &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob)
  ) {
    options.body = JSON.stringify(options.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const endpoint = url.startsWith('http') ? url : `${API_BASE}${url}`;

  try {
    const response = await fetch(endpoint, {
      ...options,
      headers
    });

    if (response.status === 401) {
      console.warn('Unauthorized request - session expired or token invalid');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      showToast('Session expired. Please log in again.', 'warning');
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 1000);
      throw new Error('Unauthorized');
    }

    return response;
  } catch (error) {
    console.error(`authFetch error for ${url}:`, error);
    throw error;
  }
}

/**
 * Show a modern floating toast notification in the top-right corner.
 * 
 * @param {string} message - Toast message text
 * @param {'success'|'error'|'warning'|'info'} type - Type of toast
 * @param {number} duration - Auto-dismiss timeout in milliseconds (default 3000ms)
 */
function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);

    // Inject fallback styles if not already defined
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        .toast-container {
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 99999;
          display: flex;
          flex-direction: column;
          gap: 12px;
          pointer-events: none;
        }
        .toast {
          pointer-events: auto;
          min-width: 280px;
          max-width: 420px;
          background: #ffffff;
          color: #1e293b;
          padding: 12px 18px;
          border-radius: 10px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          display: flex;
          align-items: center;
          gap: 12px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 0.925rem;
          font-weight: 500;
          border-left: 4px solid #1e40af;
          transform: translateX(120%);
          opacity: 0;
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        }
        .toast.toast-show {
          transform: translateX(0);
          opacity: 1;
        }
        .toast.toast-hide {
          transform: translateX(120%);
          opacity: 0;
        }
        .toast-success { border-left-color: #10b981; }
        .toast-success i { color: #10b981; }
        .toast-error { border-left-color: #ef4444; }
        .toast-error i { color: #ef4444; }
        .toast-warning { border-left-color: #f59e0b; }
        .toast-warning i { color: #f59e0b; }
        .toast-info { border-left-color: #3b82f6; }
        .toast-info i { color: #3b82f6; }
        .toast-message { flex: 1; line-height: 1.4; }
        .toast-close {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 1.1rem;
          line-height: 1;
          padding: 2px 4px;
          transition: color 0.15s;
        }
        .toast-close:hover { color: #475569; }
      `;
      document.head.appendChild(style);
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconClass = 'fa-check-circle';
  if (type === 'error') iconClass = 'fa-exclamation-circle';
  if (type === 'warning') iconClass = 'fa-exclamation-triangle';
  if (type === 'info') iconClass = 'fa-info-circle';

  toast.innerHTML = `
    <i class="fas ${iconClass}"></i>
    <div class="toast-message">${message}</div>
    <button class="toast-close" aria-label="Close notification">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  };

  closeBtn.addEventListener('click', dismiss);

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

/**
 * Format a date string into 'Mon, DD Oct YYYY'.
 * Example: "2026-10-14" -> "Wed, 14 Oct 2026"
 * 
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} Formatted date string
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    // Handle YYYY-MM-DD or standard ISO strings
    const parts = String(dateStr).split('T')[0].split('-');
    let date;
    if (parts.length === 3) {
      date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      date = new Date(dateStr);
    }

    if (isNaN(date.getTime())) return String(dateStr);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const dayName = days[date.getDay()];
    const day = String(date.getDate()).padStart(2, '0');
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();

    return `${dayName}, ${day} ${monthName} ${year}`;
  } catch (err) {
    return String(dateStr);
  }
}

/**
 * Format a time string into 'HH:MM AM/PM'.
 * Example: "14:30" -> "02:30 PM", "08:15" -> "08:15 AM"
 * 
 * @param {string} timeStr - Time string ("HH:MM" or "HH:MM:SS" or ISO string)
 * @returns {string} Formatted 12-hour time string
 */
function formatTime(timeStr) {
  if (!timeStr) return 'N/A';
  try {
    let hours, minutes;
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    } else {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return timeStr;
      hours = date.getHours();
      minutes = date.getMinutes();
    }

    if (isNaN(hours) || isNaN(minutes)) return timeStr;

    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const displayMinutes = String(minutes).padStart(2, '0');

    return `${String(displayHours).padStart(2, '0')}:${displayMinutes} ${period}`;
  } catch (e) {
    return timeStr;
  }
}

/**
 * Format amount as Indian Rupee string.
 * Example: 45 -> "₹45", 1250 -> "₹1,250"
 * 
 * @param {number|string} amount - Number to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  const val = Number(amount) || 0;
  return `₹${val.toLocaleString('en-IN')}`;
}

/**
 * Return human-readable relative time.
 * Example: "2 hours ago", "Just now", "3 days ago"
 * 
 * @param {string|Date} dateStr - Date string or timestamp
 * @returns {string} Relative time string
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return String(dateStr);

    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 45) return 'Just now';
    if (diffInSeconds < 90) return '1 minute ago';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 7200) return '1 hour ago';
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 172800) return 'Yesterday';
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
    return formatDate(dateStr);
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * Update the navbar based on the user's current authentication state.
 * Toggles between Login/Signup buttons and User profile dropdown.
 */
function updateNavbar() {
  const navAuth = document.querySelector('.nav-auth');
  if (!navAuth) return;

  const user = getUser();
  const token = getToken();

  if (token && user) {
    const initial = (user.name && user.name.trim().length > 0)
      ? user.name.trim().charAt(0).toUpperCase()
      : 'U';
    
    const isAdmin = Boolean(user.is_admin);

    navAuth.innerHTML = `
      <div class="user-menu" id="user-menu-dropdown">
        <button class="user-menu-trigger" aria-haspopup="true" aria-expanded="false" id="userMenuBtn">
          <span class="user-avatar">${initial}</span>
          <span class="user-name">${user.name || 'User'}</span>
          <i class="fas fa-chevron-down nav-dropdown-arrow"></i>
        </button>
        <div class="user-dropdown-menu" id="userDropdownContent">
          <div class="dropdown-header">
            <span class="dropdown-user-name">${user.name || 'User'}</span>
            <span class="dropdown-user-email">${user.email || ''}</span>
            ${isAdmin ? '<span class="badge badge-warning dropdown-badge">Admin</span>' : '<span class="badge badge-info dropdown-badge">Rider</span>'}
          </div>
          <div class="dropdown-divider"></div>
          <a href="/dashboard.html" class="dropdown-item">
            <i class="fas fa-th-large"></i> Dashboard
          </a>
          <a href="/dashboard.html#rides" class="dropdown-item">
            <i class="fas fa-car"></i> My Rides
          </a>
          <a href="/dashboard.html#bookings" class="dropdown-item">
            <i class="fas fa-ticket"></i> My Bookings
          </a>
          <a href="/dashboard.html#profile" class="dropdown-item">
            <i class="fas fa-user"></i> Profile & Settings
          </a>
          ${
            isAdmin
              ? `<a href="/admin.html" class="dropdown-item admin-item">
                  <i class="fas fa-shield-alt"></i> Admin Panel
                </a>`
              : ''
          }
          <div class="dropdown-divider"></div>
          <button class="dropdown-item logout-item" id="navLogoutBtn">
            <i class="fas fa-sign-out-alt"></i> Logout
          </button>
        </div>
      </div>
    `;

    // Dropdown toggle logic
    const trigger = document.getElementById('userMenuBtn');
    const dropdown = document.getElementById('userDropdownContent');
    const logoutBtn = document.getElementById('navLogoutBtn');

    if (trigger && dropdown) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');
        dropdown.classList.toggle('show', !isOpen);
        trigger.setAttribute('aria-expanded', String(!isOpen));
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#user-menu-dropdown')) {
          dropdown.classList.remove('show');
          trigger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
      });
    }

    // If user is admin, also add a prominent Admin badge button to the main navbar links
    const navLinks = document.querySelector('.nav-links');
    if (navLinks && isAdmin && !document.getElementById('nav-admin-pill')) {
      const adminPill = document.createElement('a');
      adminPill.id = 'nav-admin-pill';
      adminPill.href = '/admin.html';
      adminPill.className = 'nav-link';
      adminPill.innerHTML = `
        <span style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 4px 10px; border-radius: 8px; font-weight: 700; font-size: 0.825rem; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
          <i class="fas fa-shield-alt"></i> Admin Panel
        </span>
      `;
      navLinks.appendChild(adminPill);
    }
  } else {
    // Unauthenticated view
    navAuth.innerHTML = `
      <a href="/login.html" class="btn btn-outline">Login</a>
      <a href="/login.html#signup" class="btn btn-primary">Sign Up</a>
    `;
  }
}

/**
 * Route protection for authenticated user pages.
 * If user is not logged in, redirects to /login.html.
 */
function requireAuth() {
  if (!isLoggedIn()) {
    showToast('Please log in to access this page', 'warning');
    const current = window.location.pathname + window.location.search;
    sessionStorage.setItem('redirect_after_login', current);
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 400);
    return false;
  }
  return true;
}

/**
 * Route protection for admin-only pages.
 * If user is not logged in or is not an admin, redirects to homepage or login.
 */
function requireAdmin() {
  if (!isLoggedIn()) {
    showToast('Admin login required', 'warning');
    sessionStorage.setItem('redirect_after_login', '/admin.html');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 400);
    return false;
  }

  const user = getUser();
  if (!user || !user.is_admin) {
    showToast('Access denied: Administrator privileges required', 'error');
    setTimeout(() => {
      window.location.href = '/';
    }, 800);
    return false;
  }

  return true;
}

// Auto-initialize navbar on document load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateNavbar);
} else {
  updateNavbar();
}

// Expose utilities on window object for convenience
window.API_BASE = API_BASE;
window.getToken = getToken;
window.getUser = getUser;
window.isLoggedIn = isLoggedIn;
window.logout = logout;
window.authFetch = authFetch;
window.showToast = showToast;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.formatCurrency = formatCurrency;
window.timeAgo = timeAgo;
window.updateNavbar = updateNavbar;
window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
