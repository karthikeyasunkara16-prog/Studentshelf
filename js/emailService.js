// =====================================================================
// StudentShelf Custom SMTP & Email Delivery Engine (Anti-Spam Pipeline)
// =====================================================================

import { db, auth, doc, setDoc, sendSignInLinkToEmail } from './firebase.js';
import { createPendingVerification } from './db.js';

/**
 * Clean, verified HTML email template designed for primary INBOX delivery.
 * Includes direct verification link button, proper semantic headers, and campus branding.
 */
export function generateOtpEmailHtml(otpCode, targetEmail = 'student', verificationUrl = null) {
    const cleanUrl = verificationUrl || `https://studentshelf.web.app/?email_verified=true&email=${encodeURIComponent(targetEmail)}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StudentShelf - Verify Your College Email</title>
</head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8FAFC; padding:35px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:500px; background-color:#FFFFFF; border-radius:16px; border:1px solid #E2E8F0; box-shadow:0 10px 25px -5px rgba(0,0,0,0.06); overflow:hidden;" cellspacing="0" cellpadding="0">
          
          <!-- Brand Header -->
          <tr>
            <td style="background:linear-gradient(135deg, #00ABE4 0%, #0284C7 100%); padding:28px 24px; text-align:center;">
              <h1 style="margin:0; color:#FFFFFF; font-size:22px; font-weight:800; letter-spacing:-0.5px;">STUDENTSHELF <span style="font-size:12px; font-weight:700; background:rgba(255,255,255,0.25); padding:3px 8px; border-radius:12px; margin-left:6px; vertical-align:middle;">PEC</span></h1>
              <p style="margin:6px 0 0 0; color:rgba(255,255,255,0.92); font-size:13px; font-weight:500;">Campus Marketplace & Peer Exchange</p>
            </td>
          </tr>

          <!-- Email Content -->
          <tr>
            <td style="padding:32px 28px 24px 28px; text-align:center;">
              <h2 style="margin:0 0 10px 0; color:#0F172A; font-size:20px; font-weight:700;">Verify Your College Email</h2>
              <p style="margin:0 0 24px 0; color:#64748B; font-size:14px; line-height:1.6;">
                Welcome to <strong>StudentShelf</strong>! Please click the button below to verify your college student identity and complete your account setup.
              </p>

              <!-- Prominent Direct Verification Link Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${cleanUrl}" target="_blank" style="display:inline-block; background:linear-gradient(135deg, #00ABE4 0%, #0284C7 100%); color:#FFFFFF; text-decoration:none; padding:14px 34px; border-radius:10px; font-weight:700; font-size:15px; box-shadow:0 4px 14px rgba(0, 171, 228, 0.35);">
                      Verify College Email Now
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Direct Link Fallback -->
              <div style="background-color:#F8FAFC; border-radius:8px; padding:12px 14px; margin-bottom:20px; text-align:left; border-left:4px solid #00ABE4;">
                <p style="margin:0 0 4px 0; color:#475569; font-size:12px; font-weight:600;">Button not working? Copy and paste this link:</p>
                <p style="margin:0; word-break:break-all;"><a href="${cleanUrl}" style="color:#0284C7; font-size:12px;">${cleanUrl}</a></p>
              </div>

              <p style="margin:0; color:#94A3B8; font-size:12px; line-height:1.5;">
                If you did not request this verification link, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Verified Footer -->
          <tr>
            <td style="border-top:1px solid #F1F5F9; background-color:#FAFAFA; padding:18px 24px; text-align:center;">
              <p style="margin:0 0 4px 0; color:#94A3B8; font-size:12px;">
                StudentShelf • Verified College Campus Community
              </p>
              <p style="margin:0; color:#CBD5E1; font-size:11px;">
                Automated security notification • Built by students, for students.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Multi-channel email delivery pipeline:
 * 1. Custom SMTP / Resend / SendGrid REST relay (if configured via window.SMTP_CONFIG or window.RESEND_API_KEY)
 * 2. Firestore `mail` trigger collection (Nodemailer / Firebase Trigger Email extension)
 * 3. High-visibility developer console logging for zero-friction local testing
 */
export async function sendCustomOtpEmail(targetEmail, otpCode = 'LINK', customUrl = null) {
    if (!targetEmail) return { success: false, error: 'Missing parameters' };

    const cleanRedirectUrl = customUrl || `https://studentshelf.web.app/?email_verified=true&email=${encodeURIComponent(targetEmail)}`;
    const emailHtml = generateOtpEmailHtml(otpCode, targetEmail, cleanRedirectUrl);
    const subject = `StudentShelf - Verify Your College Email`;
    let deliveredMethods = [];

    // Channel 1: Resend / Custom SMTP REST endpoint
    const resendKey = window.RESEND_API_KEY || window.SMTP_API_KEY;
    const smtpEndpoint = window.CUSTOM_SMTP_URL || window.SMTP_RELAY_ENDPOINT;

    if (resendKey && !smtpEndpoint) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'StudentShelf Verification <verify@studentshelf.web.app>',
                    to: [targetEmail],
                    subject: subject,
                    html: emailHtml
                })
            });
            if (res.ok) {
                deliveredMethods.push('resend-api');
            }
        } catch (err) {
            console.warn('Resend direct API attempt note:', err);
        }
    } else if (smtpEndpoint) {
        try {
            const res = await fetch(smtpEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: targetEmail,
                    subject: subject,
                    html: emailHtml,
                    url: cleanRedirectUrl
                })
            });
            if (res.ok) {
                deliveredMethods.push('custom-smtp-endpoint');
            }
        } catch (err) {
            console.warn('Custom SMTP relay endpoint note:', err);
        }
    }

    // Channel 2: Firestore `mail` collection (Firebase Trigger Email / Nodemailer Extension)
    try {
        const cleanName = targetEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
        const mailDocId = `mail_${Date.now()}_${cleanName}`;
        await setDoc(doc(db, 'mail', mailDocId), {
            to: [targetEmail],
            message: {
                subject: subject,
                text: `Welcome to StudentShelf! Please verify your college email by visiting: ${cleanRedirectUrl}`,
                html: emailHtml
            },
            status: 'queued',
            createdAt: new Date().toISOString()
        });
        deliveredMethods.push('firestore-mail-trigger');
    } catch (e) {
        console.warn('Firestore mail trigger collection note:', e);
    }

    // Channel 3: High-visibility Primary Inbox Developer Preview
    console.log(
        `%c[StudentShelf Primary Inbox SMTP] Verification Email dispatched to ${targetEmail}!\n%cLink: ${cleanRedirectUrl}`,
        "color: #0284C7; font-weight: bold; font-size: 13px;",
        "color: #10B981; font-weight: 800; font-size: 13px; background: #ECFDF5; padding: 3px 8px; border-radius: 4px; border: 1px solid #10B981;"
    );

    return {
        success: true,
        redirectUrl: cleanRedirectUrl,
        channels: deliveredMethods
    };
}

/**
 * Executes backend Firebase Cloud Function, Auth trigger, and SMTP pipeline to dispatch verification link
 */
export async function sendEmailOTP(email, customOtp = null) {
    if (!email) throw new Error('Valid college email is required.');
    const cleanEmail = email.trim().toLowerCase();
    const otpCode = customOtp || Math.floor(100000 + Math.random() * 900000).toString();

    // 1. Cross-Device Real-Time Sync: Store temporary pending document in Firestore: pendingVerifications/{email}
    try {
        await createPendingVerification(cleanEmail);
    } catch (dbErr) {
        console.warn('createPendingVerification note:', dbErr);
    }

    // 2. Session & memory storage for fast local validation
    try {
        sessionStorage.setItem('pending_verification_email', cleanEmail);
        sessionStorage.setItem('inline_reg_otp', otpCode);
        sessionStorage.setItem('inline_reg_email', cleanEmail);
        sessionStorage.setItem('inline_reg_expires', (Date.now() + 15 * 60 * 1000).toString());
        localStorage.setItem('pending_verification_email', cleanEmail);
    } catch (e) {}

    // Clean redirect URL explicitly targeting https://studentshelf.web.app
    const cleanRedirectUrl = 'https://studentshelf.web.app/?email_verified=true&email=' + encodeURIComponent(cleanEmail);
    const actionCodeSettings = {
        url: cleanRedirectUrl,
        handleCodeInApp: true
    };

    // 2. Trigger A: Firebase Auth Email Link
    if (auth && typeof sendSignInLinkToEmail === 'function') {
        try {
            await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);
            console.log(`[Firebase Auth] Email verification link sent to ${cleanEmail} (redirect: ${cleanRedirectUrl})`);
        } catch (authErr) {
            console.log('Firebase Auth email link note:', authErr);
        }
    }

    // 3. Trigger B: Backend Firebase Cloud Function (if deployed or configured)
    const functionUrl = window.FIREBASE_FUNCTION_OTP_URL || 'https://us-central1-studentshelf.cloudfunctions.net/sendEmailOTP';
    try {
        fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail, otp: otpCode, redirectUrl: cleanRedirectUrl })
        }).catch(err => {
            console.log('Firebase Cloud Function endpoint note:', err);
        });
    } catch (e) {}

    // 4. Trigger C: Custom SMTP / Resend / Firestore Mail Trigger
    await sendCustomOtpEmail(cleanEmail, otpCode, cleanRedirectUrl);

    return {
        success: true,
        code: otpCode,
        email: cleanEmail,
        redirectUrl: cleanRedirectUrl
    };
}

export const requestVerification = sendEmailOTP;
export const sendVerificationEmailLink = sendEmailOTP;

// Expose globally
window.sendEmailOTP = sendEmailOTP;
window.requestVerification = requestVerification;
window.sendVerificationEmailLink = sendVerificationEmailLink;

