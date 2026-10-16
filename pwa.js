let deferredPrompt;

// Service Worker Registration for PWA & Firebase Messaging
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then((reg) => {
        console.log('Firebase Messaging Service Worker Registered!', reg);
        window.fcmRegistration = reg;
      })
      .catch((err) => {
        console.warn('FCM SW registration fallback to /sw.js:', err);
        navigator.serviceWorker.register('/sw.js')
          .catch((swErr) => console.log('Service Worker registration failed:', swErr));
      });
  });
}

// Clear any legacy storage keys to guarantee banner is not suppressed
try {
  sessionStorage.removeItem('installBannerDismissed');
  sessionStorage.removeItem('bannerDismissed');
  localStorage.removeItem('installBannerDismissed');
  localStorage.removeItem('bannerDismissed');
} catch (e) {}

// Click delegation for PWA install trigger
document.addEventListener('click', function(e) {
  if (e.target.matches('#pwa-install-trigger, #install-pwa-btn') || e.target.closest('#pwa-install-trigger, #install-pwa-btn')) {
    e.stopPropagation();
    if (typeof window.installApp === 'function') {
      window.installApp();
    }
  }
});

// Handle Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  
  const badge = document.getElementById('pwa-floating-badge');
  if (badge) {
    badge.style.display = 'flex';
  }
});

// Function to trigger installation
window.installApp = async () => {
  if (!deferredPrompt) {
    console.log('No deferred prompt available. PWA might already be installed or browser does not support it.');
    return;
  }
  
  // Show the prompt
  deferredPrompt.prompt();
  
  // Wait for the user to respond to the prompt
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response to the install prompt: ${outcome}`);
  
  // We've used the prompt, and can't use it again, throw it away
  deferredPrompt = null;
  
  if (outcome === 'accepted') {
    const badge = document.getElementById('pwa-floating-badge');
    if (badge) {
      badge.style.display = 'none';
    }
  }
};

window.addEventListener('appinstalled', (evt) => {
  console.log('StudentShelf was installed.');
  const badge = document.getElementById('pwa-floating-badge');
  if (badge) {
    badge.style.display = 'none';
  }
});
