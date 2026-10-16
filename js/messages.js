import { getUserChats, hasUnreadMessagesInChat, markMessagesAsRead, sendMessage, subscribeToMessages, getUserProfile } from './db.js';
import { auth } from './firebase.js';

let unsubscribeChat = null;
let activeChatId = null;

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function openChatOverlay(chatId, otherUserName, productName, currentUserName) {
    // If we are currently on the #/messages route, seamlessly activate the chat in the split-view
    const splitContainer = document.getElementById('split-messages-container');
    if (splitContainer && typeof window.selectActiveConversation === 'function') {
        window.selectActiveConversation(chatId, otherUserName, productName);
        return;
    }

    // Otherwise, support floating chat overlay modal (e.g. from item detail page)
    const overlay = document.getElementById('chat-overlay');
    const titleEl = document.getElementById('chat-user-name');
    const productEl = document.getElementById('chat-product-name');
    const messagesContainer = document.getElementById('chat-messages');
    const inputField = document.getElementById('chat-input-field');
    const form = document.getElementById('chat-input-form');

    if (titleEl) titleEl.textContent = otherUserName;
    if (productEl) {
        productEl.innerHTML = `<i class="fa-solid fa-tag"></i> Item: <strong>${escapeHtml(productName)}</strong>`;
    }
    if (messagesContainer) {
        messagesContainer.innerHTML = '<div class="text-center text-muted py-4"><i class="fa-solid fa-spinner fa-spin"></i> Connecting...</div>';
    }
    if (overlay) overlay.classList.add('active');

    if (unsubscribeChat) unsubscribeChat();

    unsubscribeChat = subscribeToMessages(chatId, (messages) => {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = '';
        if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="text-center text-muted py-4">No messages yet. Send a message to start the conversation!</div>';
        } else {
            // Optional context banner
            const banner = document.createElement('div');
            banner.className = 'chat-context-banner';
            banner.innerHTML = `<i class="fa-solid fa-tag"></i> Inquiring about <strong>${escapeHtml(productName)}</strong>`;
            messagesContainer.appendChild(banner);

            messages.forEach(msg => {
                const isSentByMe = msg.senderName === currentUserName || (auth.currentUser && msg.senderId === auth.currentUser.uid);
                const bubble = document.createElement('div');
                bubble.className = `message-bubble ${isSentByMe ? 'sent' : 'received'}`;

                let timeStr = '';
                if (msg.timestamp) {
                    const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                // Strictly hide sender's own username on sent messages to prevent overflow & clutter
                bubble.innerHTML = `
                    ${!isSentByMe ? `<span class="message-sender">${escapeHtml(msg.senderName)}</span>` : ''}
                    <div class="message-text">${escapeHtml(msg.messageText)}</div>
                    <span class="message-time">${timeStr}</span>
                `;
                messagesContainer.appendChild(bubble);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });

    markMessagesAsRead(chatId, currentUserName, auth.currentUser?.uid).then(() => {
        window.dispatchEvent(new CustomEvent('messages-read-update'));
    }).catch(e => console.error("Error marking messages as read:", e));

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

export async function renderMessages(container) {
    if (!container) return;
    if (!auth.currentUser) {
        window.location.hash = '#/login?redirect=' + encodeURIComponent('#/messages');
        return;
    }

    container.innerHTML = `
        <div class="messages-page-container">
            <div class="messages-top-bar">
                <nav class="breadcrumb-nav" aria-label="Breadcrumb">
                    <a href="#/"><i class="fa-solid fa-house"></i> Home</a>
                    <span class="breadcrumb-sep">/</span>
                    <span class="breadcrumb-current">My Messages</span>
                </nav>
            </div>

            <div class="split-messages-container" id="split-messages-container">
                <!-- LEFT PANEL: Conversations Sidebar -->
                <aside class="conversations-sidebar" id="conversations-sidebar">
                    <div class="conversations-header">
                        <div class="conversations-title-row">
                            <h3><i class="fa-solid fa-comments"></i> Messages</h3>
                            <span class="conversations-count-badge" id="conversations-count">0</span>
                        </div>
                        <div class="conversations-search-box">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" id="conversations-search-input" placeholder="Search chats or items...">
                        </div>
                    </div>

                    <div class="conversations-list" id="conversations-list">
                        <div class="text-center text-muted py-5" id="conv-loading-state">
                            <i class="fa-solid fa-spinner fa-spin fa-2x mb-3" style="color: #00ABE4;"></i>
                            <p style="font-size: 0.9rem;">Loading conversations...</p>
                        </div>
                    </div>
                </aside>

                <!-- RIGHT PANEL: Active Chat Window -->
                <main class="active-chat-panel" id="active-chat-panel">
                    <!-- Default Placeholder State -->
                    <div class="chat-placeholder-state" id="chat-placeholder-state">
                        <div class="placeholder-icon-wrap">
                            <i class="fa-regular fa-comments"></i>
                        </div>
                        <h3>Your Campus Conversations</h3>
                        <p>Select a student buyer or seller from the left panel to view messages, negotiate prices, and arrange campus pickups.</p>
                    </div>

                    <!-- Active Conversation View -->
                    <div class="active-chat-view" id="active-chat-view" style="display: none;">
                        <!-- STICKY CHAT HEADER -->
                        <div class="chat-header sticky-chat-header" id="active-chat-header">
                            <div class="chat-header-left">
                                <button type="button" class="chat-back-btn" id="chat-mobile-back-btn" title="Back to conversations" aria-label="Back to conversations">
                                    <i class="fa-solid fa-arrow-left"></i>
                                </button>
                                <div class="chat-user-avatar">
                                    <div class="avatar-circle" id="chat-avatar-text">U</div>
                                    <span class="avatar-status-dot" title="Active on campus"></span>
                                </div>
                                <div class="chat-header-info">
                                    <div class="chat-header-name-row">
                                        <h3 class="chat-receiver-name" id="chat-user-name">Student</h3>
                                        <span class="chat-online-pill"><span class="pulse-dot"></span> Active Student</span>
                                    </div>
                                    <div class="chat-header-badge-row">
                                        <span class="chat-item-pill" id="chat-product-name">
                                            <i class="fa-solid fa-tag"></i> Item: <strong>Product</strong>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="chat-header-actions">
                                <button type="button" class="chat-close-btn" id="chat-close-panel-btn" title="Close Active Conversation" aria-label="Close Active Conversation">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>

                        <!-- MESSAGES STREAM CONTAINER -->
                        <div class="chat-messages" id="chat-messages">
                            <!-- Messages stream loads here in real time -->
                        </div>

                        <!-- CHAT INPUT AREA -->
                        <form class="chat-input-area" id="chat-input-form">
                            <div class="chat-input-wrapper">
                                <input type="text" id="chat-input-field" placeholder="Type a message to the student..." required autocomplete="off">
                            </div>
                            <button type="submit" class="chat-send-btn" id="chat-send-submit-btn" title="Send Message" aria-label="Send Message">
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        </form>
                    </div>
                </main>
            </div>
        </div>
    `;

    const splitContainer = document.getElementById('split-messages-container');
    const convList = document.getElementById('conversations-list');
    const convCountBadge = document.getElementById('conversations-count');
    const searchInput = document.getElementById('conversations-search-input');
    const placeholderState = document.getElementById('chat-placeholder-state');
    const activeChatView = document.getElementById('active-chat-view');

    const chatUserName = document.getElementById('chat-user-name');
    const chatProductName = document.getElementById('chat-product-name');
    const chatAvatarText = document.getElementById('chat-avatar-text');
    const messagesContainer = document.getElementById('chat-messages');
    const inputField = document.getElementById('chat-input-field');
    const chatForm = document.getElementById('chat-input-form');
    const mobileBackBtn = document.getElementById('chat-mobile-back-btn');
    const closePanelBtn = document.getElementById('chat-close-panel-btn');

    // Get current user display name
    let currentUserName = auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
    try {
        const profile = await getUserProfile(auth.currentUser.uid);
        if (profile && profile.fullName) {
            currentUserName = profile.fullName;
        }
    } catch (e) {}

    let allChats = [];

    // Mobile back button handler
    if (mobileBackBtn) {
        mobileBackBtn.addEventListener('click', () => {
            if (splitContainer) {
                splitContainer.classList.remove('mobile-chat-open');
            }
        });
    }

    // Close panel button handler
    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', () => {
            if (unsubscribeChat) {
                unsubscribeChat();
                unsubscribeChat = null;
            }
            activeChatId = null;
            if (splitContainer) splitContainer.classList.remove('mobile-chat-open');
            if (activeChatView) activeChatView.style.display = 'none';
            if (placeholderState) placeholderState.style.display = 'flex';
            document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
        });
    }

    // Activate conversation function
    const selectActiveConversation = async (chatId, otherUserName, productName) => {
        if (!chatId) return;
        activeChatId = chatId;

        // Visual selection in list
        document.querySelectorAll('.conversation-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('data-chat-id') === chatId);
        });

        // Show active view, hide placeholder
        if (placeholderState) placeholderState.style.display = 'none';
        if (activeChatView) activeChatView.style.display = 'flex';

        // Update header elements
        if (chatUserName) chatUserName.textContent = otherUserName;
        if (chatProductName) {
            chatProductName.innerHTML = `<i class="fa-solid fa-tag"></i> Item: <strong>${escapeHtml(productName)}</strong>`;
        }
        if (chatAvatarText) {
            chatAvatarText.textContent = getInitials(otherUserName);
        }

        // Switch to mobile full view if screen is mobile
        if (splitContainer) {
            splitContainer.classList.add('mobile-chat-open');
        }

        if (messagesContainer) {
            messagesContainer.innerHTML = '<div class="text-center text-muted py-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading conversation...</div>';
        }

        // Detach old listener
        if (unsubscribeChat) {
            unsubscribeChat();
            unsubscribeChat = null;
        }

        // Real-time message subscription
        unsubscribeChat = subscribeToMessages(chatId, (messages) => {
            if (!messagesContainer) return;
            messagesContainer.innerHTML = '';

            if (messages.length === 0) {
                messagesContainer.innerHTML = '<div class="text-center text-muted py-4">No messages yet. Send a message to start the conversation!</div>';
            } else {
                // Product context banner at top of stream
                const banner = document.createElement('div');
                banner.className = 'chat-context-banner';
                banner.innerHTML = `<i class="fa-solid fa-tag"></i> Inquiring about <strong>${escapeHtml(productName)}</strong>`;
                messagesContainer.appendChild(banner);

                messages.forEach(msg => {
                    const isSentByMe = msg.senderName === currentUserName || (auth.currentUser && msg.senderId === auth.currentUser.uid);
                    const bubble = document.createElement('div');
                    bubble.className = `message-bubble ${isSentByMe ? 'sent' : 'received'}`;

                    let timeStr = '';
                    if (msg.timestamp) {
                        const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                        timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }

                    // For sent messages: DO NOT render sender username inside bubble to prevent overlap & clipping!
                    bubble.innerHTML = `
                        ${!isSentByMe ? `<span class="message-sender">${escapeHtml(msg.senderName)}</span>` : ''}
                        <div class="message-text">${escapeHtml(msg.messageText)}</div>
                        <span class="message-time">${timeStr}</span>
                    `;
                    messagesContainer.appendChild(bubble);
                });

                // Smooth scroll to bottom
                messagesContainer.scrollTo({
                    top: messagesContainer.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });

        // Mark messages as read
        markMessagesAsRead(chatId, currentUserName, auth.currentUser?.uid).then(() => {
            window.dispatchEvent(new CustomEvent('messages-read-update'));
            // Remove unread badge on list item
            const activeCard = document.querySelector(`.conversation-item[data-chat-id="${chatId}"]`);
            if (activeCard) {
                const unreadPill = activeCard.querySelector('.conv-unread-pill');
                if (unreadPill) unreadPill.remove();
            }
        }).catch(e => console.error("Error marking messages read:", e));

        // Form submit handler for active chat
        if (chatForm) {
            chatForm.onsubmit = async (e) => {
                e.preventDefault();
                if (!inputField) return;
                const text = inputField.value.trim();
                if (!text) return;

                inputField.value = '';
                try {
                    await sendMessage(chatId, currentUserName, otherUserName, text);
                    // Update preview in left sidebar list
                    const activeCard = document.querySelector(`.conversation-item[data-chat-id="${chatId}"]`);
                    if (activeCard) {
                        const lastMsgEl = activeCard.querySelector('.conv-last-msg');
                        if (lastMsgEl) lastMsgEl.textContent = text;
                        const timeEl = activeCard.querySelector('.conv-time');
                        if (timeEl) timeEl.textContent = 'Just now';
                    }
                } catch (err) {
                    console.error("Failed to send message: ", err);
                    alert("Failed to send message. Please try again.");
                }
            };
        }

        // Focus input field on desktop
        if (window.innerWidth > 768 && inputField) {
            setTimeout(() => inputField.focus(), 150);
        }
    };

    window.selectActiveConversation = selectActiveConversation;

    // Render conversation list helper
    const renderConversationsList = async (chatsToRender) => {
        if (!convList) return;
        convList.innerHTML = '';

        if (chatsToRender.length === 0) {
            convList.innerHTML = `
                <div class="text-center text-muted py-5 px-3">
                    <i class="fa-regular fa-comment-slash fa-2x mb-2" style="color: #94A3B8;"></i>
                    <p style="font-size: 0.9rem; margin-bottom: 4px; font-weight: 600;">No conversations found</p>
                    <p style="font-size: 0.8rem; color: #94A3B8;">Start a conversation by browsing campus listings and clicking "Chat with Seller".</p>
                </div>
            `;
            return;
        }

        for (const chat of chatsToRender) {
            const isSender = chat.senderId === auth.currentUser.uid;
            const otherUserName = isSender ? chat.receiverName : chat.senderName;
            const hasUnread = await hasUnreadMessagesInChat(chat.id, currentUserName, auth.currentUser?.uid);

            let timeStr = '';
            if (chat.lastMessageTimestamp) {
                const date = chat.lastMessageTimestamp.toDate ? chat.lastMessageTimestamp.toDate() : new Date(chat.lastMessageTimestamp);
                const isToday = date.toDateString() === new Date().toDateString();
                timeStr = isToday
                    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }

            const item = document.createElement('div');
            item.className = `conversation-item ${activeChatId === chat.id ? 'active' : ''}`;
            item.setAttribute('data-chat-id', chat.id);
            item.innerHTML = `
                <div class="conv-avatar-wrap">
                    <div class="conv-avatar-circle">${getInitials(otherUserName)}</div>
                </div>
                <div class="conv-content">
                    <div class="conv-header-row">
                        <span class="conv-name">${escapeHtml(otherUserName)}</span>
                        <span class="conv-time">${timeStr}</span>
                    </div>
                    <span class="conv-product-tag"><i class="fa-solid fa-tag"></i> ${escapeHtml(chat.productName)}</span>
                    <div class="conv-last-msg-row">
                        <p class="conv-last-msg">${chat.lastMessageText ? escapeHtml(chat.lastMessageText) : 'No messages yet...'}</p>
                        ${hasUnread ? '<span class="conv-unread-pill">New</span>' : ''}
                    </div>
                </div>
            `;

            item.addEventListener('click', () => {
                selectActiveConversation(chat.id, otherUserName, chat.productName);
            });

            convList.appendChild(item);
        }
    };

    // Load Inbox
    try {
        allChats = await getUserChats(auth.currentUser.uid);
        if (convCountBadge) {
            convCountBadge.textContent = allChats.length;
        }

        await renderConversationsList(allChats);

        // On desktop, auto-open the first conversation if available
        if (window.innerWidth > 768 && allChats.length > 0 && !activeChatId) {
            const firstChat = allChats[0];
            const isSender = firstChat.senderId === auth.currentUser.uid;
            const otherUserName = isSender ? firstChat.receiverName : firstChat.senderName;
            selectActiveConversation(firstChat.id, otherUserName, firstChat.productName);
        }
    } catch (err) {
        console.error("Error loading user chats:", err);
        if (convList) {
            convList.innerHTML = '<div class="text-center text-danger py-5">Error loading conversations. Please refresh.</div>';
        }
    }

    // Search filter input listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderConversationsList(allChats);
                return;
            }
            const filtered = allChats.filter(chat => {
                const otherUserName = (chat.senderId === auth.currentUser.uid ? chat.receiverName : chat.senderName) || '';
                const prodName = chat.productName || '';
                const lastMsg = chat.lastMessageText || '';
                return otherUserName.toLowerCase().includes(query) ||
                       prodName.toLowerCase().includes(query) ||
                       lastMsg.toLowerCase().includes(query);
            });
            renderConversationsList(filtered);
        });
    }
}
