import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, RecaptchaVerifier, signInWithPhoneNumber, sendPasswordResetEmail, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, applyActionCode, checkActionCode } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, setDoc, query, where, deleteDoc, doc, orderBy, updateDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

// ====== FIREBASE CONFIGURATION ======
// USER: Replace the values below with your Firebase Project Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDFZn2f8kH_mFgzH5FIJdARgIaQ0hn0kqM",
    authDomain: "studentshelf.firebaseapp.com",
    projectId: "studentshelf",
    storageBucket: "studentshelf.firebasestorage.app",
    messagingSenderId: "220940888620",
    appId: "1:220940888620:web:9a1a8471f54117c37f3f89",
    measurementId: "G-CSMR5XLSMK"
};
// ====================================

const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
let app, auth, db, messaging = null;

if (isConfigured) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // Compat helpers on auth
    auth.applyActionCode = (code) => applyActionCode(auth, code);
    auth.checkActionCode = (code) => checkActionCode(auth, code);
    auth.isSignInWithEmailLink = (url) => isSignInWithEmailLink(auth, url);
    auth.signInWithEmailLink = (email, url) => signInWithEmailLink(auth, email, url);

    window.firebase = window.firebase || {};
    window.firebase.auth = () => auth;

    // Compat helper on db for specification compatibility (e.g. db.collection('users').doc(id).update(...))
    if (!db.collection) {
        db.collection = function(colName) {
            return {
                doc: function(docId) {
                    return {
                        update: function(data) {
                            return updateDoc(doc(db, colName, docId), data).catch(() => {
                                return setDoc(doc(db, colName, docId), data, { merge: true });
                            });
                        },
                        set: function(data, options) {
                            return setDoc(doc(db, colName, docId), data, options);
                        },
                        get: function() {
                            return getDoc(doc(db, colName, docId));
                        }
                    };
                }
            };
        };
    }

    // Initialize Messaging safely if supported by browser environment
    isSupported().then((supported) => {
        if (supported) {
            try {
                messaging = getMessaging(app);
            } catch (err) {
                console.log("FCM messaging initialization note:", err);
            }
        }
    }).catch(() => {});
} else {
    console.warn("⚠️ Firebase is not configured! Check js/firebase.js");
}

export {
    app, auth, db, messaging, isConfigured, firebaseConfig,
    onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, RecaptchaVerifier, signInWithPhoneNumber, sendPasswordResetEmail, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, applyActionCode, checkActionCode,
    collection, addDoc, getDocs, getDoc, setDoc, query, where, deleteDoc, doc, orderBy, updateDoc, serverTimestamp, onSnapshot,
    getMessaging, getToken, onMessage, isSupported
};
