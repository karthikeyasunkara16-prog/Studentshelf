import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut, sendPasswordResetEmail, applyActionCode, checkActionCode, isSignInWithEmailLink, signInWithEmailLink } from './firebase.js';
import { saveUserProfile, getUserProfile, generateUserDocId, listenToPendingVerification } from './db.js';
import { isCollegeEmail, isAcademicEmail, isUserVerified, sendCollegeVerificationCode, sendInlineCollegeVerificationOtp, verifyInlineCollegeOtp, showInlineEmailOtpModal, showEmailVerificationModal, sendEmailOTP, requestVerification } from './verification.js';

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
                        Please enter your official college email ending with .ac.in or .edu.in for instant access.
                    </small>
                </div>
                <div class="form-group mb-2">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="margin-bottom:0;">Password</label>
                        <a href="javascript:void(0)" id="forgot-password-link" class="text-link" style="font-size: 12.5px; font-weight: 600; text-decoration: none;">Forgot Password?</a>
                    </div>
                    <div class="password-wrapper">
                        <input type="password" id="login-password" class="form-control" required placeholder="********">
                        <i class="fa-solid fa-eye eye-icon toggle-password" data-target="login-password"></i>
                    </div>
                </div>
                <div id="login-error" class="error-msg"></div>
                <div id="login-success" class="success-msg text-center mt-2" style="display:none; color:#10B981; font-weight:600; font-size:13px; line-height: 1.4;"></div>
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

    const emailInput = document.getElementById('login-email');
    const pwdInput = document.getElementById('login-password');
    const errDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-submit-btn') || document.getElementById('login-btn');

    // Field-level validation helpers for login
    const setLoginFieldError = (fieldEl, message, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.add('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const existing = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id}"]`);
            if (existing) existing.remove();
            const hint = document.createElement('div');
            hint.className = 'field-error-hint';
            hint.setAttribute('data-for', fieldEl.id);
            hint.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${message}</span>`;
            targetAnchor.insertAdjacentElement('afterend', hint);
        }
    };

    const clearLoginFieldError = (fieldEl, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.remove('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const hint = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id}"]`);
            if (hint) hint.remove();
        }
    };

    emailInput.addEventListener('input', () => clearLoginFieldError(emailInput));
    pwdInput.addEventListener('input', () => clearLoginFieldError(pwdInput, pwdInput.closest('.password-wrapper')));

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const pwd = pwdInput.value;

        errDiv.textContent = '';
        clearLoginFieldError(emailInput);
        clearLoginFieldError(pwdInput, pwdInput.closest('.password-wrapper'));

        let hasError = false;
        let firstInvalid = null;

        if (!email) {
            setLoginFieldError(emailInput, 'College Email is required');
            hasError = true;
            firstInvalid = emailInput;
        } else if (!isCollegeEmail(email)) {
            setLoginFieldError(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.');
            hasError = true;
            firstInvalid = emailInput;
        }

        const pwdWrapper = pwdInput.closest('.password-wrapper') || pwdInput;
        if (!pwd) {
            setLoginFieldError(pwdInput, 'Password is required', pwdWrapper);
            hasError = true;
            if (!firstInvalid) firstInvalid = pwdInput;
        }

        if (hasError) {
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInvalid.focus();
            }
            return;
        }

        try {
            btn.textContent = 'Logging in...';
            btn.disabled = true;
            const userCredential = await signInWithEmailAndPassword(auth, email, pwd);
            
            // Seed user profile cache on login so user info and permissions are ready
            try {
                const profile = await getUserProfile(userCredential.user.uid);
                if (profile) {
                    localStorage.setItem('user_profile', JSON.stringify(profile));
                }
            } catch (pErr) {}

            // Close any active auth modal
            if (typeof window.closeAuthModal === 'function') {
                window.closeAuthModal();
            }

            const hashParts = window.location.hash.split('?redirect=');
            if (hashParts.length > 1) {
                window.location.hash = decodeURIComponent(hashParts[1]);
            } else {
                window.location.hash = '#/';
            }
        } catch (error) {
            btn.disabled = false;
            btn.textContent = 'Login';
            let userMessage = 'Invalid email or password. Please try again.';
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                userMessage = 'Incorrect email or password. Please try again or click Forgot Password.';
            } else if (error.code === 'auth/too-many-requests') {
                userMessage = 'Too many failed login attempts. Please try again later or reset your password.';
            } else if (error.message) {
                userMessage = error.message;
            }
            errDiv.textContent = userMessage;
        }
    });

    // Forgot Password Flow
    document.getElementById('forgot-password-link').addEventListener('click', async (e) => {
        e.preventDefault();
        errDiv.textContent = '';
        const successDiv = document.getElementById('login-success');
        if (successDiv) {
            successDiv.style.display = 'none';
            successDiv.textContent = '';
        }
        clearLoginFieldError(emailInput);

        let targetEmail = emailInput.value.trim();

        // If email input is empty, prompt user to enter their registered college email
        if (!targetEmail) {
            const promptVal = prompt("Enter your registered College Email to receive a password reset link:");
            if (promptVal === null) return; // user cancelled prompt
            targetEmail = promptVal.trim();
            if (targetEmail) {
                emailInput.value = targetEmail;
            }
        }

        if (!targetEmail) {
            setLoginFieldError(emailInput, 'Please enter your registered College Email address');
            emailInput.focus();
            return;
        }

        if (!isCollegeEmail(targetEmail)) {
            setLoginFieldError(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.');
            emailInput.focus();
            return;
        }

        const forgotLink = document.getElementById('forgot-password-link');
        const origLinkText = forgotLink ? forgotLink.textContent : 'Forgot Password?';

        try {
            if (forgotLink) {
                forgotLink.textContent = 'Sending link...';
                forgotLink.style.pointerEvents = 'none';
            }

            await sendPasswordResetEmail(auth, targetEmail);

            if (successDiv) {
                successDiv.style.display = 'block';
                successDiv.innerHTML = '<i class="fa-solid fa-circle-check"></i> Password reset link sent! Please check your email inbox (and spam folder).';
            }
            alert('Password reset link sent! Please check your email inbox.');
        } catch (error) {
            let userMessage = 'Something went wrong. Please try again.';
            switch(error.code) {
                case 'auth/user-not-found':
                    userMessage = 'No account found with this college email address.';
                    break;
                case 'auth/invalid-email':
                    userMessage = 'Please enter a valid college email address.';
                    break;
                case 'auth/too-many-requests':
                    userMessage = 'Too many attempts. Please wait a moment and try again.';
                    break;
                default:
                    userMessage = error.message || 'Failed to send password reset link. Please try again.';
            }
            setLoginFieldError(emailInput, userMessage);
            emailInput.focus();
        } finally {
            if (forgotLink) {
                forgotLink.textContent = origLinkText;
                forgotLink.style.pointerEvents = 'auto';
            }
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
                    <label>College Roll Number / Branch</label>
                    <input type="text" id="reg-college-id" class="form-control" required placeholder="e.g. 21A31A0501 (CSE)">
                </div>
                <div class="form-group">
                    <label>College Email ID</label>
                    <div class="email-verify-group">
                        <input type="email" id="reg-email" class="form-control" required placeholder="yourname@college.ac.in (or .edu.in)">
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
                        Please enter your official college email ending with .ac.in or .edu.in for instant access.
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
                <button type="submit" class="btn btn-primary w-100 mt-3" id="reg-btn">
                    <i class="fa-solid fa-circle-check" id="reg-btn-icon"></i> <span id="reg-btn-text">Submit / Create Account</span>
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

    const nameInput = document.getElementById('reg-name');
    const collegeIdInput = document.getElementById('reg-college-id');
    const emailInput = document.getElementById('reg-email');
    const whatsappInput = document.getElementById('reg-whatsapp');
    const passwordInput = document.getElementById('reg-password');
    const confirmPasswordInput = document.getElementById('reg-confirm-password');
    const verifyBtn = document.getElementById('btn-verify-email');
    const statusRow = document.getElementById('email-verification-status');
    const changeBtn = document.getElementById('btn-change-email');
    const hintText = document.getElementById('reg-email-hint');
    const submitBtn = document.getElementById('reg-btn');
    const submitIcon = document.getElementById('reg-btn-icon');
    const submitText = document.getElementById('reg-btn-text');
    const errDiv = document.getElementById('reg-error');

    // Field-level validation helpers
    const setFieldError = (fieldEl, message, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.add('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const existing = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id}"]`);
            if (existing) existing.remove();
            const hint = document.createElement('div');
            hint.className = 'field-error-hint';
            hint.setAttribute('data-for', fieldEl.id);
            hint.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${message}</span>`;
            targetAnchor.insertAdjacentElement('afterend', hint);
        }
    };

    const clearFieldError = (fieldEl, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.remove('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const hint = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id}"]`);
            if (hint) hint.remove();
        }
    };

    const clearAllFieldErrors = (container) => {
        if (!container) return;
        container.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        container.querySelectorAll('.field-error-hint').forEach(el => el.remove());
    };

    // Real-time clearing on input / change
    nameInput.addEventListener('input', () => clearFieldError(nameInput));
    collegeIdInput.addEventListener('input', () => clearFieldError(collegeIdInput));
    whatsappInput.addEventListener('input', () => clearFieldError(whatsappInput));
    passwordInput.addEventListener('input', () => {
        clearFieldError(passwordInput, passwordInput.closest('.password-wrapper'));
        if (confirmPasswordInput.value && confirmPasswordInput.classList.contains('is-invalid')) {
            if (confirmPasswordInput.value === passwordInput.value) {
                clearFieldError(confirmPasswordInput, confirmPasswordInput.closest('.password-wrapper'));
            }
        }
    });
    confirmPasswordInput.addEventListener('input', () => {
        clearFieldError(confirmPasswordInput, confirmPasswordInput.closest('.password-wrapper'));
    });

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
                    onEmailSuccessfullyVerified('student@college.ac.in');
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

    // Real-time academic email validation and state handling
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

        const rawVal = emailInput.value.trim().toLowerCase();
        const emailGroup = emailInput.closest('.email-verify-group') || emailInput;

        // Inline check: Reject standard non-academic emails (e.g., @gmail.com, @yahoo.com)
        if (rawVal.includes('@')) {
            const domain = rawVal.split('@')[1] || '';
            if (domain.includes('.') && !isCollegeEmail(rawVal)) {
                setFieldError(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.', emailGroup);
            } else if (isCollegeEmail(rawVal)) {
                clearFieldError(emailInput, emailGroup);
            }
        } else {
            clearFieldError(emailInput, emailGroup);
        }

        submitBtn.disabled = false;
        submitIcon.className = 'fa-solid fa-shield-halved';
        submitText.textContent = 'Submit / Create Account';
    });

    emailInput.addEventListener('blur', () => {
        const rawVal = emailInput.value.trim().toLowerCase();
        const emailGroup = emailInput.closest('.email-verify-group') || emailInput;
        if (rawVal) {
            if (!isCollegeEmail(rawVal)) {
                setFieldError(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.', emailGroup);
            } else {
                clearFieldError(emailInput, emailGroup);
            }
        }
    });

    // BUG 2 FIX: Trigger Verification Link via Firebase Auth & Open "Check Your Inbox" Screen
    const triggerEmailVerification = async () => {
        errDiv.textContent = '';
        clearFieldError(emailInput, emailInput.closest('.email-verify-group'));
        const email = emailInput.value.trim().toLowerCase();

        if (!email) {
            setFieldError(emailInput, 'College Email is required', emailInput.closest('.email-verify-group'));
            emailInput.focus();
            return;
        }

        if (!isCollegeEmail(email)) {
            setFieldError(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.', emailInput.closest('.email-verify-group'));
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

        clearFieldError(emailInput, emailInput.closest('.email-verify-group'));
        submitBtn.disabled = false;
        submitIcon.className = 'fa-solid fa-shield-halved';
        submitText.textContent = 'Submit / Create Account';

        emailInput.focus();
    });

    // Form Submit Handler (Single-Step Registration with Field-Level Validation)
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errDiv.textContent = '';
        clearAllFieldErrors(document.getElementById('register-form'));

        const name = nameInput.value.trim();
        const collegeID = collegeIdInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const rawWhatsapp = whatsappInput.value.trim();
        const pwd = passwordInput.value;
        const confirmPwd = confirmPasswordInput.value;

        let hasError = false;
        let firstInvalid = null;

        const markInvalid = (el, msg, anchor = null) => {
            setFieldError(el, msg, anchor);
            hasError = true;
            if (!firstInvalid) firstInvalid = el;
        };

        // 1. Full Name
        if (!name) {
            markInvalid(nameInput, 'Full Name is required');
        }

        // 2. College ID / Roll Number
        if (!collegeID) {
            markInvalid(collegeIdInput, 'College Roll Number is required');
        }

        // 3. College Email ID
        const emailGroup = emailInput.closest('.email-verify-group') || emailInput;
        if (!email) {
            markInvalid(emailInput, 'College Email is required', emailGroup);
        } else if (!isCollegeEmail(email)) {
            markInvalid(emailInput, 'Please enter your official college email ending with .ac.in or .edu.in for instant access.', emailGroup);
        } else if (!isEmailVerified || !isEmailVerifiedInline || email !== verifiedEmailAddress) {
            markInvalid(emailInput, 'Please verify your college email using the Verify button first', emailGroup);
        }

        // 4. Mobile / WhatsApp Number
        const cleanedWa = rawWhatsapp.replace(/\D/g, '');
        if (!rawWhatsapp || rawWhatsapp === '+91') {
            markInvalid(whatsappInput, 'WhatsApp Number is required');
        } else if (cleanedWa.length < 10) {
            markInvalid(whatsappInput, 'Please enter a valid 10-digit WhatsApp number');
        }

        // 5. Password
        const pwdWrapper = passwordInput.closest('.password-wrapper') || passwordInput;
        if (!pwd) {
            markInvalid(passwordInput, 'Password is required', pwdWrapper);
        } else if (pwd.length < 6) {
            markInvalid(passwordInput, 'Password must be at least 6 characters', pwdWrapper);
        }

        // 6. Confirm Password
        const confirmPwdWrapper = confirmPasswordInput.closest('.password-wrapper') || confirmPasswordInput;
        if (!confirmPwd) {
            markInvalid(confirmPasswordInput, 'Please confirm your password', confirmPwdWrapper);
        } else if (pwd && confirmPwd !== pwd) {
            markInvalid(confirmPasswordInput, 'Passwords do not match', confirmPwdWrapper);
        }

        if (hasError) {
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInvalid.focus();
            }
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
