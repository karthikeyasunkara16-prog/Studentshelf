import { getUserListings, deleteUserListing, markListingAsSold, getUserProfile, getUserRequests, updateRequestStatus, saveUserProfile, generateUserDocId, getListings } from './db.js';
import { auth } from './firebase.js';
import { setUserNotificationsEnabled, getAndSaveFCMToken } from './notifications.js';

export async function renderProfile(container) {
    console.log("Initializing Profile SaaS Dashboard...");

    // 1. Initial Loading State
    container.innerHTML = `
        <div id="profile-loading-view" class="text-center" style="padding: 100px 0;">
            <div class="loader-spinner mb-3"></div>
            <p class="text-muted">Fetching your profile details...</p>
        </div>
        <div id="profile-error-view" style="display: none;"></div>
        <div id="profile-content-view" style="display: none; opacity: 0; transition: opacity 0.4s ease;"></div>
    `;

    const loadingView = container.querySelector('#profile-loading-view');
    const errorView = container.querySelector('#profile-error-view');
    const contentView = container.querySelector('#profile-content-view');

    if (!auth.currentUser) {
        window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash || '#/profile');
        return;
    }

    try {
        console.log("Fetching data for UID:", auth.currentUser.uid);

        // 2. Fetch all data with error safety
        const [profile, listings, requests, allListings] = await Promise.all([
            getUserProfile(auth.currentUser.uid).catch(e => { console.error("Profile Fetch Error:", e); return null; }),
            getUserListings(auth.currentUser.uid).catch(e => { console.error("Listings Fetch Error:", e); return []; }),
            getUserRequests(auth.currentUser.uid).catch(e => { console.error("Requests Fetch Error:", e); return []; }),
            getListings().catch(e => { console.error("All Listings Fetch Error:", e); return []; })
        ]);

        const wishlistIds = JSON.parse(localStorage.getItem('wishlist') || '[]');
        let wishlistItems = allListings.filter(item => wishlistIds.includes(item.id));

        const urlParams = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
        let activeTab = urlParams.get('tab') || 'listings';
        if (activeTab === 'saved') activeTab = 'wishlist';

        // 3. Handle Fallback (Missing Profile)
        if (!profile) {
            console.warn("No profile found in Firestore for this user.");
            loadingView.style.display = 'none';
            errorView.style.display = 'block';
            errorView.innerHTML = `
                <div class="auth-card shadow-card text-center mt-5 mx-auto" style="max-width:500px">
                    <div class="mb-4" style="font-size:3rem">👤</div>
                    <h3>Profile Not Found</h3>
                    <p class="text-muted">We couldn't find your marketplace profile. Let's set it up now!</p>
                    <button class="btn btn-primary w-100 mt-3" id="setup-profile-btn">
                        <i class="fa-solid fa-magic"></i> Create My Profile
                    </button>
                </div>
            `;
            errorView.querySelector('#setup-profile-btn').addEventListener('click', () => {
                location.reload();
            });
            return;
        }

        const displayName = profile.fullName || profile.name || profile.displayName || 'Student';
        const userInitial = displayName.charAt(0).toUpperCase();

        const browserPerm = ("Notification" in window) ? Notification.permission : 'unsupported';
        let isNotifActive = false;
        if (profile.notificationsEnabled !== undefined) {
            isNotifActive = Boolean(profile.notificationsEnabled) && browserPerm === 'granted';
        } else {
            isNotifActive = browserPerm === 'granted';
        }

        let permissionBadgeText = 'Default';
        let permissionBadgeClass = 'badge-secondary';
        if (browserPerm === 'granted') {
            permissionBadgeText = 'Granted';
            permissionBadgeClass = 'badge-success';
        } else if (browserPerm === 'denied') {
            permissionBadgeText = 'Denied';
            permissionBadgeClass = 'badge-danger';
        }

        // 4. Render SaaS Dashboard Main Content
        contentView.innerHTML = `
            <div class="profile-dashboard-layout">
                <!-- Dynamic Breadcrumbs -->
                <nav class="breadcrumb-nav" aria-label="Breadcrumb">
                    <a href="#/">Home</a>
                    <span class="breadcrumb-sep">/</span>
                    <span class="breadcrumb-current">Dashboard</span>
                    <span class="breadcrumb-sep">/</span>
                    <span class="breadcrumb-current" id="breadcrumb-tab-label">${getTabLabel(activeTab)}</span>
                </nav>

                <!-- Profile Header SaaS Card -->
                <div class="profile-header-card shadow-card">
                    <div class="profile-header-main">
                        <div class="profile-avatar-circle">
                            ${userInitial}
                        </div>
                        <div class="profile-user-details">
                            <div class="profile-name-badge-row">
                                <h2 class="profile-user-name">${displayName}</h2>
                                <span class="verified-student-badge">
                                    <i class="fa-solid fa-circle-check"></i> Verified Student
                                </span>
                            </div>
                            <div class="profile-meta-pills">
                                <span class="profile-meta-pill">
                                    <i class="fa-solid fa-building-columns"></i> PEC Campus
                                </span>
                                <span class="profile-meta-pill">
                                    <i class="fa-solid fa-id-card"></i> ID: ${profile.collegeID || 'Not set'}
                                </span>
                                <span class="profile-meta-pill">
                                    <i class="fa-solid fa-envelope"></i> ${profile.email || auth.currentUser.email || 'No email'}
                                </span>
                                <span class="profile-meta-pill">
                                    <i class="fa-brands fa-whatsapp"></i> ${profile.whatsapp || 'Not set'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="profile-header-actions">
                        <div class="profile-stats-summary">
                            <div class="profile-stat-box">
                                <span class="stat-number">${listings.length}</span>
                                <span class="stat-label">Listings</span>
                            </div>
                            <div class="profile-stat-box">
                                <span class="stat-number">${requests.length}</span>
                                <span class="stat-label">Requests</span>
                            </div>
                            <div class="profile-stat-box">
                                <span class="stat-number" id="stat-saved-count">${wishlistItems.length}</span>
                                <span class="stat-label">Saved</span>
                            </div>
                        </div>
                        <div class="profile-header-btns">
                            <button type="button" class="btn btn-outline edit-profile-btn" title="Edit your campus details">
                                <i class="fa-solid fa-user-pen"></i> Edit Profile
                            </button>
                            <button type="button" class="btn profile-logout-btn" id="profile-header-logout-btn" title="Sign out of StudentShelf">
                                <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Structured Dashboard Tabs Bar -->
                <div class="profile-tabs-bar" role="tablist">
                    <button type="button" class="profile-tab-btn ${activeTab === 'listings' ? 'active' : ''}" data-tab="listings" role="tab">
                        <i class="fa-solid fa-boxes-stacked"></i>
                        <span>My Listings</span>
                        <span class="tab-count-pill" id="tab-pill-listings">${listings.length}</span>
                    </button>
                    <button type="button" class="profile-tab-btn ${activeTab === 'requests' ? 'active' : ''}" data-tab="requests" role="tab">
                        <i class="fa-solid fa-bullhorn"></i>
                        <span>My Requests</span>
                        <span class="tab-count-pill" id="tab-pill-requests">${requests.length}</span>
                    </button>
                    <button type="button" class="profile-tab-btn ${activeTab === 'wishlist' ? 'active' : ''}" data-tab="wishlist" role="tab">
                        <i class="fa-regular fa-bookmark"></i>
                        <span>Saved Items</span>
                        <span class="tab-count-pill" id="tab-pill-saved">${wishlistItems.length}</span>
                    </button>
                    <button type="button" class="profile-tab-btn ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings" role="tab">
                        <i class="fa-solid fa-gear"></i>
                        <span>Settings</span>
                    </button>
                </div>

                <!-- Sections Container -->
                <div id="profile-sections-container">
                    <!-- Section: My Listings -->
                    <div id="section-listings" class="profile-section-content" style="${activeTab === 'listings' ? '' : 'display: none;'}">
                        <div class="profile-section-header-bar">
                            <h3 class="profile-section-title"><i class="fa-solid fa-boxes-stacked"></i> Manage My Listings</h3>
                            <button type="button" class="btn btn-primary btn-sm add-listing-trigger">
                                <i class="fa-solid fa-plus"></i> Post New Listing
                            </button>
                        </div>
                        <div id="my-listings-grid" class="listings-grid">
                            ${renderListingsHTML(listings)}
                        </div>
                    </div>

                    <!-- Section: My Requests -->
                    <div id="section-requests" class="profile-section-content" style="${activeTab === 'requests' ? '' : 'display: none;'}">
                        <div class="profile-section-header-bar">
                            <h3 class="profile-section-title"><i class="fa-solid fa-bullhorn"></i> Manage Community Requests</h3>
                            <a href="#/requests" class="btn btn-primary btn-sm">
                                <i class="fa-solid fa-plus"></i> Post New Request
                            </a>
                        </div>
                        <div id="my-requests-grid" class="listings-grid">
                            ${renderRequestsHTML(requests)}
                        </div>
                    </div>

                    <!-- Section: Saved Items (Wishlist) -->
                    <div id="section-wishlist" class="profile-section-content" style="${activeTab === 'wishlist' ? '' : 'display: none;'}">
                        <div class="profile-section-header-bar">
                            <h3 class="profile-section-title"><i class="fa-regular fa-bookmark"></i> My Saved Items</h3>
                            <a href="#/" class="btn btn-outline btn-sm">
                                <i class="fa-solid fa-store"></i> Browse More Items
                            </a>
                        </div>
                        <div id="my-wishlist-grid" class="listings-grid ecom-saved-grid">
                            ${renderWishlistHTML(wishlistItems)}
                        </div>
                    </div>

                    <!-- Section: Settings -->
                    <div id="section-settings" class="profile-section-content" style="${activeTab === 'settings' ? '' : 'display: none;'}">
                        <div class="profile-section-header-bar">
                            <h3 class="profile-section-title"><i class="fa-solid fa-gear"></i> Account Settings</h3>
                        </div>

                        <!-- Notification Settings Card with Neumorphic Toggle -->
                        <div class="settings-card shadow-card mb-4" id="notifications-settings-card">
                            <div class="settings-card-header d-flex justify-content-between align-items-center flex-wrap" style="gap: 12px;">
                                <div style="flex: 1; min-width: 200px;">
                                    <h4 style="margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px;">
                                        <i class="fa-solid fa-bell" style="color: #00ABE4;"></i> Push Notifications
                                    </h4>
                                    <p class="text-muted" style="margin: 0; font-size: 13px;">
                                        Receive real-time chat alerts and peer updates on your campus listings.
                                    </p>
                                </div>
                                <div class="neumorphic-toggle-wrap">
                                    <label class="neumorphic-switch" for="notif-toggle-input" title="Toggle Push Notifications">
                                        <input type="checkbox" id="notif-toggle-input" ${isNotifActive ? 'checked' : ''}>
                                        <span class="neumorphic-slider"></span>
                                    </label>
                                </div>
                            </div>
                            <div class="settings-notif-status-row mt-3 pt-3" style="border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <div class="d-flex align-items-center gap-2">
                                    <span class="notif-status-indicator ${isNotifActive ? 'active' : ''}" id="notif-status-dot"></span>
                                    <span class="text-muted" id="notif-status-text" style="font-size: 12px;">
                                        ${isNotifActive ? 'Notifications active on this device' : 'Notifications muted'}
                                    </span>
                                </div>
                                <span class="badge ${permissionBadgeClass}" id="notif-perm-badge" style="font-size: 11px;">
                                    ${permissionBadgeText}
                                </span>
                            </div>
                        </div>

                        <!-- Campus Profile Info Card -->
                        <div class="settings-card shadow-card">
                            <div class="settings-card-header">
                                <h4>Campus Profile Information</h4>
                                <p class="text-muted">Keep your contact and campus information updated so buyers and sellers can reach you effortlessly.</p>
                            </div>
                            <div class="settings-details-grid">
                                <div class="settings-detail-row">
                                    <span class="detail-label">Display Name</span>
                                    <span class="detail-value" id="settings-display-name">${displayName}</span>
                                </div>
                                <div class="settings-detail-row">
                                    <span class="detail-label">College ID / Roll No</span>
                                    <span class="detail-value" id="settings-college-id">${profile.collegeID || 'Not set'}</span>
                                </div>
                                <div class="settings-detail-row">
                                    <span class="detail-label">Email Address</span>
                                    <span class="detail-value">${profile.email || auth.currentUser.email || 'Not set'}</span>
                                </div>
                                <div class="settings-detail-row">
                                    <span class="detail-label">WhatsApp Contact</span>
                                    <span class="detail-value" id="settings-whatsapp">${profile.whatsapp || 'Not set'}</span>
                                </div>
                            </div>
                            <div class="settings-actions-footer">
                                <button type="button" class="btn btn-primary edit-profile-btn-settings">
                                    <i class="fa-solid fa-user-pen"></i> Edit Profile Information
                                </button>
                            </div>
                        </div>

                        <!-- Account Session & Sign Out Card -->
                        <div class="settings-card shadow-card mt-4" id="account-session-card">
                            <div class="settings-card-header d-flex justify-content-between align-items-center flex-wrap" style="gap: 12px;">
                                <div style="flex: 1; min-width: 200px;">
                                    <h4 style="margin: 0 0 4px 0; color: #DC2626; display: flex; align-items: center; gap: 8px;">
                                        <i class="fa-solid fa-arrow-right-from-bracket"></i> Account Session
                                    </h4>
                                    <p class="text-muted" style="margin: 0; font-size: 13px;">
                                        Sign out of your active session on this device. Your campus listings and saved items will remain safely stored.
                                    </p>
                                </div>
                            </div>
                            <div class="settings-actions-footer mt-3" style="padding-top: 14px; border-top: 1px solid #E2E8F0;">
                                <button type="button" class="btn profile-logout-btn profile-logout-btn-full" id="settings-logout-btn">
                                    <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out of StudentShelf
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 5. Switch Views
        loadingView.style.display = 'none';
        contentView.style.display = 'block';
        setTimeout(() => contentView.style.opacity = '1', 50);

        // 6. Tab Switching Logic
        contentView.querySelectorAll('.profile-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                contentView.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                contentView.querySelector('#section-listings').style.display = target === 'listings' ? 'block' : 'none';
                contentView.querySelector('#section-requests').style.display = target === 'requests' ? 'block' : 'none';
                contentView.querySelector('#section-wishlist').style.display = target === 'wishlist' ? 'block' : 'none';
                contentView.querySelector('#section-settings').style.display = target === 'settings' ? 'block' : 'none';

                const tabLabelEl = contentView.querySelector('#breadcrumb-tab-label');
                if (tabLabelEl) tabLabelEl.textContent = getTabLabel(target);

                const currentHash = window.location.hash.split('?')[0];
                window.history.pushState(null, '', `${currentHash}?tab=${target}`);
            });
        });

        // 7. Attach Action Listeners
        attachActions(contentView, wishlistItems);

        // 8. Attach Edit Logic
        const editTrigger = () => showEditProfileModal(profile, contentView);
        const headerEditBtn = contentView.querySelector('.edit-profile-btn');
        if (headerEditBtn) headerEditBtn.addEventListener('click', editTrigger);

        const settingsEditBtn = contentView.querySelector('.edit-profile-btn-settings');
        if (settingsEditBtn) settingsEditBtn.addEventListener('click', editTrigger);

        // 9. Attach Notification Toggle Switch Listener
        const notifToggle = contentView.querySelector('#notif-toggle-input');
        const notifStatusText = contentView.querySelector('#notif-status-text');
        const notifStatusDot = contentView.querySelector('#notif-status-dot');
        const notifPermBadge = contentView.querySelector('#notif-perm-badge');

        if (notifToggle) {
            notifToggle.addEventListener('change', async () => {
                const isEnabling = notifToggle.checked;
                const uid = auth.currentUser?.uid;
                if (!uid) return;

                if (isEnabling) {
                    /* Toggle ON: If permission is 'default', trigger Notification.requestPermission(), save FCM token to Firestore, and set notificationsEnabled: true */
                    if (!("Notification" in window)) {
                        alert("Push notifications are not supported in this browser.");
                        notifToggle.checked = false;
                        return;
                    }

                    if (Notification.permission === 'denied') {
                        alert("Notifications are currently blocked in your browser settings. Please enable notifications for this site to receive alerts.");
                        notifToggle.checked = false;
                        return;
                    }

                    try {
                        let perm = Notification.permission;
                        if (perm === 'default') {
                            const reqResult = Notification.requestPermission();
                            if (reqResult && typeof reqResult.then === 'function') {
                                perm = await reqResult;
                            } else {
                                perm = await new Promise(resolve => Notification.requestPermission(resolve));
                            }
                        }

                        if (perm === 'granted') {
                            localStorage.setItem('notificationPermissionState', 'granted');
                            localStorage.setItem('notificationBannerDismissed', 'true');
                            await setUserNotificationsEnabled(true, uid);
                            await getAndSaveFCMToken(uid);

                            if (notifStatusText) notifStatusText.textContent = 'Notifications active on this device';
                            if (notifStatusDot) notifStatusDot.classList.add('active');
                            if (notifPermBadge) {
                                notifPermBadge.className = 'badge badge-success';
                                notifPermBadge.textContent = 'Granted';
                            }
                        } else {
                            localStorage.setItem('notificationPermissionState', 'denied');
                            localStorage.setItem('notificationBannerDismissed', 'true');
                            notifToggle.checked = false;
                            await setUserNotificationsEnabled(false, uid);

                            if (notifStatusText) notifStatusText.textContent = 'Permission was not granted';
                            if (notifStatusDot) notifStatusDot.classList.remove('active');
                            if (notifPermBadge) {
                                notifPermBadge.className = 'badge badge-danger';
                                notifPermBadge.textContent = 'Denied';
                            }
                        }
                    } catch (err) {
                        console.error("Error enabling notifications from Profile Settings:", err);
                        notifToggle.checked = false;
                    }
                } else {
                    /* Toggle OFF: Set notificationsEnabled: false in Firestore to mute background push alerts */
                    try {
                        await setUserNotificationsEnabled(false, uid);
                        if (notifStatusText) notifStatusText.textContent = 'Notifications muted in StudentShelf';
                        if (notifStatusDot) notifStatusDot.classList.remove('active');
                    } catch (err) {
                        console.error("Error muting notifications from Profile Settings:", err);
                    }
                }
            });
        }

        // 10. Attach Explicit Profile Logout Action Listeners
        const profileLogoutBtns = contentView.querySelectorAll('#profile-header-logout-btn, #settings-logout-btn, .profile-logout-btn');
        profileLogoutBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.performLogout === 'function') {
                    window.performLogout();
                } else {
                    auth.signOut().then(() => {
                        window.location.hash = '#/';
                    });
                }
            });
        });

    } catch (err) {
        console.error("Critical Profile Error:", err);
        loadingView.style.display = 'none';
        errorView.style.display = 'block';
        errorView.innerHTML = `
            <div class="error-msg text-center mt-5">
                <i class="fa-solid fa-triangle-exclamation fa-2x mb-3"></i>
                <h3>Something went wrong</h3>
                <p>${err.message}</p>
                <button class="btn btn-primary mt-3" onclick="location.reload()">Retry</button>
            </div>
        `;
    }
}

function getTabLabel(tab) {
    switch (tab) {
        case 'listings': return 'My Listings';
        case 'requests': return 'My Requests';
        case 'wishlist':
        case 'saved': return 'Saved Items';
        case 'settings': return 'Settings';
        default: return 'Overview';
    }
}

function renderListingsHTML(listings) {
    if (!listings || listings.length === 0) {
        return `
            <div class="saas-empty-state-card" style="grid-column: 1/-1;">
                <div class="empty-state-icon-circle">
                    <i class="fa-solid fa-boxes-stacked"></i>
                </div>
                <h3 class="empty-state-title">No Listings Yet</h3>
                <p class="empty-state-subtitle">You haven't listed any textbooks, notes, or gear for sale on campus.</p>
                <button type="button" class="btn btn-primary empty-state-btn add-listing-trigger">
                    <i class="fa-solid fa-plus"></i> Post a Listing
                </button>
            </div>
        `;
    }

    return listings.map(item => {
        const isSold = item.status === 'sold';
        const coverImg = (Array.isArray(item.imageUrls) && item.imageUrls.length > 0)
            ? item.imageUrls[0]
            : (item.imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&h=450&q=80');
        const multiImgBadge = (Array.isArray(item.imageUrls) && item.imageUrls.length > 1)
            ? `<span class="card-multi-img-badge"><i class="fa-solid fa-images"></i> ${item.imageUrls.length}</span>`
            : '';

        return `
            <div class="product-card ecom-product-card shadow-card" id="listing-${item.id}">
                <div class="product-image-wrapper ecom-card-img-frame card-image-wrapper product-image-container">
                    <img class="ecom-card-img product-image can-zoom" src="${coverImg}" alt="${item.title}" style="${isSold ? 'filter: grayscale(1) opacity(0.6);' : ''}" loading="lazy">
                    ${multiImgBadge}
                    ${isSold ? '<div class="ecom-sold-overlay">SOLD</div>' : ''}
                </div>
                <div class="product-card-details card-content ecom-card-body card-body product-details">
                    <h3 class="ecom-card-title">${item.title}</h3>
                    <div class="ecom-card-meta">
                        ${((Array.isArray(item.categories) && item.categories.length > 0) ? item.categories : [item.category || 'General']).map(c => `
                            <span class="ecom-category-chip"><i class="fa-solid fa-tag"></i> ${c}</span>
                        `).join(' ')}
                        <span class="ecom-condition-tag"><i class="fa-solid fa-cube"></i> ${item.condition || 'Good'}</span>
                    </div>
                    <div class="ecom-card-price-row">
                        <span class="ecom-price product-price">₹${item.price}</span>
                        ${isSold ? '<span class="badge badge-danger">Sold</span>' : '<span class="badge badge-success">Active</span>'}
                    </div>
                    <div class="mt-3 d-flex gap-2 flex-column w-100">
                        ${!isSold ? `
                            <button class="btn btn-success btn-sm mark-sold-btn" data-id="${item.id}">
                                <i class="fa-solid fa-check-circle"></i> Mark as Sold
                            </button>
                        ` : ''}
                        <button class="btn btn-danger btn-sm delete-listing-btn" data-id="${item.id}">
                            <i class="fa-solid fa-trash"></i> Delete Listing
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderRequestsHTML(requests) {
    if (!requests || requests.length === 0) {
        return `
            <div class="saas-empty-state-card" style="grid-column: 1/-1;">
                <div class="empty-state-icon-circle">
                    <i class="fa-solid fa-bullhorn"></i>
                </div>
                <h3 class="empty-state-title">No Requests Yet</h3>
                <p class="empty-state-subtitle">Ask your campus peers for items or notes you're searching for.</p>
                <a href="#/requests" class="btn btn-primary empty-state-btn">
                    <i class="fa-solid fa-plus"></i> Post a Request
                </a>
            </div>
        `;
    }

    return requests.map(req => {
        return `
            <div class="listing-card request-card shadow-card" id="req-${req.id}">
                <div class="wanted-badge" style="background: #00ABE4; color: #FFFFFF;">MY REQUEST</div>
                <div class="request-content">
                    <h3 class="request-title">${req.itemName}</h3>
                    <p class="request-date">Posted on ${new Date(req.timestamp).toLocaleDateString()}</p>
                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-outline btn-resolve btn-sm w-100 resolve-req-btn" data-id="${req.id}">
                            <i class="fa-solid fa-check"></i> Found It
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderWishlistHTML(items) {
    if (!items || items.length === 0) {
        return `
            <div class="saas-empty-state-card" style="grid-column: 1/-1;">
                <div class="empty-state-icon-circle">
                    <i class="fa-regular fa-bookmark"></i>
                </div>
                <h3 class="empty-state-title">No Saved Items Yet</h3>
                <p class="empty-state-subtitle">Save items from the marketplace to keep track of them</p>
                <a href="#/" class="btn btn-primary empty-state-btn">
                    <i class="fa-solid fa-store"></i> Browse Marketplace
                </a>
            </div>
        `;
    }

    return items.map(item => {
        const isSold = item.status === 'sold';
        const coverImg = (Array.isArray(item.imageUrls) && item.imageUrls.length > 0)
            ? item.imageUrls[0]
            : (item.imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&h=450&q=80');
        const multiImgBadge = (Array.isArray(item.imageUrls) && item.imageUrls.length > 1)
            ? `<span class="card-multi-img-badge"><i class="fa-solid fa-images"></i> ${item.imageUrls.length}</span>`
            : '';

        return `
            <div class="product-card ecom-product-card shadow-card" id="saved-item-${item.id}">
                <div class="product-image-wrapper ecom-card-img-frame card-image-wrapper product-image-container">
                    <img class="ecom-card-img product-image" src="${coverImg}" alt="${item.title}" style="${isSold ? 'filter: grayscale(1) opacity(0.6);' : ''}" loading="lazy">
                    ${multiImgBadge}
                    <button type="button" class="ecom-wishlist-btn active remove-wishlist-btn" data-id="${item.id}" aria-label="Remove from saved" title="Remove from saved">
                        <i class="fa-solid fa-heart"></i>
                    </button>
                    ${isSold ? '<div class="ecom-sold-overlay">SOLD</div>' : ''}
                </div>
                <div class="product-card-details card-content ecom-card-body card-body product-details">
                    <div class="seller-info-row ecom-card-seller-row">
                        <span class="seller-name">Posted by ${item.sellerName || 'Student'}</span>
                        <span class="status-badge ${isSold ? 'status-sold' : 'status-active'}">${isSold ? 'Sold' : 'Active'}</span>
                    </div>

                    <h3 class="product-title ecom-card-title">${item.title}</h3>

                    <div class="ecom-card-meta">
                        ${((Array.isArray(item.categories) && item.categories.length > 0) ? item.categories : [item.category || 'General']).map(c => `
                            <span class="ecom-category-chip"><i class="fa-solid fa-tag"></i> ${c}</span>
                        `).join(' ')}
                        <span class="ecom-condition-tag"><i class="fa-solid fa-cube"></i> ${item.condition || 'Good'}</span>
                    </div>

                    <div class="ecom-card-price-row">
                        <span class="product-price ecom-price">₹${item.price}</span>
                        ${item.originalPrice ? `<span class="ecom-original-price">₹${item.originalPrice}</span>` : ''}
                    </div>

                    <div class="d-flex gap-2 mt-2 w-100 align-items-center">
                        <a href="#/item/${item.id}" class="view-details-btn ecom-view-btn flex-grow-1 text-center">View Details</a>
                        <button type="button" class="btn btn-outline btn-sm remove-saved-btn" data-id="${item.id}" title="Remove item" style="padding: 0 10px; height: 38px; border-color: #E2E8F0; color: #EF4444; border-radius: 8px;">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function attachActions(contentView, wishlistItems) {
    // Delete Listing
    contentView.querySelectorAll('.delete-listing-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (confirm('Delete this listing permanently?')) {
                const id = btn.dataset.id;
                try {
                    await deleteUserListing(id);
                    const el = document.getElementById(`listing-${id}`);
                    if (el) el.remove();
                } catch (err) { alert("Failed to delete: " + err.message); }
            }
        });
    });

    // Mark Sold
    contentView.querySelectorAll('.mark-sold-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            try {
                await markListingAsSold(id);
                location.reload();
            } catch (err) { alert("Failed to update: " + err.message); }
        });
    });

    // Resolve Request
    contentView.querySelectorAll('.resolve-req-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (confirm('Mark this request as resolved?')) {
                try {
                    await updateRequestStatus(id, 'resolved');
                    const card = document.getElementById(`req-${id}`);
                    if (card) {
                        card.style.opacity = '0';
                        setTimeout(() => card.remove(), 300);
                    }
                } catch (err) { alert("Failed to resolve: " + err.message); }
            }
        });
    });

    // Remove from Wishlist / Saved
    const handleRemoveSaved = (id) => {
        let wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
        wishlist = wishlist.filter(itemId => itemId !== id);
        localStorage.setItem('wishlist', JSON.stringify(wishlist));

        const card = document.getElementById(`saved-item-${id}`);
        if (card) {
            card.style.opacity = '0';
            setTimeout(() => {
                card.remove();
                const grid = document.getElementById('my-wishlist-grid');
                const remainingCards = grid ? grid.querySelectorAll('.ecom-product-card') : [];
                
                // Update counts
                const savedPill = document.getElementById('tab-pill-saved');
                if (savedPill) savedPill.textContent = remainingCards.length;
                const statCount = document.getElementById('stat-saved-count');
                if (statCount) statCount.textContent = remainingCards.length;

                if (remainingCards.length === 0 && grid) {
                    grid.innerHTML = renderWishlistHTML([]);
                }
            }, 250);
        }
    };

    contentView.querySelectorAll('.remove-wishlist-btn, .remove-saved-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.dataset.id;
            handleRemoveSaved(id);
        });
    });
}

function showEditProfileModal(currentProfile, dashboardContainer) {
    const modalId = 'edit-profile-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modalHtml = `
        <div id="${modalId}" class="modal-overlay active" style="z-index: 6000;">
            <div class="modal-content glass-card" style="max-width: 450px;">
                <h2 class="modal-title mb-4"><i class="fa-solid fa-user-pen"></i> Edit Profile</h2>
                
                <div class="form-group text-left mb-3">
                    <label>Display Name</label>
                    <input type="text" id="edit-name" class="form-control" value="${currentProfile.fullName || ''}" placeholder="Enter Name">
                </div>
                
                <div class="form-group text-left mb-3">
                    <label>College ID</label>
                    <input type="text" id="edit-college-id" class="form-control" value="${currentProfile.collegeID || ''}" placeholder="Enter Roll No">
                </div>

                <div class="form-group text-left mb-4">
                    <label>WhatsApp Number (10 Digits)</label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span style="color:var(--text-muted); font-weight:600;">+91</span>
                        <input type="tel" id="edit-whatsapp" class="form-control" value="${(currentProfile.whatsapp || '').replace('+91', '')}" placeholder="9876543210" maxlength="10">
                    </div>
                </div>

                <div class="d-flex gap-2">
                    <button type="button" id="cancel-edit-btn" class="btn btn-outline w-100">Cancel</button>
                    <button type="button" id="save-profile-btn" class="btn btn-primary w-100">Save Changes</button>
                </div>
                <div id="edit-error" class="error-msg mt-2 text-center"></div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById(modalId);

    // Field-level validation helpers for Edit Profile
    const setProfileFieldError = (fieldEl, message, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.add('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const existing = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id || 'field'}"]`);
            if (existing) existing.remove();
            const hint = document.createElement('div');
            hint.className = 'field-error-hint';
            hint.setAttribute('data-for', fieldEl.id || 'field');
            hint.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${message}</span>`;
            targetAnchor.insertAdjacentElement('afterend', hint);
        }
    };

    const clearProfileFieldError = (fieldEl, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.remove('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const hint = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id || 'field'}"]`);
            if (hint) hint.remove();
        }
    };

    const nameInput = modal.querySelector('#edit-name');
    const collegeIdInput = modal.querySelector('#edit-college-id');
    const waInput = modal.querySelector('#edit-whatsapp');

    nameInput.addEventListener('input', () => clearProfileFieldError(nameInput));
    collegeIdInput.addEventListener('input', () => clearProfileFieldError(collegeIdInput));
    waInput.addEventListener('input', () => clearProfileFieldError(waInput, waInput.parentElement));
    
    modal.querySelector('#cancel-edit-btn').addEventListener('click', () => modal.remove());

    modal.querySelector('#save-profile-btn').addEventListener('click', async () => {
        const errorDiv = modal.querySelector('#edit-error');
        const saveBtn = modal.querySelector('#save-profile-btn');

        errorDiv.textContent = "";
        clearProfileFieldError(nameInput);
        clearProfileFieldError(collegeIdInput);
        clearProfileFieldError(waInput, waInput.parentElement);

        const name = nameInput.value.trim();
        const collegeId = collegeIdInput.value.trim();
        const rawWa = waInput.value.trim();

        let hasError = false;
        let firstInvalid = null;

        const markInvalid = (el, msg, anchor = null) => {
            setProfileFieldError(el, msg, anchor);
            hasError = true;
            if (!firstInvalid) firstInvalid = el;
        };

        if (!name) {
            markInvalid(nameInput, 'Display Name is required');
        }
        if (!collegeId) {
            markInvalid(collegeIdInput, 'College Roll Number is required');
        }
        const cleanedWa = rawWa.replace(/\D/g, '');
        if (!rawWa) {
            markInvalid(waInput, 'WhatsApp Number is required', waInput.parentElement);
        } else if (cleanedWa.length !== 10) {
            markInvalid(waInput, 'WhatsApp number must be exactly 10 digits', waInput.parentElement);
        }

        if (hasError) {
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInvalid.focus();
            }
            return;
        }

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving...";
            
            const userDocId = generateUserDocId(name, collegeId, auth.currentUser.uid);
            const updatedData = {
                docId: userDocId,
                fullName: name,
                name: name,
                displayName: name,
                whatsapp: '+91' + rawWa,
                whatsappNumber: '+91' + rawWa,
                collegeID: collegeId
            };

            await saveUserProfile(userDocId, updatedData);
            
            // Instant UI Update
            const nameEl = dashboardContainer.querySelector('.profile-user-name');
            if (nameEl) nameEl.textContent = name;
            
            const settingsNameEl = dashboardContainer.querySelector('#settings-display-name');
            if (settingsNameEl) settingsNameEl.textContent = name;

            const settingsIdEl = dashboardContainer.querySelector('#settings-college-id');
            if (settingsIdEl) settingsIdEl.textContent = collegeId;

            const settingsWaEl = dashboardContainer.querySelector('#settings-whatsapp');
            if (settingsWaEl) settingsWaEl.textContent = updatedData.whatsapp;

            const avatarEl = dashboardContainer.querySelector('.profile-avatar-circle');
            if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
            
            currentProfile.fullName = name;
            currentProfile.name = name;
            currentProfile.displayName = name;
            currentProfile.whatsapp = updatedData.whatsapp;
            currentProfile.collegeID = collegeId;

            if (typeof window.updateHeaderUserProfile === 'function') {
                window.updateHeaderUserProfile(updatedData);
            }
            window.dispatchEvent(new CustomEvent('user-profile-updated', { detail: updatedData }));

            alert("Profile Updated Successfully!");
            modal.remove();
        } catch (err) {
            console.error(err);
            errorDiv.textContent = "Failed to update: " + err.message;
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
        }
    });
}
