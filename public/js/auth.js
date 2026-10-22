/**
 * Smart Commute - Authentication JavaScript
 * Handles Login, Registration, Validation, State Management, and UI interactions
 */

// Toast notification helper
function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <div class="toast-message">${message}</div>
        <button class="toast-close" type="button" aria-label="Close">&times;</button>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    const closeBtn = toast.querySelector('.toast-close');
    const removeToast = () => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    };

    closeBtn.addEventListener('click', removeToast);
    setTimeout(removeToast, duration);
}

// Global user state helpers
function getAuthToken() {
    return localStorage.getItem('token');
}

function getCurrentUser() {
    try {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
        return null;
    }
}

function setAuthSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}

function clearAuthSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

function logout() {
    clearAuthSession();
    showToast('Logged out successfully', 'info');
    setTimeout(() => {
        window.location.href = '/login.html';
    }, 500);
}

// Toggle between Login and Signup view
function switchAuthMode(mode) {
    const loginCard = document.getElementById('login-view');
    const signupCard = document.getElementById('signup-view');
    const pageTitle = document.getElementById('auth-page-title');

    if (!loginCard || !signupCard) return;

    if (mode === 'signup') {
        loginCard.style.display = 'none';
        signupCard.style.display = 'block';
        signupCard.classList.add('fade-in');
        if (pageTitle) pageTitle.textContent = 'Sign Up - Smart Commute';
        window.history.replaceState(null, '', '#signup');
    } else {
        signupCard.style.display = 'none';
        loginCard.style.display = 'block';
        loginCard.classList.add('fade-in');
        if (pageTitle) pageTitle.textContent = 'Login - Smart Commute';
        window.history.replaceState(null, '', '#login');
    }
}

// Password toggle eye handler
function setupPasswordToggles() {
    const toggleButtons = document.querySelectorAll('.toggle-password');
    toggleButtons.forEach(button => {
        button.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;

            const icon = this.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                if (icon) {
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                }
            } else {
                input.type = 'password';
                if (icon) {
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            }
        });
    });
}

// Validation helpers
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

function isValidMobile(mobile) {
    const re = /^[6-9]\d{9}$/;
    return re.test(String(mobile).trim());
}

// Submit button loading state helper
function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
    if (!button) return;
    if (isLoading) {
        button.setAttribute('data-original-html', button.innerHTML);
        button.disabled = true;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
    } else {
        button.disabled = false;
        button.innerHTML = button.getAttribute('data-original-html') || 'Submit';
    }
}

// Initialize Auth Page Handlers
document.addEventListener('DOMContentLoaded', () => {
    // Check if logout was requested via query param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'logout') {
        clearAuthSession();
        showToast('You have been logged out', 'info');
    }

    // Only auto-redirect if an explicit redirect target is requested (e.g. from protected page)
    const isAuthPage = window.location.pathname.endsWith('login.html');
    const token = getAuthToken();
    const user = getCurrentUser();

    if (isAuthPage && token && user && urlParams.get('redirect') && urlParams.get('action') !== 'logout') {
        const redirectUrl = urlParams.get('redirect');
        showToast(`Welcome back, ${user.name}! Redirecting...`, 'info', 1000);
        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 800);
        return;
    }

    // Set view based on URL hash (Default to signup matching Screenshot 1 & 4)
    if (window.location.hash === '#login') {
        switchAuthMode('login');
    } else {
        switchAuthMode('signup');
    }

    // Listen to hashchange
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#login') {
            switchAuthMode('login');
        } else {
            switchAuthMode('signup');
        }
    });

    // View switch buttons
    const goToSignupBtns = document.querySelectorAll('.go-to-signup');
    goToSignupBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthMode('signup');
        });
    });

    const goToLoginBtns = document.querySelectorAll('.go-to-login');
    goToLoginBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthMode('login');
        });
    });

    // Setup password toggle buttons
    setupPasswordToggles();

    // Setup Login Form submission
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById('loginEmail');
            const passwordInput = document.getElementById('loginPassword');
            const submitBtn = document.getElementById('loginSubmitBtn');

            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            const genderRadio = document.querySelector('input[name="loginGender"]:checked');
            const gender = genderRadio ? genderRadio.value : '';

            // Validation
            if (!email) {
                showToast('Please enter your email address', 'error');
                emailInput?.focus();
                return;
            }
            if (!isValidEmail(email)) {
                showToast('Please enter a valid email address', 'error');
                emailInput?.focus();
                return;
            }
            if (!password) {
                showToast('Please enter your password', 'error');
                passwordInput?.focus();
                return;
            }
            if (!gender) {
                showToast('Please select your gender before logging in', 'error');
                return;
            }

            setButtonLoading(submitBtn, true, 'Signing in...');

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, gender })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || data.error || 'Login failed. Please check credentials.');
                }

                if (data.token && data.user) {
                    setAuthSession(data.token, data.user);
                    showToast(`Welcome back, ${data.user.name}!`, 'success');

                    const rememberMe = document.getElementById('rememberMe');
                    if (rememberMe && rememberMe.checked) {
                        localStorage.setItem('savedEmail', email);
                        localStorage.setItem('savedGender', gender);
                    } else {
                        localStorage.removeItem('savedEmail');
                        localStorage.removeItem('savedGender');
                    }

                    const targetRedirect = urlParams.get('redirect') || (data.user.is_admin ? '/admin.html' : '/dashboard.html');
                    setTimeout(() => {
                        window.location.href = targetRedirect;
                    }, 1000);
                } else {
                    throw new Error('Invalid response received from server.');
                }
            } catch (err) {
                console.error('Login error:', err);
                showToast(err.message || 'Unable to log in. Please try again.', 'error');
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // Auto-populate remembered email and gender
    const savedEmail = localStorage.getItem('savedEmail');
    if (savedEmail && document.getElementById('loginEmail')) {
        document.getElementById('loginEmail').value = savedEmail;
        const rememberCheckbox = document.getElementById('rememberMe');
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }
    const savedGender = localStorage.getItem('savedGender');
    if (savedGender) {
        const genderInput = document.querySelector(`input[name="loginGender"][value="${savedGender}"]`);
        if (genderInput) genderInput.checked = true;
    }

    // Setup Signup Form submission
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nameInput = document.getElementById('signupName');
            const emailInput = document.getElementById('signupEmail');
            const mobileInput = document.getElementById('signupMobile');
            const ageInput = document.getElementById('signupAge');
            const genderRadio = document.querySelector('input[name="signupGender"]:checked');
            const passwordInput = document.getElementById('signupPassword');
            const confirmPasswordInput = document.getElementById('signupConfirmPassword');
            const termsCheckbox = document.getElementById('signupTerms');
            const submitBtn = document.getElementById('signupSubmitBtn');

            const name = nameInput ? nameInput.value.trim() : '';
            const email = emailInput ? emailInput.value.trim() : '';
            const mobile = mobileInput ? mobileInput.value.trim() : '';
            const age = ageInput ? parseInt(ageInput.value, 10) : 0;
            const gender = genderRadio ? genderRadio.value : '';
            const password = passwordInput ? passwordInput.value : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

            // Form validations
            if (!name || name.length < 2) {
                showToast('Please enter your full name (at least 2 characters)', 'error');
                nameInput?.focus();
                return;
            }

            if (!email || !isValidEmail(email)) {
                showToast('Please enter a valid email address', 'error');
                emailInput?.focus();
                return;
            }

            if (mobile && !isValidMobile(mobile)) {
                showToast('Please enter a valid 10-digit mobile number', 'error');
                mobileInput?.focus();
                return;
            }

            if (!gender) {
                showToast('Please specify your gender', 'error');
                return;
            }

            if (!password || password.length < 6) {
                showToast('Password must be at least 6 characters long', 'error');
                passwordInput?.focus();
                return;
            }

            if (password !== confirmPassword) {
                showToast('Passwords do not match', 'error');
                confirmPasswordInput?.focus();
                return;
            }

            if (termsCheckbox && !termsCheckbox.checked) {
                showToast('Please accept the Terms of Service & Privacy Policy', 'warning');
                return;
            }

            setButtonLoading(submitBtn, true, 'Creating Account...');

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        email,
                        mobile: mobile || `98${Math.floor(10000000 + Math.random() * 90000000)}`,
                        password,
                        gender: gender || 'other',
                        age: age || 21
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || data.error || 'Registration failed.');
                }

                if (data.token && data.user) {
                    setAuthSession(data.token, data.user);
                    showToast('Account created successfully! Welcome to Smart Commute.', 'success');

                    setTimeout(() => {
                        window.location.href = '/dashboard.html';
                    }, 1200);
                } else {
                    // In case response didn't auto-login, switch to login view
                    showToast('Account created! Please log in.', 'success');
                    switchAuthMode('login');
                    if (document.getElementById('loginEmail')) {
                        document.getElementById('loginEmail').value = email;
                    }
                }
            } catch (err) {
                console.error('Signup error:', err);
                showToast(err.message || 'Unable to create account. Please try again.', 'error');
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // Mock social login actions
    const googleBtn = document.getElementById('googleLoginBtn');
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            showToast('Google Sign-In integration is simulated for demo. Please log in with email or click Demo Login.', 'info');
        });
    }

    const githubBtn = document.getElementById('githubLoginBtn');
    if (githubBtn) {
        githubBtn.addEventListener('click', () => {
            showToast('GitHub Sign-In integration is simulated for demo. Please log in with email or click Demo Login.', 'info');
        });
    }

    // Demo Fill Quick Login Buttons
    const demoAdminBtn = document.getElementById('demoAdminBtn');
    if (demoAdminBtn) {
        demoAdminBtn.addEventListener('click', () => {
            if (document.getElementById('loginEmail') && document.getElementById('loginPassword')) {
                document.getElementById('loginEmail').value = 'admin@smartcommute.com';
                document.getElementById('loginPassword').value = 'admin123';
                const g = document.getElementById('loginGenderOther');
                if (g) g.checked = true;
                showToast('Admin credentials filled. Click Login to access Admin Dashboard!', 'info');
            }
        });
    }

    const demoCommuterBtn = document.getElementById('demoCommuterBtn');
    if (demoCommuterBtn) {
        demoCommuterBtn.addEventListener('click', () => {
            if (document.getElementById('loginEmail') && document.getElementById('loginPassword')) {
                document.getElementById('loginEmail').value = 'harshad@example.com';
                document.getElementById('loginPassword').value = 'password123';
                const g = document.getElementById('loginGenderMale');
                if (g) g.checked = true;
                showToast('Commuter credentials & gender filled. Click Login to proceed!', 'info');
            }
        });
    }

    const demoDriverBtn = document.getElementById('demoDriverBtn');
    if (demoDriverBtn) {
        demoDriverBtn.addEventListener('click', () => {
            if (document.getElementById('loginEmail') && document.getElementById('loginPassword')) {
                document.getElementById('loginEmail').value = 'sneha@example.com';
                document.getElementById('loginPassword').value = 'password123';
                const g = document.getElementById('loginGenderFemale');
                if (g) g.checked = true;
                showToast('Driver credentials & gender filled. Click Login to proceed!', 'info');
            }
        });
    }
});

// Export helper for other scripts
window.AuthHelper = {
    getToken: getAuthToken,
    getUser: getCurrentUser,
    setSession: setAuthSession,
    clearSession: clearAuthSession,
    logout: logout,
    showToast: showToast
};
