import { addListing, getRequests, createNotification, getUserProfile } from './db.js';
import { auth } from './firebase.js';
import { isUserVerified, showVerificationRequiredPrompt } from './verification.js';

export async function showAddListingModal() {
    const user = auth.currentUser;
    if (!user) {
        alert("Please login first!");
        window.location.hash = '#/login';
        return;
    }
    if (!isUserVerified(user)) {
        showVerificationRequiredPrompt("Verify your college email to start buying and selling on campus.");
        return;
    }

    // Modal ID and cleanup
    const modalId = 'add-listing-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    // Create Modal HTML
    const modalHtml = `
        <div id="${modalId}" class="modal-overlay active">
            <div class="modal-container modal-content" style="max-width: 600px;">
                <button class="modal-close" id="close-listing-modal">&times;</button>
                <h2 class="modal-title text-center"><i class="fa-solid fa-plus-circle"></i> Add New Listing</h2>
                
                <form id="add-form">
                    <!-- Step 1: Item Details -->
                    <div id="step-1" class="form-step active">
                        <div class="form-group">
                            <label>Item Name</label>
                            <input type="text" id="item-title" class="form-control" placeholder="e.g., Engineering Drawing Kit">
                        </div>
                        <div class="form-group">
                            <label style="display:flex; justify-content:space-between; align-items:center;">
                                <span>Categories <span style="font-size:12px; font-weight:normal; color:#64748B;">(Select all that apply)</span></span>
                                <span id="selected-cats-count" style="font-size:12px; font-weight:600; color:#00ABE4;">0 selected</span>
                            </label>
                            <div class="multi-category-selector" id="item-categories-selector">
                                <label class="category-checkbox-pill" data-category="Books & Notes">
                                    <input type="checkbox" name="item-categories" value="Books & Notes" class="category-checkbox-input">
                                    <span class="category-pill-box">
                                        <i class="fa-solid fa-book-open"></i>
                                        <span>Books & Notes</span>
                                        <i class="fa-solid fa-check check-indicator"></i>
                                    </span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Electronics">
                                    <input type="checkbox" name="item-categories" value="Electronics" class="category-checkbox-input">
                                    <span class="category-pill-box">
                                        <i class="fa-solid fa-laptop"></i>
                                        <span>Electronics</span>
                                        <i class="fa-solid fa-check check-indicator"></i>
                                    </span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Lab Gear">
                                    <input type="checkbox" name="item-categories" value="Lab Gear" class="category-checkbox-input">
                                    <span class="category-pill-box">
                                        <i class="fa-solid fa-microscope"></i>
                                        <span>Lab Gear</span>
                                        <i class="fa-solid fa-check check-indicator"></i>
                                    </span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Hostel">
                                    <input type="checkbox" name="item-categories" value="Hostel" class="category-checkbox-input">
                                    <span class="category-pill-box">
                                        <i class="fa-solid fa-house"></i>
                                        <span>Hostel</span>
                                        <i class="fa-solid fa-check check-indicator"></i>
                                    </span>
                                </label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Price (₹)</label>
                            <input type="number" id="item-price" class="form-control" placeholder="e.g., 500">
                        </div>
                        <div class="form-group">
                            <label>Condition</label>
                            <select id="item-condition" class="form-control">
                                <option value="New">New</option>
                                <option value="Used - Like New">Used - Like New</option>
                                <option value="Used - Good">Used - Good</option>
                                <option value="Used - Fair">Used - Fair</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Item Description</label>
                            <textarea id="item-desc" class="form-control" rows="3" placeholder="Describe the item..."></textarea>
                        </div>
                        <div class="form-group">
                            <label>Image</label>
                            <input type="file" id="item-img" class="form-control" accept="image/*">
                        </div>
                        <button type="button" class="btn btn-primary w-100 mt-4" id="next-step-btn">Next: Preview & Confirm</button>
                    </div>

                    <!-- Step 2: Confirm & Publish -->
                    <div id="step-2" class="form-step">
                        <div class="item-preview-box mb-4" style="background: var(--bg-hero); padding: 15px; border-radius: 12px; border: var(--border-subtle);">
                            <h4 class="mb-3" style="color:var(--primary-brand)">Listing Summary</h4>
                            <p><strong>Item:</strong> <span id="summary-title">-</span></p>
                            <p><strong>Price:</strong> ₹<span id="summary-price">-</span></p>
                            <p><strong>Categories:</strong> <span id="summary-cat">-</span></p>
                            <div id="summary-img-prev" class="mt-2" style="width: 100%; height: 150px; background: #000; border-radius: 8px; overflow: hidden; display: none;">
                                <img id="preview-img-tag" src="" style="width:100%; height:100%; object-fit:cover;">
                            </div>
                        </div>

                        <div class="identity-confirm mb-4 text-center">
                            <i class="fa-solid fa-shield-halved mb-2" style="font-size: 2rem; color: var(--primary-brand)"></i>
                            <p class="text-muted" style="font-size: 0.9rem;">Your WhatsApp number will be visible to buyers so they can contact you directly.</p>
                        </div>
                        
                        <div style="display:flex; gap:10px;">
                            <button type="button" class="btn btn-secondary w-100" id="prev-step-btn">Back</button>
                            <button type="submit" class="btn btn-primary w-100" id="add-btn">Publish Listing</button>
                        </div>
                    </div>

                    <div id="add-error" class="error-msg mt-3"></div>
                    <div id="add-success" style="color:var(--success-color); display:none;" class="mt-3 text-center w-100">Listing added successfully!</div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById(modalId);
    
    // Elements
    const step1 = modal.querySelector('#step-1');
    const step2 = modal.querySelector('#step-2');
    const nextBtn = modal.querySelector('#next-step-btn');
    const prevBtn = modal.querySelector('#prev-step-btn');
    const closeBtn = modal.querySelector('#close-listing-modal');
    const addForm = modal.querySelector('#add-form');
    const addBtn = modal.querySelector('#add-btn');
    const errDiv = modal.querySelector('#add-error');
    
    // Multi-Category Helpers
    const getSelectedCategories = () => {
        const checkedInputs = modal.querySelectorAll('input[name="item-categories"]:checked');
        return Array.from(checkedInputs).map(cb => cb.value);
    };

    const updateCategoryPillStates = () => {
        const catLabels = modal.querySelectorAll('.category-checkbox-pill');
        const countSpan = modal.querySelector('#selected-cats-count');
        let count = 0;
        catLabels.forEach(label => {
            const cb = label.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
                label.classList.add('selected');
                count++;
            } else {
                label.classList.remove('selected');
            }
        });
        if (countSpan) {
            countSpan.textContent = `${count} selected`;
        }
    };

    modal.querySelectorAll('input[name="item-categories"]').forEach(cb => {
        cb.addEventListener('change', updateCategoryPillStates);
    });

    // Reset Logic: Ensure Step 1 is active on start
    const resetForm = () => {
        addForm.reset();
        updateCategoryPillStates();
        step1.classList.add('active');
        step2.classList.remove('active');
        errDiv.textContent = '';
    };
    resetForm();

    // Close Logic
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
        document.body.style.overflow = 'auto';
    });

    // Step Navigation
    nextBtn.addEventListener('click', () => {
        const title = modal.querySelector('#item-title').value.trim();
        const price = modal.querySelector('#item-price').value.trim();
        const selectedCategories = getSelectedCategories();
        const imfFile = modal.querySelector('#item-img').files[0];

        if (!title || !price || !imfFile) {
            errDiv.textContent = "Please fill all required fields and upload an image.";
            return;
        }

        if (selectedCategories.length === 0) {
            errDiv.textContent = "Please select at least one category tag for your item.";
            return;
        }

        // Fill Summary
        modal.querySelector('#summary-title').textContent = title;
        modal.querySelector('#summary-price').textContent = price;
        modal.querySelector('#summary-cat').textContent = selectedCategories.join(', ');

        const reader = new FileReader();
        reader.onload = (e) => {
            modal.querySelector('#preview-img-tag').src = e.target.result;
            modal.querySelector('#summary-img-prev').style.display = 'block';
        };
        reader.readAsDataURL(imfFile);

        errDiv.textContent = "";
        step1.classList.remove('active');
        step2.classList.add('active');
    });

    prevBtn.addEventListener('click', () => {
        step2.classList.remove('active');
        step1.classList.add('active');
    });

    // Submit Logic
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            addBtn.disabled = true;
            addBtn.textContent = 'Publishing...';
            
            const fileInput = modal.querySelector('#item-img');
            const base64Image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(new Error('Image processing failed'));
                reader.readAsDataURL(fileInput.files[0]);
            });

            const profile = await getUserProfile(user.uid);
            if (!profile || !profile.whatsappNumber) {
                throw new Error("WhatsApp number missing! Please update your profile.");
            }

            const selectedCategories = getSelectedCategories();
            if (selectedCategories.length === 0) {
                throw new Error("Please select at least one category tag.");
            }

            // Store categories as an array and retain backward compatibility
            const data = {
                title: modal.querySelector('#item-title').value.trim(),
                categories: selectedCategories, // e.g. ["Electronics", "Hostel"]
                category: selectedCategories[0] || 'General', // backward compatibility fallback
                price: Number(modal.querySelector('#item-price').value),
                condition: modal.querySelector('#item-condition').value,
                description: modal.querySelector('#item-desc').value.trim(),
                imageUrl: base64Image,
                sellerName: profile.displayName || "Student",
                whatsapp: profile.whatsappNumber,
                sellerId: user.uid,
                sellerEmail: user.email,
                createdAt: Date.now(),
                status: 'active'
            };

            const listingId = await addListing(data);
            
            modal.querySelector('#add-success').style.display = 'block';
            
            // Notification Logic (same as before)
            const requests = await getRequests();
            const keywords = data.title.toLowerCase().split(/\s+/).filter(k => k.length > 2);
            const matches = requests.filter(req => keywords.some(kw => req.itemName.toLowerCase().includes(kw)));

            if (matches.length > 0) {
                modal.remove();
                showMatchModal(matches[0], listingId, data.title);
            } else {
                setTimeout(() => {
                    modal.remove();
                    window.location.hash = '#/';
                    window.location.reload(); // Refresh to see new item
                }, 1500);
            }

        } catch (err) {
            errDiv.textContent = err.message;
            addBtn.disabled = false;
            addBtn.textContent = 'Publish Listing';
        }
    });

    // Add CSS transition for focus
    document.body.style.overflow = 'hidden';
}

function showMatchModal(match, listingId, itemTitle) {
    const modalId = 'match-notify-modal';
    const modalHtml = `
        <div id="${modalId}" class="modal-overlay active">
            <div class="modal-content text-center" style="border: var(--border-subtle); background: var(--card-surface); max-width: 450px;">
                <div style="font-size: 3rem; margin-bottom: 15px;">🎉</div>
                <h2 class="modal-title" style="color: var(--primary-brand)">Match Found!</h2>
                <p class="mb-4"><strong>${match.requesterName}</strong> wants <strong>"${match.itemName}"</strong>. Your listing is a match!</p>
                
                <div class="hero-buttons" style="flex-direction: column; gap: 10px;">
                    <button id="notify-wa-btn" class="btn btn-accent w-100">
                        <i class="fa-brands fa-whatsapp"></i> Notify Buyer
                    </button>
                    <button id="close-match-btn" class="btn btn-outline w-100">Close</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById(modalId);
    
    modal.querySelector('#notify-wa-btn').addEventListener('click', async () => {
        const waLink = `https://wa.me/${match.requesterWhatsApp.replace(/\D/g,'')}?text=${encodeURIComponent("Hi, I have the item you requested on StudentShelf!")}`;
        await createNotification(match.requesterId || match.requesterEmail, listingId, itemTitle);
        window.open(waLink, '_blank');
        modal.remove();
        window.location.hash = '#/';
    });

    modal.querySelector('#close-match-btn').addEventListener('click', () => {
        modal.remove();
        window.location.hash = '#/';
    });
}
