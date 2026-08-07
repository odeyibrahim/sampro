(function () {
    'use strict';

    var token = sessionStorage.getItem('admin_token');
    if (!token) {
        window.location.href = '/admin/index.html';
        return;
    }

    var editingId = null;
    var uploadedFileData = null;
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
            return '<tr>' +
                '<td><img src="' + attr(p.image_url || '') + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"></td>' +
                '<td>' + esc(p.title || '') + '</td>' +
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
                '<td>' + esc(o.product_title || '') + ' × ' + esc(o.quantity || 1) + '</td>' +
                '<td>$' + esc((o.amount || 0).toFixed(2)) + '</td>' +
                '<td>' + esc(o.payment_method || 'paystack') + '</td>' +
                '<td><span class="badge ' + attr(o.status || 'pending') + '">' + esc(o.status || 'pending') + '</span></td>' +
                '<td>' + esc(new Date(o.created_at || o.date || Date.now()).toLocaleDateString()) + '</td>' +
            '</tr>';
        };

        if (tbody) tbody.innerHTML = result.map(mapOrder).join('');
        if (recent) recent.innerHTML = result.slice(-6).reverse().map(mapOrder).join('');
    }

    function openEditModal(productId) {
        editingId = productId || null;
        uploadedFileData = null;
        var modal = document.getElementById('editModal');
        var title = document.getElementById('editModalTitle');
        var deleteBtn = document.getElementById('deleteProductBtn');
        title.textContent = productId ? 'Edit Product' : 'Add Product';
        if (deleteBtn) deleteBtn.style.display = productId ? 'inline-block' : 'none';

        ['editTitle', 'editAuthor', 'editDescription', 'editImageUrl', 'editPrice'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        var stockEl = document.getElementById('editStock');
        if (stockEl) stockEl.value = 1;
        var preview = document.getElementById('previewMain');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }

        if (productId) {
            apiCall('get_products').then(function (result) {
                if (!Array.isArray(result)) return;
                var p = result.find(function (x) { return String(x.product_id) === String(productId); });
                if (!p) return;
                document.getElementById('editTitle').value = p.title || '';
                document.getElementById('editAuthor').value = p.author || 'V.';
                document.getElementById('editDescription').value = p.description || '';
                document.getElementById('editType').value = p.type || 'original';
                document.getElementById('editOrientation').value = p.orientation || 'square';
                document.getElementById('editStock').value = p.stock || 1;
                document.getElementById('editPrice').value = p.base_price || '';
                document.getElementById('editImageUrl').value = p.image_url || '';
                var frame = p.frame_style || {};
                var bw = document.getElementById('editBorderWidth');
                var bc = document.getElementById('editBorderColor');
                if (bw) bw.value = frame.borderWidth || 0;
                if (bc) bc.value = frame.borderColor || '#000000';
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
        var data = {
            title: document.getElementById('editTitle').value.trim(),
            author: document.getElementById('editAuthor').value.trim() || 'V.',
            description: document.getElementById('editDescription').value.trim(),
            type: document.getElementById('editType').value,
            orientation: document.getElementById('editOrientation').value,
            stock: parseInt(document.getElementById('editStock').value, 10) || 0,
            base_price: parseFloat(document.getElementById('editPrice').value) || 0,
            image_url: uploadedFileData || document.getElementById('editImageUrl').value.trim(),
            frame_style: {
                borderWidth: parseInt(document.getElementById('editBorderWidth').value, 10) || 0,
                borderColor: document.getElementById('editBorderColor').value || '#000000'
            }
        };
        if (!data.title) { showNotification('Title is required', 'error'); return; }
        var op = editingId ? 'update_product' : 'create_product';
        if (editingId) data.product_id = editingId;
        var result = await apiCall(op, data);
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification(editingId ? 'Product updated' : 'Product added');
        closeEditModal();
        loadProducts();
        loadStats();
    }

    async function deleteProduct(productId) {
        if (!confirm('Delete this product?')) return;
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
        var data = {
            store_name: document.getElementById('storeName').value.trim() || 'V. Gallery',
            ship_std: parseFloat(document.getElementById('standardShipping').value) || 0,
            ship_exp: parseFloat(document.getElementById('expressShipping').value) || 0,
            whatsapp: document.getElementById('settingWhatsapp').value.trim()
        };
        var result = await apiCall('save_settings', data);
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Settings saved');
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

    // Robust file upload handler to prevent "invalid operation" errors
    function handleFileUpload(input, previewId, callback) {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        
        // 5MB limit to prevent database/localStorage issues
        if (file.size > 5 * 1024 * 1024) {
            showNotification('File is too large. Max 5MB allowed.', 'error');
            input.value = ''; // reset input
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

        var logoUpload = document.getElementById('logoUpload');
        var logoUploadArea = document.getElementById('logoUploadArea');
        if (logoUploadArea && logoUpload) {
            logoUploadArea.onclick = function () { logoUpload.click(); };
            logoUpload.onchange = function () { 
                handleFileUpload(this, 'logoPreview', function(base64) {
                    // Here you would typically call an API to save the logo
                    showNotification('Logo ready. Save settings to apply.');
                }); 
            };
        }

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
