(function () {
    'use strict';

    // Guard: bounce to login immediately if there's no token. This is a UX
    // convenience only — every admin-operations call below still sends the
    // token to the server, and the server is what actually authorizes each
    // action. Client-side checks like this one are never sufficient on their own.
    var token = sessionStorage.getItem('admin_token');
    if (!token) {
        window.location.href = '/admin/index.html';
        return;
    }

    var editingId = null;
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

    async function loadStats() {
        var stats = await apiCall('get_stats');
        if (!stats.error) {
            document.getElementById('stats').innerHTML =
                '<div class="stat-card"><div class="stat-value">$' + esc((stats.totalRevenue || 0).toFixed(2)) + '</div><div class="stat-label">Revenue</div></div>' +
                '<div class="stat-card"><div class="stat-value">' + esc(stats.totalOrders || 0) + '</div><div class="stat-label">Orders</div></div>' +
                '<div class="stat-card"><div class="stat-value">' + esc(stats.totalProducts || 0) + '</div><div class="stat-label">Products</div></div>' +
                '<div class="stat-card"><div class="stat-value">' + esc(stats.totalCustomers || 0) + '</div><div class="stat-label">Customers</div></div>';
        }
    }

    async function showProducts() {
        var products = await apiCall('get_products');
        if (products.error) {
            document.getElementById('content').innerHTML = '<p style="color:red;">Error loading products</p>';
            return;
        }

        var html = '<h2>Products</h2><button data-action="open-add-modal" style="margin-bottom: 20px;">+ Add New Product</button><div style="overflow-x: auto;"><table><thead><tr><th>Image</th><th>Title</th><th>Price</th><th>Stock</th><th>Type</th><th>Actions</th></tr></thead><tbody>';

        for (var i = 0; i < products.length; i++) {
            var p = products[i];
            var thumb = p.image_url
                ? '<img src="' + attr(p.image_url) + '" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" alt="">'
                : '<div style="width:40px;height:40px;border-radius:4px;background:#eee;display:flex;align-items:center;justify-content:center;font-size:9px;color:#888;">TXT</div>';
            html += '<tr>' +
                '<td>' + thumb + '</td>' +
                '<td><strong>' + esc(p.title) + '</strong></td>' +
                '<td>$' + esc(p.base_price) + '</td>' +
                '<td>' + esc(p.stock) + '</td>' +
                '<td>' + esc(p.type) + (p.media_kind && p.media_kind !== 'image' ? ' (' + esc(p.media_kind) + ')' : '') + '</td>' +
                '<td>' +
                '<button class="admin-btn" data-action="edit-product" data-id="' + attr(p.id) + '">Edit</button>' +
                '<button class="admin-btn" data-action="delete-product" data-id="' + attr(p.id) + '">Delete</button>' +
                '</td></tr>';
        }

        html += '</tbody></table></div>';
        document.getElementById('content').innerHTML = html;
    }

    async function showOrders() {
        var orders = await apiCall('get_orders');
        if (orders.error) {
            document.getElementById('content').innerHTML = '<p style="color:red;">Error loading orders</p>';
            return;
        }

        var html = '<h2>Orders</h2><div style="overflow-x: auto;"><table><thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Provider</th><th>Payment</th><th>Fulfillment</th><th>Date</th><th>Actions</th></tr></thead><tbody>';

        for (var i = 0; i < orders.length; i++) {
            var o = orders[i];
            var canConfirmBank = o.payment_provider === 'bank_transfer' && o.payment_status !== 'paid';
            html += '<tr>' +
                '<td><code>' + esc(o.order_id) + '</code></td>' +
                '<td>' + esc(o.customer_name) + '<br><small>' + esc(o.customer_email) + '</small></td>' +
                '<td>$' + esc(o.total_amount) + '</td>' +
                '<td>' + esc(o.payment_provider || '-') + '</td>' +
                '<td><span class="badge ' + attr(o.payment_status) + '">' + esc(o.payment_status) + '</span></td>' +
                '<td><select data-action="update-status" data-id="' + attr(o.id) + '" style="padding: 4px 8px;">' +
                '<option value="pending"' + (o.order_status === 'pending' ? ' selected' : '') + '>Pending</option>' +
                '<option value="processing"' + (o.order_status === 'processing' ? ' selected' : '') + '>Processing</option>' +
                '<option value="shipped"' + (o.order_status === 'shipped' ? ' selected' : '') + '>Shipped</option>' +
                '<option value="delivered"' + (o.order_status === 'delivered' ? ' selected' : '') + '>Delivered</option>' +
                '</select></td>' +
                '<td>' + esc(new Date(o.created_at).toLocaleDateString()) + '</td>' +
                '<td>' +
                (canConfirmBank ? '<button class="admin-btn confirm-pay" data-action="confirm-bank-payment" data-id="' + attr(o.id) + '">Confirm Payment</button>' : '') +
                (o.payment_status === 'paid' ? '<button class="admin-btn" data-action="refund-order" data-id="' + attr(o.id) + '">Refund</button>' : '') +
                '<button class="admin-btn" data-action="view-order" data-id="' + attr(o.id) + '">View</button>' +
                '</td></tr>';
        }

        html += '</tbody></table></div>';
        document.getElementById('content').innerHTML = html;
    }

    async function confirmBankPayment(id) {
        if (!confirm('Confirm that this bank/domiciliary transfer has been received? This will mark the order paid and reduce stock.')) return;
        var result = await apiCall('confirm_bank_payment', { id: id });
        if (!result.error) {
            showOrders();
            loadStats();
        } else {
            alert('Error: ' + result.error);
        }
    }

    async function showCustomers() {
        var customers = await apiCall('get_customers');
        if (customers.error) {
            document.getElementById('content').innerHTML = '<p style="color:red;">Error loading customers</p>';
            return;
        }

        var html = '<h2>Customers</h2><div style="overflow-x: auto;"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Total Spent</th></tr></thead><tbody>';

        for (var i = 0; i < customers.length; i++) {
            var c = customers[i];
            html += '<tr>' +
                '<td><strong>' + esc(c.name || 'N/A') + '</strong></td>' +
                '<td>' + esc(c.email) + '</td>' +
                '<td>' + esc(c.phone || '-') + '</td>' +
                '<td>' + esc(c.orders_count || 0) + '</td>' +
                '<td>$' + esc(c.total_spent || 0) + '</td>' +
                '</tr>';
        }

        html += '</tbody></table></div>';
        document.getElementById('content').innerHTML = html;
    }

    function openAddModal() {
        editingId = null;
        document.getElementById('modalTitle').innerText = 'Add Product';
        clearForm();
        toggleMediaKindUI();
        toggleBgHalf('top');
        document.getElementById('productModal').classList.add('active');
    }

    async function editProduct(id) {
        var products = await apiCall('get_products');
        var product = (products || []).find(function (p) { return p.id === id; });
        if (product) {
            editingId = id;
            document.getElementById('modalTitle').innerText = 'Edit Product';
            document.getElementById('productTitle').value = product.title;
            document.getElementById('productShowAuthor').checked = product.show_author !== false;
            document.getElementById('productAuthor').value = product.author || 'V.';
            document.getElementById('productDesc').value = product.description || '';
            document.getElementById('productContentOrder').value = product.content_order === 'description-first' ? 'description-first' : 'title-first';
            document.getElementById('productType').value = product.type || 'merch';
            document.getElementById('productOrientation').value = product.orientation || 'square';
            document.getElementById('productStock').value = product.stock;
            document.getElementById('productShowStock').checked = product.show_stock !== false;
            document.getElementById('productPrice').value = product.base_price;
            document.getElementById('productComparePrice').value = product.compare_price || '';
            document.getElementById('productShowPrice').checked = product.show_price !== false;

            document.getElementById('productMediaKind').value = product.media_kind || 'image';
            document.getElementById('productImage').value = product.image_url || '';
            document.getElementById('productVariations').value = JSON.stringify(product.variations || []);
            document.getElementById('productTextContent').value = product.content || '';
            document.getElementById('productVideoAutoplay').checked = product.video_autoplay !== false;
            document.getElementById('productVideoLoop').checked = product.video_loop !== false;
            document.getElementById('productVideoMuted').checked = product.video_muted !== false;

            var frame = product.frame_style || {};
            document.getElementById('productFrameWidth').value = frame.borderWidth || 0;
            document.getElementById('productFrameColor').value = frame.borderColor || '#000000';
            document.getElementById('productObjectFit').value = frame.objectFit || 'contain';

            loadBgPanel('top', product.background_top);
            loadBgPanel('bottom', product.background_bottom);

            document.getElementById('productFontFamily').value = product.font_family || "'Copperplate', serif";
            document.getElementById('productFontWeight').value = product.font_weight || 400;
            document.getElementById('productFontSize').value = product.font_size || 11;
            document.getElementById('productTextTransform').value = product.text_transform || 'none';

            toggleMediaKindUI();
            toggleBgHalf('top');
            document.getElementById('productModal').classList.add('active');
        }
    }

    function clearForm() {
        document.getElementById('productTitle').value = '';
        document.getElementById('productShowAuthor').checked = true;
        document.getElementById('productAuthor').value = 'V.';
        document.getElementById('productDesc').value = '';
        document.getElementById('productContentOrder').value = 'title-first';
        document.getElementById('productType').value = 'merch';
        document.getElementById('productOrientation').value = 'square';
        document.getElementById('productStock').value = '1';
        document.getElementById('productShowStock').checked = true;
        document.getElementById('productPrice').value = '';
        document.getElementById('productComparePrice').value = '';
        document.getElementById('productShowPrice').checked = true;

        document.getElementById('productMediaKind').value = 'image';
        document.getElementById('productImage').value = '';
        document.getElementById('productVariations').value = '[]';
        document.getElementById('productTextContent').value = '';
        document.getElementById('productVideoAutoplay').checked = true;
        document.getElementById('productVideoLoop').checked = true;
        document.getElementById('productVideoMuted').checked = true;

        document.getElementById('productFrameWidth').value = '0';
        document.getElementById('productFrameColor').value = '#000000';
        document.getElementById('productObjectFit').value = 'contain';

        loadBgPanel('top', null);
        loadBgPanel('bottom', null);

        document.getElementById('productFontFamily').value = "'Copperplate', serif";
        document.getElementById('productFontWeight').value = '400';
        document.getElementById('productFontSize').value = '11';
        document.getElementById('productTextTransform').value = 'none';
    }

    function closeModal() {
        document.getElementById('productModal').classList.remove('active');
    }

    // ---- Design-editor UI helpers (bg half toggle, bg type rows, media kind) ----
    function toggleBgHalf(half) {
        document.querySelectorAll('.bg-half-toggle button').forEach(function (b) {
            b.classList.toggle('active', b.dataset.half === half);
        });
        document.getElementById('bgPanelTop').classList.toggle('active', half === 'top');
        document.getElementById('bgPanelBottom').classList.toggle('active', half === 'bottom');
    }

    function loadBgPanel(half, bg) {
        bg = bg || { type: 'color', color1: '#f8f8f8', color2: '#e0e0e0', mediaUrl: '' };
        var sel = document.querySelector('.bg-type-select[data-half="' + half + '"]');
        if (sel) sel.value = bg.type || 'color';
        var color1 = document.querySelector('.bg-color1[data-half="' + half + '"]');
        if (color1) color1.value = bg.color1 || '#f8f8f8';
        var color2 = document.querySelector('.bg-color2[data-half="' + half + '"]');
        if (color2) color2.value = bg.color2 || '#e0e0e0';
        var mediaUrl = document.querySelector('.bg-media-url[data-half="' + half + '"]');
        if (mediaUrl) mediaUrl.value = bg.mediaUrl || '';
        updateBgColorRow(half);
    }

    function updateBgColorRow(half) {
        var sel = document.querySelector('.bg-type-select[data-half="' + half + '"]');
        var row = document.querySelector('.bg-color2-row[data-half="' + half + '"]');
        var mediaRow = document.querySelector('.bg-media-row[data-half="' + half + '"]');
        if (row && sel) row.style.display = sel.value === 'gradient' ? 'flex' : 'none';
        if (mediaRow && sel) mediaRow.classList.toggle('visible', sel.value === 'image' || sel.value === 'video');
    }

    function toggleMediaKindUI() {
        var kind = document.getElementById('productMediaKind').value;
        document.getElementById('mediaUrlGroup').style.display = (kind === 'image' || kind === 'video') ? 'block' : 'none';
        document.getElementById('videoControls').classList.toggle('visible', kind === 'video');
        document.getElementById('textControls').classList.toggle('visible', kind === 'text');
    }

    function readBgPanel(half) {
        return {
            type: document.querySelector('.bg-type-select[data-half="' + half + '"]').value,
            color1: document.querySelector('.bg-color1[data-half="' + half + '"]').value,
            color2: document.querySelector('.bg-color2[data-half="' + half + '"]').value,
            mediaUrl: document.querySelector('.bg-media-url[data-half="' + half + '"]').value.trim()
        };
    }

    async function saveProduct() {
        var variations = [];
        try {
            variations = JSON.parse(document.getElementById('productVariations').value);
        } catch (e) {}

        var mediaKind = document.getElementById('productMediaKind').value;
        if ((mediaKind === 'image' || mediaKind === 'video') && !document.getElementById('productImage').value.trim()) {
            alert('Please provide an image/video URL for this media kind');
            return;
        }
        if (mediaKind === 'text' && !document.getElementById('productTextContent').value.trim()) {
            alert('Text content is required for the "text" media kind');
            return;
        }

        var data = {
            title: document.getElementById('productTitle').value,
            show_author: document.getElementById('productShowAuthor').checked,
            author: document.getElementById('productAuthor').value,
            description: document.getElementById('productDesc').value,
            content_order: document.getElementById('productContentOrder').value,
            type: document.getElementById('productType').value,
            orientation: document.getElementById('productOrientation').value,
            stock: parseInt(document.getElementById('productStock').value, 10),
            show_stock: document.getElementById('productShowStock').checked,
            base_price: parseFloat(document.getElementById('productPrice').value),
            compare_price: document.getElementById('productComparePrice').value || null,
            show_price: document.getElementById('productShowPrice').checked,

            media_kind: mediaKind,
            image_url: document.getElementById('productImage').value,
            variations: variations,
            content: document.getElementById('productTextContent').value,
            video_autoplay: document.getElementById('productVideoAutoplay').checked,
            video_loop: document.getElementById('productVideoLoop').checked,
            video_muted: document.getElementById('productVideoMuted').checked,

            frame_style: {
                borderWidth: parseInt(document.getElementById('productFrameWidth').value, 10) || 0,
                borderColor: document.getElementById('productFrameColor').value,
                objectFit: document.getElementById('productObjectFit').value
            },
            background_top: readBgPanel('top'),
            background_bottom: readBgPanel('bottom'),

            font_family: document.getElementById('productFontFamily').value,
            font_weight: parseInt(document.getElementById('productFontWeight').value, 10) || 400,
            font_size: parseInt(document.getElementById('productFontSize').value, 10) || 11,
            text_transform: document.getElementById('productTextTransform').value
        };

        var result;
        if (editingId) {
            data.id = editingId;
            result = await apiCall('update_product', data);
        } else {
            result = await apiCall('create_product', data);
        }

        if (!result.error) {
            closeModal();
            showProducts();
            loadStats();
        } else {
            alert('Error: ' + result.error);
        }
    }

    async function deleteProduct(id) {
        if (confirm('Delete this product permanently?')) {
            var result = await apiCall('delete_product', { id: id });
            if (!result.error) {
                showProducts();
                loadStats();
            } else {
                alert('Error: ' + result.error);
            }
        }
    }

    async function updateStatus(id, status) {
        await apiCall('update_order_status', { id: id, status: status });
        showOrders();
    }

    function viewOrder(id) {
        alert('Order details feature coming soon. ID: ' + id);
    }

    async function logout() {
        await apiCall('logout');
        sessionStorage.removeItem('admin_token');
        window.location.href = '/admin/index.html';
    }

    async function refundOrder(id) {
        if (!confirm('Refund this order? For Paystack/Flutterwave this calls the provider\'s real refund API — money moves. For bank transfer, this only records that you already refunded the customer manually.')) return;
        var result = await apiCall('refund_order', { id: id, restock: true });
        if (!result.error) {
            showOrders();
            loadStats();
        } else {
            alert('Error: ' + result.error);
        }
    }

    async function showDiscountCodes() {
        var codes = await apiCall('get_discount_codes');
        if (codes.error) {
            document.getElementById('content').innerHTML = '<p style="color:red;">Error loading discount codes</p>';
            return;
        }

        var html = '<h2>Discount Codes</h2>' +
            '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px; align-items:flex-end;">' +
            '<div><label style="display:block; font-size:12px; color:#666;">Code</label><input id="newCodeText" style="padding:8px;" placeholder="SUMMER10"></div>' +
            '<div><label style="display:block; font-size:12px; color:#666;">Type</label><select id="newCodeType" style="padding:8px;"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></div>' +
            '<div><label style="display:block; font-size:12px; color:#666;">Value</label><input id="newCodeValue" type="number" step="0.01" style="padding:8px; width:100px;" placeholder="10"></div>' +
            '<div><label style="display:block; font-size:12px; color:#666;">Currency (optional)</label><select id="newCodeCurrency" style="padding:8px;"><option value="">Any</option><option value="NGN">NGN</option><option value="USD">USD</option></select></div>' +
            '<div><label style="display:block; font-size:12px; color:#666;">Usage limit (optional)</label><input id="newCodeLimit" type="number" style="padding:8px; width:100px;"></div>' +
            '<button data-action="add-discount-code">+ Create</button>' +
            '</div>' +
            '<div style="overflow-x: auto;"><table><thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Currency</th><th>Used</th><th>Limit</th><th>Active</th><th>Actions</th></tr></thead><tbody>';

        for (var i = 0; i < codes.length; i++) {
            var c = codes[i];
            html += '<tr>' +
                '<td><code>' + esc(c.code) + '</code></td>' +
                '<td>' + esc(c.type) + '</td>' +
                '<td>' + esc(c.value) + (c.type === 'percent' ? '%' : '') + '</td>' +
                '<td>' + esc(c.currency || 'Any') + '</td>' +
                '<td>' + esc(c.times_used || 0) + '</td>' +
                '<td>' + esc(c.usage_limit == null ? '∞' : c.usage_limit) + '</td>' +
                '<td>' + (c.is_active ? 'Yes' : 'No') + '</td>' +
                '<td>' +
                '<button class="admin-btn" data-action="toggle-discount-code" data-id="' + attr(c.id) + '" data-active="' + (c.is_active ? '0' : '1') + '">' + (c.is_active ? 'Deactivate' : 'Activate') + '</button>' +
                '<button class="admin-btn" data-action="delete-discount-code" data-id="' + attr(c.id) + '">Delete</button>' +
                '</td></tr>';
        }

        html += '</tbody></table></div>';
        document.getElementById('content').innerHTML = html;
    }

    async function addDiscountCode() {
        var code = document.getElementById('newCodeText').value;
        var type = document.getElementById('newCodeType').value;
        var value = document.getElementById('newCodeValue').value;
        var currency = document.getElementById('newCodeCurrency').value;
        var limit = document.getElementById('newCodeLimit').value;

        if (!code || !value) {
            alert('Code and value are required');
            return;
        }

        var result = await apiCall('create_discount_code', {
            code: code, type: type, value: value, currency: currency || null, usage_limit: limit || null
        });
        if (!result.error) {
            showDiscountCodes();
        } else {
            alert('Error: ' + result.error);
        }
    }

    async function toggleDiscountCode(id, makeActive) {
        var result = await apiCall('toggle_discount_code', { id: id, is_active: makeActive === '1' });
        if (!result.error) showDiscountCodes();
        else alert('Error: ' + result.error);
    }

    async function deleteDiscountCode(id) {
        if (!confirm('Delete this discount code?')) return;
        await apiCall('delete_discount_code', { id: id });
        showDiscountCodes();
    }

    // ------------------------------------------------------
    // SETTINGS — store name/logo/WhatsApp/tax rates + shipping rates,
    // all editable here instead of needing Supabase's Table Editor.
    // ------------------------------------------------------
    async function showSettings() {
        var settings = await apiCall('get_settings');
        var rates = await apiCall('get_shipping_rates');
        if (settings.error || rates.error) {
            document.getElementById('content').innerHTML = '<p style="color:red;">Error loading settings</p>';
            return;
        }

        var html = '<h2>Store Settings</h2>' +
            '<div style="max-width:480px;">' +
            '<label style="display:block; font-size:12px; color:#666; margin-top:14px;">Store name</label>' +
            '<input id="settingStoreName" style="width:100%; padding:8px;" value="' + attr(settings.store_name) + '">' +
            '<label style="display:block; font-size:12px; color:#666; margin-top:14px;">Logo URL (shown top-left on the storefront)</label>' +
            '<input id="settingLogoUrl" style="width:100%; padding:8px;" value="' + attr(settings.logo_url) + '" placeholder="https://...">' +
            '<label style="display:block; font-size:12px; color:#666; margin-top:14px;">WhatsApp number (country code + digits, no +)</label>' +
            '<input id="settingWhatsapp" style="width:100%; padding:8px;" value="' + attr(settings.whatsapp_number) + '" placeholder="2349012345678">' +
            '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<div style="flex:1;"><label style="display:block; font-size:12px; color:#666;">Tax rate — NGN (decimal, e.g. 0.075 = 7.5%)</label><input id="settingTaxNgn" type="number" step="0.001" style="width:100%; padding:8px;" value="' + attr(settings.tax_rate_ngn) + '"></div>' +
            '<div style="flex:1;"><label style="display:block; font-size:12px; color:#666;">Tax rate — USD</label><input id="settingTaxUsd" type="number" step="0.001" style="width:100%; padding:8px;" value="' + attr(settings.tax_rate_usd) + '"></div>' +
            '</div>' +
            '<button data-action="save-settings" style="margin-top:16px; width:100%;">Save Settings</button>' +
            '</div>' +
            '<h3 style="margin:30px 0 14px; font-size:14px;">Shipping Rates</h3>' +
            '<div style="overflow-x:auto;"><table><thead><tr><th>Method</th><th>Currency</th><th>Cost</th><th>Actions</th></tr></thead><tbody>';

        for (var i = 0; i < rates.length; i++) {
            var r = rates[i];
            html += '<tr>' +
                '<td>' + esc(r.label || r.method) + '</td>' +
                '<td>' + esc(r.currency) + '</td>' +
                '<td><input type="number" step="0.01" id="rateCost_' + attr(r.id) + '" value="' + attr(r.cost) + '" style="width:100px; padding:6px;"></td>' +
                '<td><button class="admin-btn" data-action="save-shipping-rate" data-id="' + attr(r.id) + '">Save</button></td>' +
                '</tr>';
        }
        html += '</tbody></table></div>' +
            '<h3 style="margin:30px 0 14px; font-size:14px;">Catalog Data</h3>' +
            '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
            '<button data-action="export-json">Export JSON</button>' +
            '<button data-action="import-json">Import JSON</button>' +
            '<button data-action="export-pdf">Export PDF Catalog</button>' +
            '</div>' +
            '<input type="file" id="importJsonFile" accept="application/json" style="display:none;">';

        document.getElementById('content').innerHTML = html;
        document.getElementById('importJsonFile').addEventListener('change', handleImportFile);
    }

    async function saveSettingsForm() {
        var result = await apiCall('update_settings', {
            store_name: document.getElementById('settingStoreName').value,
            logo_url: document.getElementById('settingLogoUrl').value,
            whatsapp_number: document.getElementById('settingWhatsapp').value,
            tax_rate_ngn: document.getElementById('settingTaxNgn').value,
            tax_rate_usd: document.getElementById('settingTaxUsd').value
        });
        if (!result.error) {
            alert('Settings saved');
        } else {
            alert('Error: ' + result.error);
        }
    }

    async function saveShippingRate(id) {
        var costInput = document.getElementById('rateCost_' + id);
        var result = await apiCall('update_shipping_rate', { id: id, cost: costInput.value });
        if (!result.error) {
            alert('Shipping rate updated');
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ------------------------------------------------------
    // JSON EXPORT / IMPORT — round-trips the full product catalog.
    // Import matches on `id`: present -> update_product, absent ->
    // create_product, so re-importing an exported file is safe to
    // repeat (it updates in place rather than duplicating).
    // ------------------------------------------------------
    async function exportJSON() {
        var products = await apiCall('get_products');
        if (products.error) { alert('Error loading products'); return; }
        var blob = new Blob([JSON.stringify(products, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vgallery_catalog_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function importJSON() {
        document.getElementById('importJsonFile').click();
    }

    async function handleImportFile(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = async function (ev) {
            var items;
            try {
                items = JSON.parse(ev.target.result);
                if (!Array.isArray(items)) throw new Error('bad format');
            } catch (err) {
                alert('Invalid catalog file — expected a JSON array of products');
                return;
            }

            var succeeded = 0, failed = 0;
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var op = item.id ? 'update_product' : 'create_product';
                var result = await apiCall(op, item);
                if (result.error) failed++; else succeeded++;
            }
            alert('Import complete: ' + succeeded + ' saved, ' + failed + ' failed.');
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    // ------------------------------------------------------
    // PDF CATALOG EXPORT — built directly with jsPDF's text APIs
    // rather than by screenshotting a live page, since the admin
    // panel is a separate page from the storefront and has no
    // product display in its own DOM to capture. Text-only by
    // design (no embedded images) so it doesn't depend on
    // third-party image hosts allowing cross-origin fetches.
    // ------------------------------------------------------
    async function exportPDF() {
        if (!window.jspdf) {
            alert('PDF library failed to load');
            return;
        }
        var products = await apiCall('get_products');
        if (products.error) { alert('Error loading products'); return; }

        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: 'pt', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var margin = 40;
        var y = margin;

        doc.setFontSize(18);
        doc.text('Catalog', margin, y);
        y += 30;

        products.forEach(function (p) {
            if (y > pageHeight - 100) {
                doc.addPage();
                y = margin;
            }
            doc.setFontSize(13);
            doc.text(String(p.title || 'Untitled'), margin, y);
            y += 16;
            doc.setFontSize(10);
            doc.text('Category: ' + (p.type || '-') + '   Price: $' + (p.base_price || 0) + '   Stock: ' + (p.stock != null ? p.stock : '-'), margin, y);
            y += 14;
            if (p.description) {
                var lines = doc.splitTextToSize(String(p.description), pageWidth - margin * 2);
                doc.text(lines, margin, y);
                y += lines.length * 12 + 10;
            } else {
                y += 10;
            }
            y += 10;
        });

        doc.save('vgallery_catalog_' + new Date().toISOString().slice(0, 10) + '.pdf');
    }

    // CSP-safe event delegation — no inline onclick= anywhere, including in
    // the HTML generated dynamically above.
    document.addEventListener('click', function (e) {
        var target = e.target.closest('[data-action]');
        if (!target) return;
        var action = target.dataset.action;
        var id = target.dataset.id;
        switch (action) {
            case 'logout': logout(); break;
            case 'show-products': showProducts(); break;
            case 'show-orders': showOrders(); break;
            case 'show-customers': showCustomers(); break;
            case 'show-discount-codes': showDiscountCodes(); break;
            case 'open-add-modal': openAddModal(); break;
            case 'save-product': saveProduct(); break;
            case 'close-modal': closeModal(); break;
            case 'edit-product': editProduct(id); break;
            case 'delete-product': deleteProduct(id); break;
            case 'confirm-bank-payment': confirmBankPayment(id); break;
            case 'refund-order': refundOrder(id); break;
            case 'view-order': viewOrder(id); break;
            case 'add-discount-code': addDiscountCode(); break;
            case 'toggle-discount-code': toggleDiscountCode(id, target.dataset.active); break;
            case 'delete-discount-code': deleteDiscountCode(id); break;
            case 'toggle-bg-half': toggleBgHalf(target.dataset.half); break;
            case 'show-settings': showSettings(); break;
            case 'save-settings': saveSettingsForm(); break;
            case 'save-shipping-rate': saveShippingRate(id); break;
            case 'export-json': exportJSON(); break;
            case 'import-json': importJSON(); break;
            case 'export-pdf': exportPDF(); break;
        }
    });

    document.addEventListener('change', function (e) {
        var statusTarget = e.target.closest('[data-action="update-status"]');
        if (statusTarget) {
            updateStatus(statusTarget.dataset.id, statusTarget.value);
            return;
        }
        var mediaKindTarget = e.target.closest('[data-action="media-kind-changed"]');
        if (mediaKindTarget) {
            toggleMediaKindUI();
            return;
        }
        var bgTypeTarget = e.target.closest('[data-action="bg-type-changed"]');
        if (bgTypeTarget) {
            updateBgColorRow(bgTypeTarget.dataset.half);
            return;
        }
    });

    loadStats();
})();
