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

    var configLazyLoaded = false;

    function switchTab(tabName) {
        document.querySelectorAll('.admin-tab').forEach(function(tab) {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        // Map tab names to section IDs: overview→adminOverview, catalog→adminCatalog, orders→adminOrders, config→adminConfig
        var idMap = { overview: 'adminOverview', catalog: 'adminCatalog', orders: 'adminOrders', config: 'adminConfig' };
        var targetId = idMap[tabName] || ('admin' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
        document.querySelectorAll('.admin-section').forEach(function(section) {
            section.classList.toggle('active', section.id === targetId);
        });
        // Lazy-load config tab children (shipping zones + live rates)
        if (tabName === 'config' && !configLazyLoaded) {
            configLazyLoaded = true;
            loadShippingZones();
            loadLiveRatesStatus();
        }
    }

    function applyStats(stats) {
        document.getElementById('totalRevenue').textContent = '$' + (stats.totalRevenue || 0).toFixed(2);
        document.getElementById('totalOrders').textContent = stats.totalOrders || 0;
        document.getElementById('totalProducts').textContent = stats.totalProducts || 0;
        document.getElementById('totalCustomers').textContent = stats.totalCustomers || 0;
    }

    async function loadStats() {
        var result = await apiCall('get_stats');
        if (result.error) return;
        applyStats(result);
    }

    function renderProductsTable(products) {
        var tbody = document.getElementById('adminProductsBody');
        if (!tbody) return;
        tbody.innerHTML = products.map(function (p) {
            var imgCount = '';
            var imgs = (Array.isArray(p.variations) ? p.variations.length : 0);
            if (imgs > 0) imgCount = ' <span style="color:#888;font-size:10px;">(' + (imgs + 1) + ')</span>';
            var typeLabels = { original: 'Original', print: 'Print', merch: 'Product', craft: 'Handmade' };
            var typeDisplay = typeLabels[p.type] || '';
            var featured = p.is_featured ? ' <span style="color:#D0A380;font-size:10px;">\u2605</span>' : '';
            return '<tr>' +
                '<td><img src="' + attr(p.image_url || '') + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;"></td>' +
                '<td>' + esc(p.title || '') + imgCount + featured + '</td>' +
                '<td>' + esc(typeDisplay) + '</td>' +
                '<td>$' + esc((p.base_price || 0).toFixed(2)) + '</td>' +
                '<td><input type="number" value="' + esc(p.stock || 0) + '" min="0" data-product-id="' + attr(p.product_id) + '" class="stock-input" style="width:54px;padding:3px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;"></td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="admin-btn" data-edit-id="' + attr(p.product_id) + '" title="Edit">Edit</button> ' +
                    '<button class="admin-btn" data-dup-id="' + attr(p.product_id) + '" title="Duplicate">Dup</button> ' +
                    '<button class="admin-btn danger" data-delete-id="' + attr(p.product_id) + '" title="Delete">\u00d7</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-edit-id]').forEach(function (btn) {
            btn.onclick = function () { openEditModal(btn.dataset.editId); };
        });
        tbody.querySelectorAll('[data-delete-id]').forEach(function (btn) {
            btn.onclick = function () { deleteProduct(btn.dataset.deleteId); };
        });
        tbody.querySelectorAll('[data-dup-id]').forEach(function (btn) {
            btn.onclick = function () { duplicateProduct(btn.dataset.dupId); };
        });
        tbody.querySelectorAll('.stock-input').forEach(function (input) {
            input.onchange = function () { updateStock(input.dataset.productId, input.value); };
        });
    }

    async function loadProducts() {
        var result = await apiCall('get_products');
        if (result.error || !Array.isArray(result)) return;
        renderProductsTable(result);
        renderLowStock(result);
    }

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

    function renderOrdersTables(orders) {
        var tbody = document.getElementById('adminOrdersBody');
        var recent = document.getElementById('recentOrdersBody');
        if (tbody) tbody.innerHTML = orders.map(mapOrder).join('');
        if (recent) recent.innerHTML = orders.slice(-6).reverse().map(mapOrder).join('');
    }

    function renderLowStock(products) {
        var el = document.getElementById('lowStockList');
        if (!el) return;
        var low = products.filter(function(p) { return (p.stock || 0) <= 3; });
        if (low.length === 0) {
            el.innerHTML = '<p style="color:#aaa; padding:8px 0;">All items well stocked.</p>';
            return;
        }
        el.innerHTML = low.map(function(p) {
            var urgent = (p.stock || 0) === 0;
            var color = urgent ? '#e53935' : '#f9a825';
            var label = urgent ? 'Out of stock' : p.stock + ' left';
            return '<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border-color, #eee);">' +
                '<img src="' + attr(p.image_url || '') + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.title || 'Untitled') + '</div>' +
                    '<div style="color:' + color + ';font-size:11px;font-weight:500;">' + label + '</div>' +
                '</div>' +
                '<div style="font-size:11px;color:#888;">$' + (p.base_price || 0).toFixed(2) + '</div>' +
            '</div>';
        }).join('');
    }

    function renderCustomersTable(customers) {
        var tbody = document.getElementById('adminCustomersBody');
        if (!tbody) return;
        if (!customers || customers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">No customers yet.</td></tr>';
            return;
        }
        tbody.innerHTML = customers.map(function(c) {
            return '<tr>' +
                '<td>' + esc(c.name || 'N/A') + '</td>' +
                '<td>' + esc(c.email || '') + '</td>' +
                '<td>' + (c.order_count || 0) + '</td>' +
                '<td>$' + (c.total_spent || 0).toFixed(2) + '</td>' +
                '<td>' + esc(c.last_order ? new Date(c.last_order).toLocaleDateString() : '-') + '</td>' +
            '</tr>';
        }).join('');
    }

    async function loadOrders() {
        var result = await apiCall('get_orders');
        if (result.error || !Array.isArray(result)) return;
        renderOrdersTables(result);
    }

    function applySettingsForm(settings) {
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
        if (settings.tax_rate_ngn) document.getElementById('taxRateNGN').value = settings.tax_rate_ngn;
        if (settings.tax_rate_usd) document.getElementById('taxRateUSD').value = settings.tax_rate_usd;
        if (settings.logo_url) {
            var logoPreview = document.getElementById('logoPreview');
            if (logoPreview) { logoPreview.src = settings.logo_url; }
        }
        if (settings.logo_size) {
            document.getElementById('logoSizeRange').value = settings.logo_size;
            document.getElementById('logoSizeValue').textContent = settings.logo_size;
        }
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
        var panel = document.getElementById('catalogPanel');
        var title = document.getElementById('editModalTitle');
        var deleteBtn = document.getElementById('deleteProductBtn');
        title.textContent = productId ? 'Edit Product' : 'Add Product';
        if (deleteBtn) deleteBtn.style.display = productId ? 'inline-block' : 'none';

        // Reset all text/number fields
        ['editTitle','editAuthor','editDescription','editImageUrl','editPrice','editComparePrice','editVariations','editTags','editSlug'].forEach(function (id) {
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
        if (document.getElementById('editType')) document.getElementById('editType').value = '';
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
                document.getElementById('editSlug').value = p.slug || '';
                document.getElementById('editAuthor').value = p.author || 'V.';
                document.getElementById('editDescription').value = p.description || '';
                // editContent removed from UI — content field not used
                document.getElementById('editType').value = p.type || '';
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

        if (panel) panel.classList.add('active');
    }

    function closeEditModal() {
        var panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('active');
        editingId = null;
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
            slug: val('editSlug').trim() || undefined, // empty = auto-generate from title
            author: val('editAuthor').trim() || 'V.',
            description: val('editDescription').trim(),
            content: '', // text_content field removed from admin UI
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
        Promise.all([loadProducts(), loadStats()]);
    }

    async function deleteProduct(productId) {
        if (!confirm('Delete this product? This cannot be undone.')) return;
        var result = await apiCall('delete_product', { product_id: productId });
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Product deleted');
        closeEditModal();
        Promise.all([loadProducts(), loadStats()]);
    }

    async function duplicateProduct(productId) {
        var result = await apiCall('get_products');
        if (result.error || !Array.isArray(result)) return;
        var p = result.find(function (x) { return String(x.product_id) === String(productId); });
        if (!p) return;
        var clone = JSON.parse(JSON.stringify(p));
        delete clone.product_id;
        delete clone.created_at;
        delete clone.updated_at;
        clone.title = (clone.title || 'Untitled') + ' (copy)';
        clone.slug = ''; // auto-generate
        var res = await apiCall('create_product', clone);
        if (res.error) { showNotification(res.error, 'error'); return; }
        showNotification('Product duplicated');
        Promise.all([loadProducts(), loadStats()]);
    }

    async function toggleFeatured(productId) {
        var result = await apiCall('get_products');
        if (result.error || !Array.isArray(result)) return;
        var p = result.find(function (x) { return String(x.product_id) === String(productId); });
        if (!p) return;
        var newVal = !p.is_featured;
        var res = await apiCall('update_product', { product_id: productId, is_featured: newVal });
        if (res.error) { showNotification(res.error, 'error'); return; }
        showNotification(newVal ? 'Marked as featured' : 'Removed from featured');
        loadProducts();
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
            whatsapp: document.getElementById('settingWhatsapp').value.trim(),
            logo_size: parseInt(document.getElementById('logoSizeRange').value) || 36,
            tax_rate_ngn: parseFloat(document.getElementById('taxRateNGN').value) || 0,
            tax_rate_usd: parseFloat(document.getElementById('taxRateUSD').value) || 0
        };
        // Include logo if one was uploaded
        if (uploadedLogoData) {
            data.logo_url = uploadedLogoData;
        }
        var result = await apiCall('update_settings', data);
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Settings saved');
        uploadedLogoData = null;
        // Persist dark mode preference
        var isDark = document.body.classList.contains('dark-mode');
        try { localStorage.setItem('admin_dark_mode', isDark ? '1' : '0'); } catch(e) {}
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

    // ---- CSV Import ----
    function parseCsvLine(line) {
        var fields = [];
        var current = '';
        var inQuotes = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                else if (ch === '"') { inQuotes = false; }
                else { current += ch; }
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === ',') { fields.push(current.trim()); current = ''; }
                else { current += ch; }
            }
        }
        fields.push(current.trim());
        return fields;
    }

    function parseCsv(text) {
        var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        if (lines.length < 2) return { headers: [], rows: [] };
        var headers = parseCsvLine(lines[0]).map(function (h) { return h.toLowerCase().replace(/[^a-z0-9_]/g, '_'); });
        var rows = [];
        for (var i = 1; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var values = parseCsvLine(line);
            var row = {};
            headers.forEach(function (h, idx) {
                if (values[idx] !== undefined) row[h] = values[idx];
            });
            rows.push(row);
        }
        return { headers: headers, rows: rows };
    }

    function csvRowToProduct(row) {
        return {
            title: row.title || '',
            author: row.author || 'V.',
            description: row.description || '',
            content: row.content || '',
            type: row.type || 'merch',
            media_kind: ['image', 'video', 'text'].includes(row.media_kind) ? row.media_kind : 'image',
            orientation: ['square', 'portrait', 'landscape'].includes(row.orientation) ? row.orientation : 'square',
            base_price: parseFloat(row.base_price) || 0,
            compare_price: parseFloat(row.compare_price) || null,
            stock: parseInt(row.stock, 10) || 0,
            image_url: row.image_url || '',
            variations: row.variations ? row.variations.split('|').filter(Boolean) : [],
            tags: row.tags ? row.tags.split('|').filter(Boolean) : [],
            font_family: row.font_family || '',
            font_size: parseInt(row.font_size, 10) || null,
            font_weight: parseInt(row.font_weight, 10) || null,
            text_transform: row.text_transform || '',
            content_order: row.content_order || '',
            show_author: row.show_author === 'true' || row.show_author === '1',
            show_price: row.show_price !== 'false' && row.show_price !== '0',
            show_stock: row.show_stock !== 'false' && row.show_stock !== '0',
            show_share: row.show_share === 'true' || row.show_share === '1',
            is_featured: row.is_featured === 'true' || row.is_featured === '1',
            video_autoplay: row.video_autoplay !== 'false',
            video_loop: row.video_loop !== 'false',
            video_muted: row.video_muted !== 'false'
        };
    }

    function downloadCsvTemplate() {
        var headers = [
            'title', 'author', 'description', 'content', 'type', 'media_kind',
            'orientation', 'base_price', 'compare_price', 'stock', 'image_url',
            'variations', 'tags', 'font_family', 'font_size', 'font_weight',
            'text_transform', 'content_order', 'show_author', 'show_price',
            'show_stock', 'show_share', 'is_featured', 'video_autoplay',
            'video_loop', 'video_muted'
        ];
        var example = [
            'Sunset Canvas', 'V.', 'A vibrant sunset over the ocean', '', 'original',
            'image', 'landscape', '450', '500', '1',
            'https://example.com/sunset.jpg', '', 'landscape,original',
            "'Copperplate', serif", '11', '400', 'none', 'title-first',
            'true', 'true', 'true', 'false', 'false',
            'true', 'true', 'true'
        ];
        var csv = headers.join(',') + '\n' + example.join(',');
        var blob = new Blob([csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vgallery_product_template.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    function logout() {
        sessionStorage.removeItem('admin_token');
        window.location.href = '/admin/index.html';
    }

    // ---- Shipping Zones ----
    function renderShippingZones(zones) {
        var tbody = document.getElementById('shippingZonesBody');
        if (!tbody) return;
        if (!zones || zones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:20px;">No shipping zones yet. Click "+ Add Zone" to create one.</td></tr>';
            return;
        }
        tbody.innerHTML = zones.map(function(z) {
            var activeLabel = z.is_active !== false
                ? '<span style="color:#4caf50;">Active</span>'
                : '<span style="color:#999;">Inactive</span>';
            return '<tr>' +
                '<td>' + esc(z.country_name || z.country_code) + ' <span style="color:#888;font-size:10px;">(' + esc(z.country_code) + ')</span></td>' +
                '<td>' + esc(z.method) + '</td>' +
                '<td>' + esc(z.currency) + '</td>' +
                '<td>' + z.currency + ' ' + parseFloat(z.cost || 0).toFixed(2) + '</td>' +
                '<td>' + esc(z.estimated_days || '-') + '</td>' +
                '<td>' + activeLabel + '</td>' +
                '<td>' +
                    '<button class="admin-btn" data-toggle-zone="' + attr(z.id) + '">Toggle</button> ' +
                    '<button class="admin-btn danger" data-delete-zone="' + attr(z.id) + '">Delete</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-toggle-zone]').forEach(function(btn) {
            btn.onclick = function() { toggleShippingZone(btn.dataset.toggleZone); };
        });
        tbody.querySelectorAll('[data-delete-zone]').forEach(function(btn) {
            btn.onclick = function() {
                if (confirm('Delete this shipping zone?')) deleteShippingZone(btn.dataset.deleteZone);
            };
        });
    }

    async function loadShippingZones() {
        var result = await apiCall('get_shipping_zones');
        if (result.error) return;
        renderShippingZones(result);
    }

    async function addShippingZone() {
        var code = prompt('Country code (ISO 3166-1 alpha-2, e.g. NG, US, GB, EU, ROW):');
        if (!code) return;
        var name = prompt('Display name (e.g. Nigeria, United States):') || code;
        var method = prompt('Method (standard or express):', 'standard');
        if (!method) return;
        var currency = prompt('Currency (NGN, USD, GBP, EUR):', 'USD');
        if (!currency) return;
        var cost = prompt('Shipping cost (' + currency + '):', '15');
        if (cost === null) return;
        var days = prompt('Estimated delivery days (e.g. 3-5, 7-14):', '') || '';

        var result = await apiCall('create_shipping_zone', {
            country_code: code,
            country_name: name,
            method: method,
            currency: currency,
            cost: cost,
            estimated_days: days
        });
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Shipping zone added');
        loadShippingZones();
    }

    async function toggleShippingZone(id) {
        // We need to get current state first. Simplest: load all, find it, toggle.
        var result = await apiCall('get_shipping_zones');
        if (result.error) return;
        var zone = result.find(function(z) { return z.id === id; });
        if (!zone) return;
        var newActive = zone.is_active === false;
        var upd = await apiCall('update_shipping_zone', { id: id, is_active: newActive });
        if (upd.error) { showNotification(upd.error, 'error'); return; }
        showNotification(newActive ? 'Zone activated' : 'Zone deactivated');
        loadShippingZones();
    }

    async function deleteShippingZone(id) {
        var result = await apiCall('delete_shipping_zone', { id: id });
        if (result.error) { showNotification(result.error, 'error'); return; }
        showNotification('Zone deleted');
        loadShippingZones();
    }

    // ---- Live Currency Rates ----
    async function loadLiveRatesStatus() {
        var toggle = document.getElementById('liveRatesToggle');
        var statusEl = document.getElementById('liveRatesStatus');
        var previewEl = document.getElementById('liveRatesPreview');
        if (!toggle) return;

        // Read current setting
        var settings = await apiCall('get_settings');
        if (settings.error) return;

        var enabled = settings.live_rates_enabled !== 'false';
        toggle.checked = enabled;
        if (statusEl) statusEl.textContent = enabled ? 'Enabled' : 'Disabled (using manual rates)';

        // Show cached rates preview
        if (settings.live_rates_data) {
            try {
                var rates = JSON.parse(settings.live_rates_data);
                var preview = Object.keys(rates).slice(0, 8).map(function(c) {
                    return c + ': ' + (typeof rates[c] === 'number' ? rates[c].toFixed(c === 'NGN' ? 0 : 4) : rates[c]);
                }).join(' | ');
                if (previewEl) previewEl.innerHTML = '<strong>Cached rates:</strong> ' + esc(preview);
                if (settings.live_rates_last_fetched && statusEl) {
                    statusEl.textContent += ' (fetched ' + new Date(settings.live_rates_last_fetched).toLocaleString() + ')';
                }
            } catch(e) {}
        }
    }

    async function toggleLiveRates() {
        var toggle = document.getElementById('liveRatesToggle');
        if (!toggle) return;
        var enabled = toggle.checked;
        var result = await apiCall('update_settings', { live_rates_enabled: enabled ? 'true' : 'false' });
        if (result.error) { showNotification(result.error, 'error'); toggle.checked = !enabled; return; }
        showNotification(enabled ? 'Live rates enabled' : 'Using manual rates');
        var statusEl = document.getElementById('liveRatesStatus');
        if (statusEl) statusEl.textContent = enabled ? 'Enabled' : 'Disabled (using manual rates)';
    }

    async function refreshRates() {
        var btn = document.getElementById('refreshRatesBtn');
        if (!btn) return;
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
        var result = await apiCall('refresh_currency_rates');
        if (result.error || !result.success) {
            showNotification('Failed to refresh: ' + (result.error || 'unknown'), 'error');
        } else {
            showNotification('Rates refreshed from ECB');
            // Update preview
            var previewEl = document.getElementById('liveRatesPreview');
            if (previewEl && result.rates) {
                var preview = Object.keys(result.rates).slice(0, 8).map(function(c) {
                    return c + ': ' + (typeof result.rates[c] === 'number' ? result.rates[c].toFixed(c === 'NGN' ? 0 : 4) : result.rates[c]);
                }).join(' | ');
                previewEl.innerHTML = '<strong>Live rates:</strong> ' + esc(preview);
            }
        }
        btn.disabled = false;
        btn.textContent = 'Force Refresh Rates';
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Single batched call for initial data — avoids 4 separate cold starts
        apiCall('dashboard_init').then(function (initData) {
            if (initData.error) {
                // Fallback to individual calls if batch fails
                Promise.all([loadStats(), loadProducts(), loadOrders()]);
            } else {
                // Apply stats
                if (initData.stats) applyStats(initData.stats);
                // Apply products table + low stock
                if (Array.isArray(initData.products)) {
                    renderProductsTable(initData.products);
                    renderLowStock(initData.products);
                }
                // Apply orders tables
                if (Array.isArray(initData.orders)) renderOrdersTables(initData.orders);
                // Apply customers table (now in Overview)
                if (Array.isArray(initData.customers)) renderCustomersTable(initData.customers);
                // Apply settings form
                if (initData.settings) applySettingsForm(initData.settings);
            }
            updateSyncBadge();
        });

        window.addEventListener('online', updateSyncBadge);
        window.addEventListener('offline', updateSyncBadge);

        document.getElementById('logoutBtn').onclick = logout;

        // Dark mode toggle
        var darkBtn = document.getElementById('darkToggleBtn');
        if (darkBtn) {
            // Restore saved preference
            try {
                if (localStorage.getItem('admin_dark_mode') === '1') {
                    document.body.classList.add('dark-mode');
                    darkBtn.textContent = '◑';
                }
            } catch(e) {}
            darkBtn.onclick = function() {
                document.body.classList.toggle('dark-mode');
                var isNowDark = document.body.classList.contains('dark-mode');
                darkBtn.textContent = isNowDark ? '◑' : '◐';
                try { localStorage.setItem('admin_dark_mode', isNowDark ? '1' : '0'); } catch(e) {}
            };
        }

        // Logo size range slider
        var logoSizeRange = document.getElementById('logoSizeRange');
        var logoSizeValue = document.getElementById('logoSizeValue');
        if (logoSizeRange && logoSizeValue) {
            logoSizeRange.oninput = function() { logoSizeValue.textContent = this.value; };
        }

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

        // ---- Shipping Zones ----
        var addZoneBtn = document.getElementById('addShippingZoneBtn');
        if (addZoneBtn) addZoneBtn.onclick = addShippingZone;

        // ---- Live Rates ----
        var liveToggle = document.getElementById('liveRatesToggle');
        if (liveToggle) liveToggle.onchange = toggleLiveRates;
        var refreshBtn = document.getElementById('refreshRatesBtn');
        if (refreshBtn) refreshBtn.onclick = refreshRates;

        // ---- CSV Import ----
        var csvFileInput = document.getElementById('csvFileInput');
        var importCsvBtn = document.getElementById('importCsvBtn');
        var downloadCsvTemplateBtn = document.getElementById('downloadCsvTemplateBtn');
        if (importCsvBtn && csvFileInput) {
            importCsvBtn.onclick = function () { csvFileInput.click(); };
            csvFileInput.onchange = async function () {
                var file = this.files && this.files[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                    showNotification('CSV file too large (max 5MB)', 'error');
                    this.value = '';
                    return;
                }
                importCsvBtn.disabled = true;
                importCsvBtn.textContent = 'Importing...';
                try {
                    var text = await file.text();
                    var parsed = parseCsv(text);
                    if (parsed.rows.length === 0) {
                        showNotification('CSV has no data rows', 'error');
                        return;
                    }
                    var products = parsed.rows.map(csvRowToProduct);
                    var result = await apiCall('import_csv', { products: products });
                    if (result.error) { showNotification(result.error, 'error'); return; }
                    showNotification('Imported ' + result.imported + ' of ' + result.total + ' products');
                    Promise.all([loadProducts(), loadStats()]);
                } catch (err) {
                    showNotification('Failed to read CSV: ' + err.message, 'error');
                } finally {
                    importCsvBtn.disabled = false;
                    importCsvBtn.textContent = 'Import CSV';
                    csvFileInput.value = '';
                }
            };
        }
        if (downloadCsvTemplateBtn) {
            downloadCsvTemplateBtn.onclick = downloadCsvTemplate;
        }

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

        // Settings are now loaded via dashboard_init batch call above.
        // If batch failed and fell back to individual calls, settings
        // will be loaded when user clicks the Settings tab.

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

        // Auto-generate slug from title when slug field is empty/unmodified
        var titleInput = document.getElementById('editTitle');
        var slugInput = document.getElementById('editSlug');
        var slugManuallyEdited = false;
        if (titleInput && slugInput) {
            titleInput.addEventListener('input', function () {
                if (slugManuallyEdited) return;
                var raw = titleInput.value.toLowerCase().trim()
                    .replace(/[\s\u00A0]+/g, '-')
                    .replace(/[^a-z0-9\-\u00C0-\u024F]+/g, '')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                slugInput.value = raw;
            });
            slugInput.addEventListener('input', function () {
                slugManuallyEdited = true;
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeEditModal();
        });

        // Reset slugManuallyEdited each time the edit panel opens
        var catPanel = document.getElementById('catalogPanel');
        if (catPanel) {
            var observer = new MutationObserver(function () {
                if (catPanel.classList.contains('active')) {
                    slugManuallyEdited = false;
                }
            });
            observer.observe(catPanel, { attributes: true, attributeFilter: ['class'] });
        }

        // ═══════════════════════════════════════════════════════
        // PREVIEW & TWEAK MODE
        // Embeds the live storefront in an iframe with tap-to-edit
        // overlays. Tap image→upload, tap description→editable,
        // tap background→color picker, tap action row→toggle visibility.
        // ═══════════════════════════════════════════════════════
        var ptContainer = document.getElementById('previewTweakContainer');
        var ptFrame = document.getElementById('previewTweakFrame');
        var ptBackBtn = document.getElementById('previewTweakBack');
        var ptSaveBtn = document.getElementById('previewTweakSave');
        var ptPrevBtn = document.getElementById('previewTweakPrev');
        var ptNextBtn = document.getElementById('previewTweakNext');
        var ptEditPanel = document.getElementById('ptEditPanel');
        var ptEditTitle = document.getElementById('ptEditTitle');
        var ptEditBody = document.getElementById('ptEditBody');
        var ptEditClose = document.getElementById('ptEditClose');
        var ptProductLabel = document.getElementById('previewTweakProduct');
        var ptProducts = []; // loaded products list
        var ptIndex = 0;    // current product in preview
        var ptFrameReady = false;

        function ptLoadProducts() {
            return apiCall('get_products').then(function (list) {
                ptProducts = Array.isArray(list) ? list : [];
            });
        }

        function ptShow() {
            ptContainer.style.display = 'block';
            document.getElementById('catalogLayout').style.display = 'none';
            ptLoadProducts().then(function () {
                ptIndex = 0;
                if (!ptFrameReady) {
                    ptFrame.src = '/?pt=1';
                    ptFrame.onload = function () { ptFrameReady = true; ptSendNavigate(); };
                } else {
                    ptSendNavigate();
                }
                ptUpdateLabel();
            });
        }

        function ptHide() {
            ptContainer.style.display = 'none';
            ptEditPanel.style.display = 'none';
            document.getElementById('catalogLayout').style.display = '';
            ptFrame.src = 'about:blank';
            ptFrameReady = false;
            loadProducts();
        }

        function ptSendNavigate() {
            if (!ptFrameReady || !ptFrame.contentWindow) return;
            ptFrame.contentWindow.postMessage({ type: 'pt-navigate', index: ptIndex }, window.location.origin);
        }

        function ptUpdateLabel() {
            var p = ptProducts[ptIndex];
            if (ptProductLabel) ptProductLabel.textContent = (ptIndex + 1) + '/' + ptProducts.length + ' — ' + (p && p.title ? p.title : 'Untitled');
        }

        // Called from within the iframe via postMessage
        window.addEventListener('message', function (e) {
            if (e.origin !== window.location.origin) return;
            if (!e.data) return;
            if (e.data.type === 'pt-edit') {
                ptShowEditPanel(e.data.zone, e.data.productId);
            }
        });

        function ptShowEditPanel(zone, productId) {
            var p = ptProducts.find(function (x) { return x.product_id === productId; });
            if (!p) return;

            ptEditPanel.style.display = 'block';
            var html = '';

            if (zone === 'image') {
                ptEditTitle.textContent = 'Edit Image';
                html = '<div class="form-group"><label>Image URL</label><input type="text" id="ptField_image_url" value="' + esc(p.image_url || '') + '" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"></div>';
                html += '<label style="display:block;margin-top:8px;font-size:12px;opacity:0.7;">Or upload new image</label>';
                html += '<input type="file" id="ptImageUpload" accept="image/*" style="margin-top:4px;font-size:16px;"></div>';
            } else if (zone === 'description') {
                ptEditTitle.textContent = 'Edit Description';
                html = '<div class="form-group"><label>Title</label><input type="text" id="ptField_title" value="' + esc(p.title || '') + '" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"></div>';
                html += '<div class="form-group" style="margin-top:8px;"><label>Description</label><textarea id="ptField_description" rows="4" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;">' + esc(p.description || '') + '</textarea></div>';
            } else if (zone === 'background') {
                ptEditTitle.textContent = 'Edit Background';
                var bgTop = p.background_top || {};
                html = '<p style="font-size:11px;opacity:0.6;margin-bottom:8px;">Top Half Background</p>';
                html += '<div style="display:flex;gap:8px;margin-bottom:8px;"><div class="form-group" style="flex:1;"><label>Type</label><select id="ptField_bg_top_type" style="width:100%;padding:6px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"><option value="color"' + (bgTop.type === 'color' ? ' selected' : '') + '>Color</option><option value="gradient"' + (bgTop.type === 'gradient' ? ' selected' : '') + '>Gradient</option><option value="image"' + (bgTop.type === 'image' ? ' selected' : '') + '>Image</option></select></div>';
                html += '<div class="form-group" style="flex:1;"><label>Color 1</label><input type="color" id="ptField_bg_top_c1" value="' + (bgTop.color1 || '#f8f8f8') + '" style="width:100%;height:36px;border:none;border-radius:4px;"></div></div>';
                html += '<div style="display:flex;gap:8px;"><div class="form-group" style="flex:1;"><label>Color 2</label><input type="color" id="ptField_bg_top_c2" value="' + (bgTop.color2 || '#e0e0e0') + '" style="width:100%;height:36px;border:none;border-radius:4px;"></div>';
                html += '<div class="form-group" style="flex:1;"><label>Media URL</label><input type="text" id="ptField_bg_top_url" value="' + esc(bgTop.mediaUrl || '') + '" placeholder="https://..." style="width:100%;padding:6px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"></div></div>';
            } else if (zone === 'actions') {
                ptEditTitle.textContent = 'Toggle Visibility';
                html = '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="ptField_show_price" ' + (p.show_price !== false ? 'checked' : '') + ' style="width:18px;height:18px;"> Show price</label>';
                html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="ptField_show_author" ' + (p.show_author !== false ? 'checked' : '') + ' style="width:18px;height:18px;"> Show author</label>';
                html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="ptField_show_stock" ' + (p.show_stock !== false ? 'checked' : '') + ' style="width:18px;height:18px;"> Show stock badge</label>';
                html += '<div class="form-group" style="margin-top:12px;"><label>Price (USD)</label><input type="number" id="ptField_price" value="' + (p.base_price || 0) + '" step="0.01" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"></div>';
                html += '<div class="form-group" style="margin-top:8px;"><label>Stock</label><input type="number" id="ptField_stock" value="' + (p.stock || 0) + '" min="0" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:4px;font-size:16px;"></div>';
            }

            html += '<button id="ptEditApply" style="margin-top:12px;padding:8px 20px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;width:100%;">Apply</button>';
            ptEditBody.innerHTML = html;

            // Wire up apply button
            var applyBtn = document.getElementById('ptEditApply');
            if (applyBtn) applyBtn.onclick = function () { ptApplyEdit(zone, p); };

            // Wire up image upload
            var uploadInput = document.getElementById('ptImageUpload');
            if (uploadInput) {
                uploadInput.onchange = function () {
                    handleFileUpload(uploadInput, null, function (base64) {
                        var urlInput = document.getElementById('ptField_image_url');
                        if (urlInput) urlInput.value = base64;
                    });
                };
            }
        }

        function ptApplyEdit(zone, p) {
            var data = { product_id: p.product_id };

            if (zone === 'image') {
                data.image_url = document.getElementById('ptField_image_url').value.trim();
            } else if (zone === 'description') {
                data.title = document.getElementById('ptField_title').value.trim();
                data.description = document.getElementById('ptField_description').value.trim();
            } else if (zone === 'background') {
                data.background_top = {
                    type: document.getElementById('ptField_bg_top_type').value,
                    color1: document.getElementById('ptField_bg_top_c1').value,
                    color2: document.getElementById('ptField_bg_top_c2').value,
                    mediaUrl: document.getElementById('ptField_bg_top_url').value.trim()
                };
            } else if (zone === 'actions') {
                data.show_price = document.getElementById('ptField_show_price').checked;
                data.show_author = document.getElementById('ptField_show_author').checked;
                data.show_stock = document.getElementById('ptField_show_stock').checked;
                data.base_price = parseFloat(document.getElementById('ptField_price').value) || 0;
                data.stock = parseInt(document.getElementById('ptField_stock').value, 10) || 0;
            }

            ptEditPanel.style.display = 'none';
            showNotification('Saving...');

            apiCall('update_product', data).then(function (result) {
                if (result.error) { showNotification(result.error, 'error'); return; }
                showNotification('Saved');
                // Refresh product list and re-render
                ptLoadProducts().then(function () { ptUpdateLabel(); ptSendNavigate(); });
            });
        }

        function ptSaveAll() {
            ptHide();
        }

        // Wire buttons
        var ptTweakBtn = document.getElementById('previewTweakBtn');
        if (ptTweakBtn) ptTweakBtn.onclick = ptShow;
        if (ptBackBtn) ptBackBtn.onclick = ptHide;
        if (ptSaveBtn) ptSaveBtn.onclick = ptSaveAll;
        if (ptPrevBtn) ptPrevBtn.onclick = function () { if (ptIndex > 0) { ptIndex--; ptUpdateLabel(); ptSendNavigate(); } };
        if (ptNextBtn) ptNextBtn.onclick = function () { if (ptIndex < ptProducts.length - 1) { ptIndex++; ptUpdateLabel(); ptSendNavigate(); } };
        if (ptEditClose) ptEditClose.onclick = function () { ptEditPanel.style.display = 'none'; };
    });
})();
