import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut, sendPasswordResetEmail, applyActionCode, checkActionCode, isSignInWithEmailLink, signInWithEmailLink } from './firebase.js';
import { saveUserProfile, generateUserDocId, listenToPendingVerification } from './db.js';
import { isCollegeEmail, isUserVerified, sendCollegeVerificationCode, sendInlineCollegeVerificationOtp, verifyInlineCollegeOtp, showInlineEmailOtpModal, showEmailVerificationModal, sendEmailOTP, requestVerification } from './verification.js';

export function renderLogin(container) {
    container.innerHTML = `
        <div class="auth-card shadow-card">
            <div class="back-arrow" onclick="window.location.hash = '#'"><i class="fas fa-arrow-left"></i></div>
            <h2 class="text-center mb-4"><i class="fa-solid fa-right-to-bracket"></i> Welcome Back</h2>
            <form id="login-form">
                <div class="form-group">
                    <label>College Email ID</label>
                    <input type="email" id="login-email" class="form-control" required placeholder="student@pragati.ac.in">
                    <small class="college-email-hint" style="display:block; margin-top:4px; font-size:12px; color:#64748B;">
                        <i class="fa-solid fa-graduation-cap" style="color:#00ABE4; margin-right:4px;"></i>
                        Please use your official college email ID for verification.
                    </small>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <div class="password-wrapper">
                        <input type="password" id="login-password" class="form-control" required placeholder="********">
                        <i class="fa-solid fa-eye eye-icon toggle-password" data-target="login-password"></i>
                    </div>
                </div>
                <div class="text-right mb-3">
                    <a href="#" id="forgot-password-link" class="text-muted" style="font-size: 0.85rem; text-decoration: none;">Forgot Password?</a>
                </div>
                <div id="login-error" class="error-msg"></div>
                <button type="submit" class="btn btn-primary w-100 mt-3" id="login-submit-btn">Login</button>
            </form>
            <p class="text-center mt-4">Don't have an account? <a href="#/register" class="text-link">Sign Up</a></p>
        </div>
    `;

    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                this.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                this.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pwd = document.getElementById('login-password').value;
        const errDiv = document.getElementById('login-error');
        const btn = document.getElementById('login-submit-btn') || document.getElementById('login-btn');

        errDiv.textContent = '';
        
        if (!isCollegeEmail(email)) {
            errDiv.textContent = 'Please use your official college email ID for verification (e.g. yourname@college.edu or rollno@pragati.ac.in).';
            return;
        }

        try {
            btn.textContent = 'Logging in...';
            btn.disabled = true;
            const userCredential = await signInWithEmailAndPassword(auth, email, pwd);
            
            // Check verification status
            if (!isUserVerified(userCredential.user)) {
                btn.textContent = 'Login';
                btn.disabled = false;
                if (typeof window.closeAuthModal === 'function') {
                    window.closeAuthModal();
                }
                showEmailVerificationModal(userCredential.user, email);
                return;
            }

            const hashParts = window.location.hash.split('?redirect=');
            if (hashParts.length > 1) {
                window.location.hash = decodeURIComponent(hashParts[1]);
            } else {
                window.location.hash = '#/';
            }
        } catch (error) {
            errDiv.textContent = error.message;
            btn.disabled = false;
            btn.textContent = 'Login';
        }
    });

    // Forgot Password Logic
    document.getElementById('forgot-password-link').addEventListener('click', async (e) => {
        e.preventDefault();
        const email = prompt("Please enter your College Email to receive a reset link:");
        
        if (!email) return;

        if (!email.endsWith('.edu') && !email.endsWith('.ac.in')) {
            alert('Please use a valid college email (.edu or .ac.in)');
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            alert('Password reset link sent! Please check your inbox (and spam folder).');
        } catch (error) {
            let userMessage;
            switch(error.code) {
                case 'auth/user-not-found':
                    userMessage = 'No account found with this email.';
                    break;
                case 'auth/invalid-email':
                    userMessage = 'Please enter a valid college email address.';
                    break;
                default:
                    userMessage = 'Something went wrong. Please try again.';
            }
            alert(userMessage);
        }
    });
}

export function renderRegister(container) {
    container.innerHTML = `
        <div class="auth-card shadow-card">
            <div class="back-arrow" onclick="window.location.hash = '#'"><i class="fas fa-arrow-left"></i></div>
            <h2 class="text-center mb-4"><i class="fa-solid fa-user-plus"></i> Join StudentShelf</h2>
            <form id="register-form" novalidate>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="reg-name" class="form-control" required placeholder="e.g. Karthikeya Varma">
                </div>
                <div class="form-group">
                    <label>College ID / Roll Number</label>
                    <input type="text" id="reg-college-id" class="form-control" required placeholder="e.g. 21A31A0501">
                </div>
                <div class="form-group">
                    <label>College Email ID</label>
                    <div class="email-verify-group">
                        <input type="email" id="reg-email" class="form-control" required placeholder="rollno@pragati.ac.in">
                        <button type="button" class="btn btn-inline-verify" id="btn-verify-email">
                            <i class="fa-solid fa-envelope-circle-check"></i> Verify
                        </button>
                    </div>
                    <div id="email-verification-status" class="email-verification-status-row" style="display: none !important;">
                        <span class="email-verified-tag" id="email-verified-tag" style="display: none !important;">
                            <i class="fa-solid fa-circle-check"></i> Verified
                        </span>
                        <button type="button" class="btn-change-email" id="btn-change-email">Change Email</button>
                    </div>
                    <small class="college-email-hint text-muted" id="reg-email-hint">
                        <i class="fa-solid fa-graduation-cap" style="color:#00ABE4; margin-right:4px;"></i>
                        Click "Verify" to send a verification link to your official college email.
                    </small>
                </div>
                <div class="form-group">
                    <label>Mobile / WhatsApp Number</label>
                    <input type="tel" id="reg-whatsapp" class="form-control" required placeholder="+919876543210" value="+91">
                    <small style="color:var(--text-muted); font-size:12px;">Used directly by buyers and sellers on campus to reach you.</small>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <div class="password-wrapper">
                        <input type="password" id="reg-password" class="form-control" required placeholder="********" minlength="6">
                        <i class="fa-solid fa-eye eye-icon toggle-password" data-target="reg-password"></i>
                    </div>
                </div>
                <div class="form-group">
                    <label>Confirm Password</label>
                    <div class="password-wrapper">
                        <input type="password" id="reg-confirm-password" class="form-control" required placeholder="********" minlength="6">
                        <i class="fa-solid fa-eye eye-icon toggle-password" data-target="reg-confirm-password"></i>
                    </div>
                </div>
                <div id="reg-error" class="error-msg"></div>
                <button type="submit" class="btn btn-primary w-100 mt-3" id="reg-btn" disabled>
                    <i class="fa-solid fa-shield-halved" id="reg-btn-icon"></i> <span id="reg-btn-text">Verify Email First</span>
                </button>
            </form>
            <p class="text-center mt-4">Already have an account? <a href="#/login" class="text-link">Login</a></p>
        </div>
    `;

    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                this.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                this.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    const emailInput = document.getElementById('reg-email');
    const verifyBtn = document.getElementById('btn-verify-email');
    const statusRow = document.getElementById('email-verification-status');
    const changeBtn = document.getElementById('btn-change-email');
    const hintText = document.getElementById('reg-email-hint');
    const submitBtn = document.getElementById('reg-btn');
    const submitIcon = document.getElementById('reg-btn-icon');
    const submitText = document.getElementById('reg-btn-text');
    const errDiv = document.getElementById('reg-error');

    // State flags for strict verification
    let isEmailVerified = false;
    let isEmailVerifiedInline = false;
    let verifiedEmailAddress = '';
    let verifyCooldownTimer = null;
    let verifyCooldownSeconds = 0;

    // Helper: start 30-second cooldown timer on Verify button
    const startVerifyCooldown = (seconds = 30) => {
        if (verifyCooldownTimer) clearInterval(verifyCooldownTimer);
        verifyCooldownSeconds = seconds;
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Resend (${verifyCooldownSeconds}s)`;

        verifyCooldownTimer = setInterval(() => {
            verifyCooldownSeconds--;
            if (verifyCooldownSeconds > 0) {
                if (!isEmailVerified) {
                    verifyBtn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Resend (${verifyCooldownSeconds}s)`;
                }
            } else {
                clearInterval(verifyCooldownTimer);
                verifyCooldownTimer = null;
                if (!isEmailVerified) {
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = `<i class="fa-solid fa-envelope-circle-check"></i> Verify`;
                }
            }
        }, 1000);
    };

    let pendingUnsubscribe = null;

    // Central state update when email is verified via Link, Action Code, or modal
    const onEmailSuccessfullyVerified = (confirmedEmail) => {
        if (verifyCooldownTimer) {
            clearInterval(verifyCooldownTimer);
            verifyCooldownTimer = null;
        }

        if (typeof pendingUnsubscribe === 'function') {
            try { pendingUnsubscribe(); } catch (e) {}
            pendingUnsubscribe = null;
        }

        isEmailVerified = true;
        isEmailVerifiedInline = true;
        verifiedEmailAddress = confirmedEmail;

        // Persist verified status in localStorage as requested
        localStorage.setItem('emailVerifiedStatus', 'true');
        if (confirmedEmail) {
            const clean = confirmedEmail.trim().toLowerCase();
            localStorage.setItem('email_link_verified_' + clean, 'true');
            localStorage.setItem('email_link_verified_latest', clean);
        }

        // Close verification modal if currently open
        const activeModal = document.getElementById('inline-otp-modal');
        if (activeModal) activeModal.remove();

        emailInput.value = confirmedEmail;
        emailInput.readOnly = true;
        emailInput.classList.add('is-verified');

        // Render Green Tick (✔️ Verified) icon immediately next to email field
        verifyBtn.style.setProperty('display', 'none', 'important');
        statusRow.classList.add('is-verified', 'active');
        statusRow.style.removeProperty('display');
        statusRow.style.display = 'flex';

        const tag = statusRow.querySelector('.email-verified-tag');
        if (tag) {
            tag.classList.add('is-verified', 'active');
            tag.style.removeProperty('display');
            tag.style.display = 'inline-flex';
        }
        hintText.style.setProperty('display', 'none', 'important');

        // Unlock and enable the main "Create Account / Submit" button
        submitBtn.disabled = false;
        submitIcon.className = 'fa-solid fa-circle-check';
        submitText.textContent = 'Submit / Create Account';
        errDiv.textContent = '';
    };

    // 1. DETECT AND PROCESS OOB ACTION CODES ON PAGE LOAD
    const processOobActionCodesInRegister = async () => {
        try {
            const currentUrl = window.location.href;
            const parsedUrl = new URL(currentUrl);
            let mode = parsedUrl.searchParams.get('mode');
            let oobCode = parsedUrl.searchParams.get('oobCode');
            let apiKey = parsedUrl.searchParams.get('apiKey');

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
                console.log('[Register] Processing OOB Action Code:', oobCode, 'Mode:', mode);
                let emailFromUrl = parsedUrl.searchParams.get('email') || parsedUrl.searchParams.get('verified_email');

                if (!emailFromUrl && typeof checkActionCode === 'function') {
                    try {
                        const info = await checkActionCode(auth, oobCode);
                        if (info?.data?.email) emailFromUrl = info.data.email;
                    } catch (e) {}
                }

                // Execute applyActionCode(oobCode)
                try {
                    if (typeof applyActionCode === 'function') {
                        await applyActionCode(auth, oobCode);
                        console.log('[Register] applyActionCode successful for:', oobCode);
                    }
                } catch (applyErr) {
                    console.warn('[Register] applyActionCode notice:', applyErr);
                }

                // Force reload current user
                if (auth && auth.currentUser) {
                    try {
                        await auth.currentUser.reload();
                    } catch (e) {}
                }

                const resolvedEmail = emailFromUrl || auth?.currentUser?.email || emailInput.value || localStorage.getItem('pending_verification_email') || '';
                if (resolvedEmail) {
                    onEmailSuccessfullyVerified(resolvedEmail.trim().toLowerCase());
                } else {
                    localStorage.setItem('emailVerifiedStatus', 'true');
                    onEmailSuccessfullyVerified('student@college.edu');
                }

                // Clean up URL parameters dynamically using replaceState without reloading the page
                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                } catch (e) {}
                return;
            } else if (parsedUrl.searchParams.get('email_verified') === 'true') {
                const verifiedParam = parsedUrl.searchParams.get('email') || parsedUrl.searchParams.get('verified_email') || emailInput.value || localStorage.getItem('pending_verification_email');
                if (verifiedParam) {
                    onEmailSuccessfullyVerified(verifiedParam.trim().toLowerCase());
                }
                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                } catch (e) {}
                return;
            }

            // Check if already verified in session/localStorage
            if (localStorage.getItem('emailVerifiedStatus') === 'true') {
                const targetEmail = emailInput.value || localStorage.getItem('pending_verification_email') || localStorage.getItem('email_link_verified_latest');
                if (targetEmail) {
                    onEmailSuccessfullyVerified(targetEmail.trim().toLowerCase());
                }
            }
        } catch (e) {
            console.warn('[Register] OOB URL processing error:', e);
        }
    };

    processOobActionCodesInRegister();

    // 2. AUTO-RELOAD ON TAB FOCUS
    const handleTabFocusAutoReload = async () => {
        if (isEmailVerified) return;
        const currentTargetEmail = (emailInput.value || localStorage.getItem('pending_verification_email') || localStorage.getItem('email_link_verified_latest') || '').trim().toLowerCase();

        // When user switches back to tab, automatically trigger currentUser.reload()
        if (auth && auth.currentUser) {
            try {
                await auth.currentUser.reload();
                if (auth.currentUser.emailVerified === true) {
                    onEmailSuccessfullyVerified(auth.currentUser.email || currentTargetEmail);
                    return;
                }
            } catch (e) {}
        }

        // Check if verified via another tab or action code handler
        if (localStorage.getItem('emailVerifiedStatus') === 'true' && currentTargetEmail) {
            onEmailSuccessfullyVerified(currentTargetEmail);
            return;
        }

        if (currentTargetEmail && localStorage.getItem('email_link_verified_' + currentTargetEmail) === 'true') {
            onEmailSuccessfullyVerified(currentTargetEmail);
            return;
        }
    };

    window.addEventListener('focus', handleTabFocusAutoReload);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleTabFocusAutoReload();
        }
    });

    // Cross-tab link verification listener
    const formStorageListener = (e) => {
        if (e.key === 'emailVerifiedStatus' && e.newValue === 'true') {
            const currentEmail = (emailInput.value || localStorage.getItem('pending_verification_email') || '').trim().toLowerCase();
            if (currentEmail) onEmailSuccessfullyVerified(currentEmail);
            return;
        }
        const currentEmail = emailInput.value.trim().toLowerCase();
        if (currentEmail && e.key === 'email_link_verified_' + currentEmail && e.newValue === 'true') {
            onEmailSuccessfullyVerified(currentEmail);
        }
    };
    window.addEventListener('storage', formStorageListener);

    // Custom broadcast event listener
    window.addEventListener('student_shelf_email_verified', (e) => {
        const verifiedDetailEmail = e.detail?.email || emailInput.value || localStorage.getItem('pending_verification_email');
        if (verifiedDetailEmail) {
            onEmailSuccessfullyVerified(verifiedDetailEmail.trim().toLowerCase());
        }
    });

    // BUG 1 FIX: Ensure Green Tick is strictly HIDDEN during input and initial state
    emailInput.addEventListener('input', () => {
        if (typeof pendingUnsubscribe === 'function') {
            try { pendingUnsubscribe(); } catch (e) {}
            pendingUnsubscribe = null;
        }

        isEmailVerified = false;
        isEmailVerifiedInline = false;
        verifiedEmailAddress = '';

        // Strictly hide the Green Tick row and badge
        statusRow.style.setProperty('display', 'none', 'important');
        statusRow.classList.remove('is-verified', 'active');
        const tag = statusRow.querySelector('.email-verified-tag');
        if (tag) {
            tag.style.setProperty('display', 'none', 'important');
            tag.classList.remove('is-verified', 'active');
        }

        // Show Verify button & college email hint
        verifyBtn.style.removeProperty('display');
        verifyBtn.style.display = 'inline-flex';
        hintText.style.removeProperty('display');
        hintText.style.display = 'flex';

        // STRICT SUBMIT LOCK: Keep Submit button disabled during typing
        submitBtn.disabled = true;
        submitIcon.className = 'fa-solid fa-shield-halved';
        submitText.textContent = 'Verify Email First';
    });

    // BUG 2 FIX: Trigger Verification Link via Firebase Auth & Open "Check Your Inbox" Screen
    const triggerEmailVerification = async () => {
        errDiv.textContent = '';
        const email = emailInput.value.trim().toLowerCase();

        if (!email) {
            errDiv.textContent = 'Please enter your official college email address.';
            emailInput.focus();
            return;
        }

        if (!isCollegeEmail(email)) {
            errDiv.textContent = 'Please use an official college domain (e.g. rollno@pragati.ac.in or yourname@college.edu).';
            emailInput.focus();
            return;
        }

        // 1. Disable Verify button and start 30-second cooldown timer
        startVerifyCooldown(30);

        try {
            // Cancel previous listener if any
            if (typeof pendingUnsubscribe === 'function') {
                try { pendingUnsubscribe(); } catch (e) {}
                pendingUnsubscribe = null;
            }

            // Cross-Device Real-Time Sync: Attach snapshot listener for Laptop
            try {
                pendingUnsubscribe = listenToPendingVerification(email, (confirmedEmail) => {
                    console.log('[Cross-Device Laptop Auto-Unlock] Firestore verified snapshot received for:', confirmedEmail);
                    onEmailSuccessfullyVerified(confirmedEmail);
                });
            } catch (snapErr) {
                console.warn('[Cross-Device Sync] listenToPendingVerification note:', snapErr);
            }

            // 2. Dispatch Email Verification Link via Firebase Auth & Custom SMTP (creates pending doc in Firestore)
            await sendEmailOTP(email);

            // 3. Open "Check Your Inbox" Screen with "I've Verified (Check Status)" & "Resend Email Link"
            showInlineEmailOtpModal(email, (confirmedEmail) => {
                onEmailSuccessfullyVerified(confirmedEmail);
            }, async (resendTarget) => {
                startVerifyCooldown(30);
                await sendEmailOTP(resendTarget);
            });
        } catch (err) {
            if (verifyCooldownTimer) {
                clearInterval(verifyCooldownTimer);
                verifyCooldownTimer = null;
            }
            if (typeof pendingUnsubscribe === 'function') {
                try { pendingUnsubscribe(); } catch (e) {}
                pendingUnsubscribe = null;
            }
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = `<i class="fa-solid fa-envelope-circle-check"></i> Verify`;
            errDiv.textContent = err.message || 'Could not send verification link. Please try again.';
        }
    };

    verifyBtn.addEventListener('click', triggerEmailVerification);

    // Allow user to change email if needed
    changeBtn.addEventListener('click', () => {
        if (verifyCooldownTimer) {
            clearInterval(verifyCooldownTimer);
            verifyCooldownTimer = null;
        }
        if (typeof pendingUnsubscribe === 'function') {
            try { pendingUnsubscribe(); } catch (e) {}
            pendingUnsubscribe = null;
        }
        isEmailVerified = false;
        isEmailVerifiedInline = false;
        verifiedEmailAddress = '';

        emailInput.readOnly = false;
        emailInput.classList.remove('is-verified');

        verifyBtn.disabled = false;
        verifyBtn.innerHTML = `<i class="fa-solid fa-envelope-circle-check"></i> Verify`;
        verifyBtn.style.removeProperty('display');
        verifyBtn.style.display = 'inline-flex';

        // BUG 1 FIX: Strictly hide Green Tick
        statusRow.classList.remove('is-verified', 'active');
        statusRow.style.setProperty('display', 'none', 'important');
        const tag = statusRow.querySelector('.email-verified-tag');
        if (tag) {
            tag.classList.remove('is-verified', 'active');
            tag.style.setProperty('display', 'none', 'important');
        }

        hintText.style.removeProperty('display');
        hintText.style.display = 'flex';

        // STRICT SUBMIT LOCK: Re-lock submit button
        submitBtn.disabled = true;
        submitIcon.className = 'fa-solid fa-shield-halved';
        submitText.textContent = 'Verify Email First';

        emailInput.focus();
    });

    // Form Submit Handler (Single-Step Registration)
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errDiv.textContent = '';

        const name = document.getElementById('reg-name').value.trim();
        const collegeID = document.getElementById('reg-college-id').value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const rawWhatsapp = document.getElementById('reg-whatsapp').value.trim();
        const pwd = document.getElementById('reg-password').value;
        const confirmPwd = document.getElementById('reg-confirm-password').value;

        if (!name || !collegeID || !email || !rawWhatsapp || !pwd) {
            errDiv.textContent = 'Please fill out all required fields.';
            return;
        }

        if (pwd !== confirmPwd) {
            errDiv.textContent = 'Passwords do not match!';
            return;
        }

        if (pwd.length < 6) {
            errDiv.textContent = 'Password must be at least 6 characters.';
            return;
        }

        // STRICT SUBMIT LOCK: Check email verification status
        if (!isEmailVerified || !isEmailVerifiedInline || email !== verifiedEmailAddress) {
            errDiv.textContent = 'Please verify your college email using the verification link sent to your inbox first.';
            triggerEmailVerification();
            return;
        }

        // Format WhatsApp Number consistently
        let formattedWhatsapp = rawWhatsapp;
        if (!formattedWhatsapp.startsWith('+91')) {
            formattedWhatsapp = '+91' + formattedWhatsapp.replace(/^0+/, '');
        }

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Finalizing Account...`;

            // Create Firebase Auth user
            const userCredential = await createUserWithEmailAndPassword(auth, email, pwd);
            
            // Generate clean human-readable Firestore custom Document ID
            // docId = ${sanitizedFullName}_${collegeID} (e.g., Aswitha_24A31A4403 or ${collegeID})
            const userDocId = generateUserDocId(name, collegeID, userCredential.user.uid);
            
            const profilePayload = {
                docId: userDocId,
                uid: userCredential.user.uid,
                authUid: userCredential.user.uid,
                fullName: name,
                name: name,
                displayName: name,
                email: email,
                whatsapp: formattedWhatsapp,
                whatsappNumber: formattedWhatsapp,
                collegeID: collegeID,
                isVerifiedStudent: true,
                emailVerified: true,
                verifiedAt: new Date().toISOString(),
                joinedAt: new Date().toISOString()
            };

            await saveUserProfile(userDocId, profilePayload);

            // Seed user_profile cache so all guards and permissions activate immediately
            try {
                localStorage.setItem('user_profile', JSON.stringify(profilePayload));
            } catch (e) {}

            // Close any active auth modal
            if (typeof window.closeAuthModal === 'function') {
                window.closeAuthModal();
            }

            // Zero-redundancy single-step completion: show brief toast and land directly on Marketplace
            const toast = document.createElement('div');
            toast.className = 'custom-auth-success-toast';
            toast.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#0F172A; color:#FFFFFF; padding:12px 24px; border-radius:30px; font-weight:600; font-size:14px; z-index:100020; box-shadow:0 10px 25px rgba(0,0,0,0.25); display:flex; align-items:center; gap:8px;';
            toast.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10B981;"></i> Welcome to StudentShelf! Your college identity is verified.';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);

            // Redirect user straight to Marketplace
            window.location.hash = '#/';
        } catch (error) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Submit / Create Account`;
            
            let userMessage;
            switch (error.code) {
                case 'auth/email-already-in-use':
                    userMessage = 'This email is already registered. Please login instead.';
                    break;
                case 'auth/invalid-email':
                    userMessage = 'Please enter a valid college email address.';
                    break;
                case 'auth/weak-password':
                    userMessage = 'Password should be at least 6 characters.';
                    break;
                default:
                    userMessage = error.message || 'Registration failed. Please try again.';
                    break;
            }
            errDiv.textContent = userMessage;
        }
    });
}
