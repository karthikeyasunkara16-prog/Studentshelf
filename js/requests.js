import { addRequest, getRequests, updateRequestStatus, getUserProfile } from './db.js';
import { auth } from './firebase.js';

export async function renderRequests(container) {
    if (!container) return;
    container.innerHTML = `
        <nav class="breadcrumb-nav" aria-label="Breadcrumb">
            <a href="#/">Home</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Community Requests</span>
        </nav>

        <div class="hero-section text-center">
            <h1 class="hero-title"><span class="gradient-bridge">Student Requests</span></h1>
            <p class="hero-subtitle">Can't find what you're looking for? Post a request and let the community help you!</p>
        </div>

        <div class="auth-card shadow-card w-100 mb-5" style="max-width: 600px; margin: 0 auto 50px auto;">
            <h3 class="mb-4 text-center">Post a Request</h3>
            <form id="request-form">
                <div class="form-group">
                    <label>What are you looking for?</label>
                    <input type="text" id="req-item-name" class="form-control" required placeholder="e.g., Data Structures Book">
                </div>
                <div class="form-group">
                    <label>Identity Confirmation</label>
                    <p class="text-muted" style="font-size: 0.9rem;">Your registered name and WhatsApp will be attached to this request.</p>
                </div>
                <button type="submit" class="btn btn-bridge w-100 mt-3" id="post-req-btn">Post Request</button>
                <div id="req-msg" class="mt-3 text-center"></div>
            </form>
        </div>

        <div id="requests-loader" class="text-center">
            <i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--primary-brand)"></i>
        </div>

        <div id="requests-grid" class="listings-grid">
            <!-- Requests will be rendered here -->
        </div>
    `;

    const form = container.querySelector('#request-form');
    const grid = container.querySelector('#requests-grid');
    const loader = container.querySelector('#requests-loader');
    const msgDiv = container.querySelector('#req-msg');

    // Initial Load Trigger
    console.log("Initiating initial request load...");
    loadRequests();

    // Fetch and render existing requests
    async function loadRequests() {
        console.log("Fetching requests from database...");
        let fetchTimedOut = false;
        
        const timeoutId = setTimeout(() => {
            fetchTimedOut = true;
            console.warn("Requests fetch is taking too long (Timeout > 5s)");
            if (loader) loader.style.display = 'none';
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                        <h3>Taking longer than usual...</h3>
                        <p>Fetching requests is taking some time. Please refresh if this persists or check your connection.</p>
                    </div>
                `;
            }
        }, 5000);

        try {
            const requests = await getRequests();
            clearTimeout(timeoutId);
            if (fetchTimedOut) return; // Already showed timeout UI

            console.log("Fetched data:", requests);
            if (loader) loader.style.display = 'none';
            
            if (!grid) return;
            if (!requests || requests.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-clipboard-list" style="color:var(--primary-brand)"></i>
                        <h3>No active requests found</h3>
                        <p>Post your first request to get started!</p>
                    </div>
                `;
                return;
            }

            grid.innerHTML = requests.map(req => {
                const requesterName = req.requesterName || 'Unknown Student';
                const requesterWA = req.requesterWhatsApp || '';
                const phoneNumber = requesterWA.replace(/\D/g, '');
                
                const message = encodeURIComponent(`Hi ${requesterName}, I saw your request on StudentShelf for "${req.itemName}". I might be able to help!`);
                const waLink = phoneNumber ? `https://wa.me/${phoneNumber}?text=${message}` : '#';
                const isOwner = auth.currentUser && req.requesterId === auth.currentUser.uid;

                return `
                    <div class="listing-card request-card" id="req-${req.id}">
                        <div class="wanted-badge">WANTED</div>
                        <div class="request-content">
                            <h3 class="request-title">Wanted: ${req.itemName}</h3>
                            <p class="request-by">By: ${requesterName}</p>
                            <p class="request-date">${new Date(req.timestamp).toLocaleDateString()}</p>
                            
                            <div class="d-flex flex-column gap-2 mt-3">
                                ${phoneNumber ? `
                                    <a href="${waLink}" target="_blank" class="btn btn-accent w-100">
                                        <i class="fa-brands fa-whatsapp"></i> Help this Student
                                    </a>
                                ` : `
                                    <button class="btn btn-secondary w-100" disabled>No Contact Info</button>
                                `}
                                ${isOwner ? `
                                    <button class="btn btn-outline btn-resolve w-100" data-id="${req.id}">
                                        <i class="fa-solid fa-check-circle"></i> Found It! (Resolve)
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Add Resolve Listeners
            grid.querySelectorAll('.btn-resolve').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.getAttribute('data-id');
                    if (confirm('Did you find this item? This will remove the request from the public feed.')) {
                        try {
                            const card = document.getElementById(`req-${reqId}`);
                            if (card) {
                                card.style.opacity = '0.5';
                                card.style.pointerEvents = 'none';
                            }
                            
                            await updateRequestStatus(reqId, 'resolved');
                            
                            if (card) {
                                card.style.transform = 'scale(0.9)';
                                card.style.opacity = '0';
                            }
                            setTimeout(() => {
                                loadRequests();
                            }, 300);
                        } catch (err) {
                            alert('Error updating status: ' + err.message);
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Requests Loading Error:", err);
            if (loader) loader.style.display = 'none';
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-color)"></i>
                        <h3>Error Loading Requests</h3>
                        <p>If you just deployed, we might be setting up the database. Please check the browser console for an 'Index' link to fix this instantly.</p>
                    </div>
                `;
            }
        }
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = container.querySelector('#post-req-btn');
            
            try {
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Fetching Profile...';
                }

                const profile = await getUserProfile(auth.currentUser.uid);
                if (!profile) throw new Error("Please complete your profile first.");

                const reqItemInput = container.querySelector('#req-item-name');
                const data = {
                    itemName: reqItemInput ? reqItemInput.value.trim() : '',
                    requesterName: profile.displayName || 'Student',
                    requesterWhatsApp: profile.whatsappNumber || '',
                    requesterEmail: auth.currentUser.email,
                    requesterId: auth.currentUser.uid
                };
                
                await addRequest(data);
                
                if (msgDiv) msgDiv.innerHTML = '<span style="color:#25D366">Request posted! Refreshing...</span>';
                form.reset();
                setTimeout(() => {
                    if (msgDiv) msgDiv.innerHTML = '';
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Post Request';
                    }
                    loadRequests();
                }, 1500);
            } catch (err) {
                if (msgDiv) msgDiv.innerHTML = `<span class="error-msg">Error: ${err.message}</span>`;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Post Request';
                }
            }
        });
    }
}
