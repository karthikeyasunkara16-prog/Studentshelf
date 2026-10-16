import { db, collection, addDoc, getDocs, getDoc, setDoc, query, where, deleteDoc, doc, orderBy, updateDoc, serverTimestamp, onSnapshot, auth } from './firebase.js';

// =====================================================================
// Human-Readable Custom Document ID Generators & Sanitization Helpers
// =====================================================================

/**
 * Clean/sanitize string helper: Replace spaces and special characters with underscores `_`
 */
export function sanitizeDocId(text, maxLength = 50) {
    if (!text) return '';
    return text.toString().trim()
        .replace(/[\s\W]+/g, '_')       // Replace spaces and special characters with _
        .replace(/^_+|_+$/g, '')          // Strip leading and trailing underscores
        .substring(0, maxLength);
}

// Backward compatibility helper
export function formatIdPart(text) {
    return sanitizeDocId(text, 25);
}

/**
 * Generates custom human-readable Document ID for Users:
 * docId = ${sanitizedFullName}_${collegeID} (e.g., Aswitha_24A31A4403 or ${collegeID})
 */
export function generateUserDocId(fullName, collegeID, fallbackUid = '') {
    const cleanName = sanitizeDocId(fullName, 30);
    const cleanCollegeId = sanitizeDocId(collegeID, 25);
    
    if (cleanName && cleanCollegeId) {
        return `${cleanName}_${cleanCollegeId}`;
    }
    if (cleanCollegeId) {
        return cleanCollegeId;
    }
    if (cleanName && fallbackUid) {
        return `${cleanName}_${sanitizeDocId(fallbackUid, 15)}`;
    }
    if (cleanName) {
        return cleanName;
    }
    return fallbackUid || ('User_' + Date.now());
}

/**
 * Generates custom human-readable Document ID for Listings / Products:
 * docId = ${sanitizedProductTitle}_by_${sanitizedSellerName}_${dateSlug} (e.g., Java_Class_Notes_by_Karthikeya_20261015)
 */
export function generateListingDocId(title, sellerName, dateInput = null) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateSlug = `${yyyy}${mm}${dd}`;

    const cleanTitle = sanitizeDocId(title, 35) || 'Item';
    const cleanSeller = sanitizeDocId(sellerName, 25) || 'Student';

    return `${cleanTitle}_by_${cleanSeller}_${dateSlug}`;
}

export async function addListing(listingData) {
    try {
        const baseDocId = generateListingDocId(listingData.title, listingData.sellerName);
        let customId = baseDocId;

        // Collision safety check: avoid overwriting if seller posts multiple items with same title on same date
        try {
            const existingSnap = await getDoc(doc(db, "listings", customId));
            if (existingSnap.exists()) {
                const timeSuffix = new Date().toTimeString().split(' ')[0].replace(/:/g, '').substring(0, 4);
                customId = `${baseDocId}_${timeSuffix}`;
            }
        } catch (checkErr) {
            console.warn("Listing collision check note:", checkErr);
        }

        const createdAtStr = listingData.createdAt 
            ? (typeof listingData.createdAt === 'number' ? new Date(listingData.createdAt).toISOString() : listingData.createdAt) 
            : new Date().toISOString();
        
        await setDoc(doc(db, "listings", customId), {
            ...listingData,
            docId: customId,
            id: customId,
            createdAt: createdAtStr
        });
        return customId;
    } catch (e) {
        console.error("Error adding document: ", e);
        throw e;
    }
}

/**
 * Normalizes category names to the clean standard:
 * ["All Items", "Books & Notes", "Electronics", "Lab Gear", "Hostel"]
 */
export function normalizeCategoryName(cat) {
    if (!cat) return '';
    const clean = cat.trim();
    if (clean === 'Books' || clean === 'Notes' || clean === 'Books & Notes') return 'Books & Notes';
    if (clean === 'Lab Equipment' || clean === 'Lab Gear') return 'Lab Gear';
    if (clean === 'Hostel Essentials' || clean === 'Hostel') return 'Hostel';
    if (clean === 'All Items' || clean === 'All') return 'All Items';
    return clean;
}

/**
 * Checks if a product matches a selected category:
 * - If selectedCategory === "All Items" (or "All"), display all items
 * - Checks if product.categories.includes(selectedCategory) (or normalized equivalent)
 * - Checks fallback product.category === selectedCategory
 */
export function isProductMatchingCategory(product, selectedCategory) {
    if (!selectedCategory || selectedCategory === 'All Items' || selectedCategory === 'All') {
        return true;
    }
    const targetNorm = normalizeCategoryName(selectedCategory);

    // 1. Multi-category array check
    if (Array.isArray(product.categories) && product.categories.length > 0) {
        if (product.categories.includes(selectedCategory)) return true;
        if (product.categories.some(c => normalizeCategoryName(c) === targetNorm)) return true;
    }

    // 2. Fallback check product.category string
    if (product.category) {
        if (product.category === selectedCategory) return true;
        if (normalizeCategoryName(product.category) === targetNorm) return true;
    }

    return false;
}

/**
 * Filters a list of products by category
 */
export function filterProductsByCategory(products, selectedCategory) {
    if (!Array.isArray(products)) return [];
    if (!selectedCategory || selectedCategory === 'All Items' || selectedCategory === 'All') {
        return products;
    }
    return products.filter(p => isProductMatchingCategory(p, selectedCategory));
}

export async function getListings(category = null, searchQuery = '') {
    try {
        // Without composite indexes, a generic query is best, followed by client filtering for a small scale app.
        const listingsRef = collection(db, "listings");
        const q = query(listingsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        let results = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            let match = true;
            if (category && !isProductMatchingCategory(data, category)) {
                match = false;
            }
            if (searchQuery && !data.title?.toLowerCase().includes(searchQuery.toLowerCase())) {
                match = false;
            }
            
            if (match) {
                results.push({ id: docSnap.id, docId: docSnap.id, ...data });
            }
        });
        return results;
    } catch (e) {
        console.error("Error getting listings: ", e);
        throw e;
    }
}

export async function getUserListings(userId) {
    try {
        const listingsRef = collection(db, "listings");
        const customDocId = localStorage.getItem('user_doc_id_' + userId);
        const queryIds = [userId];
        if (customDocId && customDocId !== userId) {
            queryIds.push(customDocId);
        }

        let resultsMap = new Map();
        for (const id of queryIds) {
            const q = query(listingsRef, where("sellerId", "==", id));
            const snapshot = await getDocs(q);
            snapshot.forEach((docSnapshot) => {
                resultsMap.set(docSnapshot.id, { id: docSnapshot.id, docId: docSnapshot.id, ...docSnapshot.data() });
            });
        }
        
        let results = Array.from(resultsMap.values());
        return results.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
        console.error("Error getting user listings: ", e);
        throw e;
    }
}

export async function deleteUserListing(listingId) {
    try {
        await deleteDoc(doc(db, "listings", listingId));
    } catch (e) {
        console.error("Error deleting document: ", e);
        throw e;
    }
}

export async function getListingById(id) {
    try {
        const docRef = doc(db, "listings", id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return { id: docSnap.id, docId: docSnap.id, ...docSnap.data() };
        } else {
            return null;
        }
    } catch (e) {
        console.error("Error getting document:", e);
        throw e;
    }
}

export async function markListingAsSold(listingId) {
    try {
        const docRef = doc(db, "listings", listingId);
        await updateDoc(docRef, { status: "sold" });
    } catch (e) {
        console.error("Error marking as sold: ", e);
        throw e;
    }
}

export async function addLead(leadData) {
    try {
        const shortTimestamp = Math.floor(Date.now() / 1000);
        const customId = `lead_${sanitizeDocId(leadData.buyerName)}_wants_${sanitizeDocId(leadData.productName)}_${shortTimestamp}`;
        
        await setDoc(doc(db, "leads", customId), {
            ...leadData,
            docId: customId,
            id: customId,
            timestamp: new Date().toISOString()
        });
        console.log("Lead captured with custom ID:", customId);
    } catch (e) {
        console.error("Error adding lead: ", e);
    }
}

export async function addRequest(requestData) {
    try {
        const shortTimestamp = Math.floor(Date.now() / 1000);
        const customId = `req_${sanitizeDocId(requestData.itemName)}_by_${sanitizeDocId(requestData.requesterName)}_${shortTimestamp}`;
        
        await setDoc(doc(db, "requests", customId), {
            ...requestData,
            docId: customId,
            id: customId,
            status: 'pending',
            timestamp: new Date().toISOString()
        });
        return customId;
    } catch (e) {
        console.error("Error adding request: ", e);
        throw e;
    }
}

export async function getRequests() {
    try {
        const requestsRef = collection(db, "requests");
        // Try the optimized query first
        const q = query(requestsRef, where("status", "==", "pending"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);
        
        let results = [];
        snapshot.forEach((docSnap) => {
            results.push({ id: docSnap.id, ...docSnap.data() });
        });
        return results;
    } catch (e) {
        console.warn("Optimized getRequests failed (likely missing index). Falling back to JS filtering.", e);
        try {
            // Fallback: Fetch all and filter in JS to avoid index requirement
            const requestsRef = collection(db, "requests");
            const qFallback = query(requestsRef, orderBy("timestamp", "desc"));
            const snapshot = await getDocs(qFallback);
            
            let results = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                // Show if status is pending OR status doesn't exist (old docs)
                if (!data.status || data.status === 'pending') {
                    results.push({ id: docSnap.id, ...data });
                }
            });
            return results;
        } catch (fallbackErr) {
            console.error("Fallback getRequests also failed:", fallbackErr);
            throw fallbackErr;
        }
    }
}

export async function getRequestCount() {
    try {
        const requestsRef = collection(db, "requests");
        const q = query(requestsRef, where("status", "==", "pending"));
        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (e) {
        console.warn("Optimized getRequestCount failed. Falling back to JS counting.", e);
        try {
            const requestsRef = collection(db, "requests");
            const snapshot = await getDocs(requestsRef);
            let count = 0;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.status || data.status === 'pending') count++;
            });
            return count;
        } catch (fallbackErr) {
            return 0;
        }
    }
}

export async function updateRequestStatus(requestId, status) {
    try {
        const docRef = doc(db, "requests", requestId);
        await updateDoc(docRef, { status: status });
    } catch (e) {
        console.error("Error updating request status: ", e);
        throw e;
    }
}

export async function createNotification(requesterId, listingId, itemName) {
    try {
        const cleanItem = formatChatIdPart(itemName);
        const notifDocId = `notif_match_${cleanItem}_${Date.now()}`;
        await setDoc(doc(db, "notifications", notifDocId), {
            docId: notifDocId,
            id: notifDocId,
            type: 'match',
            recipientId: requesterId,
            listingId: listingId,
            itemName: itemName,
            seen: false,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error("Error creating notification: ", e);
    }
}

export async function getUnreadNotifications(userId) {
    try {
        const customDocId = localStorage.getItem('user_doc_id_' + userId);
        const queryIds = [userId];
        if (customDocId && customDocId !== userId) {
            queryIds.push(customDocId);
        }

        let notifMap = new Map();
        for (const id of queryIds) {
            const q = query(
                collection(db, "notifications"), 
                where("recipientId", "==", id),
                where("seen", "==", false)
            );
            const snapshot = await getDocs(q);
            snapshot.forEach(docSnap => notifMap.set(docSnap.id, { id: docSnap.id, docId: docSnap.id, ...docSnap.data() }));
        }
        return Array.from(notifMap.values());
    } catch (e) {
        console.error("Error getting notifications: ", e);
        return [];
    }
}

export async function markNotificationsAsRead(userId) {
    try {
        const unread = await getUnreadNotifications(userId);
        const batch = unread.map(notif => {
            const docRef = doc(db, "notifications", notif.id);
            return updateDoc(docRef, { seen: true });
        });
        await Promise.all(batch);
    } catch (e) {
        console.error("Error marking as read: ", e);
    }
}

// =====================================================================
// User Profile Management with Human-Readable Custom Document IDs
// =====================================================================

/**
 * Resolves the custom human-readable Document ID for a given user identifier or profile data
 */
export async function resolveUserDocId(identifier, profileData = null) {
    if (!identifier) return null;
    
    // Check local mapping cache
    const cached = localStorage.getItem('user_doc_id_' + identifier);
    if (cached) return cached;
    
    // If profileData has fullName and collegeID, compute custom docId
    const name = profileData ? (profileData.fullName || profileData.name || profileData.displayName) : null;
    const collegeID = profileData ? (profileData.collegeID || profileData.collegeId) : null;
    if (name && collegeID) {
        const generated = generateUserDocId(name, collegeID, identifier);
        localStorage.setItem('user_doc_id_' + identifier, generated);
        return generated;
    }
    
    // Check if direct document exists in users/{identifier}
    try {
        const directSnap = await getDoc(doc(db, "users", identifier));
        if (directSnap.exists()) {
            return identifier;
        }
    } catch (e) {}
    
    // Query users collection by uid or authUid
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("uid", "==", identifier));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const foundId = snap.docs[0].id;
            localStorage.setItem('user_doc_id_' + identifier, foundId);
            return foundId;
        }
    } catch (e) {}

    // Fallback: generate from whatever name or collegeID is available
    if (name || collegeID) {
        const generated = generateUserDocId(name || '', collegeID || '', identifier);
        localStorage.setItem('user_doc_id_' + identifier, generated);
        return generated;
    }
    
    return identifier;
}

/**
 * Fetches user profile with backward-compatible lookup supporting:
 * 1. Custom document ID: users/${fullName}_${collegeID}
 * 2. Firebase Auth UID query
 */
export async function getUserProfile(identifier) {
    if (!identifier) return null;
    try {
        // 1. Direct getDoc on users/{identifier}
        const docRef = doc(db, "users", identifier);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const resolvedId = docSnap.id;
            if (data.uid) {
                localStorage.setItem('user_doc_id_' + data.uid, resolvedId);
            }
            localStorage.setItem('user_doc_id_' + resolvedId, resolvedId);
            return { id: resolvedId, docId: resolvedId, ...data };
        }
        
        // 2. Check local mapping cache
        const cachedDocId = localStorage.getItem('user_doc_id_' + identifier);
        if (cachedDocId && cachedDocId !== identifier) {
            const cachedSnap = await getDoc(doc(db, "users", cachedDocId));
            if (cachedSnap.exists()) {
                const data = cachedSnap.data();
                return { id: cachedSnap.id, docId: cachedSnap.id, ...data };
            }
        }
        
        // 3. Fallback Query by uid or authUid (for backward compatibility when passing Firebase Auth UID)
        const usersRef = collection(db, "users");
        const qUid = query(usersRef, where("uid", "==", identifier));
        const snapUid = await getDocs(qUid);
        if (!snapUid.empty) {
            const foundDoc = snapUid.docs[0];
            const data = foundDoc.data();
            localStorage.setItem('user_doc_id_' + identifier, foundDoc.id);
            return { id: foundDoc.id, docId: foundDoc.id, ...data };
        }
        
        const qAuthUid = query(usersRef, where("authUid", "==", identifier));
        const snapAuthUid = await getDocs(qAuthUid);
        if (!snapAuthUid.empty) {
            const foundDoc = snapAuthUid.docs[0];
            const data = foundDoc.data();
            localStorage.setItem('user_doc_id_' + identifier, foundDoc.id);
            return { id: foundDoc.id, docId: foundDoc.id, ...data };
        }
        
        return null;
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return null;
    }
}

/**
 * Subscribes to real-time user profile changes supporting both custom Document ID and Firebase UID
 */
export function subscribeToUserProfile(identifier, callback) {
    if (!identifier) return () => {};
    let unsubscribe = () => {};
    let isCancelled = false;

    const attach = (docIdToWatch) => {
        try {
            const docRef = doc(db, "users", docIdToWatch);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    callback({ id: docSnap.id, docId: docSnap.id, ...docSnap.data() });
                }
            }, (err) => {
                console.error("User profile subscription error:", err);
            });
        } catch (err) {
            console.error("Error setting up user profile observer:", err);
            return () => {};
        }
    };

    const cachedDocId = localStorage.getItem('user_doc_id_' + identifier);
    if (cachedDocId) {
        unsubscribe = attach(cachedDocId);
    } else {
        unsubscribe = attach(identifier);
        resolveUserDocId(identifier).then(resolvedId => {
            if (!isCancelled && resolvedId && resolvedId !== identifier && resolvedId !== cachedDocId) {
                if (typeof unsubscribe === 'function') unsubscribe();
                unsubscribe = attach(resolvedId);
            }
        }).catch(err => {
            console.warn("Could not resolve doc ID for user subscription:", err);
        });
    }

    return () => {
        isCancelled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
    };
}

/**
 * Saves or updates user profile under custom human-readable Document ID:
 * `docId = ${sanitizedFullName}_${collegeID}`
 */
export async function saveUserProfile(identifier, data) {
    try {
        let targetDocId = data.docId;
        
        if (!targetDocId) {
            const name = data.fullName || data.name || data.displayName;
            const collegeID = data.collegeID || data.collegeId;
            if (name && collegeID) {
                targetDocId = generateUserDocId(name, collegeID, identifier);
            }
        }
        
        if (!targetDocId) {
            targetDocId = await resolveUserDocId(identifier, data);
        }
        
        if (!targetDocId) {
            targetDocId = identifier;
        }
        
        const authUid = data.uid || (identifier !== targetDocId ? identifier : (auth.currentUser ? auth.currentUser.uid : identifier));
        
        const payload = {
            ...data,
            docId: targetDocId,
            uid: authUid,
            authUid: authUid,
            updatedAt: serverTimestamp()
        };
        
        const docRef = doc(db, "users", targetDocId);
        await setDoc(docRef, payload, { merge: true });
        
        // Cache mapping for future fast lookups
        if (authUid) {
            localStorage.setItem('user_doc_id_' + authUid, targetDocId);
        }
        localStorage.setItem('user_doc_id_' + targetDocId, targetDocId);
        localStorage.setItem('active_user_doc_id', targetDocId);
        
        return targetDocId;
    } catch (e) {
        console.error("Error saving user profile:", e);
        throw e;
    }
}

/**
 * Creates or resets a pending verification record in Firestore
 * `pendingVerifications/{email}` with `{ email, status: 'pending', createdAt: timestamp }`
 */
export async function createPendingVerification(email) {
    if (!email) return;
    const cleanEmail = email.trim().toLowerCase();
    const docId = cleanEmail.replace(/[\/\s]/g, '_');
    try {
        await setDoc(doc(db, 'pendingVerifications', docId), {
            email: cleanEmail,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
        console.log('[Firestore] Stored pendingVerifications/' + docId, { status: 'pending' });
    } catch (e) {
        console.warn('createPendingVerification note:', e);
    }
}

/**
 * Marks pending verification as verified in Firestore
 * `pendingVerifications/{email}` with `{ status: 'verified', verifiedAt: timestamp }`
 */
export async function markPendingVerificationVerified(email) {
    if (!email) return;
    const cleanEmail = email.trim().toLowerCase();
    const docId = cleanEmail.replace(/[\/\s]/g, '_');
    try {
        await setDoc(doc(db, 'pendingVerifications', docId), {
            email: cleanEmail,
            status: 'verified',
            verifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
        console.log('[Firestore] Marked pendingVerifications/' + docId, { status: 'verified' });
    } catch (e) {
        console.warn('markPendingVerificationVerified note:', e);
    }
}

/**
 * Attaches a real-time snapshot listener on `pendingVerifications/{email}`
 * Returns the unsubscribe function.
 */
export function listenToPendingVerification(email, onVerified) {
    if (!email || typeof onVerified !== 'function') return () => {};
    const cleanEmail = email.trim().toLowerCase();
    const docId = cleanEmail.replace(/[\/\s]/g, '_');

    try {
        return onSnapshot(doc(db, 'pendingVerifications', docId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data && data.status === 'verified') {
                    console.log('[Cross-Device Real-Time Sync] Firestore verification detected for:', cleanEmail);
                    onVerified(cleanEmail);
                }
            }
        }, (err) => {
            console.warn('listenToPendingVerification snapshot note:', err);
        });
    } catch (e) {
        console.warn('listenToPendingVerification setup note:', e);
        return () => {};
    }
}

export async function getUserRequests(userId) {
    try {
        const requestsRef = collection(db, "requests");
        const customDocId = localStorage.getItem('user_doc_id_' + userId);
        const queryIds = [userId];
        if (customDocId && customDocId !== userId) {
            queryIds.push(customDocId);
        }

        let resultsMap = new Map();
        for (const id of queryIds) {
            const q = query(requestsRef, where("requesterId", "==", id));
            const snapshot = await getDocs(q);
            snapshot.forEach(docSnap => {
                resultsMap.set(docSnap.id, { id: docSnap.id, docId: docSnap.id, ...docSnap.data() });
            });
        }
        
        let results = Array.from(resultsMap.values());
        return results.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (e) {
        console.error("Error fetching user requests:", e);
        return [];
    }
}

export async function deleteRequest(id) {
    try {
        await deleteDoc(doc(db, "requests", id));
    } catch (e) {
        console.error("Error deleting request:", e);
        throw e;
    }
}

// =====================================================================
// Chat System Controller with Human-Readable Custom Document IDs
// =====================================================================

export function formatChatIdPart(text) {
    if (!text) return 'unknown';
    return text.toString().toLowerCase().trim()
        .replace(/[\s\W]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 25);
}

/**
 * Initiates chat room using readable custom document ID:
 * `docId = ${senderName}_${receiverName}_${sanitizedProductTitle}`
 */
export async function initiateChat(senderName, receiverName, productName, senderId, receiverId, productId) {
    try {
        const cleanSender = formatChatIdPart(senderName);
        const cleanReceiver = formatChatIdPart(receiverName);
        const cleanProduct = formatChatIdPart(productName);
        const chatId = `${cleanSender}_${cleanReceiver}_${cleanProduct}`;

        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        
        if (!chatSnap.exists()) {
            await setDoc(chatRef, {
                docId: chatId,
                id: chatId,
                senderName,
                receiverName,
                productName,
                senderId,
                receiverId,
                productId,
                createdAt: new Date().toISOString()
            });
        }
        return chatId;
    } catch (e) {
        console.error("Error initiating chat: ", e);
        throw e;
    }
}

/**
 * Sends chat message using custom timestamped message Document ID:
 * `docId = msg_${Date.now()}_${cleanSender}`
 */
export async function sendMessage(chatId, senderName, receiverName, messageText, senderId = null, receiverId = null) {
    try {
        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        const chatData = chatSnap.exists() ? chatSnap.data() : {};
        const productName = chatData.productName || "Product";

        const currentUserId = auth.currentUser ? auth.currentUser.uid : senderId;

        // Resolve senderId and receiverId reliably from chatData
        let resolvedSenderId = senderId || currentUserId;
        let resolvedReceiverId = receiverId;

        if (chatSnap.exists()) {
            if (currentUserId && currentUserId === chatData.senderId) {
                resolvedSenderId = chatData.senderId;
                resolvedReceiverId = resolvedReceiverId || chatData.receiverId;
            } else if (currentUserId && currentUserId === chatData.receiverId) {
                resolvedSenderId = chatData.receiverId;
                resolvedReceiverId = resolvedReceiverId || chatData.senderId;
            } else if (senderName === chatData.senderName) {
                resolvedSenderId = resolvedSenderId || chatData.senderId;
                resolvedReceiverId = resolvedReceiverId || chatData.receiverId;
            } else if (senderName === chatData.receiverName) {
                resolvedSenderId = resolvedSenderId || chatData.receiverId;
                resolvedReceiverId = resolvedReceiverId || chatData.senderId;
            }
        }

        const cleanSender = formatChatIdPart(senderName);
        const msgDocId = `msg_${Date.now()}_${cleanSender}`;
        const messageRef = doc(db, "chats", chatId, "messages", msgDocId);

        await setDoc(messageRef, {
            docId: msgDocId,
            id: msgDocId,
            senderId: resolvedSenderId || null,
            receiverId: resolvedReceiverId || null,
            senderName,
            receiverName,
            messageText,
            productName,
            chatId,
            timestamp: serverTimestamp(),
            isRead: false
        });

        // Update chat room metadata with last message details
        await setDoc(chatRef, {
            lastMessageText: messageText,
            lastMessageTimestamp: serverTimestamp(),
            lastMessageSenderName: senderName,
            lastMessageSenderId: resolvedSenderId || null,
            lastMessageReceiverId: resolvedReceiverId || null
        }, { merge: true });
    } catch (e) {
        console.error("Error sending message: ", e);
        throw e;
    }
}

export function subscribeToMessages(chatId, callback) {
    try {
        const messagesRef = collection(db, "chats", chatId, "messages");
        const q = query(messagesRef, orderBy("timestamp", "asc"));
        
        let isInitial = true;
        
        return onSnapshot(q, (snapshot) => {
            try {
                let messages = [];
                snapshot.forEach((doc) => {
                    messages.push({ id: doc.id, ...doc.data() });
                });
                
                // Recipient-Only Notifications for new incoming messages
                if (!isInitial) {
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === 'added') {
                            const msg = change.doc.data();
                            const user = auth.currentUser;
                            if (user) {
                                const currentUserId = user.uid;
                                const userEmailPrefix = user.email ? user.email.split('@')[0] : '';
                                const userDisplayName = user.displayName || '';
                                
                                // RECIPIENT-ONLY CHECK 1: If sent by current user, NEVER notify
                                const isSentByMe = (msg.senderId && msg.senderId === currentUserId) ||
                                                   (msg.senderName && (msg.senderName === userDisplayName || msg.senderName === userEmailPrefix));
                                if (isSentByMe) {
                                    return; // DO NOT NOTIFY SENDER
                                }
                                
                                // RECIPIENT-ONLY CHECK 2: Only notify if current user IS the receiver
                                const isReceiverMe = (msg.receiverId && msg.receiverId === currentUserId) ||
                                                     (msg.receiverName && (msg.receiverName === userDisplayName || msg.receiverName === userEmailPrefix));
                                if (!isReceiverMe && (msg.receiverId || msg.receiverName)) {
                                    return; // DO NOT NOTIFY NON-RECIPIENTS
                                }
                                
                                // Check if message timestamp is fresh (under 45s)
                                let isFresh = false;
                                if (msg.timestamp) {
                                    const msgDate = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                                    isFresh = (new Date() - msgDate) < 45000;
                                } else {
                                    isFresh = true;
                                }
                                
                                // Check if user is active on this specific chat view window
                                const chatOverlay = document.getElementById('chat-overlay');
                                const isOverlayActive = chatOverlay && chatOverlay.classList.contains('active');
                                const activeChatUserName = document.getElementById('chat-user-name')?.textContent;
                                const isActiveOnThisChat = isOverlayActive && activeChatUserName === msg.senderName;
                                
                                // Trigger only when overlay is closed, browser tab is backgrounded, or on another chat
                                const isNotActive = !isActiveOnThisChat || document.hidden;
                                
                                if (isFresh && isNotActive && ('Notification' in window) && Notification.permission === 'granted') {
                                    const sender = msg.senderName || 'Someone';
                                    const product = msg.productName || 'Product';
                                    const notifTitle = `New message from ${sender} about ${product}`;
                                    const notifBody = msg.messageText || msg.text || '';
                                    const notifOptions = {
                                        body: notifBody,
                                        icon: '/icon.png',
                                        badge: '/badge.png',
                                        data: { url: `#/messages` }
                                    };

                                    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
                                        navigator.serviceWorker.ready.then(reg => {
                                            reg.showNotification(notifTitle, notifOptions);
                                        }).catch(() => {
                                            new Notification(notifTitle, notifOptions);
                                        });
                                    } else {
                                        new Notification(notifTitle, notifOptions);
                                    }
                                }
                            }
                        }
                    });
                }
                
                isInitial = false;
                callback(messages);
            } catch (innerErr) {
                console.error("Error processing messages snapshot:", innerErr);
                callback([]);
            }
        }, (error) => {
            console.error("Error subscribing to messages: ", error);
            callback([]);
        });
    } catch (error) {
        console.error("Error initializing subscribeToMessages:", error);
        callback([]);
        return () => {};
    }
}

export async function getActiveChatsForItem(productId) {
    try {
        const chatsRef = collection(db, "chats");
        const q = query(chatsRef, where("productId", "==", productId));
        const snapshot = await getDocs(q);
        let results = [];
        snapshot.forEach((docSnap) => {
            results.push({ id: docSnap.id, ...docSnap.data() });
        });
        return results;
    } catch (e) {
        console.error("Error getting active chats: ", e);
        return [];
    }
}

export async function getUserChats(uid) {
    try {
        const chatsRef = collection(db, "chats");
        const customDocId = localStorage.getItem('user_doc_id_' + uid);
        const queryIds = [uid];
        if (customDocId && customDocId !== uid) {
            queryIds.push(customDocId);
        }

        let chatsMap = new Map();
        for (const id of queryIds) {
            const q1 = query(chatsRef, where("senderId", "==", id));
            const q2 = query(chatsRef, where("receiverId", "==", id));
            const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
            
            snap1.forEach(docSnap => {
                chatsMap.set(docSnap.id, { id: docSnap.id, docId: docSnap.id, ...docSnap.data() });
            });
            snap2.forEach(docSnap => {
                chatsMap.set(docSnap.id, { id: docSnap.id, docId: docSnap.id, ...docSnap.data() });
            });
        }
        
        let chatsList = Array.from(chatsMap.values());
        chatsList.sort((a, b) => {
            const timeA = a.lastMessageTimestamp ? (a.lastMessageTimestamp.toMillis ? a.lastMessageTimestamp.toMillis() : new Date(a.lastMessageTimestamp).getTime()) : 0;
            const timeB = b.lastMessageTimestamp ? (b.lastMessageTimestamp.toMillis ? b.lastMessageTimestamp.toMillis() : new Date(b.lastMessageTimestamp).getTime()) : 0;
            return timeB - timeA;
        });
        
        return chatsList;
    } catch (e) {
        console.error("Error getting user chats: ", e);
        return [];
    }
}

export async function hasUnreadMessagesInChat(chatId, currentUserName, currentUserId = null) {
    try {
        const uid = currentUserId || auth.currentUser?.uid;
        const messagesRef = collection(db, "chats", chatId, "messages");
        const snap = await getDocs(messagesRef);
        let hasUnread = false;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.isRead === false) {
                // Sender NEVER has unread messages for messages they sent
                const isSentByMe = (uid && data.senderId === uid) ||
                                   (currentUserName && data.senderName === currentUserName);
                if (!isSentByMe) {
                    // Check if receiver is the current user
                    const isForMe = (uid && data.receiverId === uid) ||
                                    (currentUserName && data.receiverName === currentUserName) ||
                                    (!data.receiverId && !data.receiverName);
                    if (isForMe) {
                        hasUnread = true;
                    }
                }
            }
        });
        return hasUnread;
    } catch (e) {
        console.error("Error checking unread messages: ", e);
        return false;
    }
}

export async function markMessagesAsRead(chatId, currentUserName, currentUserId = null) {
    try {
        const uid = currentUserId || auth.currentUser?.uid;
        const messagesRef = collection(db, "chats", chatId, "messages");
        const snap = await getDocs(messagesRef);
        
        const batch = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.isRead === false) {
                // Only mark messages sent TO me as read, ignore messages sent BY me
                const isSentByMe = (uid && data.senderId === uid) ||
                                   (currentUserName && data.senderName === currentUserName);
                if (!isSentByMe) {
                    const isForMe = (uid && data.receiverId === uid) ||
                                    (currentUserName && data.receiverName === currentUserName) ||
                                    (!data.receiverId && !data.receiverName);
                    if (isForMe) {
                        const docRef = doc(db, "chats", chatId, "messages", docSnap.id);
                        batch.push(updateDoc(docRef, { isRead: true }));
                    }
                }
            }
        });
        
        await Promise.all(batch);
    } catch (e) {
        console.error("Error marking messages as read: ", e);
    }
}

export function initNotificationSystem() {
    if (!('Notification' in window)) {
        console.warn("This browser does not support desktop notifications.");
        return;
    }
    
    const permission = Notification.permission;
    if (permission === 'default') {
        Notification.requestPermission().then((res) => {
            console.log("Notification permission response:", res);
            localStorage.setItem('notification_permission', res);
        });
    } else {
        localStorage.setItem('notification_permission', permission);
    }
}

export async function getMarketplaceStats() {
    try {
        const listingsSnapshot = await getDocs(collection(db, "listings"));
        const usersSnapshot = await getDocs(collection(db, "users"));
        return {
            listingsCount: listingsSnapshot.size,
            usersCount: usersSnapshot.size
        };
    } catch (e) {
        console.error("Error getting stats:", e);
        return {
            listingsCount: 0,
            usersCount: 0
        };
    }
}

export function subscribeToListings(callback) {
    try {
        const q = query(collection(db, "listings"), orderBy("createdAt", "desc"));
        return onSnapshot(q, (snapshot) => {
            try {
                const listings = [];
                snapshot.forEach(docSnap => {
                    listings.push({ id: docSnap.id, ...docSnap.data() });
                });
                callback(listings);
            } catch (innerErr) {
                console.error("Error processing listings snapshot:", innerErr);
                callback([]);
            }
        }, (error) => {
            console.error("Error in listings subscription:", error);
            callback([]);
        });
    } catch (error) {
        console.error("Error initializing subscribeToListings:", error);
        callback([]);
        return () => {};
    }
}

