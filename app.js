import { isConfigured, onAuthStateChanged, signOut, auth, db, collection, query, where, onSnapshot, doc, applyActionCode, checkActionCode, isSignInWithEmailLink, signInWithEmailLink } from './js/firebase.js';
import { getUnreadNotifications, markNotificationsAsRead, getRequestCount, getUserProfile, saveUserProfile, generateUserDocId, getUserChats, hasUnreadMessagesInChat, initNotificationSystem, subscribeToListings, subscribeToUserProfile, markPendingVerificationVerified } from './js/db.js';
import { renderLogin, renderRegister } from './js/auth.js';
import { renderHome } from './js/home.js';
import { showAddListingModal } from './js/add.js';
import { renderProfile } from './js/profile.js';
import { renderItemDetail } from './js/item.js';
import { renderRequests } from './js/requests.js';
import { renderMessages } from './js/messages.js';
import { triggerNotificationPermission, renderFloatingPermissionBanner, hideFloatingPermissionBanner, getAndSaveFCMToken, requestNotificationPermission, setupRealtimeChatNotificationTrigger, detachRealtimeChatNotifications } from './js/notifications.js';
import { isUserVerified, showVerificationRequiredPrompt, showEmailVerificationModal, markUserAsVerified } from './js/verification.js';

// Global render state
let currentUser = null;
let isAuthReady = false;

// 1. DETECT AND PROCESS OOB ACTION CODES ON PAGE LOAD
export async function processAuthActionCodesOnLoad() {
    try {
        const currentUrl = window.location.href;
        const parsedUrl = new URL(currentUrl);
        let mode = parsedUrl.searchParams.get('mode');
        let oobCode = parsedUrl.searchParams.get('oobCode');
        let apiKey = parsedUrl.searchParams.get('apiKey');

        // Check hash parameters if query was appended after #
        if (!oobCode && window.location.hash.includes('oobCode')) {
            const hashParts = window.location.hash.split('?');
            if (hashParts[1]) {
                const hashParams = new URLSearchParams(hashParts[1]);
                mode = mode || hashParams.get('mode');
                oobCode = oobCode || hashParams.get('oobCode');
                apiKey = apiKey || hashParams.get('apiKey');
            }
        }

        const isEmailLink = auth && typeof isSignInWithEmailLink === 'function' && isSignInWithEmailLink(auth, currentUrl);
        const isActionCodeMode = mode === 'verifyEmail' || mode === 'signIn';

        if ((isEmailLink || isActionCodeMode) && oobCode) {
            console.log('[Firebase Auth] OOB Action Code detected. Mode:', mode, 'oobCode:', oobCode);
            let verifiedEmail = parsedUrl.searchParams.get('email') || parsedUrl.searchParams.get('verified_email');

            // Resolve email from action code if not in URL parameters
            if (!verifiedEmail && typeof checkActionCode === 'function') {
                try {
                    const info = await checkActionCode(auth, oobCode);
                    if (info?.data?.email) {
                        verifiedEmail = info.data.email;
                    }
                } catch (e) {}
            }

            // Execute applyActionCode(oobCode)
            try {
                if (typeof applyActionCode === 'function') {
                    await applyActionCode(auth, oobCode);
                    console.log('[Firebase Auth] applyActionCode succeeded for:', oobCode);
                }
            } catch (err) {
                console.warn('[Firebase Auth] applyActionCode notice:', err);
            }

            // Force reload current user
            if (auth && auth.currentUser) {
                try {
                    await auth.currentUser.reload();
                } catch (e) {}
            }

            // Save verified status
            localStorage.setItem('emailVerifiedStatus', 'true');
            if (verifiedEmail) {
                const clean = verifiedEmail.trim().toLowerCase();
                localStorage.setItem('email_link_verified_' + clean, 'true');
                localStorage.setItem('email_link_verified_latest', clean);
                localStorage.setItem('email_link_verified_time', Date.now().toString());
            }

            // Cross-Device Real-Time Sync: Update pendingVerifications/{email} to status: 'verified' in Firestore
            const targetVerifiedEmail = verifiedEmail || auth?.currentUser?.email || localStorage.getItem('pending_verification_email') || sessionStorage.getItem('pending_verification_email');
            if (targetVerifiedEmail) {
                try {
                    await markPendingVerificationVerified(targetVerifiedEmail);
                    console.log('[Cross-Device Sync] Firestore pendingVerifications marked verified for:', targetVerifiedEmail);
                } catch (syncErr) {
                    console.warn('[Cross-Device Sync] markPendingVerificationVerified note:', syncErr);
                }
            }

            // Cross-tab broadcast & local window event
            try {
                const bc = new BroadcastChannel('student_shelf_verification');
                bc.postMessage({ type: 'EMAIL_VERIFIED', email: verifiedEmail || '' });
            } catch (e) {}
            window.dispatchEvent(new CustomEvent('student_shelf_email_verified', { detail: { email: verifiedEmail } }));

            // Clean up URL parameters dynamically using replaceState without reloading the page
            try {
                const cleanUrl = window.location.pathname + (window.location.hash ? window.location.hash.split('?')[0] : '');
                window.history.replaceState({}, document.title, cleanUrl || window.location.pathname);
            } catch (e) {}

            return { success: true, email: verifiedEmail };
        } else if (parsedUrl.searchParams.get('email_verified') === 'true') {
            const verifiedEmail = parsedUrl.searchParams.get('email') || parsedUrl.searchParams.get('verified_email');
            localStorage.setItem('emailVerifiedStatus', 'true');
            if (verifiedEmail) {
                const clean = verifiedEmail.trim().toLowerCase();
                localStorage.setItem('email_link_verified_' + clean, 'true');
                localStorage.setItem('email_link_verified_latest', clean);
                localStorage.setItem('email_link_verified_time', Date.now().toString());
            }

            // Cross-Device Real-Time Sync: Update pendingVerifications/{email} to status: 'verified' in Firestore
            const targetVerifiedEmail = verifiedEmail || auth?.currentUser?.email || localStorage.getItem('pending_verification_email') || sessionStorage.getItem('pending_verification_email');
            if (targetVerifiedEmail) {
                try {
                    await markPendingVerificationVerified(targetVerifiedEmail);
                    console.log('[Cross-Device Sync] Firestore pendingVerifications marked verified for:', targetVerifiedEmail);
                } catch (syncErr) {
                    console.warn('[Cross-Device Sync] markPendingVerificationVerified note:', syncErr);
                }
            }

            try {
                const bc = new BroadcastChannel('student_shelf_verification');
                bc.postMessage({ type: 'EMAIL_VERIFIED', email: verifiedEmail || '' });
            } catch (e) {}
            window.dispatchEvent(new CustomEvent('student_shelf_email_verified', { detail: { email: verifiedEmail } }));

            try {
                const cleanUrl = window.location.pathname + (window.location.hash ? window.location.hash.split('?')[0] : '');
                window.history.replaceState({}, document.title, cleanUrl || window.location.pathname);
            } catch (e) {}

            return { success: true, email: verifiedEmail };
        }
    } catch (e) {
        console.warn('[Firebase Auth] Action code processing note:', e);
    }
    return null;
}

// Execute immediately on script load
processAuthActionCodesOnLoad();

// 2. AUTO-RELOAD ON TAB FOCUS
window.addEventListener('focus', async () => {
    if (auth && auth.currentUser) {
        try {
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
                localStorage.setItem('emailVerifiedStatus', 'true');
                const clean = (auth.currentUser.email || '').trim().toLowerCase();
                if (clean) {
                    localStorage.setItem('email_link_verified_' + clean, 'true');
                    localStorage.setItem('email_link_verified_latest', clean);
                }
                try {
                    const bc = new BroadcastChannel('student_shelf_verification');
                    bc.postMessage({ type: 'EMAIL_VERIFIED', email: clean });
                } catch (e) {}
                window.dispatchEvent(new CustomEvent('student_shelf_email_verified', { detail: { email: clean } }));
            }
        } catch (e) {}
    }
});

// Central profile state listener function
export function updateHeaderUserProfile(userData) {
    const headerNameElement = document.querySelector('.user-profile-name, #header-user-name, [data-user-name]');
    const headerAvatarElement = document.querySelector('.user-profile-avatar, #header-user-avatar');
    
    const displayName = userData?.name || userData?.displayName || userData?.fullName || 'User';
    
    if (headerNameElement) {
        headerNameElement.textContent = displayName;
    }
    
    const photoURL = userData?.photoURL || userData?.avatarUrl || userData?.photoUrl;
    if (headerAvatarElement && photoURL) {
        headerAvatarElement.src = photoURL;
    }

    // Synchronize all header and dropdown profile elements
    const allNameElements = document.querySelectorAll('.user-profile-name, #header-user-name, [data-user-name], #widget-name, #dropdown-user-name');
    allNameElements.forEach(el => {
        el.textContent = displayName;
    });

    if (photoURL) {
        const allAvatarElements = document.querySelectorAll('.user-profile-avatar, #header-user-avatar, #widget-avatar, #dropdown-avatar-img');
        allAvatarElements.forEach(el => {
            el.src = photoURL;
        });
    }

    if (userData?.email) {
        const dropdownEmail = document.getElementById('dropdown-user-email');
        if (dropdownEmail) dropdownEmail.textContent = userData.email;
    }

    // Synchronize to LocalStorage state
    try {
        const currentProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');
        const updatedProfile = { ...currentProfile, ...userData, name: displayName, displayName, fullName: displayName };
        localStorage.setItem('user_profile', JSON.stringify(updatedProfile));
    } catch (e) {
        console.warn("Could not sync user profile to localStorage:", e);
    }
}
window.updateHeaderUserProfile = updateHeaderUserProfile;

// =====================================================
// AUTH MODAL LOGIC & GLOBAL EVENT DELEGATION
// =====================================================
function ensureAuthFormsMounted() {
    const loginMount = document.getElementById('auth-modal-login-mount');
    const signupMount = document.getElementById('auth-modal-signup-mount');
    if (loginMount && (!loginMount.hasChildNodes() || loginMount.children.length === 0)) {
        renderLogin(loginMount);
        const backBtn = loginMount.querySelector('.back-arrow');
        if (backBtn) backBtn.style.display = 'none';
    }
    if (signupMount && (!signupMount.hasChildNodes() || signupMount.children.length === 0)) {
        renderRegister(signupMount);
        const backBtn = signupMount.querySelector('.back-arrow');
        if (backBtn) backBtn.style.display = 'none';
    }
}

export function openAuthModal(tab = 'login') {
    const modalOverlay = document.querySelector('#auth-modal, .auth-modal-overlay');
    if (modalOverlay) {
        ensureAuthFormsMounted();
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('active');
        modalOverlay.style.setProperty('display', 'flex', 'important');
        
        // Toggle Login vs Sign Up tab view inside modal
        const loginTabBtn = modalOverlay.querySelector('#tab-login-btn');
        const signupTabBtn = modalOverlay.querySelector('#tab-signup-btn');
        if (tab === 'login' && loginTabBtn) loginTabBtn.click();
        if (tab === 'signup' && signupTabBtn) signupTabBtn.click();
    }
}
window.openAuthModal = openAuthModal;

export function closeAuthModal() {
    const modalOverlay = document.querySelector('#auth-modal, .auth-modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.add('hidden');
        modalOverlay.classList.remove('active');
        modalOverlay.style.setProperty('display', 'none', 'important');
    }
}
window.closeAuthModal = closeAuthModal;

// Global/root event delegation listener for Login and Sign Up triggers
document.addEventListener('click', function(e) {
    // Close modal action (close button or click outside modal container)
    const closeTrigger = e.target.closest('.close-auth-modal, #close-auth-modal');
    if (closeTrigger) {
        e.preventDefault();
        closeAuthModal();
        return;
    }

    const modalOverlay = document.querySelector('#auth-modal, .auth-modal-overlay');
    if (modalOverlay && e.target === modalOverlay) {
        e.preventDefault();
        closeAuthModal();
        return;
    }

    // Modal tabs switching
    const tabLoginBtn = e.target.closest('#tab-login-btn');
    const tabSignupBtn = e.target.closest('#tab-signup-btn');
    if (tabLoginBtn) {
        e.preventDefault();
        const loginPane = document.getElementById('auth-tab-login-pane');
        const signupPane = document.getElementById('auth-tab-signup-pane');
        const otherTab = document.getElementById('tab-signup-btn');
        if (loginPane) loginPane.style.display = 'block';
        if (signupPane) signupPane.style.display = 'none';
        tabLoginBtn.classList.add('active');
        if (otherTab) otherTab.classList.remove('active');
        return;
    }
    if (tabSignupBtn) {
        e.preventDefault();
        const loginPane = document.getElementById('auth-tab-login-pane');
        const signupPane = document.getElementById('auth-tab-signup-pane');
        const otherTab = document.getElementById('tab-login-btn');
        if (signupPane) signupPane.style.display = 'block';
        if (loginPane) loginPane.style.display = 'none';
        tabSignupBtn.classList.add('active');
        if (otherTab) otherTab.classList.remove('active');
        return;
    }

    // Tab switch links inside forms (e.g. "Sign Up" or "Login" text links)
    const modalSignupLink = e.target.closest('#auth-modal a[href="#/register"]');
    const modalLoginLink = e.target.closest('#auth-modal a[href="#/login"]');
    if (modalSignupLink) {
        e.preventDefault();
        openAuthModal('signup');
        return;
    }
    if (modalLoginLink) {
        e.preventDefault();
        openAuthModal('login');
        return;
    }

    // Login and Sign Up triggers
    const loginTrigger = e.target.closest('#login-btn, .login-btn, [data-action="login"]');
    const signupTrigger = e.target.closest('#signup-btn, .signup-btn, [data-action="signup"]');
    
    if (loginTrigger && !loginTrigger.closest('form')) {
        e.preventDefault();
        openAuthModal('login');
    } else if (signupTrigger && !signupTrigger.closest('form')) {
        e.preventDefault();
        openAuthModal('signup');
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeAuthModal();
    }
});

export function showLogoutToast(message = "Successfully logged out") {
    const existing = document.getElementById('logout-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'logout-toast';
    toast.className = 'logout-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
        <div class="logout-toast-icon">
            <i class="fa-solid fa-circle-check"></i>
        </div>
        <div class="logout-toast-content">
            <span class="logout-toast-title">${message}</span>
            <span class="logout-toast-desc">You have been signed out.</span>
        </div>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.add('show');
        }, 30);
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

export async function performLogout() {
    try {
        await signOut(auth);
    } catch (err) {
        console.warn("Firebase signOut error (proceeding with local session cleanup):", err);
    }

    // Clear active session data in localStorage and sessionStorage
    localStorage.removeItem('user_profile');
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authUser');
    localStorage.removeItem('wishlist');
    localStorage.removeItem('lastSeenRequestCount');
    try {
        sessionStorage.clear();
    } catch (e) {
        console.warn("Could not clear sessionStorage:", e);
    }

    // Close any open menus/dropdowns
    const dropdown = document.getElementById('profile-dropdown-menu');
    if (dropdown) dropdown.classList.add('hidden');
    if (window.appInstance && typeof window.appInstance.closeSidebar === 'function') {
        window.appInstance.closeSidebar();
    }

    // Redirect user back to Home/Marketplace view with unauthenticated state
    window.location.hash = '#/';

    // Show brief confirmation toast
    showLogoutToast("Successfully logged out");
}

window.performLogout = performLogout;
window.showLogoutToast = showLogoutToast;

class AppRouter {
    constructor() {
        window.appInstance = this;
        this.appDiv = document.getElementById('main-content');
        this.navLinks = document.getElementById('nav-links');
        this.sidebarLinks = document.getElementById('sidebar-links');
        this.sidebar = document.getElementById('mobile-sidebar');
        this.overlay = document.getElementById('sidebar-overlay');
        this.authUnsubscribe = null;
        this.profileUnsubscribe = null;
        this.unreadListeners = [];

        // Global listener for dynamic profile sync events
        window.addEventListener('user-profile-updated', (event) => {
            if (event.detail) {
                updateHeaderUserProfile(event.detail);
            }
        });

        this.init();
    }
    
    init() {
        if (!isConfigured) {
            this.showMissingConfig();
            this.hidePreloader();
            return;
        }
        
        this.authUnsubscribe = onAuthStateChanged(auth, async (user) => {
            try {
                currentUser = user;
                isAuthReady = true;
                this.renderNav();
                
                if (user) {
                    closeAuthModal();
                    if (user.emailVerified) {
                        markUserAsVerified(user).catch(() => {});
                        const cleanUserEmail = user.email ? user.email.trim().toLowerCase() : '';
                        if (cleanUserEmail) {
                            localStorage.setItem('email_link_verified_' + cleanUserEmail, 'true');
                            try {
                                const bc = new BroadcastChannel('student_shelf_verification');
                                bc.postMessage({ type: 'EMAIL_VERIFIED', email: cleanUserEmail });
                            } catch (e) {}
                        }
                    }
                    // Detach any previous real-time profile listener
                    if (this.profileUnsubscribe) {
                        this.profileUnsubscribe();
                        this.profileUnsubscribe = null;
                    }

                    // 1. Initial immediate header render from cached localStorage or auth user
                    const cachedProfile = JSON.parse(localStorage.getItem('user_profile') || 'null');
                    if (cachedProfile && (cachedProfile.name || cachedProfile.displayName || cachedProfile.fullName)) {
                        updateHeaderUserProfile(cachedProfile);
                    } else {
                        const fallbackName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
                        updateHeaderUserProfile({
                            name: fallbackName,
                            displayName: fallbackName,
                            photoURL: user.photoURL,
                            email: user.email
                        });
                    }

                    const dropdownAuthActions = document.getElementById('dropdown-auth-actions');
                    if (dropdownAuthActions) {
                        dropdownAuthActions.innerHTML = `
                            <button id="logout-btn" class="user-dropdown-item logout-trigger text-danger" style="width:100%; text-align:left; background:none; border:none; cursor:pointer; color: #EF4444 !important;">
                                <i class="fa-solid fa-arrow-right-from-bracket" style="color: #EF4444 !important;"></i> Logout
                            </button>
                        `;
                    }

                    await this.ensureProfile(user);
                    initNotificationSystem();
                    if (window.Notification && (Notification.permission === 'granted' || localStorage.getItem('notificationPermissionState') === 'granted')) {
                        getAndSaveFCMToken(user.uid);
                    } else {
                        renderFloatingPermissionBanner();
                    }
                    setupRealtimeChatNotificationTrigger(user.uid, user.displayName || (user.email ? user.email.split('@')[0] : 'User'));

                    // 2. Attach real-time database profile observer
                    this.profileUnsubscribe = subscribeToUserProfile(user.uid, (profileData) => {
                        if (profileData) {
                            updateHeaderUserProfile(profileData);
                        }
                    });
                } else {
                    detachRealtimeChatNotifications();
                    if (this.profileUnsubscribe) {
                        this.profileUnsubscribe();
                        this.profileUnsubscribe = null;
                    }
                    localStorage.removeItem('user_profile');

                    const widgetName = document.getElementById('widget-name');
                    const widgetAvatar = document.getElementById('widget-avatar');
                    const dropdownAvatar = document.getElementById('dropdown-avatar-img');
                    const dropdownName = document.getElementById('dropdown-user-name');
                    const dropdownEmail = document.getElementById('dropdown-user-email');
                    const dropdownAuthActions = document.getElementById('dropdown-auth-actions');

                    const guestImg = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&h=100&q=80';
                    if (widgetName) widgetName.textContent = 'Guest';
                    if (widgetAvatar) widgetAvatar.src = guestImg;
                    if (dropdownAvatar) dropdownAvatar.src = guestImg;
                    if (dropdownName) dropdownName.textContent = 'Guest User';
                    if (dropdownEmail) dropdownEmail.textContent = 'Pragati Engineering College';
                    if (dropdownAuthActions) {
                        dropdownAuthActions.innerHTML = `
                            <a href="#/login" class="user-dropdown-item" id="login-btn"><i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In</a>
                            <a href="#/register" class="user-dropdown-item text-primary" id="signup-btn" style="font-weight:600;"><i class="fa-solid fa-user-plus"></i> Create Account</a>
                        `;
                    }
                }
                
                this.handleRoute(); // re-render page on auth state change
                this.updateRequestBadge(); // Update badge on auth state
                this.updateMessagesBadge(); // Update messages badge on auth state
                this.closeSidebar(); // Ensure sidebar closes on auth change
            } catch (err) {
                console.error("Error inside onAuthStateChanged handler:", err);
            } finally {
                // Hide Pre-loader faster now that we have layout pre-rendered
                this.hidePreloader();
                renderFloatingPermissionBanner();
            }
        });

        // Global shortcut (⌘K or Ctrl+K) to focus search
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                const globalSearch = document.getElementById('global-search-input');
                if (globalSearch) {
                    globalSearch.focus();
                    globalSearch.select();
                }
            }
        });

        // Sync header global search input with home search input or route to home
        document.addEventListener('input', (e) => {
            if (e.target.id === 'global-search-input') {
                const homeSearch = document.getElementById('search-input');
                if (homeSearch) {
                    homeSearch.value = e.target.value;
                    homeSearch.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.target.id === 'global-search-input' && e.key === 'Enter') {
                const currentHash = window.location.hash || '#/';
                if (!currentHash.startsWith('#/')) {
                    window.location.hash = '#/';
                }
                const searchBtn = document.getElementById('search-btn');
                if (searchBtn) searchBtn.click();
            }
        });

        // JAVASCRIPT CLICK LISTENER REPAIR for Profile Dropdown
        const profileBtn = document.querySelector('.user-profile-btn, #user-profile-menu, [data-profile-trigger]');
        const profileDropdown = document.getElementById('profile-dropdown-menu');

        if (profileBtn && profileDropdown) {
            profileBtn.style.cursor = 'pointer';
            profileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close notifications dropdown if open
                const notifDrop = document.getElementById('notifications-dropdown') || document.getElementById('notif-dropdown');
                if (notifDrop) notifDrop.classList.remove('active');
                profileDropdown.classList.toggle('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
                    profileDropdown.classList.add('hidden');
                }
            });

            // Close when clicking an item inside dropdown
            profileDropdown.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('button')) {
                    profileDropdown.classList.add('hidden');
                }
            });
        }

        // Global delegated listener for profile triggers as fallback
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.user-profile-btn, #user-profile-menu, [data-profile-trigger]');
            if (btn && !e.defaultPrevented) {
                e.stopPropagation();
                const dropdown = document.getElementById('profile-dropdown-menu');
                if (dropdown) {
                    dropdown.classList.toggle('hidden');
                }
            }
        });

        // Global delegated logout listener
        document.addEventListener('click', (e) => {
            const logoutBtn = e.target.closest('#dropdown-logout-btn, #logout-btn, .logout-trigger, .logout-btn, .profile-logout-btn, #profile-header-logout-btn, #settings-logout-btn');
            if (logoutBtn) {
                e.preventDefault();
                e.stopPropagation();
                performLogout();
            }
        });
        
        window.addEventListener('hashchange', () => this.handleRoute());
        window.addEventListener('messages-read-update', () => this.updateMessagesBadge());
        
        // initial route
        if(!window.location.hash) window.location.hash = '#/';
        this.handleRoute();

        // Ensure loading screen is removed even if Firebase query fails or hangs
        setTimeout(() => {
            const loader = document.querySelector('#loading-screen, #spinner, .loader, .loading-overlay, #pre-loader, .pre-loader, .app-loader');
            if (loader) {
                loader.style.setProperty('display', 'none', 'important');
                loader.style.setProperty('opacity', '0', 'important');
                loader.style.setProperty('visibility', 'hidden', 'important');
                loader.style.setProperty('pointer-events', 'none', 'important');
            }
            const app = document.querySelector('#app, #dashboard, .main-wrapper, .dashboard-container, .dashboard-layout');
            if (app) {
                app.style.setProperty('display', 'grid', 'important');
                app.style.setProperty('visibility', 'visible', 'important');
                app.style.setProperty('opacity', '1', 'important');
            }
        }, 500);

        // Safety Timeout: If auth takes too long, hide preloader anyway to show layout
        setTimeout(() => this.hidePreloader(), 2000);
    }
    
    hidePreloader() {
        const loaders = [
            document.getElementById('pre-loader'),
            document.getElementById('loading-spinner'),
            document.getElementById('loading-screen'),
            document.getElementById('spinner'),
            document.querySelector('.loader'),
            document.querySelector('.pre-loader'),
            document.querySelector('.loading-overlay'),
            document.querySelector('.app-loader')
        ];
        loaders.forEach(loader => {
            if (loader) {
                loader.style.setProperty('display', 'none', 'important');
                loader.style.setProperty('opacity', '0', 'important');
                loader.style.setProperty('visibility', 'hidden', 'important');
                loader.style.setProperty('pointer-events', 'none', 'important');
                loader.classList.add('hidden');
            }
        });

        // Ensure the main layout grid (.dashboard-container, #app-content, .dashboard-layout, #app) becomes visible immediately after the auth state resolves.
        const grids = [
            document.querySelector('.dashboard-container'),
            document.querySelector('.dashboard-layout'),
            document.getElementById('dashboard'),
            document.querySelector('.main-wrapper')
        ];
        grids.forEach(grid => {
            if (grid) {
                grid.style.setProperty('display', 'grid', 'important');
                grid.style.setProperty('visibility', 'visible', 'important');
                grid.style.setProperty('opacity', '1', 'important');
            }
        });
        const contents = [
            document.getElementById('app-content'),
            document.getElementById('app'),
            document.getElementById('main-content')
        ];
        contents.forEach(content => {
            if (content) {
                if (content.style.display === 'none') {
                    content.style.setProperty('display', 'block', 'important');
                }
                content.style.setProperty('visibility', 'visible', 'important');
                content.style.setProperty('opacity', '1', 'important');
            }
        });
    }
    
    showMissingConfig() {
        this.appDiv.innerHTML = `
            <div class="auth-card shadow-card mt-5 text-center" style="max-width: 600px; margin: 50px auto;">
                <h2><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-color)"></i> Firebase Setup Required</h2>
                <p class="mt-3">Please open <code>js/firebase.js</code> and add your actual Firebase configuration.</p>
            </div>
        `;
    }
    
    renderNav() {
        const topNavbar = document.getElementById('top-navbar');
        const guestElements = document.querySelectorAll('#nav-guest-actions, .auth-guest-group, #login-btn, .login-btn, #signup-btn, .signup-btn, #guest-signin-btn, #guest-saved-btn');
        const authElements = document.querySelectorAll('#nav-auth-actions, .nav-auth-actions, #user-profile-menu, #nav-saved-btn-auth, .notif-wrapper');
        const topNavbarTier2 = document.getElementById('top-navbar-tier2');
        const searchKbdBadge = document.getElementById('search-kbd-badge');

        if (currentUser) {
            if (topNavbar) {
                topNavbar.classList.remove('is-guest');
                topNavbar.classList.add('is-authenticated');
            }
            guestElements.forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
            authElements.forEach(el => {
                el.style.setProperty('display', 'flex', 'important');
            });
            if (topNavbarTier2) topNavbarTier2.style.setProperty('display', 'flex', 'important');
            if (searchKbdBadge) searchKbdBadge.style.setProperty('display', 'inline-flex', 'important');
        } else {
            if (topNavbar) {
                topNavbar.classList.remove('is-authenticated');
                topNavbar.classList.add('is-guest');
            }
            guestElements.forEach(el => {
                el.style.setProperty('display', 'inline-flex', 'important');
            });
            authElements.forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
            if (topNavbarTier2) topNavbarTier2.style.setProperty('display', 'flex', 'important');
            if (searchKbdBadge) searchKbdBadge.style.setProperty('display', 'none', 'important');
        }

        const getDesktopHtml = () => `
            <a href="#/" class="nav-tab">
                <i class="fa-solid fa-store"></i> Marketplace
            </a>
            <button type="button" class="nav-tab nav-tab-add add-listing-trigger">
                <i class="fa-solid fa-plus-circle"></i> Add Listing
            </button>
            <a href="#/messages" class="nav-tab nav-rel">
                <i class="fa-regular fa-message"></i> Messages
                <span class="notification-badge" style="display:none;"></span>
            </a>
            <a href="#/requests" class="nav-tab nav-rel">
                <i class="fa-solid fa-bullhorn"></i> Requests
                <span id="req-badge" class="nav-badge" style="display:none;">0</span>
            </a>
        `;

        const getMobileHtml = () => currentUser ? `
            <a href="#/" class="nav-item">
                <i class="fa-solid fa-store"></i> Marketplace
            </a>
            <button type="button" class="nav-item btn-transparent add-listing-trigger" style="background:none; border:none; cursor:pointer; width:100%; text-align:left; display:flex; align-items:center; font-family:inherit;">
                <i class="fa-solid fa-plus-circle"></i> Add Listing
            </button>
            <a href="#/messages" class="nav-item nav-rel">
                <i class="fa-regular fa-message"></i> Messages
                <span class="notification-badge" style="display:none;"></span>
            </a>
            <a href="#/requests" class="nav-item nav-rel">
                <i class="fa-solid fa-bullhorn"></i> Requests
                <span id="req-badge" class="nav-badge" style="display:none;">0</span>
            </a>
            <a href="#/profile" class="nav-item">
                <i class="fa-regular fa-circle-user"></i> Profile
            </a>
            <a href="#/profile?tab=saved" class="nav-item">
                <i class="fa-regular fa-bookmark"></i> Cart / Saved
            </a>
            <a href="#/profile?tab=settings" class="nav-item">
                <i class="fa-solid fa-gear"></i> Settings
            </a>
            <button id="logout-btn" type="button" class="nav-item btn-transparent logout-trigger" style="background:none; border:none; cursor:pointer; width:100%; text-align:left; display:flex; align-items:center; font-family:inherit; color: var(--danger) !important; margin-top: auto;">
                <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
            </button>
        ` : `
            <a href="#/" class="nav-item">
                <i class="fa-solid fa-store"></i> Marketplace
            </a>
            <a href="#/login?redirect=%23%2Fprofile%3Ftab%3Dsaved" class="nav-item">
                <i class="fa-regular fa-bookmark"></i> Cart / Saved
            </a>
            <a href="#/login" class="nav-item login-btn" id="mobile-login-btn" data-action="login">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> Login / Sign In
            </a>
            <a href="#/register" class="btn btn-accent border-0 signup-btn" id="mobile-signup-btn" data-action="signup" style="padding: 10px 18px; border-radius: 9999px; font-size: 13.5px; font-weight: 600; text-align: center; margin-top: 10px; background: #00ABE4; color: #FFFFFF; display: block; text-decoration: none;">
                <i class="fa-solid fa-user-plus"></i> Create Account
            </a>
        `;
 
        // Update Desktop Tier 2 Nav Links
        if (this.navLinks) this.navLinks.innerHTML = getDesktopHtml();
        
        // Update Mobile Sidebar
        if (this.sidebarLinks) this.sidebarLinks.innerHTML = getMobileHtml();

        // Logout Listeners
        const logoutButtons = document.querySelectorAll('.logout-trigger, .profile-logout-btn, #logout-btn');
        logoutButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                performLogout();
            });
        });

        // Add Listing Modal Trigger
        const addTriggers = document.querySelectorAll('.add-listing-trigger');
        addTriggers.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!currentUser) {
                    if (typeof window.openAuthModal === 'function') {
                        window.openAuthModal('login');
                    } else {
                        window.location.hash = '#/login';
                    }
                    return;
                }
                if (!isUserVerified(currentUser)) {
                    showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
                    return;
                }
                showAddListingModal();
                this.closeSidebar();
            });
        });
    }
    
    handleRoute() {
        if (!isConfigured) return;
        if (!isAuthReady) return; // Wait for auth to resolve
        
        this.updateActiveLink();
        this.updateMessagesBadge(); // Update badge on navigation to ensure fresh state
 
        const hash = window.location.hash || '#/';
        const route = hash.split('?')[0];
        
        switch(route) {
            case '#/':
                this.showHome();
                break;
            case '#/requests':
                this.showRequests();
                break;
            case '#/messages':
                if (!currentUser) {
                    alert('Please sign in to view messages.');
                    return window.location.hash = '#/login?redirect=%23%2Fmessages';
                }
                if (!isUserVerified(currentUser)) {
                    showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
                    return window.location.hash = '#/';
                }
                renderMessages(this.appDiv);
                break;
            case '#/login':
                if (currentUser) return window.location.hash = '#/';
                renderLogin(this.appDiv);
                break;
            case '#/register':
                if (currentUser) return window.location.hash = '#/';
                renderRegister(this.appDiv);
                break;
            case '#/add':
                if (!currentUser) {
                    if (typeof window.openAuthModal === 'function') {
                        window.openAuthModal('login');
                    } else {
                        window.location.hash = '#/login';
                    }
                    return;
                }
                if (!isUserVerified(currentUser)) {
                    showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
                    return window.location.hash = '#/';
                }
                // Redirect legacy hash to home and show modal
                window.location.hash = '#/';
                showAddListingModal();
                break;
            case '#/profile':
                if (!currentUser) {
                    alert('Please sign in to access your profile.');
                    return window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
                }
                this.showProfile();
                break;
            case '#/saved':
                if (!currentUser) {
                    alert('Please sign in to access saved items.');
                    return window.location.hash = '#/login?redirect=' + encodeURIComponent('#/profile?tab=saved');
                }
                window.location.hash = '#/profile?tab=saved';
                break;
            case '#/my-listings':
                if (!currentUser) return window.location.hash = '#/login';
                window.location.hash = '#/profile?tab=listings';
                break;
            case '#/settings':
                if (!currentUser) return window.location.hash = '#/login';
                window.location.hash = '#/profile?tab=settings';
                break;
            default:
                if (route.startsWith('#/item/')) {
                    if (!currentUser) {
                        alert('Please Login First to View Details and Contact Seller!');
                        window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
                        return;
                    }
                    if (!isUserVerified(currentUser)) {
                        showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
                        window.location.hash = '#/';
                        return;
                    }
                    // Extract ID and view item
                    const itemId = route.split('#/item/')[1];
                    this.showItemDetail(itemId);
                } else {
                    this.appDiv.innerHTML = '<h2 class="text-center mt-5">404 - Page not found</h2>';
                }
        }
    }

    updateActiveLink() {
        const hash = window.location.hash || '#/';
        
        setTimeout(() => {
            const links = document.querySelectorAll('.nav-tab, .nav-item');
            links.forEach(link => {
                const linkHash = link.getAttribute('href');
                if (!linkHash) return;
                
                let isMatch = false;
                if (linkHash.includes('?')) {
                    isMatch = hash === linkHash;
                } else {
                    const route = hash.split('?')[0];
                    isMatch = linkHash === route;
                }
                
                if (isMatch) {
                    link.classList.add('nav-active');
                } else {
                    link.classList.remove('nav-active');
                }
            });

            // Synchronize Mobile Bottom Nav Active Item
            const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
            bottomNavItems.forEach(item => {
                const navType = item.getAttribute('data-nav');
                let isActive = false;
                if (navType === 'home' && (!hash || hash === '#/')) {
                    isActive = true;
                } else if (navType === 'chats' && hash.startsWith('#/messages')) {
                    isActive = true;
                } else if (navType === 'profile' && hash.startsWith('#/profile')) {
                    isActive = true;
                } else if ((navType === 'post' || navType === 'add') && hash.startsWith('#/add')) {
                    isActive = true;
                }
                item.classList.toggle('active', isActive);
            });
        }, 10);
    }

    toggleSidebar() {
        this.sidebar.classList.toggle('active');
        this.overlay.classList.toggle('active');
        document.body.style.overflow = this.sidebar.classList.contains('active') ? 'hidden' : 'auto';
    }

    closeSidebar() {
        if (this.sidebar) {
            this.sidebar.classList.remove('active');
            this.overlay.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }

    showHome() {
        renderHome(this.appDiv);
        renderFloatingPermissionBanner();
    }
    
    showAddListing() {
        showAddListingModal();
    }
    
    showProfile() {
        renderProfile(this.appDiv);
    }
    
    showItemDetail(id) {
        renderItemDetail(this.appDiv, id);
    }

    showRequests() {
        if (!currentUser) {
            alert('Please Login First to View/Post Requests!');
            window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
            return;
        }
        
        // Mark as seen
        getRequestCount().then(count => {
            localStorage.setItem('lastSeenRequestCount', count);
            const badge = document.getElementById('req-badge');
            if (badge) badge.style.display = 'none';
        });
        
        renderRequests(this.appDiv);
    }

    async updateRequestBadge() {
        try {
            const totalCount = await getRequestCount();
            const lastSeenCount = parseInt(localStorage.getItem('lastSeenRequestCount') || '0');
            const diff = totalCount - lastSeenCount;
            
            const badge = document.getElementById('req-badge');
            if (badge && diff > 0) {
                badge.textContent = diff;
                badge.style.display = 'flex';
                badge.classList.add('pulse');
            }
        } catch (err) {
            console.error("Badge update failed:", err);
        }
    }

    async updateMessagesBadge() {
        if (!currentUser) return;
        try {
            let unreadCount = 0;
            let currentUserName = currentUser.displayName || currentUser.email.split('@')[0];
            const profile = await getUserProfile(currentUser.uid);
            if (profile && profile.fullName) {
                currentUserName = profile.fullName;
            }

            const chats = await getUserChats(currentUser.uid);
            for (const chat of chats) {
                const unread = await hasUnreadMessagesInChat(chat.id, currentUserName);
                if (unread) {
                    unreadCount++;
                }
            }

            const badges = document.querySelectorAll('.notification-badge');
            badges.forEach(badge => {
                if (unreadCount > 0) {
                    badge.innerText = unreadCount;
                    badge.style.display = 'inline-flex';
                } else {
                    badge.style.display = 'none';
                }
            });
        } catch (err) {
            console.error("Failed to update messages badge:", err);
        }
    }

    async checkNotifications(userId) {
        try {
            const notifications = await getUnreadNotifications(userId);
            if (notifications.length > 0) {
                this.showToast("Good News! Someone just listed an item you were looking for! Check the Marketplace.");
                await markNotificationsAsRead(userId);
            }
        } catch (err) {
            console.error("Notif check failed:", err);
        }
    }

    async ensureProfile(user) {
        try {
            let profile = await getUserProfile(user.uid);
            
            // 1. Auto-Create Profile if missing
            if (!profile) {
                console.log("Auto-creating profile for new/legacy user...");
                const displayName = user.displayName || user.email.split('@')[0];
                const collegeID = user.email.split('@')[0];
                const userDocId = generateUserDocId(displayName, collegeID, user.uid);
                profile = {
                    docId: userDocId,
                    uid: user.uid,
                    authUid: user.uid,
                    displayName: displayName,
                    fullName: displayName,
                    collegeID: collegeID,
                    email: user.email,
                    status: 'active',
                    createdAt: new Date().toISOString()
                };
                await saveUserProfile(userDocId, profile);
            }

            // 2. Check for missing WhatsApp Number (only if neither whatsappNumber nor whatsapp exists)
            if (!profile.whatsappNumber && !profile.whatsapp) {
                this.showOnboardingModal(user);
            }
        } catch (err) {
            console.error("Profile assurance failed:", err);
        }
    }

    showOnboardingModal(user) {
        const modalId = 'onboarding-modal';
        if (document.getElementById(modalId)) return;

        const modalHtml = `
            <div id="${modalId}" class="modal-overlay active" style="z-index: 5000;">
                <div class="modal-content text-center onboarding-card">
                    <div class="profile-avatar mb-3 mx-auto" style="width:70px; height:70px;">
                        <i class="fa-solid fa-user-graduate"></i>
                    </div>
                    <h2 class="modal-title">Welcome to StudentShelf!</h2>
                    <p class="text-muted mb-4">Please add your WhatsApp number to start buying and selling on campus.</p>
                    
                    <div class="form-group text-left mb-4">
                        <label>WhatsApp Number</label>
                        <input type="tel" id="onboard-whatsapp" class="form-control" placeholder="+919876543210" value="+91">
                        <small class="text-muted">Buyers and sellers will contact you here.</small>
                    </div>

                    <button id="save-onboard-btn" class="btn btn-primary w-100">
                        Complete Profile
                    </button>
                    <div id="onboard-error" class="error-msg mt-2"></div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById(modalId);
        const saveBtn = modal.querySelector('#save-onboard-btn');
        const errorDiv = modal.querySelector('#onboard-error');

        saveBtn.addEventListener('click', async () => {
            const wa = modal.querySelector('#onboard-whatsapp').value.trim();
            if (!/^\+91\d{10}$/.test(wa)) {
                errorDiv.textContent = "Please enter a valid number (+91XXXXXXXXXX)";
                return;
            }

            try {
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving...";
                await saveUserProfile(user.uid, { whatsappNumber: wa });
                modal.remove();
                if (window.location.hash === '#/profile') {
                    renderProfile(this.appDiv); // Refresh profile if on that page
                }
            } catch (err) {
                errorDiv.textContent = "Failed to save. Try again.";
                saveBtn.disabled = false;
                saveBtn.textContent = "Complete Profile";
            }
        });
    }

    showToast(message) {
        const toastId = 'app-toast';
        const existing = document.getElementById(toastId);
        if (existing) existing.remove();

        const toastHtml = `
            <div id="${toastId}" class="toast-notification">
                <i class="fa-solid fa-bell"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', toastHtml);
        const toast = document.getElementById(toastId);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AppRouter();


    // -- UI Global Handlers (Modal etc) --
    const aboutTrigger = document.getElementById('about-trigger');
    const aboutModal = document.getElementById('about-modal');
    const modalClose = document.getElementById('modal-close');

    if (aboutTrigger && aboutModal) {
        aboutTrigger.addEventListener('click', () => {
            aboutModal.classList.add('active');
            document.body.style.overflow = 'hidden'; // Prevent scroll
        });

        if (modalClose) {
            modalClose.addEventListener('click', () => {
                aboutModal.classList.remove('active');
                document.body.style.overflow = 'auto';
            });
        }

        // Close on outside click
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                aboutModal.classList.remove('active');
                document.body.style.overflow = 'auto';
            }
        });
    }

    // -- Sidebar Global Handlers --
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    const closeDrawerBtn = document.getElementById('close-drawer-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebarLinksContainer = document.getElementById('sidebar-links');

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('mobile-sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) {
                sidebar.classList.add('active');
                sidebar.classList.add('drawer-open');
            }
            if (overlay) {
                overlay.classList.add('active');
                overlay.classList.add('drawer-open');
            }
            document.body.style.overflow = 'hidden';
        });

        const closeMenu = () => {
            const sidebar = document.getElementById('mobile-sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) {
                sidebar.classList.remove('active');
                sidebar.classList.remove('drawer-open');
            }
            if (overlay) {
                overlay.classList.remove('active');
                overlay.classList.remove('drawer-open');
            }
            document.body.style.overflow = 'auto';
        };

        if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeMenu);
        if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeMenu);
        if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeMenu);
        if (sidebarLinksContainer) {
            sidebarLinksContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('nav-item') || e.target.classList.contains('btn')) {
                    closeMenu();
                }
            });
        }
    }

    // -- Global Lightbox Handler --
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxClose = document.getElementById('lightbox-close');

    if (lightboxModal) {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('can-zoom')) {
                const src = e.target.src;
                const alt = e.target.alt;
                
                if (lightboxImg) lightboxImg.src = src;
                if (lightboxCaption) lightboxCaption.textContent = alt;
                lightboxModal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });

        const closeLightbox = () => {
            lightboxModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        };

        if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) closeLightbox();
        });
    }

    // -- Header Notifications Dropdown --
    const notifBellBtn = document.getElementById('notif-bell-btn');
    const notifDropdown = document.getElementById('notifications-dropdown') || document.getElementById('notif-dropdown');
    
    if (notifBellBtn && notifDropdown) {
        notifBellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('active');
            if (notifDropdown.classList.contains('active')) {
                populateNotifications();
            }
        });
        
        document.addEventListener('click', (e) => {
            if (notifBellBtn && notifDropdown) {
                if (!notifBellBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
                    notifDropdown.classList.remove('active');
                }
            }
        });
        
        const markReadBtn = document.getElementById('notif-mark-read-btn');
        if (markReadBtn) {
            markReadBtn.addEventListener('click', async () => {
                if (auth && auth.currentUser) {
                    await markNotificationsAsRead(auth.currentUser.uid);
                }
                const badges = document.querySelectorAll('.notification-badge');
                badges.forEach(b => b.style.display = 'none');
                populateNotifications();
            });
        }
    }
    
    async function populateNotifications() {
        const listEl = document.getElementById('notif-items-list');
        if (!listEl) return;
        
        let html = '';
        let realNotifs = [];
        if (auth.currentUser) {
            try {
                realNotifs = await getUnreadNotifications(auth.currentUser.uid);
            } catch (err) {
                console.error("Failed to load user notifications:", err);
            }
        }
        
        const combined = [
            ...realNotifs.map(n => ({
                id: n.id,
                title: "Item Match Found! 🌟",
                message: `Someone posted an item matching: ${n.itemName}`,
                time: n.timestamp ? new Date(n.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now'
            })),
            {
                id: "mock1",
                title: "Welcome to StudentShelf! 🎉",
                message: "Start by browsing the marketplace or post your first item.",
                time: "Just now"
            },
            {
                id: "mock2",
                title: "Trending Items 📈",
                message: "Check out the high-demand 'Java Programming Notes' posted today.",
                time: "2 hours ago"
            }
        ];

        combined.forEach(n => {
            html += `
                <div class="notif-item" data-id="${n.id}">
                    <i class="fa-solid fa-bell"></i>
                    <div class="notif-content-text">
                        <span class="notif-title">${n.title}</span>
                        <span class="notif-message" style="font-size:12px; color:var(--text-muted);">${n.message}</span>
                        <span class="notif-time">${n.time}</span>
                    </div>
                </div>
            `;
        });
        listEl.innerHTML = html;
    }

    // -- Floating Live Activity Feed (Disabled to prevent annoying toast popups) --
    const liveActivityContainer = document.getElementById('live-activity-container');
    if (liveActivityContainer) {
        liveActivityContainer.innerHTML = '';
        liveActivityContainer.style.display = 'none';
    }
});

// Click delegation for PWA install badge
document.addEventListener('click', function(e) {
  if (e.target.matches('#pwa-install-trigger, #install-pwa-btn') || e.target.closest('#pwa-install-trigger, #install-pwa-btn')) {
    e.stopPropagation();
    if (typeof window.installApp === 'function') {
      window.installApp();
    }
  }
});

