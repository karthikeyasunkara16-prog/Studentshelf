import { getListingById, addLead, initiateChat, sendMessage, subscribeToMessages, getActiveChatsForItem, getUserProfile, getListings } from './db.js';
import { auth } from './firebase.js';
import { isUserVerified, showVerificationRequiredPrompt } from './verification.js';

let unsubscribeChat = null;

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function openChatOverlay(chatId, otherUserName, productName, currentUserName) {
    const overlay = document.getElementById('chat-overlay');
    const titleEl = document.getElementById('chat-user-name');
    const productEl = document.getElementById('chat-product-name');
    const messagesContainer = document.getElementById('chat-messages');
    const inputField = document.getElementById('chat-input-field');
    const form = document.getElementById('chat-input-form');

    if (titleEl) titleEl.textContent = otherUserName;
    if (productEl) productEl.textContent = productName;
    if (messagesContainer) {
        messagesContainer.innerHTML = '<div class="text-center text-muted py-3"><i class="fa-solid fa-spinner fa-spin"></i> Connecting...</div>';
    }
    if (overlay) overlay.classList.add('active');

    // Subscribe to messages in real time
    if (unsubscribeChat) unsubscribeChat();
    
    unsubscribeChat = subscribeToMessages(chatId, (messages) => {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = '';
        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="text-center text-muted py-3">No messages yet. Send a message to start the conversation!</div>';
        } else {
            messages.forEach(msg => {
                const isSentByMe = msg.senderName === currentUserName;
                const bubble = document.createElement('div');
                bubble.className = `message-bubble ${isSentByMe ? 'sent' : 'received'}`;
                
                let timeStr = '';
                if (msg.timestamp) {
                    const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
                
                bubble.innerHTML = `
                    <span class="message-sender">${msg.senderName}</span>
                    <div class="message-text">${escapeHtml(msg.messageText)}</div>
                    <span class="message-time">${timeStr}</span>
                `;
                messagesContainer.appendChild(bubble);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });

    // Handle form submit
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            if (!inputField) return;
            const text = inputField.value.trim();
            if (!text) return;
            
            inputField.value = '';
            try {
                await sendMessage(chatId, currentUserName, otherUserName, text);
            } catch (err) {
                console.error("Failed to send message: ", err);
                alert("Failed to send message. Please try again.");
            }
        };
    }
}

export async function renderItemDetail(container, id) {
    if (!container) return;

    if (!auth.currentUser) {
        alert('Please Login First to View Details and Contact Seller!');
        window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
        return;
    }
    if (!isUserVerified(auth.currentUser)) {
        showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
        window.location.hash = '#/';
        return;
    }
    container.innerHTML = `
        <div class="loader text-center mt-5" id="item-loader" style="padding: 80px 0;">
            <div class="loader-spinner mb-3"></div>
            <p class="text-muted">Loading product details...</p>
        </div>
        <div id="item-content" style="display:none;" class="product-showcase-container">
        </div>
    `;

    try {
        const [item, allListings] = await Promise.all([
            getListingById(id),
            getListings().catch(() => [])
        ]);

        const loader = document.getElementById('item-loader');
        const content = document.getElementById('item-content');
        
        if (loader) loader.style.display = 'none';

        if (!item) {
            if (content) {
                content.style.display = 'block';
                content.innerHTML = `
                    <div class="saas-empty-state-card mt-5 text-center">
                        <div class="empty-state-icon-circle"><i class="fa-solid fa-triangle-exclamation"></i></div>
                        <h3 class="empty-state-title">Item Not Found</h3>
                        <p class="empty-state-subtitle">This listing may have been removed or marked as sold.</p>
                        <a href="#/" class="btn btn-primary empty-state-btn">Back to Marketplace</a>
                    </div>
                `;
            }
            return;
        }

        const isSeller = auth.currentUser && auth.currentUser.uid === item.sellerId;
        const isSold = item.status === 'sold';
        const buyerName = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email.split('@')[0]) : 'Student';

        let currentUserName = buyerName;
        if (auth.currentUser) {
            const profile = await getUserProfile(auth.currentUser.uid);
            if (profile && profile.fullName) {
                currentUserName = profile.fullName;
            }
        }

        // Check wishlist state
        let wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
        let isSaved = wishlist.includes(id);

        // Filter Similar Items in Campus (3-4 related products)
        const myCats = Array.isArray(item.categories) && item.categories.length > 0 
            ? item.categories 
            : [item.category].filter(Boolean);
        let similarItems = allListings.filter(l => {
            if (l.id === id) return false;
            const otherCats = Array.isArray(l.categories) && l.categories.length > 0 
                ? l.categories 
                : [l.category].filter(Boolean);
            return myCats.some(c => otherCats.includes(c));
        });
        if (similarItems.length < 3) {
            const otherListings = allListings.filter(l => l.id !== id && !similarItems.some(s => s.id === l.id));
            similarItems = [...similarItems, ...otherListings];
        }
        similarItems = similarItems.slice(0, 4);

        if (content) content.style.display = 'block';
        
        let actionButtonHtml = '';
        let sellerChatsHtml = '';

        if (isSeller) {
            actionButtonHtml = `
                <div class="btn w-100 text-center" style="border: 2px solid #00ABE4; color: #00ABE4; background: #E9F1FA; font-weight: 600; cursor: default; padding: 12px 18px; border-radius: 10px;">
                    <i class="fa-solid fa-store"></i> This is your active campus listing
                </div>
            `;
            sellerChatsHtml = `
                <div class="seller-chats-container mt-4" id="seller-chats-section">
                    <div class="seller-chats-title"><i class="fa-solid fa-comments"></i> Active Buyer Inquiries</div>
                    <div class="seller-chats-list" id="seller-chats-list">
                        <div class="text-center text-muted py-3">
                            <i class="fa-solid fa-circle-notch fa-spin"></i> Loading active inquiries...
                        </div>
                    </div>
                </div>
            `;
        } else {
            actionButtonHtml = `
                <div class="seller-actions-btn-group">
                    <button type="button" id="chat-with-seller-btn" class="btn btn-primary seller-chat-btn" ${isSold ? 'disabled' : ''}>
                        <i class="fa-solid fa-comments"></i> ${isSold ? 'Item Sold' : 'Chat with Seller'}
                    </button>
                    <button type="button" id="save-item-btn" class="btn btn-outline seller-save-btn ${isSaved ? 'active' : ''}">
                        <i class="fa-${isSaved ? 'solid' : 'regular'} fa-heart"></i>
                        <span id="save-item-text">${isSaved ? 'Saved' : 'Save Item'}</span>
                    </button>
                </div>
            `;
        }

        // Render Premium 2-Column Product Showcase
        content.innerHTML = `
            <!-- Dynamic Breadcrumbs -->
            <nav class="breadcrumb-nav" aria-label="Breadcrumb">
                <a href="#/">Home</a>
                <span class="breadcrumb-sep">/</span>
                <a href="#/">Marketplace</a>
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-current">${escapeHtml(item.title)}</span>
            </nav>

            <!-- 2-COLUMN PRODUCT SHOWCASE CARD -->
            <div class="product-showcase-card shadow-card">
                <div class="product-showcase-grid">
                    
                    <!-- LEFT COLUMN: Product Image Frame -->
                    <div class="product-image-showcase card-image-wrapper">
                        <img src="${item.imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&h=600&q=80'}" 
                             alt="${escapeHtml(item.title)}" 
                             class="product-showcase-img can-zoom" 
                             style="${isSold ? 'filter: grayscale(1) opacity(0.5);' : ''}" 
                             loading="lazy">
                        ${isSold ? '<div class="ecom-sold-overlay">SOLD</div>' : ''}
                    </div>

                    <!-- RIGHT COLUMN: Details & Seller Box -->
                    <div class="product-info-showcase">
                        <!-- Badges Header Row -->
                        <div class="product-badges-row">
                            ${((Array.isArray(item.categories) && item.categories.length > 0) ? item.categories : [item.category || 'General']).map(c => `
                                <span class="ecom-category-chip">
                                    <i class="fa-solid fa-tag"></i> ${escapeHtml(c)}
                                </span>
                            `).join(' ')}
                            <span class="item-verified-pill">
                                <i class="fa-solid fa-shield-halved"></i> 100% Campus Verified
                            </span>
                        </div>

                        <!-- Product Title -->
                        <h1 class="product-showcase-title">${escapeHtml(item.title)}</h1>

                        <!-- Price Row -->
                        <div class="product-showcase-price-row">
                            <span class="product-showcase-price">₹${item.price}</span>
                            ${item.originalPrice ? `<span class="product-showcase-original-price">₹${item.originalPrice}</span>` : ''}
                            <span class="product-showcase-badge-active">${isSold ? 'Sold Out' : 'Available for Trade'}</span>
                        </div>

                        <!-- Item Condition Specs Grid -->
                        <div class="item-specs-grid">
                            <div class="spec-box">
                                <span class="spec-label">Condition</span>
                                <span class="spec-value"><i class="fa-solid fa-cube"></i> ${item.condition || 'Good'}</span>
                            </div>
                            <div class="spec-box">
                                <span class="spec-label">Location</span>
                                <span class="spec-value"><i class="fa-solid fa-location-dot"></i> PEC Campus</span>
                            </div>
                            <div class="spec-box">
                                <span class="spec-label">Posted</span>
                                <span class="spec-value"><i class="fa-regular fa-calendar"></i> ${new Date(item.createdAt || Date.now()).toLocaleDateString()}</span>
                            </div>
                        </div>

                        <!-- Description Block -->
                        <div class="product-desc-block">
                            <h4 class="product-desc-title">Description & Details</h4>
                            <p class="product-desc-text">${escapeHtml(item.description || 'No detailed description provided by the seller.')}</p>
                        </div>

                        <!-- Seller Card Section -->
                        <div class="seller-showcase-card">
                            <div class="seller-card-header">
                                <img src="${item.sellerAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&h=100&q=80'}" 
                                     alt="${escapeHtml(item.sellerName || 'Student')}" 
                                     class="seller-showcase-avatar">
                                <div class="seller-card-details">
                                    <div class="seller-card-name-row">
                                        <span class="seller-showcase-name">${escapeHtml(item.sellerName || 'Student')}</span>
                                        <span class="seller-verified-mini"><i class="fa-solid fa-circle-check"></i> Peer</span>
                                    </div>
                                    <span class="seller-showcase-dept">PEC • Student Community Member</span>
                                </div>
                            </div>
                            ${actionButtonHtml}
                        </div>

                        ${sellerChatsHtml}
                    </div>

                </div>
            </div>

            <!-- BOTTOM SECTION: Similar Items in Campus -->
            <div class="similar-items-section">
                <div class="similar-items-header">
                    <h3 class="similar-items-title"><i class="fa-solid fa-layer-group"></i> Similar Items in Campus</h3>
                    <a href="#/" class="similar-browse-link">View All Listings →</a>
                </div>
                <div class="listings-grid similar-items-grid">
                    ${renderSimilarItemsHTML(similarItems)}
                </div>
            </div>

            <!-- Glassmorphic Chat Overlay -->
            <div class="chat-overlay" id="chat-overlay">
                <div class="chat-card">
                    <div class="chat-header">
                        <div class="chat-header-title">
                            <h3 id="chat-user-name">Chat</h3>
                            <span id="chat-product-name">${escapeHtml(item.title)}</span>
                        </div>
                        <button type="button" class="chat-close-btn" id="chat-close-btn">&times;</button>
                    </div>
                    <div class="chat-messages" id="chat-messages">
                        <!-- Realtime messages load here -->
                    </div>
                    <form class="chat-input-area" id="chat-input-form">
                        <input type="text" id="chat-input-field" placeholder="Type a message to the seller..." required autocomplete="off">
                        <button type="submit" class="chat-send-btn">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                    </form>
                </div>
            </div>
        `;

        // Save Item Button (Wishlist Toggle)
        const saveBtn = document.getElementById('save-item-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!auth.currentUser) {
                    alert('Please sign in to save items to your wishlist.');
                    window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
                    return;
                }
                let currentWish = JSON.parse(localStorage.getItem('wishlist') || '[]');
                if (currentWish.includes(id)) {
                    currentWish = currentWish.filter(x => x !== id);
                    saveBtn.classList.remove('active');
                    saveBtn.innerHTML = '<i class="fa-regular fa-heart"></i> <span id="save-item-text">Save Item</span>';
                } else {
                    currentWish.push(id);
                    saveBtn.classList.add('active');
                    saveBtn.innerHTML = '<i class="fa-solid fa-heart" style="color:#00ABE4;"></i> <span id="save-item-text">Saved</span>';
                }
                localStorage.setItem('wishlist', JSON.stringify(currentWish));
            });
        }

        // Attach Overlay Close Listener
        const overlay = document.getElementById('chat-overlay');
        const closeBtn = document.getElementById('chat-close-btn');
        if (closeBtn && overlay) {
            closeBtn.addEventListener('click', () => {
                overlay.classList.remove('active');
                if (unsubscribeChat) {
                    unsubscribeChat();
                    unsubscribeChat = null;
                }
            });
        }

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                    if (unsubscribeChat) {
                        unsubscribeChat();
                        unsubscribeChat = null;
                    }
                }
            });
        }

        if (isSeller) {
            // Load Active Chats for Seller
            const chatsList = document.getElementById('seller-chats-list');
            try {
                const chats = await getActiveChatsForItem(id);
                if (chatsList) {
                    if (chats.length === 0) {
                        chatsList.innerHTML = '<div class="text-center text-muted py-3">No inquiries received for this item yet.</div>';
                    } else {
                        chatsList.innerHTML = '';
                        chats.forEach(chat => {
                            const chatItem = document.createElement('div');
                            chatItem.className = 'seller-chat-item';
                            chatItem.innerHTML = `
                                <span class="seller-chat-name">${escapeHtml(chat.senderName)}</span>
                                <span class="seller-chat-action">
                                    <i class="fa-solid fa-message"></i> Reply
                                </span>
                            `;
                            chatItem.addEventListener('click', () => {
                                openChatOverlay(chat.id, chat.senderName, item.title, currentUserName);
                            });
                            chatsList.appendChild(chatItem);
                        });
                    }
                }
            } catch (err) {
                console.error("Error loading chats for seller:", err);
                if (chatsList) {
                    chatsList.innerHTML = '<div class="text-center text-danger py-3">Failed to load inquiries.</div>';
                }
            }
        } else {
            // Buyer action button logic
            const chatBtn = document.getElementById('chat-with-seller-btn');
            if (chatBtn) {
                chatBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (!auth.currentUser) {
                        alert('Please Login to Contact Seller');
                        window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash);
                        return;
                    }
                    if (!isUserVerified(auth.currentUser)) {
                        showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
                        return;
                    }

                    const originalText = chatBtn.innerHTML;
                    chatBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';
                    chatBtn.style.opacity = '0.8';
                    chatBtn.style.pointerEvents = 'none';

                    try {
                        const leadData = {
                            buyerEmail: auth.currentUser.email,
                            buyerName: currentUserName,
                            sellerName: item.sellerName,
                            sellerPhone: item.whatsapp || '',
                            productName: item.title,
                            productId: id
                        };
                        await addLead(leadData);

                        const chatId = await initiateChat(
                            currentUserName,
                            item.sellerName,
                            item.title,
                            auth.currentUser.uid,
                            item.sellerId,
                            id
                        );
                        
                        openChatOverlay(chatId, item.sellerName, item.title, currentUserName);
                    } catch (err) {
                        console.error("Error connecting: ", err);
                        alert("Could not connect to seller chat: " + err.message);
                    } finally {
                        chatBtn.innerHTML = originalText;
                        chatBtn.style.opacity = '1';
                        chatBtn.style.pointerEvents = 'auto';
                    }
                });
            }
        }

    } catch (e) {
        console.error("Error loading item details page: ", e);
        const loader = document.getElementById('item-loader');
        const content = document.getElementById('item-content');
        if (loader) loader.style.display = 'none';
        if (content) {
            content.style.display = 'block';
            content.innerHTML = `<p class="error-msg text-center mt-5">Error loading item data: ${e.message}</p>`;
        }
    }
}

function renderSimilarItemsHTML(items) {
    if (!items || items.length === 0) {
        return '<p class="text-muted" style="grid-column: 1/-1;">No other similar listings right now.</p>';
    }

    return items.map(item => {
        const isSold = item.status === 'sold';
        return `
            <div class="product-card ecom-product-card shadow-card">
                <div class="product-image-wrapper ecom-card-img-frame card-image-wrapper product-image-container">
                    <img class="ecom-card-img product-image" src="${item.imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&h=450&q=80'}" alt="${escapeHtml(item.title)}" loading="lazy" style="${isSold ? 'filter: grayscale(1) opacity(0.5);' : ''}">
                    ${isSold ? '<div class="ecom-sold-overlay">SOLD</div>' : ''}
                </div>
                <div class="product-card-details card-content ecom-card-body card-body product-details">
                    <div class="seller-info-row ecom-card-seller-row">
                        <span class="seller-name">Posted by ${escapeHtml(item.sellerName || 'Student')}</span>
                        <span class="status-badge ${isSold ? 'status-sold' : 'status-active'}">${isSold ? 'Sold' : 'Active'}</span>
                    </div>

                    <h3 class="product-title ecom-card-title">${escapeHtml(item.title)}</h3>

                    <div class="ecom-card-meta">
                        ${((Array.isArray(item.categories) && item.categories.length > 0) ? item.categories : [item.category || 'General']).map(c => `
                            <span class="ecom-category-chip"><i class="fa-solid fa-tag"></i> ${escapeHtml(c)}</span>
                        `).join(' ')}
                        <span class="ecom-condition-tag"><i class="fa-solid fa-cube"></i> ${escapeHtml(item.condition || 'Good')}</span>
                    </div>

                    <div class="ecom-card-price-row">
                        <span class="product-price ecom-price">₹${item.price}</span>
                        ${item.originalPrice ? `<span class="ecom-original-price">₹${item.originalPrice}</span>` : ''}
                    </div>

                    <a href="#/item/${item.id}" class="view-details-btn ecom-view-btn mt-2 text-center">View Details</a>
                </div>
            </div>
        `;
    }).join('');
}
