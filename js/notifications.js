// =====================================================
// StudentShelf Web Push Notifications & FCM Service
// =====================================================

import { app, auth, db, messaging, isConfigured, doc, updateDoc, setDoc, collection, query, where, onSnapshot, orderBy, getMessaging, getToken, onMessage, isSupported } from './firebase.js';
import { saveUserProfile } from './db.js';

let activeChatListeners = new Map();

/**
 * Register Service Worker for FCM safely in background without blocking page render
 */
export async function registerFirebaseMessagingServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return null;
    }
    try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        return registration;
    } catch (err) {
        console.warn('Firebase Messaging SW background registration note:', err);
        return null;
    }
}

/**
 * Updates notificationsEnabled flag in Firestore using custom Document ID
 */
export async function setUserNotificationsEnabled(enabled, targetUserId) {
    const uid = targetUserId || auth.currentUser?.uid;
    if (!uid) return;
    try {
        await saveUserProfile(uid, {
            notificationsEnabled: Boolean(enabled),
            notificationsUpdatedAt: new Date().toISOString()
        });
        console.log(`Updated notificationsEnabled: ${enabled} in Firestore for ${uid}`);
    } catch (e) {
        console.warn("Could not update notificationsEnabled in Firestore:", e);
    }
}
window.setUserNotificationsEnabled = setUserNotificationsEnabled;

/**
 * Explicit Click Handler for "Enable Now" button and Notification permission triggers
 */
export async function handleEnableNotificationsClick(e, targetUserId) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }

    if (!("Notification" in window)) {
        console.warn("This browser does not support desktop notifications");
        hideFloatingPermissionBanner();
        return;
    }

    try {
        let permission;
        // 1. Execute Notification.requestPermission()
        const reqResult = Notification.requestPermission();
        if (reqResult && typeof reqResult.then === 'function') {
            permission = await reqResult;
        } else {
            permission = await new Promise((resolve) => {
                Notification.requestPermission(resolve);
            });
        }

        console.log("Notification permission response:", permission);

        // 2. Permanently dismiss banner on this device
        localStorage.setItem('notificationPermissionState', permission);
        localStorage.setItem('notificationBannerDismissed', 'true');

        // 3. Immediately hide/remove the banner from the DOM
        hideFloatingPermissionBanner();

        // 4. If permission is granted, retrieve FCM token, update Firestore (notificationsEnabled: true)
        const uid = targetUserId || auth.currentUser?.uid;
        if (permission === "granted") {
            console.log("Notification permission granted!");
            await setUserNotificationsEnabled(true, uid);
            await getAndSaveFCMToken(uid);
        } else {
            if (uid) {
                await setUserNotificationsEnabled(false, uid);
            }
        }
    } catch (err) {
        console.error("Error executing Notification.requestPermission():", err);
        hideFloatingPermissionBanner();
    }
}
window.handleEnableNotificationsClick = handleEnableNotificationsClick;

export function handleDismissBannerClick(e) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
        e.stopPropagation();
    }
    // Clicking "✕": Sets localStorage.setItem('notificationBannerDismissed', 'true') and immediately removes the banner from DOM
    localStorage.setItem('notificationBannerDismissed', 'true');
    localStorage.setItem('notificationPermissionState', 'denied');
    sessionStorage.setItem('notificationBannerDismissed', 'true');
    hideFloatingPermissionBanner();
}
window.handleDismissBannerClick = handleDismissBannerClick;

export function triggerNotificationPermission(targetUserId) {
    return handleEnableNotificationsClick(null, targetUserId);
}
window.triggerNotificationPermission = triggerNotificationPermission;

// Keep alias requestNotificationPermission for backwards-compatibility
export function requestNotificationPermission(userId) {
    triggerNotificationPermission(userId);
}
window.requestNotificationPermission = requestNotificationPermission;

/**
 * Attaches explicit click event listeners directly to Enable Now & Dismiss buttons
 */
export function attachNotificationBannerListeners() {
    const enableBtns = document.querySelectorAll('#enable-notifications-btn, .enable-notifications-btn, .banner-enable-btn');
    enableBtns.forEach((btn) => {
        if (!btn.dataset.notifListenerAttached) {
            btn.dataset.notifListenerAttached = 'true';
            btn.addEventListener('click', (e) => {
                handleEnableNotificationsClick(e);
            });
        }
    });

    const dismissBtns = document.querySelectorAll('#dismiss-notifications-banner, .banner-dismiss-btn');
    dismissBtns.forEach((btn) => {
        if (!btn.dataset.notifListenerAttached) {
            btn.dataset.notifListenerAttached = 'true';
            btn.addEventListener('click', (e) => {
                handleDismissBannerClick(e);
            });
        }
    });
}

/**
 * 1. FIRST-TIME PROMPT BANNER (MOBILE PWA STANDARD):
 * On page load / DOMContentLoaded:
 * Display the Notification Permission Banner ONLY on first-time visits or fresh app installs if:
 * Notification.permission === 'default' AND localStorage.getItem('notificationBannerDismissed') !== 'true'
 * On subsequent app opens or page refreshes, if permission status is already decided ('granted'/'denied') or dismissed, DO NOT show the banner again.
 */
export function checkAndPersistNotificationState() {
    if (!("Notification" in window)) {
        hideFloatingPermissionBanner();
        return;
    }

    const isDismissed = localStorage.getItem('notificationBannerDismissed') === 'true';
    const isDecided = Notification.permission === 'granted' || Notification.permission === 'denied';

    if (isDismissed || isDecided) {
        // Automatically hide/suppress banner permanently on this device
        hideFloatingPermissionBanner();

        // If granted, ensure FCM token is saved for authenticated user
        if (Notification.permission === 'granted' && auth?.currentUser?.uid) {
            getAndSaveFCMToken(auth.currentUser.uid);
        }
    } else {
        // First-time visit or fresh install: attach listeners and show banner
        renderFloatingPermissionBanner();
    }
}
window.checkAndPersistNotificationState = checkAndPersistNotificationState;

// Run device persistence check on DOM ready and window load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndPersistNotificationState);
} else {
    checkAndPersistNotificationState();
}
window.addEventListener('load', checkAndPersistNotificationState);

/**
 * FALLBACK FLOATING PERMISSION BANNER:
 * Shows a floating banner ONLY if Notification.permission === 'default' AND localStorage.getItem('notificationBannerDismissed') !== 'true'
 */
export function renderFloatingPermissionBanner() {
    if (!("Notification" in window)) return;

    // Display banner ONLY on first-time visits or fresh app installs if:
    // Notification.permission === 'default' AND localStorage.getItem('notificationBannerDismissed') !== 'true'
    if (Notification.permission !== 'default' || localStorage.getItem('notificationBannerDismissed') === 'true') {
        hideFloatingPermissionBanner();
        return;
    }

    if (sessionStorage.getItem('notificationBannerDismissed') === 'true') {
        hideFloatingPermissionBanner();
        return;
    }

    let banner = document.getElementById('notification-permission-banner');
    if (banner) {
        banner.style.display = 'flex';
        banner.style.setProperty('display', 'flex', 'important');
        attachNotificationBannerListeners();
        return;
    }

    banner = document.createElement('div');
    banner.id = 'notification-permission-banner';
    banner.className = 'notification-permission-banner';
    banner.innerHTML = `
        <div class="banner-content">
            <span class="banner-icon">🔔</span>
            <span class="banner-text">Enable Push Notifications to get instant chat alerts when students message about your items!</span>
        </div>
        <div class="banner-actions">
            <button id="enable-notifications-btn" class="banner-enable-btn enable-notifications-btn" type="button">Enable Now</button>
            <button id="dismiss-notifications-banner" class="banner-dismiss-btn" type="button" aria-label="Close">✕</button>
        </div>
    `;
    document.body.appendChild(banner);
    banner.style.display = 'flex';
    banner.style.setProperty('display', 'flex', 'important');
    attachNotificationBannerListeners();
}
window.renderFloatingPermissionBanner = renderFloatingPermissionBanner;

export function hideFloatingPermissionBanner() {
    const banners = document.querySelectorAll('#notification-permission-banner, .notification-permission-banner');
    banners.forEach((banner) => {
        banner.style.display = 'none';
        banner.style.setProperty('display', 'none', 'important');
    });
}
window.hideFloatingPermissionBanner = hideFloatingPermissionBanner;

/**
 * 3. FCM TOKEN LOGGING & FIRESTORE SAVE:
 * Requests FCM token cleanly and updates Firestore active user document (users/{uid}/fcmToken)
 */
export async function getAndSaveFCMToken(targetUserId) {
    const uid = targetUserId || auth.currentUser?.uid;
    try {
        const swReg = await registerFirebaseMessagingServiceWorker();
        const supported = await isSupported().catch(() => false);

        if (supported && isConfigured) {
            const msgInstance = messaging || getMessaging(app);
            if (!msgInstance) return null;

            const tokenOptions = {};
            if (swReg) tokenOptions.serviceWorkerRegistration = swReg;

            // Handle VAPID key: only include if a valid non-dummy key is provided
            const customVapidKey = window.VAPID_KEY || window.FCM_VAPID_KEY;
            if (customVapidKey && customVapidKey !== 'YOUR_PUBLIC_VAPID_KEY' && typeof customVapidKey === 'string') {
                tokenOptions.vapidKey = customVapidKey;
            }

            try {
                const currentToken = await getToken(msgInstance, tokenOptions);
                if (currentToken) {
                    console.log("FCM push notification token initialized successfully.");
                    if (uid) {
                        // Save FCM token under user's custom Firestore document
                        await saveUserProfile(uid, {
                            fcmToken: currentToken,
                            notificationsEnabled: true,
                            lastFcmTokenUpdate: new Date().toISOString()
                        });
                        console.log("FCM push token preference saved in user profile.");
                    }
                    return currentToken;
                } else {
                    console.log("No registration token available. Request permission to generate one.");
                }
            } catch (tokenErr) {
                console.log("FCM Token Error:", tokenErr);
            }

            // Foreground message handler
            onMessage(msgInstance, (payload) => {
                console.log('Foreground FCM message received:', payload);
                const title = payload.notification?.title || payload.data?.title || "StudentShelf Update";
                const body = payload.notification?.body || payload.data?.body || "";
                triggerNativeNotification(title, body, payload.data?.url || '#/messages');
            });
        }
    } catch (err) {
        console.log("Error in getAndSaveFCMToken:", err);
    }
    return null;
}
window.getAndSaveFCMToken = getAndSaveFCMToken;

/**
 * Global User Gesture Event Delegation fallback for Notification Bell & Banner Triggers
 */
document.addEventListener('click', (e) => {
    // 1. Notification Bell Icon click
    if (e.target.closest('#notification-bell, #notif-bell-btn, .bell-icon, [data-action="notifications"]')) {
        handleEnableNotificationsClick(e);
        return;
    }

    // 2. Banner "Enable Now" click
    if (e.target.closest('#enable-notifications-btn, .enable-notifications-btn, .banner-enable-btn')) {
        handleEnableNotificationsClick(e);
        return;
    }

    // 3. Banner "✕" dismiss click
    if (e.target.closest('#dismiss-notifications-banner, .banner-dismiss-btn')) {
        localStorage.setItem('notificationPermissionState', 'denied');
        sessionStorage.setItem('notificationBannerDismissed', 'true');
        hideFloatingPermissionBanner();
        return;
    }
});

/**
 * Triggers native browser popup notification via Service Worker or Notification API
 */
export function triggerNativeNotification(title, body, url = '#/messages') {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    const options = {
        body: body,
        icon: '/icon.png',
        badge: '/badge.png',
        data: { url: url }
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options);
        }).catch(() => {
            try {
                new Notification(title, options);
            } catch (e) {}
        });
    } else {
        try {
            new Notification(title, options);
        } catch (e) {}
    }
}

/**
 * Real-time Chat Trigger:
 * Whenever a chat message document is added to chats/{chatId}/messages,
 * triggers native browser popup for recipient: "New message from [Sender] about [Product Name]"
 */
export function setupRealtimeChatNotificationTrigger(userId, userName) {
    if (!userId) return () => {};

    // Detach previous listeners
    detachRealtimeChatNotifications();

    try {
        const chatsRef = collection(db, "chats");
        const q1 = query(chatsRef, where("receiverId", "==", userId));
        const q2 = query(chatsRef, where("senderId", "==", userId));

        const bindChatListener = (chatDoc) => {
            const chatId = chatDoc.id;
            if (activeChatListeners.has(chatId)) return;

            const chatData = chatDoc.data() || {};
            const productName = chatData.productName || "Product";

            const messagesRef = collection(db, "chats", chatId, "messages");
            const messagesQuery = query(messagesRef, orderBy("timestamp", "asc"));
            let isInitialLoad = true;

            const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
                if (isInitialLoad) {
                    isInitialLoad = false;
                    return;
                }

                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const msg = change.doc.data();
                        const sender = msg.senderName || 'Someone';
                        const product = msg.productName || productName;
                        
                        // 1. RECIPIENT-ONLY NOTIFICATION CHECK:
                        // Extract senderId, receiverId, and current user ID
                        const currentUserId = auth.currentUser?.uid || userId;
                        const userEmailPrefix = auth.currentUser?.email ? auth.currentUser.email.split('@')[0] : '';
                        const userDisplayName = auth.currentUser?.displayName || '';

                        // Explicit check: If current user is the sender -> STRICTLY DO NOT NOTIFY
                        const isSentByMe = (msg.senderId && msg.senderId === currentUserId) ||
                                           (msg.senderName && (msg.senderName === userName || msg.senderName === userDisplayName || msg.senderName === userEmailPrefix));

                        if (isSentByMe) {
                            return; // DO NOT NOTIFY SENDER
                        }

                        // Explicit check: Only dispatch notification when current user IS the recipient
                        const isReceiverMe = (msg.receiverId && msg.receiverId === currentUserId) ||
                                             (msg.receiverName && (msg.receiverName === userName || msg.receiverName === userDisplayName || msg.receiverName === userEmailPrefix));

                        if (!isReceiverMe && (msg.receiverId || msg.receiverName)) {
                            return; // DO NOT NOTIFY NON-RECIPIENTS
                        }

                        // Check freshness (must be under 45 seconds old)
                        let isFresh = true;
                        if (msg.timestamp) {
                            const msgTime = msg.timestamp.toDate ? msg.timestamp.toDate().getTime() : new Date(msg.timestamp).getTime();
                            isFresh = (Date.now() - msgTime) < 45000;
                        }

                        // Check if chat overlay is currently open and active for this specific chat
                        const chatOverlay = document.getElementById('chat-overlay');
                        const isOverlayActive = chatOverlay && chatOverlay.classList.contains('active');
                        const activeChatUserName = document.getElementById('chat-user-name')?.textContent;
                        const isActiveOnThisChat = isOverlayActive && activeChatUserName === sender;
                        const shouldNotify = !isActiveOnThisChat || document.hidden;

                        if (isFresh && shouldNotify) {
                            const title = `New message from ${sender} about ${product}`;
                            const body = msg.messageText || msg.text || 'Sent you a new message';
                            triggerNativeNotification(title, body, `#/messages`);
                        }
                    }
                });
            }, (err) => {
                console.log(`Chat listener note for ${chatId}:`, err);
            });

            activeChatListeners.set(chatId, unsubscribe);
        };

        const unsub1 = onSnapshot(q1, (snap) => {
            snap.forEach(bindChatListener);
        }, () => {});

        const unsub2 = onSnapshot(q2, (snap) => {
            snap.forEach(bindChatListener);
        }, () => {});

        return () => {
            unsub1();
            unsub2();
            detachRealtimeChatNotifications();
        };
    } catch (e) {
        console.warn("Could not setup realtime chat notifications:", e);
        return () => {};
    }
}

export function detachRealtimeChatNotifications() {
    activeChatListeners.forEach((unsub) => {
        try { unsub(); } catch (e) {}
    });
    activeChatListeners.clear();
}
