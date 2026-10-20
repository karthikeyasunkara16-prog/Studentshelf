import { getListings, getMarketplaceStats, filterProductsByCategory, isProductMatchingCategory, normalizeCategoryName } from './db.js';
import { auth } from './firebase.js';

export const CLEAN_CATEGORIES = ["All Items", "Books & Notes", "Electronics", "Lab Gear", "Hostel"];
let currentCategory = 'All Items';
let currentSearch = '';
let currentSort = 'newest';
let currentTab = 'all';
let localListings = [];

export function getCategoryIcon(cat) {
    const iconMap = {
        'All Items': 'fa-solid fa-layer-group',
        'All': 'fa-solid fa-layer-group',
        'Books & Notes': 'fa-solid fa-book-open',
        'Books': 'fa-solid fa-book-open',
        'Notes': 'fa-solid fa-file-lines',
        'Electronics': 'fa-solid fa-laptop',
        'Lab Gear': 'fa-solid fa-microscope',
        'Lab Equipment': 'fa-solid fa-microscope',
        'Hostel': 'fa-solid fa-house',
        'Hostel Essentials': 'fa-solid fa-house'
    };
    return iconMap[cat] || 'fa-solid fa-tag';
}

export { filterProductsByCategory, isProductMatchingCategory };

export async function renderHome(container) {
    if (!container) return;

    // Premium skeleton state on initial loading
    container.innerHTML = `
        <div class="hero-section hero-skeleton skeleton-shimmer" style="height: 48px; min-height: 48px; max-height: 48px; border-radius: 10px; margin: 12px 0 20px 0;"></div>
        <div class="category-pills-row category-strip" style="margin-bottom: 24px; gap: 8px;">
            ${Array(5).fill(0).map(() => `<div class="skeleton-shimmer" style="height: 38px; width: 110px; border-radius: 9999px;"></div>`).join('')}
        </div>
        <div class="products-section-header" style="margin-bottom: 20px;">
            <div class="skeleton-shimmer" style="height: 28px; width: 160px; border-radius: 6px;"></div>
            <div class="skeleton-shimmer" style="height: 36px; width: 220px; border-radius: 8px;"></div>
        </div>
        <div class="listings-grid marketplace-grid products-grid product-container" id="products-container">
            ${Array(8).fill(0).map(() => `
                <div class="product-card">
                    <div class="skeleton-shimmer product-image-wrapper" style="height: 150px; width: 100%;"></div>
                    <div class="product-card-details card-content" style="padding: 10px;">
                        <div class="skeleton-shimmer" style="height: 14px; width: 80%; border-radius: 4px; margin-bottom: 8px;"></div>
                        <div class="skeleton-shimmer" style="height: 18px; width: 50%; border-radius: 4px; margin-bottom: 12px;"></div>
                        <div class="skeleton-shimmer" style="height: 36px; width: 100%; border-radius: 8px;"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    try {
        const stats = await getMarketplaceStats();
        const listings = await getListings();
        localListings = listings;

        // Clean unique category pills: ["All Items", "Books & Notes", "Electronics", "Lab Gear", "Hostel"]
        const categoriesHTML = CLEAN_CATEGORIES.map(cat => {
            const icon = getCategoryIcon(cat);
            const isActive = cat === currentCategory || (cat === 'All Items' && (currentCategory === 'All' || currentCategory === 'All Items'));
            return `
                <button type="button" class="category-pill ${isActive ? 'active' : ''}" data-cat="${cat}">
                    <i class="${icon}"></i>
                    <span>${cat}</span>
                </button>
            `;
        }).join('');

        container.innerHTML = `
            <!-- HERO BANNER: ULTRA-SLEEK COMPACT SINGLE-LINE TRUST & ANNOUNCEMENT BAR -->
            <section class="hero-section hero-trust-bar" aria-label="Campus trust announcement bar">
                <div class="hero-left-content">
                    <span class="hero-promo-badge">CAMPUS EXCHANGE</span>
                    <span class="hero-promo-headline">⚡ 100% Peer-Verified Exchange — Trade textbooks, lab gear, and notes safely within your campus community.</span>
                </div>
                <div class="hero-trust-right">
                    <span class="hero-live-counter">
                        <span class="live-dot">●</span> 100+ Active College Listings
                    </span>
                </div>
            </section>

            <!-- CATEGORY PILLS (Horizontal row with 8px gaps and crisp icons) -->
            <div class="category-pills-row category-strip" id="category-pills-row" role="tablist">
                ${categoriesHTML}
            </div>

            <!-- SECTION HEADER: UPGRADED TO CRISP MODERN TYPOGRAPHY -->
            <div class="products-section-header">
                <div class="products-section-title-wrap">
                    <h2 class="products-section-title">Marketplace Listings</h2>
                    <span class="products-count-badge" id="ecom-results-count">Loading items...</span>
                </div>
                <div class="products-controls-row">
                    <div class="filter-tabs-strip filter-strip">
                        <button type="button" class="filter-tab-pill ${currentTab === 'all' ? 'active' : ''}" data-tab="all">
                            <i class="fa-solid fa-fire"></i> Trending
                        </button>
                        <button type="button" class="filter-tab-pill ${currentTab === 'recent' ? 'active' : ''}" data-tab="recent">
                            <i class="fa-solid fa-clock"></i> Recent
                        </button>
                        <button type="button" class="filter-tab-pill ${currentTab === 'most-liked' ? 'active' : ''}" data-tab="most-liked">
                            <i class="fa-solid fa-heart"></i> Liked
                        </button>
                        <button type="button" class="filter-tab-pill ${currentTab === 'most-viewed' ? 'active' : ''}" data-tab="most-viewed">
                            <i class="fa-solid fa-eye"></i> Viewed
                        </button>
                    </div>
                    <div class="sort-dropdown-wrap">
                        <i class="fa-solid fa-arrow-down-short-wide sort-icon"></i>
                        <select id="sort-filter" class="sort-select-pill" aria-label="Sort listings">
                            <option value="newest" ${currentSort === 'newest' ? 'selected' : ''}>Newest First</option>
                            <option value="price-low" ${currentSort === 'price-low' ? 'selected' : ''}>Price: Low to High</option>
                            <option value="price-high" ${currentSort === 'price-high' ? 'selected' : ''}>Price: High to Low</option>
                            <option value="popular" ${currentSort === 'popular' ? 'selected' : ''}>Most Popular</option>
                            <option value="oldest" ${currentSort === 'oldest' ? 'selected' : ''}>Oldest First</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- PRODUCTION PRODUCT CARDS GRID (repeat(auto-fill, minmax(220px, 1fr)), gap: 20px) -->
            <div class="products-grid-container">
                <div class="marketplace-grid products-grid listings-grid product-container" id="listings-grid">
                    <!-- Product cards rendered dynamically -->
                </div>
            </div>

            <!-- BOTTOM TRUST BAR -->
            <div class="bottom-trust-bar">
                <div class="trust-item">
                    <div class="trust-icon-container"><i class="fa-solid fa-shield-halved"></i></div>
                    <div class="trust-text">
                        <h5>Safe Transactions</h5>
                        <p>Direct peer-to-peer campus trades</p>
                    </div>
                </div>
                <div class="trust-divider"></div>
                <div class="trust-item">
                    <div class="trust-icon-container"><i class="fa-solid fa-user-check"></i></div>
                    <div class="trust-text">
                        <h5>Verified Students</h5>
                        <p>Exclusively for College peers</p>
                    </div>
                </div>
                <div class="trust-divider"></div>
                <div class="trust-item">
                    <div class="trust-icon-container"><i class="fa-solid fa-comments"></i></div>
                    <div class="trust-text">
                        <h5>Instant Chat</h5>
                        <p>Direct negotiation with sellers</p>
                    </div>
                </div>
                <div class="trust-divider"></div>
                <div class="trust-item">
                    <div class="trust-icon-container"><i class="fa-solid fa-tags"></i></div>
                    <div class="trust-text">
                        <h5>Zero Fees</h5>
                        <p>100% savings kept between students</p>
                    </div>
                </div>
            </div>
        `;

        setupInteractions(container);
        await loadAndRenderListings();

    } catch (e) {
        console.error("Home loading failed:", e);
        if (container) {
            container.innerHTML = `
                <div class="error-msg-box" style="padding: 40px; text-align: center;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 32px; color: #EF4444; margin-bottom: 12px;"></i>
                    <h3>Unable to load StudentShelf dashboard</h3>
                    <p style="color: #64748B; margin-top: 8px;">Please check your internet connection or Firebase setup.</p>
                </div>
            `;
        }
    }
}

function setupInteractions(container) {
    // Category pills click handlers
    const catPills = container.querySelectorAll('.category-pill');
    catPills.forEach(pill => {
        pill.addEventListener('click', () => {
            catPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentCategory = pill.dataset.cat;
            loadAndRenderListings();
        });
    });

    // Filter tabs click handlers
    const filterTabs = container.querySelectorAll('.filter-tab-pill');
    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            loadAndRenderListings();
        });
    });

    // Sort filter change handler
    const sortSelect = container.querySelector('#sort-filter');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentSort = sortSelect.value;
            loadAndRenderListings();
        });
    }

    // Add listing triggers in home view
    const addTriggers = container.querySelectorAll('.add-listing-trigger');
    addTriggers.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!auth.currentUser) {
                alert('Please sign in to post a listing.');
                window.location.hash = '#/login';
                return;
            }
            const modalTrigger = document.querySelector('.top-navbar .add-listing-trigger');
            if (modalTrigger) {
                modalTrigger.click();
            } else if (typeof window.showAddListingModal === 'function') {
                window.showAddListingModal();
            }
        });
    });

    // Global search input synchronization
    const globalSearchInput = document.getElementById('global-search-input');
    if (globalSearchInput) {
        globalSearchInput.value = currentSearch;
        globalSearchInput.oninput = (e) => {
            currentSearch = e.target.value.trim();
            loadAndRenderListings();
        };
    }
}

function getWishlist() {
    return JSON.parse(localStorage.getItem('wishlist') || '[]');
}

function toggleWishlist(id) {
    let wishlist = getWishlist();
    if (wishlist.includes(id)) {
        wishlist = wishlist.filter(item => item !== id);
    } else {
        wishlist.push(id);
    }
    localStorage.setItem('wishlist', JSON.stringify(wishlist));
}

async function loadAndRenderListings() {
    const grid = document.getElementById('listings-grid');
    if (!grid) return;

    // Grid skeleton shimmer while loading items
    grid.innerHTML = Array(8).fill(0).map(() => `
        <div class="product-card">
            <div class="skeleton-shimmer product-image-wrapper" style="height: 150px; width: 100%;"></div>
            <div class="product-card-details card-content" style="padding: 10px;">
                <div class="skeleton-shimmer" style="height: 14px; width: 75%; border-radius: 4px; margin-bottom: 8px;"></div>
                <div class="skeleton-shimmer" style="height: 18px; width: 45%; border-radius: 4px; margin-bottom: 12px;"></div>
                <div class="skeleton-shimmer" style="height: 36px; width: 100%; border-radius: 8px;"></div>
            </div>
        </div>
    `).join('');

    try {
        let allItems = await getListings(null, currentSearch);
        let items = filterProductsByCategory(allItems, currentCategory);

        // Sorting Logic
        if (currentSort === 'price-low') {
            items.sort((a, b) => a.price - b.price);
        } else if (currentSort === 'price-high') {
            items.sort((a, b) => b.price - a.price);
        } else if (currentSort === 'oldest') {
            items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        } else if (currentSort === 'popular') {
            items.sort((a, b) => (b.views || 0) - (a.views || 0));
        } else {
            items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        // Tab-specific Filtering/Sorting
        if (currentTab === 'most-viewed') {
            items.forEach(item => {
                item.views = item.views || Math.floor(Math.random() * 200) + 12;
            });
            items.sort((a, b) => b.views - a.views);
        } else if (currentTab === 'most-liked') {
            items.forEach(item => {
                item.likes = item.likes || Math.floor(Math.random() * 45) + 3;
            });
            items.sort((a, b) => b.likes - a.likes);
        } else if (currentTab === 'recent') {
            items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        grid.innerHTML = '';

        // Update results count badge
        const resultsCount = document.getElementById('ecom-results-count');
        if (resultsCount) {
            const catLabel = (currentCategory === 'All' || currentCategory === 'All Items') ? 'All Items' : currentCategory;
            resultsCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''} in ${catLabel}`;
        }

        if (items.length === 0) {
            grid.innerHTML = `
                <div class="empty-state-card" style="grid-column: 1 / -1; text-align: center; padding: 60px 24px; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 16px; margin: 20px 0;">
                    <div style="width: 56px; height: 56px; border-radius: 50%; background: #E9F1FA; color: #00ABE4; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 24px;">
                        <i class="fa-solid fa-box-open"></i>
                    </div>
                    <h3 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">No listings found</h3>
                    <p style="font-size: 14px; color: #64748B; max-width: 400px; margin: 0 auto 20px auto;">
                        ${currentSearch ? `No results matching "${currentSearch}". Try a different keyword or category.` : 'Be the first one to post an item in this category!'}
                    </p>
                    <button type="button" class="btn btn-primary add-listing-trigger" style="display: inline-flex; align-items: center; gap: 8px; border-radius: 8px; padding: 10px 20px;">
                        <i class="fa-solid fa-plus"></i> Post a Listing
                    </button>
                </div>
            `;
            const emptyAddBtn = grid.querySelector('.add-listing-trigger');
            if (emptyAddBtn) {
                emptyAddBtn.addEventListener('click', () => {
                    const modalTrigger = document.querySelector('.top-navbar .add-listing-trigger');
                    if (modalTrigger) modalTrigger.click();
                });
            }
            return;
        }

        const wishlist = getWishlist();

        items.forEach(item => {
            const isWishlisted = wishlist.includes(item.id);
            const isSold = item.status === 'sold';
            const card = document.createElement('div');
            card.className = 'product-card ecom-product-card';

            const ageSec = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 1000);
            let timeText = 'Just now';
            if (ageSec > 86400) {
                timeText = `${Math.floor(ageSec / 86400)}d ago`;
            } else if (ageSec > 3600) {
                timeText = `${Math.floor(ageSec / 3600)}h ago`;
            } else if (ageSec > 60) {
                timeText = `${Math.floor(ageSec / 60)}m ago`;
            }

            const displayCategories = (Array.isArray(item.categories) && item.categories.length > 0)
                ? item.categories
                : [item.category || 'General'];
            const categoryChipsHtml = displayCategories.map(c => 
                `<span class="ecom-category-chip"><i class="fa-solid fa-tag"></i> ${c}</span>`
            ).join(' ');

            const coverImg = (Array.isArray(item.imageUrls) && item.imageUrls.length > 0)
                ? item.imageUrls[0]
                : (item.imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&h=450&q=80');
            const multiImgBadge = (Array.isArray(item.imageUrls) && item.imageUrls.length > 1)
                ? `<span class="card-multi-img-badge"><i class="fa-solid fa-images"></i> ${item.imageUrls.length}</span>`
                : '';

            card.innerHTML = `
                <!-- Product Image Inner Canvas Frame -->
                <div class="product-image-wrapper ecom-card-img-frame card-image-wrapper product-image-container">
                    <img class="ecom-card-img product-image" src="${coverImg}" alt="${item.title}" loading="lazy" style="${isSold ? 'filter: grayscale(1) opacity(0.5);' : ''}">
                    ${multiImgBadge}
                    <button type="button" class="ecom-wishlist-btn ${isWishlisted ? 'active' : ''}" data-id="${item.id}" aria-label="Save to wishlist">
                        <i class="fa-${isWishlisted ? 'solid' : 'regular'} fa-heart"></i>
                    </button>
                    ${isSold ? '<div class="ecom-sold-overlay">SOLD</div>' : ''}
                </div>

                <!-- Product Body Details -->
                <div class="product-card-details card-content ecom-card-body card-body product-details">
                    <!-- Publisher Person Name & Status Row -->
                    <div class="seller-info-row ecom-card-seller-row">
                        <span class="seller-name">Posted by ${item.sellerName || 'Student'}</span>
                        <span class="status-badge ${isSold ? 'status-sold' : 'status-active'}">${isSold ? 'Sold' : 'Active'}</span>
                        <span class="ecom-time-tag">${timeText}</span>
                    </div>

                    <h3 class="product-title ecom-card-title">${item.title}</h3>

                    <div class="ecom-card-meta">
                        ${categoryChipsHtml}
                        <span class="ecom-condition-tag"><i class="fa-solid fa-cube"></i> ${item.condition || 'Good'}</span>
                    </div>

                    <div class="ecom-card-price-row">
                        <span class="product-price ecom-price">₹${item.price}</span>
                        ${item.originalPrice ? `<span class="ecom-original-price">₹${item.originalPrice}</span>` : ''}
                    </div>

                    ${isSold
                        ? '<button type="button" class="view-details-btn ecom-view-btn ecom-sold-btn" disabled>Item Sold</button>'
                        : `<a href="#/item/${item.id}" class="view-details-btn ecom-view-btn">View Details</a>`
                    }
                </div>
            `;

            // Wishlist interaction
            const wishBtn = card.querySelector('.ecom-wishlist-btn');
            if (wishBtn) {
                wishBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!auth.currentUser) {
                        alert('Please sign in to save items to your wishlist.');
                        window.location.hash = '#/login?redirect=' + encodeURIComponent(window.location.hash || '#/');
                        return;
                    }
                    const id = wishBtn.dataset.id;
                    toggleWishlist(id);
                    const icon = wishBtn.querySelector('i');
                    wishBtn.classList.toggle('active');
                    if (wishBtn.classList.contains('active')) {
                        icon.classList.replace('fa-regular', 'fa-solid');
                    } else {
                        icon.classList.replace('fa-solid', 'fa-regular');
                    }
                });
            }

            // View Details button authentication check
            const viewBtn = card.querySelector('.ecom-view-btn');
            if (viewBtn && !isSold) {
                viewBtn.addEventListener('click', (e) => {
                    if (!auth.currentUser) {
                        e.preventDefault();
                        alert('Please Login First to View Details and Contact Seller!');
                        window.location.hash = `#/login?redirect=${encodeURIComponent('#/item/' + item.id)}`;
                    }
                });
            }

            // Click entire card to navigate to details if not clicking button or link
            card.addEventListener('click', (e) => {
                if (!e.target.closest('a') && !e.target.closest('button')) {
                    if (!isSold) {
                        if (!auth.currentUser) {
                            alert('Please Login First to View Details and Contact Seller!');
                            window.location.hash = `#/login?redirect=${encodeURIComponent('#/item/' + item.id)}`;
                            return;
                        }
                        window.location.hash = `#/item/${item.id}`;
                    }
                }
            });

            grid.appendChild(card);
        });

    } catch (err) {
        console.error("Listing render error:", err);
        grid.innerHTML = `<p class="error-msg" style="grid-column:1/-1; padding:20px; text-align:center;">Failed to load listings.</p>`;
    }
}
