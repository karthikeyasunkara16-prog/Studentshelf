import { getUserChats, hasUnreadMessagesInChat, markMessagesAsRead, sendMessage, subscribeToMessages, getUserProfile } from './db.js';
import { auth } from './firebase.js';

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
            // Auto scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });

    // Mark as read immediately when chat opens
    markMessagesAsRead(chatId, currentUserName).then(() => {
        // Dispatch a custom event to notify app.js to update the navigation badge
        window.dispatchEvent(new CustomEvent('messages-read-update'));
    }).catch(e => {
        console.error("Error marking messages as read:", e);
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

export async function renderMessages(container) {
    if (!container) return;
    if (!auth.currentUser) {
        window.location.hash = '#/login?redirect=' + encodeURIComponent('#/messages');
        return;
    }

    container.innerHTML = `
        <div class="loader text-center mt-5" id="inbox-loader">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
        </div>
        <div id="inbox-content" style="display:none;" class="inbox-container">
            <nav class="breadcrumb-nav" aria-label="Breadcrumb">
                <a href="#/">Home</a>
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-current">My Messages</span>
            </nav>
            <h2 class="mb-4"><i class="fa-solid fa-envelope"></i> My Messages</h2>
            <div id="inbox-list" class="inbox-list"></div>
        </div>
        
        <!-- Dynamic Glassmorphic Chat Overlay -->
        <div class="chat-overlay" id="chat-overlay">
            <div class="chat-card">
                <div class="chat-header">
                    <div class="chat-header-title">
                        <h3 id="chat-user-name">Chat</h3>
                        <span id="chat-product-name">Product</span>
                    </div>
                    <button class="chat-close-btn" id="chat-close-btn">&times;</button>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <!-- Messages will load here in real time -->
                </div>
                <form class="chat-input-area" id="chat-input-form">
                    <input type="text" id="chat-input-field" placeholder="Type a message..." required autocomplete="off">
                    <button type="submit" class="chat-send-btn">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            </div>
        </div>
    `;

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
            loadInbox();
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
                loadInbox();
            }
        });
    }

    const loader = document.getElementById('inbox-loader');
    const inboxContent = document.getElementById('inbox-content');
    const inboxList = document.getElementById('inbox-list');

    // Get current user display name
    let currentUserName = auth.currentUser.displayName || auth.currentUser.email.split('@')[0];
    const profile = await getUserProfile(auth.currentUser.uid);
    if (profile && profile.fullName) {
        currentUserName = profile.fullName;
    }

    async function loadInbox() {
        try {
            const chats = await getUserChats(auth.currentUser.uid);
            if (loader) loader.style.display = 'none';
            if (inboxContent) inboxContent.style.display = 'block';

            if (!inboxList) return;
            if (chats.length === 0) {
                inboxList.innerHTML = '<div class="text-center text-muted py-5">No active conversations yet.</div>';
                return;
            }

            inboxList.innerHTML = '';

            for (const chat of chats) {
                // Determine who the other person is
                const isSender = chat.senderId === auth.currentUser.uid;
                const otherUserName = isSender ? chat.receiverName : chat.senderName;

                // Check if this chat has unread messages for the current user
                const hasUnread = await hasUnreadMessagesInChat(chat.id, currentUserName);

                const chatCard = document.createElement('div');
                chatCard.className = `inbox-card shadow-card ${hasUnread ? 'unread-chat' : ''}`;
                
                let timeStr = 'No messages';
                if (chat.lastMessageTimestamp) {
                    const date = chat.lastMessageTimestamp.toDate ? chat.lastMessageTimestamp.toDate() : new Date(chat.lastMessageTimestamp);
                    timeStr = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                }

                chatCard.innerHTML = `
                    <div class="inbox-card-details">
                        <div class="inbox-user-header">
                            <span class="inbox-user-name">${escapeHtml(otherUserName)}</span>
                            ${hasUnread ? '<span class="new-message-badge">New Message</span>' : ''}
                        </div>
                        <span class="inbox-product-name"><i class="fa-solid fa-tag"></i> ${escapeHtml(chat.productName)}</span>
                        <p class="inbox-last-msg">${chat.lastMessageText ? escapeHtml(chat.lastMessageText) : 'No messages yet...'}</p>
                        <span class="inbox-time">${timeStr}</span>
                    </div>
                    <button class="btn btn-primary btn-sm view-chat-btn">View Chat</button>
                `;

                chatCard.querySelector('.view-chat-btn').addEventListener('click', () => {
                    openChatOverlay(chat.id, otherUserName, chat.productName, currentUserName);
                });

                inboxList.appendChild(chatCard);
            }
        } catch (err) {
            console.error("Error loading inbox: ", err);
            if (loader) loader.style.display = 'none';
            if (inboxContent) inboxContent.style.display = 'block';
            if (inboxList) {
                inboxList.innerHTML = '<div class="text-center text-danger py-5">Error loading messages. Please try again.</div>';
            }
        }
    }

    // Initial load
    await loadInbox();
}
