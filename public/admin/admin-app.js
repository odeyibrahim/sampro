(function () {
    'use strict';

    var token = sessionStorage.getItem('admin_token');
    if (!token) {
        window.location.href = '/admin/index.html';
        return;
    }

    var editingId = null;
    var uploadedFileData = null;
    var uploadedLogoData = null;
    var additionalImages = []; // array of { type: 'url'|'base64', value: string }
    var esc = Utils.escapeHtml;
    var attr = Utils.escapeAttr;

    async function apiCall(op, data) {
        data = data || {};
        try {
            var response = await fetch('/.netlify/functions/admin-operations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ operation: op, data: data })
            });
            if (response.status === 401) {
                sessionStorage.removeItem('admin_token');
                window.location.href = '/admin/index.html';
                return { error: 'Session expired' };
            }
            return await response.json();
        } catch (err) {
            console.error('API call failed:', err);
            return { error: err.message };
        }
    }

    function showNotification(message, type) {
        var existing = document.querySelector('.admin-notification');
        if (existing) existing.remove();
        var n = document.createElement('div');
        n.className = 'admin-notification' + (type ? ' ' + type : '');
        n.textContent = message;
        n.style.cssText = 'position:fixed; top:20px; right:20px; padding:12px 20px; background:#000; color:#fff; border-radius:6px; font-size:13px; z-index:10000; font-family:Inter,sans-serif; opacity:0; transform:translateX(20px); transition:all 0.3s;';
        document.body.appendChild(n);
        requestAnimationFrame(() => {
            n.style.opacity = '1';
            n.style.transform = 'translateX(0)';
        });
        setTimeout(() => {
            n.style.opacity = '0';
            n.style.transform = 'translateX(20px)';
            setTimeout(() => n.remove(), 300);
        }, 3000);
    }

    function updateSyncBadge() {
        var badge = document.getElementById('syncBadge');
        if (!badge) return;
        var online = navigator.onLine;
        badge.textContent = online ? 'Synced' : 'Local mode';
        badge.className = 'sync-badge ' + (online ? 'online' : 'offline');
    }

    function switchTab(tabName) {
        document.querySelectorAll('.admin-tab').forEach(function(tab) {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.admin-section').forEach(function(section) {
            section.classList.toggle('active', section.id === 'admin' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
        });
    }

    async function loadStats() {
        var stats = await apiCall('get_stats');
        if (stats.error) return;
        document.getElementById('totalRevenue').textContent = '$' + (stats.totalRevenue || 0).toFixed(2);
        document.getElementById('totalOrders').textContent = stats.totalOrders || 0;
        document.getElementById('totalProducts').textContent = stats.totalProducts || 0;
        document.getElementById('totalCustomers').textContent = stats.totalCustomers || 0;
    }

    async function loadProducts() {
        var result = await apiCall('get_products');
        if (result.error || !Array.isArray(result)) return;
        var tbody = document.getElementById('adminProductsBody');
        if (!tbody) return;
        tbody.innerHTML = result.map(function (p) {
            var imgCount = '';
            var imgs = (Array.isArray(p.variations) ? p.variations.length : 0);
            if (imgs > 0) imgCount = ' <span style="color:#888;font-size:10px;">(' + (imgs + 1) + ')</span>';
            return '<tr>' +
                '<td><img src="' + attr(p.image_url || '') + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"></td>' +
                '<td>' + esc(p.title || '') + imgCount + '</td>' +
                '<td>' + esc(p.type || '') + '</td>' +
                '<td>$' + esc((p.base_price || 0).toFixed(2)) + '</td>' +
                '<td><input type="number" value="' + esc(p.stock || 0) + '" min="0" data-product-id="' + attr(p.product_id) + '" class="stock-input" style="width:60px;padding:4px;border:1px solid #ddd;border-radius:4px;"></td>' +
                '<td>' +
                    '<button class="admin-btn" data-edit-id="' + attr(p.product_id) + '">Edit</button>' +
                    '<button class="admin-btn danger" data-delete-id="' + attr(p.product_id) + '">Delete</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-edit-id]').forEach(function (btn) {
            btn.onclick = function () { openEditModal(btn.dataset.editId); };
        });
        tbody.querySelectorAll('[data-delete-id]').forEach(function (btn) {
            btn.onclick = function () { deleteProduct(btn.dataset.deleteId); };
        });
        tbody.querySelectorAll('.stock-input').forEach(function (input) {
            input.onchange = function () { updateStock(input.dataset.productId, input.value); };
        });
    }

    async function loadOrders() {
        var result = await apiCall('get_orders');
        if (result.error || !Array.isArray(result)) return;
        var tbody = document.getElementById('adminOrdersBody');
        var recent = document.getElementById('recentOrdersBody');
        
        var mapOrder = function(o) {
            return '<tr>' +
                '<td>' + esc(String(o.order_id || o.id || '').slice(0, 10)) + '</td>' +
                '<td>' + esc(o.customer_name || 'N/A') + '</td>' +
                '<td>' + esc(o.product_title || '') + ' &times; ' + esc(o.quantity || 1) + '</td>' +
                '<td>$' + esc((o.amount || 0).toFixed(2)) + '</td>' +
                '<td>' + esc(o.payment_method || 'paystack') + '</td>' +
                '<td><span class="badge ' + attr(o.status || 'pending') + '">' + esc(o.status || 'pending') + '</span></td>' +
                '<td>' + esc(new Date(o.created_at || o.date || Date.now()).toLocaleDateString()) + '</td>' +
            '</tr>';
        };

        if (tbody) tbody.innerHTML = result.map(mapOrder).join('');
        if (recent) recent.innerHTML = result.slice(-6).reverse().map(mapOrder).join('');
    }

    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function chk(id) { var el = document.getElementById(id); return el ? el.checked : false; }

    // ---- Additional images management ----
    function renderAdditionalImages() {
        var container = document.getElementById('additionalImagesPreview');
        if (!container) return;
        container.innerHTML = '';
        additionalImages.forEach(function (img, idx) {
            var div = document.createElement('div');
            div.className = 'thumb-item';
            var imgEl = document.createElement('img');
            imgEl.src = img.value;
            imgEl.alt = 'Additional image ' + (idx + 1);
            div.appendChild(imgEl);
            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-thumb';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove this image';
            removeBtn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                additionalImages.splice(idx, 1);
                renderAdditionalImages();
            };
            div.appendChild(removeBtn);
            container.appendChild(div);
        });
    }

    // ---- Image URL live preview ----
    function setupImageUrlPreview() {
        var urlInput = document.getElementById('editImageUrl');
        if (!urlInput) return;
        var debounceTimer = null;
        urlInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                var url = urlInput.value.trim();
                var preview = document.getElementById('previewMain');
                if (!preview) return;
                if (url && !uploadedFileData) {
                    // Test if the URL looks like an image
                    if (/\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i.test(url) || url.startsWith('data:image')) {
                        preview.src = url;
                        preview.style.display = 'block';
                        preview.onerror = function () { preview.style.display = 'none'; };
                    } else {
                        preview.style.display = 'none';
                    }
                } else if (!uploadedFileData) {
                    preview.style.display = 'none';
                }
            }, 400);
        });
    }

    function openEditModal(productId) {
        editingId = productId || null;
        uploadedFileData = null;
        additionalImages = [];
        var modal = document.getElementById('editModal');
        var title = document.getElementById('editModalTitle');
        var deleteBtn = document.getElementById('deleteProductBtn');
        title.textContent = productId ? 'Edit Product' : 'Add Product';
        if (deleteBtn) deleteBtn.style.display = productId ? 'inline-block' : 'none';

        // Reset all text/number fields
        ['editTitle','editAuthor','editDescription','editContent','editImageUrl','editPrice','editComparePrice','editVariations','editTags'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        var stockEl = document.getElementById('editStock');
        if (stockEl) stockEl.value = 1;
        var preview = document.getElementById('previewMain');
        if (preview) { preview.src = ''; preview.style.display = 'none'; preview.onerror = null; }

        // Clear additional images
        renderAdditionalImages();

        // Reset selects to defaults
        if (document.getElementById('editType')) document.getElementById('editType').value = 'original';
        if (document.getElementById('editMediaKind')) document.getElementById('editMediaKind').value = 'image';
        if (document.getElementById('editOrientation')) document.getElementById('editOrientation').value = 'square';
        if (document.getElementById('editFontFamily')) document.getElementById('editFontFamily').value = "'Copperplate', serif";
        if (document.getElementById('editContentOrder')) document.getElementById('editContentOrder').value = 'title-first';
        if (document.getElementById('editFontWeight')) document.getElementById('editFontWeight').value = '400';
        if (document.getElementById('editTextTransform')) document.getElementById('editTextTransform').value = 'none';
        if (document.getElementById('editFrameObjectFit')) document.getElementById('editFrameObjectFit').value = 'contain';
        if (document.getElementById('editFontSize')) document.getElementById('editFontSize').value = '11';
        if (document.getElementById('editBorderWidth')) document.getElementById('editBorderWidth').value = '0';
        if (document.getElementById('editBorderColor')) document.getElementById('editBorderColor').value = '#000000';
        if (document.getElementById('editFramePadding')) document.getElementById('editFramePadding').value = '0';

        // Reset backdrop fields
        ['editBgTopType','editBgBottomType'].forEach(function(id) { if (document.getElementById(id)) document.getElementById(id).value = 'color'; });
        ['editBgTopColor1','editBgBottomColor1'].forEach(function(id) { if (document.getElementById(id)) document.getElementById(id).value = '#f8f8f8'; });
        ['editBgTopColor2','editBgBottomColor2'].forEach(function(id) { if (document.getElementById(id)) document.getElementById(id).value = '#e0e0e0'; });
        ['editBgTopUrl','editBgBottomUrl'].forEach(function(id) { if (document.getElementById(id)) document.getElementById(id).value = ''; });

        // Reset checkboxes
        ['editShowAuthor','editShowPrice','editShowStock','editVideoAutoplay','editVideoLoop','editVideoMuted'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.checked = true;
        });
        if (document.getElementById('editIsFeatured')) document.getElementById('editIsFeatured').checked = false;
        if (document.getElementById('editShowShare')) document.getElementById('editShowShare').checked = false;

        // Reset the file input so re-editing the same file triggers onchange
        var deviceFile = document.getElementById('deviceFileUpload');
        if (deviceFile) deviceFile.value = '';
        var addlFile = document.getElementById('additionalFileUpload');
        if (addlFile) addlFile.value = '';

        if (productId) {
            apiCall('get_products').then(function (result) {
                if (!Array.isArray(result)) return;
                var p = result.find(function (x) { return String(x.product_id) === String(productId); });
                if (!p) return;
                document.getElementById('editTitle').value = p.title || '';
                document.getElementById('editAuthor').value = p.author || 'V.';
                document.getElementById('editDescription').value = p.description || '';
                document.getElementById('editContent').value = p.content || '';
                document.getElementById('editType').value = p.type || 'original';
                document.getElementById('editMediaKind').value = p.media_kind || 'image';
                document.getElementById('editOrientation').value = p.orientation || 'square';
                document.getElementById('editStock').value = p.stock || 1;
                document.getElementById('editPrice').value = p.base_price || '';
                document.getElementById('editComparePrice').value = p.compare_price || '';
                document.getElementById('editImageUrl').value = p.image_url || '';
                document.getElementById('editTags').value = Array.isArray(p.tags) ? p.tags.join(', ') : '';

                // Show main image preview when editing
                if (p.image_url) {
                    var preview = document.getElementById('previewMain');
                    if (preview) {
                        preview.src = p.image_url;
                        preview.style.display = 'block';
                    }
                }

                // Load existing variations into additional images grid
                if (Array.isArray(p.variations) && p.variations.length > 0) {
                    additionalImages = p.variations.map(function (url) {
                        return { type: 'url', value: url };
                    });
                    renderAdditionalImages();
                    // Also populate the textarea so admin can see/edit the URLs
                    document.getElementById('editVariations').value = p.variations.join('\n');
                }

                // Typography
                if (p.font_family) document.getElementById('editFontFamily').value = p.font_family;
                if (p.font_size) document.getElementById('editFontSize').value = p.font_size;
                if (p.font_weight) document.getElementById('editFontWeight').value = String(p.font_weight);
                if (p.text_transform) document.getElementById('editTextTransform').value = p.text_transform;
                if (p.content_order) document.getElementById('editContentOrder').value = p.content_order;

                // Toggles
                document.getElementById('editShowAuthor').checked = p.show_author !== false;
                document.getElementById('editShowPrice').checked = p.show_price !== false;
                document.getElementById('editShowStock').checked = p.show_stock !== false;
                document.getElementById('editIsFeatured').checked = !!p.is_featured;
                document.getElementById('editShowShare').checked = !!p.show_share;

                // Backdrop top
                var bgTop = p.background_top || {};
                if (document.getElementById('editBgTopType')) document.getElementById('editBgTopType').value = bgTop.type || 'color';
                if (document.getElementById('editBgTopColor1')) document.getElementById('editBgTopColor1').value = bgTop.color1 || '#f8f8f8';
                if (document.getElementById('editBgTopColor2')) document.getElementById('editBgTopColor2').value = bgTop.color2 || '#e0e0e0';
                if (document.getElementById('editBgTopUrl')) document.getElementById('editBgTopUrl').value = bgTop.mediaUrl || '';

                // Backdrop bottom
                var bgBottom = p.background_bottom || {};
                if (document.getElementById('editBgBottomType')) document.getElementById('editBgBottomType').value = bgBottom.type || 'color';
                if (document.getElementById('editBgBottomColor1')) document.getElementById('editBgBottomColor1').value = bgBottom.color1 || '#f8f8f8';
                if (document.getElementById('editBgBottomColor2')) document.getElementById('editBgBottomColor2').value = bgBottom.color2 || '#e0e0e0';
                if (document.getElementById('editBgBottomUrl')) document.getElementById('editBgBottomUrl').value = bgBottom.mediaUrl || '';

                // Video
                document.getElementById('editVideoAutoplay').checked = p.video_autoplay !== false;
                document.getElementById('editVideoLoop').checked = p.video_loop !== false;
                document.getElementById('editVideoMuted').checked = p.video_muted !== false;

                // Frame
                var frame = p.frame_style || {};
                if (document.getElementById('editBorderWidth')) document.getElementById('editBorderWidth').value = frame.borderWidth || 0;
                if (document.getElementById('editBorderColor')) document.getElementById('editBorderColor').value = frame.borderColor || '#000000';
                if (document.getElementById('editFramePadding')) document.getElementById('editFramePadding').value = frame.padding || 0;
                if (document.getElementById('editFrameObjectFit')) document.getElementById('editFrameObjectFit').value = frame.objectFit || 'contain';
            });
        }

        if (modal) modal.classList.add('active');
    }

    function closeEditModal() {
        var modal = document.getElementById('editModal');
        if (modal) modal.classList.remove('active');
    }

    async function saveProduct(e) {
        if (e) e.preventDefault();

        var titleVal = val('editTitle').trim();
        if (!titleVal) {
            showNotification('Title is required', 'error');
            document.getElementById('editTitle').focus();
            return;
        }

        var priceVal = parseFloat(val('editPrice'));
        if (isNaN(priceVal) || priceVal < 0) {
            showNotification('Please enter a valid price', 'error');
            document.getElementById('editPrice').focus();
            return;
        }

        // Parse variations: split by newline, filter empty
        var variationsRaw = val('editVariations');
        var urlVariations = variationsRaw ? variationsRaw.split(/[\n\r]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];

        // Merge: uploaded additional images (base64) + URL variations from textarea
        // Additional images take priority, then URL variations that aren't duplicates
        var allVariations = additionalImages.map(function (img) { return img.value; });
        urlVariations.forEach(function (url) {
            if (allVariations.indexOf(url) === -1) {
                allVariations.push(url);
            }
        });

        // Parse tags: split by comma
        var tagsRaw = val('editTags');
        var tags = tagsRaw ? tagsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

        // Disable save button to prevent double-submit
        var submitBtn = document.querySelector('#editProductForm button[type="submit"]');
        var originalBtnText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

        var data = {
            title: titleVal,
            author: val('editAuthor').trim() || 'V.',
            description: val('editDescription').trim(),
            content: val('editContent').trim(),
            type: val('editType'),
            media_kind: val('editMediaKind'),
            orientation: val('editOrientation'),
            stock: parseInt(val('editStock'), 10) || 0,
            base_price: priceVal,
            compare_price: parseFloat(val('editComparePrice')) || null,
            image_url: uploadedFileData || val('editImageUrl').trim(),
            variations: allVariations,
            tags: tags,
            font_family: val('editFontFamily'),
            font_size: parseInt(val('editFontSize'), 10) || 11,
            font_weight: parseInt(val('editFontWeight'), 10) || 400,
            text_transform: val('editTextTransform'),
            content_order: val('editContentOrder'),
            show_author: chk('editShowAuthor'),
            show_price: chk('editShowPrice'),
            show_stock: chk('editShowStock'),
            show_share: chk('editShowShare'),
            is_featured: chk('editIsFeatured'),
            video_autoplay: chk('editVideoAutoplay'),
            video_loop: chk('editVideoLoop'),
            video_muted: chk('editVideoMuted'),
            frame_style: {
                borderWidth: parseInt(val('editBorderWidth'), 10) || 0,
                borderColor: val('editBorderColor') || '#000000',
                padding: parseInt(val('editFramePadding'), 10) || 0,
                objectFit: val('editFrameObjectFit') || 'contain'
            },
            background_top: {
                type: val('editBgTopType'),
                color1: val('editBgTopColor1'),
                color2: val('editBgTopColor2'),
                mediaUrl: val('editBgTopUrl').trim()
            },
            background_bottom: {
                type: val('editBgBottomType'),
                color1: val('editBgBottomColor1'),
                color2: val('editBgBottomColor2'),
                mediaUrl: val('editBgBottomUrl').trim()
            }
        };

        var op = editingId ? 'update_product' : 'create_product';
        if (editingId) data.product_id = editingId;
        var result = await apiCall(op, data);

        // Re-enable save button
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }

        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification(editingId ? 'Product updated' : 'Product added');
        closeEditModal();
        loadProducts();
        loadStats();
    }

    async function deleteProduct(productId) {
        if (!confirm('Delete this product? This cannot be undone.')) return;
        var result = await apiCall('delete_product', { product_id: productId });
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Product deleted');
        loadProducts();
        loadStats();
    }

    async function updateStock(productId, newStock) {
        var result = await apiCall('update_stock', { product_id: productId, stock: parseInt(newStock, 10) || 0 });
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Stock updated');
    }

    async function saveSettings() {
        var exchangeRates = JSON.stringify({
            USD: 1,
            EUR: parseFloat(document.getElementById('rateEUR').value) || 0.92,
            GBP: parseFloat(document.getElementById('rateGBP').value) || 0.79,
            NGN: parseFloat(document.getElementById('rateNGN').value) || 1500
        });
        var data = {
            store_name: document.getElementById('storeName').value.trim() || 'V. Gallery',
            exchange_rates: exchangeRates,
            ship_std: parseFloat(document.getElementById('localStdShipping').value) || 0,
            ship_exp: parseFloat(document.getElementById('localExpShipping').value) || 0,
            ship_intl_std: parseFloat(document.getElementById('intlStdShipping').value) || 0,
            ship_intl_exp: parseFloat(document.getElementById('intlExpShipping').value) || 0,
            ship_local_ngn_std: parseFloat(document.getElementById('localStdNGN').value) || 0,
            ship_local_ngn_exp: parseFloat(document.getElementById('localExpNGN').value) || 0,
            whatsapp: document.getElementById('settingWhatsapp').value.trim()
        };
        // Include logo if one was uploaded
        if (uploadedLogoData) {
            data.logo_url = uploadedLogoData;
        }
        var result = await apiCall('update_settings', data);
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Settings saved');
        // Clear the uploaded logo data after successful save so it's not re-sent
        uploadedLogoData = null;
    }

    async function exportData() {
        var result = await apiCall('get_products');
        if (result.error) { showNotification(result.error, 'error'); return; }
        var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vgallery_catalog_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Catalog exported');
    }

    // Robust file upload handler
    function handleFileUpload(input, previewId, callback) {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        
        // 5MB limit to prevent database/localStorage issues
        if (file.size > 5 * 1024 * 1024) {
            showNotification('File is too large. Max 5MB allowed.', 'error');
            input.value = '';
            return;
        }

        var reader = new FileReader();
        reader.onload = function (e) {
            var preview = document.getElementById(previewId);
            if (preview) {
                preview.src = e.target.result;
                preview.style.display = 'block';
            }
            if (callback) callback(e.target.result);
        };
        reader.onerror = function() {
            showNotification('Failed to read file.', 'error');
        };
        reader.readAsDataURL(file);
    }

    // Multi-file upload handler for additional images
    function handleMultipleFileUpload(input) {
        if (!input.files || input.files.length === 0) return;
        var files = Array.prototype.slice.call(input.files);
        var processed = 0;
        var totalSize = 0;

        // Check total size (all files combined, max 10MB)
        files.forEach(function (f) { totalSize += f.size; });
        if (totalSize > 10 * 1024 * 1024) {
            showNotification('Total file size exceeds 10MB limit.', 'error');
            input.value = '';
            return;
        }

        files.forEach(function (file) {
            if (file.size > 5 * 1024 * 1024) {
                showNotification(file.name + ' is too large (max 5MB per file).', 'error');
                processed++;
                if (processed === files.length) input.value = '';
                return;
            }
            var reader = new FileReader();
            reader.onload = function (e) {
                additionalImages.push({ type: 'base64', value: e.target.result });
                processed++;
                if (processed === files.length) {
                    input.value = '';
                    renderAdditionalImages();
                }
            };
            reader.onerror = function () {
                showNotification('Failed to read ' + file.name, 'error');
                processed++;
                if (processed === files.length) input.value = '';
            };
            reader.readAsDataURL(file);
        });
    }

    function logout() {
        sessionStorage.removeItem('admin_token');
        window.location.href = '/admin/index.html';
    }

    document.addEventListener('DOMContentLoaded', function () {
        loadStats();
        loadProducts();
        loadOrders();
        updateSyncBadge();

        window.addEventListener('online', updateSyncBadge);
        window.addEventListener('offline', updateSyncBadge);

        document.getElementById('logoutBtn').onclick = logout;

        // Tab switching logic
        document.querySelectorAll('.admin-tab').forEach(function(tab) {
            tab.onclick = function() { switchTab(tab.dataset.tab); };
        });

        document.getElementById('addProductBtn').onclick = function () { openEditModal(null); };
        document.getElementById('cancelEditBtn').onclick = closeEditModal;

        document.getElementById('deleteProductBtn').onclick = function () {
            if (editingId) { closeEditModal(); deleteProduct(editingId); }
        };

        document.getElementById('editProductForm').onsubmit = saveProduct;
        document.getElementById('saveSettingsBtn').onclick = saveSettings;
        document.getElementById('exportDataBtn').onclick = exportData;

        // ---- Logo upload ----
        var logoUpload = document.getElementById('logoUpload');
        var logoUploadArea = document.getElementById('logoUploadArea');
        if (logoUploadArea && logoUpload) {
            logoUploadArea.onclick = function () { logoUpload.click(); };
            logoUpload.onchange = function () {
                handleFileUpload(this, 'logoPreview', function(base64) {
                    uploadedLogoData = base64;
                    showNotification('Logo ready. Save settings to apply.');
                });
            };
        }

        // Load current settings into form (including existing logo preview)
        apiCall('get_settings').then(function(settings) {
            if (settings.error) return;
            if (settings.store_name) document.getElementById('storeName').value = settings.store_name;
            if (settings.ship_std) document.getElementById('localStdShipping').value = settings.ship_std;
            if (settings.ship_exp) document.getElementById('localExpShipping').value = settings.ship_exp;
            if (settings.ship_intl_std) document.getElementById('intlStdShipping').value = settings.ship_intl_std;
            if (settings.ship_intl_exp) document.getElementById('intlExpShipping').value = settings.ship_intl_exp;
            if (settings.ship_local_ngn_std) document.getElementById('localStdNGN').value = settings.ship_local_ngn_std;
            if (settings.ship_local_ngn_exp) document.getElementById('localExpNGN').value = settings.ship_local_ngn_exp;
            if (settings.whatsapp_number) document.getElementById('settingWhatsapp').value = settings.whatsapp_number;
            if (settings.exchange_rates) {
                try {
                    var rates = JSON.parse(settings.exchange_rates);
                    if (rates.EUR) document.getElementById('rateEUR').value = rates.EUR;
                    if (rates.GBP) document.getElementById('rateGBP').value = rates.GBP;
                    if (rates.NGN) document.getElementById('rateNGN').value = rates.NGN;
                } catch (e) {}
            }
            if (settings.logo_url) {
                var logoPreview = document.getElementById('logoPreview');
                if (logoPreview) { logoPreview.src = settings.logo_url; }
            }
        });

        // ---- Main product image upload ----
        var deviceUpload = document.getElementById('deviceFileUpload');
        var deviceUploadArea = document.getElementById('deviceUploadArea');
        if (deviceUploadArea && deviceUpload) {
            deviceUploadArea.onclick = function () { deviceUpload.click(); };
            deviceUpload.onchange = function () { 
                handleFileUpload(this, 'previewMain', function(base64) {
                    uploadedFileData = base64;
                    document.getElementById('editImageUrl').value = ''; // Clear URL if uploading file
                }); 
            };
        }

        // ---- Additional images upload ----
        var additionalUpload = document.getElementById('additionalFileUpload');
        var additionalUploadArea = document.getElementById('additionalUploadArea');
        if (additionalUploadArea && additionalUpload) {
            additionalUploadArea.onclick = function () { additionalUpload.click(); };
            additionalUpload.onchange = function () {
                handleMultipleFileUpload(this);
            };
        }

        // ---- Image URL live preview ----
        setupImageUrlPreview();

        // ---- Modal backdrop + Escape ----
        var modal = document.getElementById('editModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeEditModal();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeEditModal();
        });
    });
})();
