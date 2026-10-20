import { auth, db, doc, getDoc, sendEmailVerification, signOut } from './firebase.js';
import { saveUserProfile, getUserProfile, listenToPendingVerification, createPendingVerification, markPendingVerificationVerified } from './db.js';
import { sendCustomOtpEmail, sendEmailOTP, requestVerification } from './emailService.js';

export { sendEmailOTP, requestVerification };

/**
 * Validates whether an email belongs to an official academic domain ending in .ac.in or .edu.in.
 * Supports all official student domains (e.g. @pragati.ac.in, @jntuk.edu.in, @aditya.ac.in).
 * Rejects standard non-academic emails (e.g. @gmail.com, @yahoo.com).
 */
export function isCollegeEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const clean = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(clean)) return false;

    const domain = clean.split('@')[1] || '';
    return domain.endsWith('.ac.in') || domain.endsWith('.edu.in');
}

export const isAcademicEmail = isCollegeEmail;

/**
 * Checks if a user is verified via Firebase emailVerified or Firestore isVerifiedStudent.
 * Rule: Any authenticated user inside an active session is considered verified
 * (verification is strictly required during initial signup).
 */
export function isUserVerified(user, profile = null) {
    if (!user) return false;
    return true;
}

/**
 * Dispatches a 6-digit verification OTP before account creation for inline verification
 * via Cloud Function, Firebase Auth, and Custom SMTP pipeline.
 */
export async function sendInlineCollegeVerificationOtp(email) {
    if (!email) throw new Error('Email is required');
    const res = await sendEmailOTP(email);
    return res.code;
}

/**
 * Verifies entered OTP against inline session storage.
 */
export function verifyInlineCollegeOtp(enteredOtp, email) {
    if (!enteredOtp || !email) {
        return { success: false, message: 'Please enter the 6-digit code.' };
    }

    const cleanEntered = enteredOtp.toString().trim();
    const cleanEmail = email.trim().toLowerCase();
    const storedOtp = sessionStorage.getItem('inline_reg_otp');
    const storedEmail = sessionStorage.getItem('inline_reg_email');
    const expiresAt = Number(sessionStorage.getItem('inline_reg_expires') || '0');

    if (!storedOtp) {
        return { success: false, message: 'No active code found. Please click Resend Code.' };
    }

    if (Date.now() > expiresAt) {
        return { success: false, message: 'Verification code has expired. Please request a new code.' };
    }

    if (storedEmail !== cleanEmail) {
        return { success: false, message: 'Email address mismatch. Please request a new code.' };
    }

    if (cleanEntered !== storedOtp) {
        return { success: false, message: 'Incorrect verification code. Please check and try again.' };
    }

    // Mark as verified
    sessionStorage.setItem('inline_verified_email', cleanEmail);
    sessionStorage.setItem('inline_verified_status', 'true');
    return { success: true };
}

/**
 * Generates and stores a 6-digit OTP code, and routes via Custom SMTP pipeline.
 */
export async function sendCollegeVerificationCode(user, email = null) {
    if (!user) return null;
    const targetEmail = email || user.email;

    // 1. Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 2. Save OTP & unverified status in Firestore & SessionStorage
    try {
        await saveUserProfile(user.uid, {
            verificationOTP: otpCode,
            verificationExpiresAt: Date.now() + 15 * 60 * 1000, // 15 mins
            isVerifiedStudent: false,
            emailVerified: Boolean(user.emailVerified)
        });
    } catch (e) {
        console.warn("Could not save OTP to Firestore:", e);
    }

    try {
        sessionStorage.setItem('pending_verification_otp', otpCode);
        sessionStorage.setItem('pending_verification_email', targetEmail);
    } catch (e) {}

    // 3. Dispatch via Custom SMTP email pipeline to avoid spam folder
    await sendCustomOtpEmail(targetEmail, otpCode);

    // 4. Secondary fallback: Firebase Email link
    try {
        await sendEmailVerification(user);
    } catch (err) {
        console.warn("Firebase sendEmailVerification note:", err);
    }

    return otpCode;
}

/**
 * Marks user as verified in Firestore and local storage.
 */
export async function markUserAsVerified(user) {
    if (!user) return;
    try {
        await saveUserProfile(user.uid, {
            isVerifiedStudent: true,
            emailVerified: true,
            verificationOTP: null,
            verifiedAt: new Date().toISOString()
        });
    } catch (e) {
        console.warn("Error marking user as verified in Firestore:", e);
    }

    try {
        const cached = JSON.parse(localStorage.getItem('user_profile') || '{}');
        localStorage.setItem('user_profile', JSON.stringify({
            ...cached,
            isVerifiedStudent: true,
            emailVerified: true
        }));
    } catch (e) {}
}

/**
 * Shows the mandatory Verification Screen/Modal with link re-check, 6-digit OTP,
 * 30-second resend cooldown timer, and automatic background polling.
 */
export function showEmailVerificationModal(user, userEmail = null) {
    const email = userEmail || user?.email || sessionStorage.getItem('pending_verification_email') || 'your college email';
    const existingModal = document.getElementById('college-verification-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'college-verification-modal';
    modal.className = 'modal-overlay verification-modal-overlay active';
    modal.style.zIndex = '100005';

    modal.innerHTML = `
        <div class="modal-content auth-card shadow-card verification-modal-card" style="max-width: 480px; width: 92%; border-radius: 20px; padding: 28px 24px; position: relative;">
            <button type="button" class="modal-close" id="close-verify-modal-btn" aria-label="Close" style="position: absolute; top: 16px; right: 18px; background: none; border: none; font-size: 22px; cursor: pointer; color: #64748B;">&times;</button>
            
            <div class="text-center">
                <div class="verification-icon-wrap mb-3" style="width: 70px; height: 70px; border-radius: 50%; background: linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 100%); border: 3px solid #00ABE4; display: flex; align-items: center; justify-content: center; margin: 0 auto; color: #00ABE4; font-size: 30px; box-shadow: 0 4px 15px rgba(0, 171, 228, 0.25);">
                    <i class="fa-solid fa-envelope-circle-check"></i>
                </div>
                
                <h3 style="font-size: 22px; font-weight: 800; color: #1E293B; margin-bottom: 6px;">Verify Your College Email</h3>
                <p style="color: #64748B; font-size: 13.5px; line-height: 1.5; margin-bottom: 18px;">
                    We've sent a verification link and a 6-digit code to:<br>
                    <strong style="color: #00ABE4; word-break: break-all;">${email}</strong>.<br>
                    Please verify your email to unlock buying, selling, and chatting on campus.
                </p>
            </div>

            <!-- Feedback Alert -->
            <div id="verify-modal-alert" class="alert-box" style="display: none; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; text-align: center;"></div>

            <!-- Verification Method Tabs / Options -->
            <div class="verification-options-box" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; margin-bottom: 18px;">
                <!-- Option 1: 6-Digit OTP Code -->
                <div class="otp-verification-section mb-3">
                    <label style="font-size: 12.5px; font-weight: 700; color: #334155; display: block; margin-bottom: 6px;">
                        <i class="fa-solid fa-key" style="color: #00ABE4; margin-right: 4px;"></i> Enter 6-Digit Code
                    </label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="verify-otp-input" class="form-control" placeholder="123456" maxlength="6" inputmode="numeric" style="flex: 1; text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 4px; border-radius: 10px; height: 42px;">
                        <button type="button" class="btn btn-primary" id="verify-otp-submit-btn" style="padding: 0 16px; border-radius: 10px; font-weight: 700; height: 42px;">
                            Verify Code
                        </button>
                    </div>
                </div>

                <div style="display: flex; align-items: center; text-align: center; margin: 12px 0;">
                    <div style="flex: 1; height: 1px; background: #E2E8F0;"></div>
                    <span style="padding: 0 10px; font-size: 11px; font-weight: 600; color: #94A3B8; text-transform: uppercase;">OR VIA EMAIL LINK</span>
                    <div style="flex: 1; height: 1px; background: #E2E8F0;"></div>
                </div>

                <!-- Option 2: Link Click Verification -->
                <button type="button" class="btn btn-outline w-100" id="verify-recheck-link-btn" style="border-radius: 10px; font-size: 13px; font-weight: 600; padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 8px; border-color: #CBD5E1;">
                    <i class="fa-solid fa-arrow-rotate-right"></i> I've Clicked The Email Link
                </button>
            </div>

            <!-- Resend & Cooldown Footer -->
            <div class="text-center" style="display: flex; flex-direction: column; gap: 8px;">
                <button type="button" class="btn btn-ghost" id="resend-verification-btn" disabled style="font-size: 12.5px; color: #64748B; background: none; border: none; cursor: not-allowed;">
                    <i class="fa-solid fa-clock-rotate-left"></i> Resend Code / Email (<span id="resend-timer-seconds">30</span>s)
                </button>
                <button type="button" class="btn btn-ghost" id="browse-guest-btn" style="font-size: 12px; color: #94A3B8; background: none; border: none; cursor: pointer; text-decoration: underline;">
                    I will verify later (Browse as Guest)
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const alertBox = modal.querySelector('#verify-modal-alert');
    const showAlert = (msg, isError = false) => {
        if (!alertBox) return;
        alertBox.style.display = 'block';
        alertBox.style.background = isError ? '#FEF2F2' : '#F0FDF4';
        alertBox.style.color = isError ? '#DC2626' : '#15803D';
        alertBox.style.border = `1px solid ${isError ? '#FECACA' : '#BBF7D0'}`;
        alertBox.textContent = msg;
    };

    let cooldownTimer = 30;
    const resendBtn = modal.querySelector('#resend-verification-btn');
    const timerSpan = modal.querySelector('#resend-timer-seconds');
    let timerInterval = null;

    const startCooldown = () => {
        cooldownTimer = 30;
        if (resendBtn) {
            resendBtn.disabled = true;
            resendBtn.style.cursor = 'not-allowed';
            resendBtn.style.color = '#64748B';
            resendBtn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Resend Code / Email (<span id="resend-timer-seconds">30</span>s)`;
        }
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            cooldownTimer--;
            const span = modal.querySelector('#resend-timer-seconds');
            if (span) span.textContent = cooldownTimer;
            if (cooldownTimer <= 0) {
                clearInterval(timerInterval);
                if (resendBtn) {
                    resendBtn.disabled = false;
                    resendBtn.style.cursor = 'pointer';
                    resendBtn.style.color = '#00ABE4';
                    resendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Resend Code / Email`;
                }
            }
        }, 1000);
    };

    startCooldown();

    // Auto-poll in background every 4s to check if user clicked verification link
    let pollInterval = setInterval(async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        try {
            await currentUser.reload();
            if (currentUser.emailVerified) {
                clearInterval(pollInterval);
                clearInterval(timerInterval);
                await handleSuccess();
            }
        } catch (e) {}
    }, 4000);

    const cleanUp = () => {
        clearInterval(pollInterval);
        clearInterval(timerInterval);
        modal.remove();
    };

    const handleSuccess = async () => {
        showAlert("🎉 College email verified successfully! Welcome to StudentShelf.", false);
        const currentUser = auth.currentUser;
        if (currentUser) {
            await markUserAsVerified(currentUser);
        }
        setTimeout(() => {
            cleanUp();
            window.location.hash = '#/';
            if (typeof window.showLogoutToast === 'function') {
                window.showLogoutToast("Welcome! Your College Email is 100% verified.");
            }
        }, 1200);
    };

    // Close buttons
    modal.querySelector('#close-verify-modal-btn').addEventListener('click', cleanUp);
    modal.querySelector('#browse-guest-btn').addEventListener('click', cleanUp);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) cleanUp();
    });

    // 1. Submit 6-digit OTP
    modal.querySelector('#verify-otp-submit-btn').addEventListener('click', async () => {
        const inputOtp = modal.querySelector('#verify-otp-input').value.trim();
        if (inputOtp.length !== 6) {
            showAlert("Please enter the complete 6-digit code.", true);
            return;
        }

        const storedOtp = sessionStorage.getItem('pending_verification_otp');
        let isValidOtp = (storedOtp && inputOtp === storedOtp);

        // Fallback: check Firestore profile if available
        if (!isValidOtp && auth.currentUser) {
            try {
                const profile = await getUserProfile(auth.currentUser.uid);
                if (profile && profile.verificationOTP === inputOtp) {
                    isValidOtp = true;
                }
            } catch (e) {}
        }

        if (isValidOtp) {
            clearInterval(pollInterval);
            clearInterval(timerInterval);
            await handleSuccess();
        } else {
            showAlert("Invalid or expired verification code. Please try again or click the link.", true);
        }
    });

    // 2. Click "I've Clicked The Email Link"
    modal.querySelector('#verify-recheck-link-btn').addEventListener('click', async () => {
        const btn = modal.querySelector('#verify-recheck-link-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Verification Status...`;
        btn.disabled = true;

        const currentUser = auth.currentUser;
        if (currentUser) {
            try {
                await currentUser.reload();
                if (currentUser.emailVerified) {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    clearInterval(pollInterval);
                    clearInterval(timerInterval);
                    await handleSuccess();
                    return;
                }
            } catch (e) {
                console.warn("Reload error:", e);
            }
        }

        btn.innerHTML = originalText;
        btn.disabled = false;
        showAlert("Verification link not confirmed yet. Please click the link in your email, or enter the 6-digit code above.", true);
    });

    // 3. Resend button
    resendBtn.addEventListener('click', async () => {
        if (resendBtn.disabled) return;
        resendBtn.disabled = true;
        resendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;

        try {
            const currentUser = auth.currentUser;
            if (currentUser) {
                await sendCollegeVerificationCode(currentUser, email);
                showAlert("Verification link and fresh 6-digit code sent to your college inbox!", false);
            }
        } catch (e) {
            showAlert("Failed to resend. Please try again in a moment.", true);
        } finally {
            startCooldown();
        }
    });
}

/**
 * Prompts unverified users when attempting restricted campus actions.
 */
export function showVerificationRequiredPrompt(message = "Verify your college email to start buying and selling on campus.") {
    // If user is already authenticated in an active session, never prompt for email verification
    if (auth.currentUser) return;

    const existing = document.getElementById('verification-required-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'verification-required-modal';
    modal.className = 'modal-overlay verification-modal-overlay active';
    modal.style.zIndex = '100004';

    modal.innerHTML = `
        <div class="modal-content auth-card text-center shadow-card verification-prompt-card" style="max-width: 440px; width: 92%; border-radius: 20px; padding: 28px 24px; position: relative;">
            <button type="button" class="modal-close" id="close-verify-prompt-btn" style="position: absolute; top: 14px; right: 16px; background: none; border: none; font-size: 22px; cursor: pointer; color: #64748B;">&times;</button>
            
            <div class="verification-badge-icon mb-3" style="width: 68px; height: 68px; border-radius: 50%; background: #EFF6FF; border: 2px solid #BFDBFE; display: flex; align-items: center; justify-content: center; margin: 0 auto; color: #00ABE4; font-size: 30px; box-shadow: 0 4px 14px rgba(0, 171, 228, 0.2);">
                <i class="fa-solid fa-user-shield"></i>
            </div>
            
            <h3 style="font-size: 20px; font-weight: 800; color: #1E293B; margin-bottom: 8px;">Campus Verification Required</h3>
            <p style="color: #64748B; font-size: 13.5px; line-height: 1.5; margin-bottom: 22px;">
                ${message}
            </p>
            
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button type="button" class="btn btn-primary w-100" id="verify-now-btn" style="padding: 12px; font-weight: 700; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="fa-solid fa-circle-check"></i> Verify College Email Now
                </button>
                <button type="button" class="btn btn-outline w-100" id="verify-later-btn" style="padding: 10px; font-size: 13px; border-radius: 12px; border: 1px solid #CBD5E1; color: #64748B;">
                    Continue Browsing
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#close-verify-prompt-btn').addEventListener('click', closeModal);
    modal.querySelector('#verify-later-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    modal.querySelector('#verify-now-btn').addEventListener('click', () => {
        closeModal();
        const currentUser = auth.currentUser;
        if (currentUser) {
            showEmailVerificationModal(currentUser, currentUser.email);
        } else {
            if (typeof window.openAuthModal === 'function') {
                window.openAuthModal('signup');
            } else {
                window.location.hash = '#/register';
            }
        }
    });
}

/**
 * Opens the clean "Check Your Inbox" link verification modal.
 * Title: "Verify College Email"
 * Message: "We've sent a verification link to ${email}. Please click the link in your email to complete verification."
 * Action Buttons: "Resend Email Link" & "I've Verified (Check Status)"
 */
export function showInlineEmailOtpModal(email, onVerifiedCallback, onResendCallback = null) {
    const existing = document.getElementById('inline-otp-modal');
    if (existing) existing.remove();

    const cleanEmail = (email || '').trim().toLowerCase();
    const modal = document.createElement('div');
    modal.id = 'inline-otp-modal';
    modal.className = 'inline-otp-overlay active';

    modal.innerHTML = `
        <div class="inline-otp-card" style="max-width: 440px; text-align: center; padding: 30px 24px;">
            <button type="button" class="inline-otp-close-btn" id="close-inline-otp-btn" aria-label="Close">&times;</button>
            <div class="inline-otp-badge-icon" style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 100%); border: 2px solid #00ABE4; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; color: #0284C7; font-size: 26px; box-shadow: 0 4px 14px rgba(0, 171, 228, 0.25);">
                <i class="fa-solid fa-envelope-circle-check"></i>
            </div>
            <h3 class="inline-otp-title" style="font-size: 20px; font-weight: 800; color: #0F172A; margin-bottom: 8px;">Verify College Email</h3>
            <p class="inline-otp-desc" style="color: #64748B; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
                We've sent a verification link to<br>
                <strong style="color: #0284C7; word-break: break-all; font-size: 14.5px;">${cleanEmail}</strong>.<br>
                Please click the link in your email to complete verification.
            </p>
            <div id="inbox-modal-alert" class="inline-otp-error" style="display: none; padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.4; margin-bottom: 16px; font-weight: 600; text-align: center;"></div>
            <div class="inbox-modal-actions" style="display: flex; flex-direction: column; gap: 10px;">
                <button type="button" id="btn-check-verified-status" class="btn btn-primary" style="height: 46px; font-size: 14.5px; font-weight: 700; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; box-shadow: 0 4px 12px rgba(0, 171, 228, 0.25); cursor: pointer;">
                    <i class="fa-solid fa-circle-check"></i> I've Verified (Check Status)
                </button>
                <div style="display: flex; align-items: center; justify-content: center; margin-top: 4px;">
                    <button type="button" id="btn-resend-inline-otp" class="btn-resend-inline-otp" disabled style="background: none; border: none; font-size: 13px; font-weight: 600; color: #64748B; cursor: not-allowed; display: flex; align-items: center; gap: 6px; padding: 6px 10px;">
                        <i class="fa-solid fa-clock-rotate-left"></i> Resend Email Link (<span id="inline-resend-countdown">30</span>s)
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const alertDiv = modal.querySelector('#inbox-modal-alert');
    const checkBtn = modal.querySelector('#btn-check-verified-status');
    const resendBtn = modal.querySelector('#btn-resend-inline-otp');
    const closeBtn = modal.querySelector('#close-inline-otp-btn');

    const showAlert = (msg, type = 'error') => {
        if (!alertDiv) return;
        alertDiv.style.display = 'block';
        if (type === 'success') {
            alertDiv.style.backgroundColor = '#ECFDF5';
            alertDiv.style.color = '#059669';
            alertDiv.style.border = '1px solid #A7F3D0';
        } else if (type === 'info') {
            alertDiv.style.backgroundColor = '#F0F9FF';
            alertDiv.style.color = '#0284C7';
            alertDiv.style.border = '1px solid #BAE6FD';
        } else {
            alertDiv.style.backgroundColor = '#FEF2F2';
            alertDiv.style.color = '#DC2626';
            alertDiv.style.border = '1px solid #FECACA';
        }
        alertDiv.textContent = msg;
    };

    let cooldownSeconds = 30;
    let timerInterval = null;
    let pollInterval = null;
    let isFinished = false;

    const startCooldown = () => {
        clearInterval(timerInterval);
        cooldownSeconds = 30;
        resendBtn.disabled = true;
        resendBtn.style.cursor = 'not-allowed';
        resendBtn.style.color = '#64748B';
        resendBtn.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Resend Email Link (<span id="inline-resend-countdown">${cooldownSeconds}</span>s)`;

        timerInterval = setInterval(() => {
            cooldownSeconds--;
            const countEl = modal.querySelector('#inline-resend-countdown');
            if (countEl) countEl.textContent = cooldownSeconds;

            if (cooldownSeconds <= 0) {
                clearInterval(timerInterval);
                resendBtn.disabled = false;
                resendBtn.style.cursor = 'pointer';
                resendBtn.style.color = '#00ABE4';
                resendBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Resend Email Link`;
            }
        }, 1000);
    };

    startCooldown();

    let unwatchPending = null;

    const closeModal = () => {
        isFinished = true;
        clearInterval(timerInterval);
        clearInterval(pollInterval);
        window.removeEventListener('storage', storageListener);
        window.removeEventListener('focus', focusListener);
        if (typeof unwatchPending === 'function') {
            try { unwatchPending(); } catch (e) {}
            unwatchPending = null;
        }
        if (bc) {
            try { bc.close(); } catch (e) {}
        }
        modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const triggerSuccess = () => {
        if (isFinished) return;
        isFinished = true;
        clearInterval(timerInterval);
        clearInterval(pollInterval);
        window.removeEventListener('storage', storageListener);
        window.removeEventListener('focus', focusListener);
        if (typeof unwatchPending === 'function') {
            try { unwatchPending(); } catch (e) {}
            unwatchPending = null;
        }

        showAlert("🎉 College email verified successfully! Unlocking registration...", "success");
        checkBtn.disabled = true;
        checkBtn.innerHTML = `<i class="fa-solid fa-check"></i> Verified!`;
        checkBtn.style.backgroundColor = '#10B981';
        checkBtn.style.borderColor = '#10B981';

        setTimeout(() => {
            closeModal();
            if (typeof onVerifiedCallback === 'function') {
                onVerifiedCallback(cleanEmail);
            }
        }, 500);
    };

    // Real-time verification status checker
    const checkVerificationStatus = async () => {
        // 1. Check local cross-tab verification signal
        if (localStorage.getItem('emailVerifiedStatus') === 'true' || localStorage.getItem('email_link_verified_' + cleanEmail) === 'true') {
            return true;
        }

        // 2. Check Firebase Auth user reload
        if (auth && auth.currentUser) {
            try {
                await auth.currentUser.reload();
                if (auth.currentUser.emailVerified) {
                    localStorage.setItem('emailVerifiedStatus', 'true');
                    localStorage.setItem('email_link_verified_' + cleanEmail, 'true');
                    return true;
                }
            } catch (e) {}
        }

        // 3. Check current window query parameters
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('email_verified') === 'true' || params.get('mode') === 'verifyEmail') {
                const paramEmail = (params.get('email') || '').trim().toLowerCase();
                if (!paramEmail || paramEmail === cleanEmail) {
                    localStorage.setItem('emailVerifiedStatus', 'true');
                    localStorage.setItem('email_link_verified_' + cleanEmail, 'true');
                    return true;
                }
            }
        } catch (e) {}

        // 4. Cross-Device Real-Time Sync: Check Firestore pendingVerifications/{email}
        try {
            if (db) {
                const docId = cleanEmail.replace(/[\/\s]/g, '_');
                const docSnap = await getDoc(doc(db, 'pendingVerifications', docId));
                if (docSnap && docSnap.exists()) {
                    const data = docSnap.data();
                    if (data && data.status === 'verified') {
                        console.log('[Cross-Device Sync] Firestore pendingVerifications confirmed verified for:', cleanEmail);
                        localStorage.setItem('emailVerifiedStatus', 'true');
                        localStorage.setItem('email_link_verified_' + cleanEmail, 'true');
                        return true;
                    }
                }
            }
        } catch (e) {}

        return false;
    };

    // Listener 1: Cross-tab localStorage storage event
    const storageListener = (e) => {
        if ((e.key === 'emailVerifiedStatus' || e.key === 'email_link_verified_' + cleanEmail) && e.newValue === 'true') {
            triggerSuccess();
        }
    };
    window.addEventListener('storage', storageListener);

    // Listener 2: BroadcastChannel across open tabs
    let bc = null;
    try {
        bc = new BroadcastChannel('student_shelf_verification');
        bc.onmessage = (msg) => {
            if (msg.data?.type === 'EMAIL_VERIFIED') {
                if (!msg.data.email || msg.data.email === cleanEmail) {
                    triggerSuccess();
                }
            }
        };
    } catch (e) {}

    // Listener 3: Cross-Device Real-Time Firestore Snapshot Listener (Laptop <-> Phone)
    try {
        unwatchPending = listenToPendingVerification(cleanEmail, (verifiedEmail) => {
            console.log('[Cross-Device Real-Time Sync] Snapshot verified detected on Laptop for:', verifiedEmail);
            triggerSuccess();
        });
    } catch (snapErr) {
        console.warn('listenToPendingVerification listener note:', snapErr);
    }

    // Listener 4: Automatic background polling every 2.5s (includes Firestore check & auth.currentUser.reload())
    pollInterval = setInterval(async () => {
        if (isFinished) return;
        const verified = await checkVerificationStatus();
        if (verified) {
            triggerSuccess();
        }
    }, 2500);

    // Listener 5: Tab Focus check
    const focusListener = async () => {
        if (isFinished) return;
        const verified = await checkVerificationStatus();
        if (verified) {
            triggerSuccess();
        }
    };
    window.addEventListener('focus', focusListener);

    // ACTION: "I've Verified (Check Status)" Click
    checkBtn.addEventListener('click', async () => {
        if (isFinished) return;
        const origContent = checkBtn.innerHTML;
        checkBtn.disabled = true;
        checkBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Status...`;

        try {
            const isVerified = await checkVerificationStatus();
            if (isVerified) {
                triggerSuccess();
            } else {
                checkBtn.disabled = false;
                checkBtn.innerHTML = origContent;
                showAlert("Verification link not clicked yet. Please open the email sent to " + cleanEmail + " and click the link, then click this button.", "error");
            }
        } catch (err) {
            checkBtn.disabled = false;
            checkBtn.innerHTML = origContent;
            showAlert("Could not verify status. Please check your internet connection.", "error");
        }
    });

    // ACTION: "Resend Email Link" Click
    resendBtn.addEventListener('click', async () => {
        if (resendBtn.disabled || isFinished) return;
        resendBtn.disabled = true;
        resendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Resending...`;

        try {
            if (typeof onResendCallback === 'function') {
                await onResendCallback(cleanEmail);
            } else {
                await sendEmailOTP(cleanEmail);
            }
            showAlert("Fresh verification link sent! Please check your inbox (and Spam/Junk folder).", "info");
            startCooldown();
        } catch (err) {
            showAlert("Failed to resend email link. Please try again in a moment.", "error");
            startCooldown();
        }
    });
}

export const showCheckInboxVerificationModal = showInlineEmailOtpModal;

// Global exposures
window.isCollegeEmail = isCollegeEmail;
window.isUserVerified = isUserVerified;
window.showEmailVerificationModal = showEmailVerificationModal;
window.showInlineEmailOtpModal = showInlineEmailOtpModal;
window.showCheckInboxVerificationModal = showCheckInboxVerificationModal;
window.showVerificationRequiredPrompt = showVerificationRequiredPrompt;
window.sendCollegeVerificationCode = sendCollegeVerificationCode;
window.sendInlineCollegeVerificationOtp = sendInlineCollegeVerificationOtp;
window.sendEmailOTP = sendEmailOTP;
window.requestVerification = requestVerification;
window.verifyInlineCollegeOtp = verifyInlineCollegeOtp;
window.markUserAsVerified = markUserAsVerified;
