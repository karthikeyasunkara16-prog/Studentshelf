import { addListing, getRequests, createNotification, getUserProfile } from './db.js';
import { auth } from './firebase.js';
import { isUserVerified, showVerificationRequiredPrompt } from './verification.js';
import { compressImage } from './imageUtils.js';

export async function showAddListingModal() {
    const user = auth.currentUser;
    if (!user) {
        alert("Please login first!");
        window.location.hash = '#/login';
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
                <div class="modal-header">
                    <h3><i class="fa-solid fa-tag"></i> Post an Item to Shelf</h3>
                    <button class="modal-close" id="close-listing-modal">&times;</button>
                </div>
                
                <form id="add-form" novalidate>
                    <!-- Step 1: Details -->
                    <div id="step-1" class="form-step active">
                        <div class="form-group">
                            <label>Item Name / Title</label>
                            <input type="text" id="item-title" class="form-control" placeholder="e.g., Engineering Mathematics - Vol 1">
                        </div>
                        <div class="form-group">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <label style="margin-bottom:0;">Categories <span class="text-muted" style="font-size:12px; font-weight:normal;">(Select all relevant tags)</span></label>
                                <span id="selected-cats-count" class="badge-mini" style="font-size:11px; background:#EFF6FF; color:#00ABE4; padding:2px 8px; border-radius:10px; font-weight:600;">0 selected</span>
                            </div>
                            
                            <!-- Multi-Category Tag Pills Selector -->
                            <div class="category-checkbox-group" id="item-categories-selector">
                                <label class="category-checkbox-pill" data-category="Books & Notes">
                                    <input type="checkbox" name="item-categories" value="Books & Notes">
                                    <span class="pill-check"><i class="fa-solid fa-check"></i></span>
                                    <span class="pill-text"><i class="fa-solid fa-book"></i> Books & Notes</span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Electronics">
                                    <input type="checkbox" name="item-categories" value="Electronics">
                                    <span class="pill-check"><i class="fa-solid fa-check"></i></span>
                                    <span class="pill-text"><i class="fa-solid fa-laptop"></i> Electronics</span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Lab Gear">
                                    <input type="checkbox" name="item-categories" value="Lab Gear">
                                    <span class="pill-check"><i class="fa-solid fa-check"></i></span>
                                    <span class="pill-text"><i class="fa-solid fa-flask"></i> Lab Gear</span>
                                </label>
                                <label class="category-checkbox-pill" data-category="Hostel">
                                    <input type="checkbox" name="item-categories" value="Hostel">
                                    <span class="pill-check"><i class="fa-solid fa-check"></i></span>
                                    <span class="pill-text"><i class="fa-solid fa-bed"></i> Hostel</span>
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

                        <!-- Multi-Image Upload Area with Client-Side Compression -->
                        <div class="form-group">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <label style="margin-bottom:0;">Item Photos <span class="text-muted" style="font-size:12px; font-weight:normal;">(Up to 5 photos)</span></label>
                                <span id="img-count-badge" style="font-size:11.5px; background:#EFF6FF; color:#00ABE4; padding:2px 8px; border-radius:10px; font-weight:700;">0/5 selected</span>
                            </div>

                            <div class="multi-img-upload-box" id="upload-box-wrapper">
                                <input type="file" id="item-img-input" accept="image/*" multiple style="display:none;">
                                <div class="upload-dropzone-inner" id="upload-dropzone" role="button" tabindex="0">
                                    <i class="fa-solid fa-cloud-arrow-up" style="font-size:26px; color:#00ABE4; margin-bottom:6px; display:block;"></i>
                                    <div style="font-size:13.5px; font-weight:600; color:#1E293B;">Click to select or drag & drop photos</div>
                                    <div style="font-size:11.5px; color:#64748B; margin-top:2px;">PNG, JPG, JPEG, WEBP • Auto-compressed strictly under 200 KB</div>
                                </div>
                            </div>

                            <!-- Selected Thumbnails Grid -->
                            <div id="selected-imgs-grid" class="selected-imgs-grid" style="display:none;"></div>

                            <!-- Compression Loading Spinner -->
                            <div id="img-compress-spinner" class="img-compress-spinner mt-2" style="display:none;">
                                <i class="fa-solid fa-spinner fa-spin"></i>
                                <span id="compress-spinner-text">Optimizing photos for instant campus loading...</span>
                            </div>
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
                            
                            <!-- Multi-Image Preview Container in Step 2 -->
                            <div id="summary-img-prev" class="mt-2" style="display:none;">
                                <div style="width: 100%; height: 180px; background: #0F172A; border-radius: 10px; overflow: hidden; position: relative;">
                                    <img id="preview-img-tag" src="" style="width:100%; height:100%; object-fit:contain;">
                                    <span id="summary-photo-count-badge" style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.7); color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; backdrop-filter:blur(4px);">1 Photo</span>
                                </div>
                                <div id="summary-thumbnails-row" style="display:flex; gap:8px; margin-top:8px; overflow-x:auto;"></div>
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

    // Field-level validation helpers for Add Item Modal
    const setFieldError = (fieldEl, message, anchorEl = null) => {
        if (!fieldEl) return;
        fieldEl.classList.add('is-invalid');
        const targetAnchor = anchorEl || fieldEl;
        const parent = targetAnchor.parentElement;
        if (parent) {
            const existing = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id || 'field'}"]`);
            if (existing) existing.remove();
            const hint = document.createElement('div');
            hint.className = 'field-error-hint';
            hint.setAttribute('data-for', fieldEl.id || 'field');
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
            const hint = parent.querySelector(`.field-error-hint[data-for="${fieldEl.id || 'field'}"]`);
            if (hint) hint.remove();
        }
    };

    const clearAllFieldErrors = (container) => {
        if (!container) return;
        container.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        container.querySelectorAll('.field-error-hint').forEach(el => el.remove());
    };

    // Form inputs
    const titleInput = modal.querySelector('#item-title');
    const priceInput = modal.querySelector('#item-price');
    const conditionInput = modal.querySelector('#item-condition');
    const descInput = modal.querySelector('#item-desc');
    const catSelector = modal.querySelector('#item-categories-selector');
    
    // Multi-Image Elements
    const fileInput = modal.querySelector('#item-img-input');
    const dropzone = modal.querySelector('#upload-dropzone');
    const imgsGrid = modal.querySelector('#selected-imgs-grid');
    const imgCountBadge = modal.querySelector('#img-count-badge');
    const compressSpinner = modal.querySelector('#img-compress-spinner');
    const compressSpinnerText = modal.querySelector('#compress-spinner-text');

    // State for selected compressed images: [{ id, dataUrl, sizeKb }]
    let selectedImages = [];
    let isCompressing = false;

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
        if (count > 0) {
            clearFieldError(catSelector, catSelector);
        }
    };

    modal.querySelectorAll('input[name="item-categories"]').forEach(cb => {
        cb.addEventListener('change', updateCategoryPillStates);
    });

    // Render Thumbnails Grid with Cover Badges and Remove 'X' buttons
    const renderThumbnailsGrid = () => {
        if (!imgsGrid) return;
        imgsGrid.innerHTML = '';

        if (imgCountBadge) {
            imgCountBadge.textContent = `${selectedImages.length}/5 selected`;
        }

        if (selectedImages.length === 0) {
            imgsGrid.style.display = 'none';
            if (dropzone) dropzone.style.display = 'block';
            return;
        }

        imgsGrid.style.display = 'grid';
        if (dropzone) dropzone.style.display = 'none';

        selectedImages.forEach((imgObj, idx) => {
            const card = document.createElement('div');
            card.className = 'selected-img-card';
            card.innerHTML = `
                <img src="${imgObj.dataUrl}" alt="Photo ${idx + 1}" loading="lazy">
                ${idx === 0 ? '<span class="img-cover-badge">★ Cover</span>' : ''}
                <button type="button" class="img-remove-btn" title="Remove Photo" data-id="${imgObj.id}">&times;</button>
            `;

            card.querySelector('.img-remove-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                selectedImages = selectedImages.filter(item => item.id !== imgObj.id);
                renderThumbnailsGrid();
            });

            imgsGrid.appendChild(card);
        });

        // "+ Add Photo" button if fewer than 5 images selected
        if (selectedImages.length < 5) {
            const addMoreCard = document.createElement('div');
            addMoreCard.className = 'add-more-img-card';
            addMoreCard.innerHTML = `
                <i class="fa-solid fa-plus"></i>
                <span>Add Photo</span>
            `;
            addMoreCard.addEventListener('click', () => {
                if (fileInput) fileInput.click();
            });
            imgsGrid.appendChild(addMoreCard);
        }
    };

    // Process & compress selected files
    const handleFilesSelected = async (files) => {
        clearFieldError(dropzone, dropzone);
        if (!files || files.length === 0) return;

        const remainingSlots = 5 - selectedImages.length;
        if (remainingSlots <= 0) {
            alert("Maximum 5 photos allowed per listing.");
            return;
        }

        const filesToProcess = Array.from(files).filter(f => f.type && f.type.startsWith('image/')).slice(0, remainingSlots);
        if (filesToProcess.length === 0) {
            setFieldError(dropzone, 'Please select valid image files (PNG, JPG, WEBP).', dropzone);
            return;
        }

        isCompressing = true;
        if (compressSpinner) compressSpinner.style.display = 'flex';

        try {
            for (let i = 0; i < filesToProcess.length; i++) {
                if (compressSpinnerText) {
                    compressSpinnerText.textContent = `Optimizing photo ${i + 1} of ${filesToProcess.length}...`;
                }
                const compressed = await compressImage(filesToProcess[i]);
                selectedImages.push({
                    id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    dataUrl: compressed.dataUrl,
                    sizeKb: compressed.sizeKb
                });
            }
            renderThumbnailsGrid();
            clearFieldError(dropzone, dropzone);
        } catch (err) {
            console.error("Compression error:", err);
            setFieldError(dropzone, 'Failed to optimize images: ' + err.message, dropzone);
        } finally {
            isCompressing = false;
            if (compressSpinner) compressSpinner.style.display = 'none';
            if (fileInput) fileInput.value = ''; // Reset file input to allow re-selection
        }
    };

    // File Input change listener
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
        });
    }

    // Dropzone Click & Drag-Drop listeners
    if (dropzone) {
        dropzone.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files) {
                handleFilesSelected(e.dataTransfer.files);
            }
        });
    }

    // Real-Time Clearing Listeners
    titleInput.addEventListener('input', () => clearFieldError(titleInput));
    priceInput.addEventListener('input', () => clearFieldError(priceInput));
    conditionInput.addEventListener('change', () => clearFieldError(conditionInput));
    descInput.addEventListener('input', () => clearFieldError(descInput));

    // Reset Logic: Ensure Step 1 is active on start
    const resetForm = () => {
        addForm.reset();
        clearAllFieldErrors(step1);
        clearAllFieldErrors(step2);
        updateCategoryPillStates();
        selectedImages = [];
        renderThumbnailsGrid();
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

    // Step Navigation with Inline Field-Level Validation
    nextBtn.addEventListener('click', () => {
        clearAllFieldErrors(step1);
        errDiv.textContent = "";

        const title = titleInput.value.trim();
        const price = priceInput.value.trim();
        const condition = conditionInput.value;
        const desc = descInput.value.trim();
        const selectedCategories = getSelectedCategories();

        let hasError = false;
        let firstInvalid = null;

        const markInvalid = (el, msg, anchor = null) => {
            setFieldError(el, msg, anchor);
            hasError = true;
            if (!firstInvalid) firstInvalid = el;
        };

        // 1. Item Name / Title
        if (!title) {
            markInvalid(titleInput, 'Item Title is required');
        }

        // 2. Categories
        if (selectedCategories.length === 0) {
            markInvalid(catSelector, 'Please select at least one category tag', catSelector);
        }

        // 3. Price / Cost
        if (!price) {
            markInvalid(priceInput, 'Price/Cost is required');
        } else if (isNaN(price) || Number(price) < 0) {
            markInvalid(priceInput, 'Please enter a valid price amount');
        }

        // 4. Item Condition
        if (!condition) {
            markInvalid(conditionInput, 'Item condition is required');
        }

        // 5. Item Description
        if (!desc) {
            markInvalid(descInput, 'Item description is required');
        }

        // 6. Image selection & compression check
        if (isCompressing) {
            alert('Please wait for photos to finish optimizing.');
            return;
        }

        if (selectedImages.length === 0) {
            markInvalid(dropzone, 'Please upload at least one image of the item', dropzone);
        }

        if (hasError) {
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (typeof firstInvalid.focus === 'function') {
                    firstInvalid.focus();
                }
            }
            return;
        }

        // Fill Summary for Step 2
        modal.querySelector('#summary-title').textContent = title;
        modal.querySelector('#summary-price').textContent = price;
        modal.querySelector('#summary-cat').textContent = selectedCategories.join(', ');

        const previewImgTag = modal.querySelector('#preview-img-tag');
        const summaryImgPrev = modal.querySelector('#summary-img-prev');
        const summaryPhotoCountBadge = modal.querySelector('#summary-photo-count-badge');
        const summaryThumbnailsRow = modal.querySelector('#summary-thumbnails-row');

        if (selectedImages.length > 0 && previewImgTag) {
            previewImgTag.src = selectedImages[0].dataUrl;
            summaryImgPrev.style.display = 'block';

            if (summaryPhotoCountBadge) {
                summaryPhotoCountBadge.textContent = `${selectedImages.length} Photo${selectedImages.length > 1 ? 's' : ''}`;
            }

            if (summaryThumbnailsRow) {
                summaryThumbnailsRow.innerHTML = '';
                if (selectedImages.length > 1) {
                    selectedImages.forEach((imgObj, idx) => {
                        const thumb = document.createElement('img');
                        thumb.src = imgObj.dataUrl;
                        thumb.style.cssText = `width: 48px; height: 48px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 2px solid ${idx === 0 ? '#00ABE4' : '#CBD5E1'}; transition: all 0.2s;`;
                        thumb.addEventListener('click', () => {
                            previewImgTag.src = imgObj.dataUrl;
                            summaryThumbnailsRow.querySelectorAll('img').forEach(el => el.style.borderColor = '#CBD5E1');
                            thumb.style.borderColor = '#00ABE4';
                        });
                        summaryThumbnailsRow.appendChild(thumb);
                    });
                }
            }
        }

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
            if (isCompressing) {
                throw new Error("Photos are currently being optimized. Please wait a moment.");
            }

            if (selectedImages.length === 0) {
                throw new Error("Please upload at least one image of the item.");
            }

            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publishing...';
            
            const profile = await getUserProfile(user.uid);
            if (!profile || !profile.whatsappNumber) {
                throw new Error("WhatsApp number missing! Please update your profile.");
            }

            const selectedCategories = getSelectedCategories();
            if (selectedCategories.length === 0) {
                throw new Error("Please select at least one category tag.");
            }

            // Extract array of compressed image strings
            const imageUrls = selectedImages.map(img => img.dataUrl);

            // Store categories and compressed images array, with imageUrl backward compatibility
            const data = {
                title: modal.querySelector('#item-title').value.trim(),
                categories: selectedCategories, // e.g. ["Electronics", "Hostel"]
                category: selectedCategories[0] || 'General', // backward compatibility fallback
                price: Number(modal.querySelector('#item-price').value),
                condition: modal.querySelector('#item-condition').value,
                description: modal.querySelector('#item-desc').value.trim(),
                imageUrl: imageUrls[0], // primary cover image
                imageUrls: imageUrls,   // full array of compressed photos (each < 190 KB)
                sellerName: profile.displayName || "Student",
                whatsapp: profile.whatsappNumber,
                sellerId: user.uid,
                sellerEmail: user.email,
                createdAt: Date.now(),
                status: 'active'
            };

            const listingId = await addListing(data);
            
            modal.querySelector('#add-success').style.display = 'block';
            
            // Notification Logic
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
                }, 1200);
            }

        } catch (err) {
            console.error("Listing publish error:", err);
            errDiv.textContent = err.message || 'Failed to publish listing. Please try again.';
            addBtn.disabled = false;
            addBtn.innerHTML = 'Publish Listing';
        }
    });

    document.body.style.overflow = 'hidden';
}
