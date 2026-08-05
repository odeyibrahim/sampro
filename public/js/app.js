class HybridApp {
    constructor() {
        this.products = [];
        this.currentIndex = 0;
        this.savedItems = new Set();
        this.selectedCurrency = 'USD';
        this.exchangeRates = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1500 };
        this.checkoutQuantity = 1;
        this.zoomActive = false;
        this.variationIndex = 0;
        this.currentVariations = [];
        this.selectedPaymentProvider = 'paystack';
        this.lastBankOrder = null;
        this.sessionId = localStorage.getItem('session_id') || 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem('session_id', this.sessionId);
        this.init();
    }

    async init() {
        this.bindElements();
        await this.loadProducts();
        this.loadSaved();
        this.setupEvents();
        this.setupSwipe();
        this.registerServiceWorker();
        this.loadStoreSettings();
        const enterBtn = document.getElementById('enterGalleryBtn');
        if (enterBtn) enterBtn.onclick = () => this.enterGallery();
        this.showIntro();
    }

    // Fail-soft by design: a missing/unreachable settings endpoint just
    // means the site keeps its default "V." branding, never blocks load.
    async loadStoreSettings() {
        try {
            const res = await fetch('/.netlify/functions/get-settings');
            if (!res.ok) return;
            const settings = await res.json();

            const siteLogo = document.getElementById('siteLogo');
            if (siteLogo && settings.logo_url) {
                siteLogo.innerHTML = '';
                const img = document.createElement('img');
                img.src = settings.logo_url;
                img.alt = settings.store_name || 'Store logo';
                img.style.cssText = 'max-height:36px; max-width:120px; object-fit:contain; display:block;';
                siteLogo.appendChild(img);
            }
            if (settings.store_name) {
                document.title = settings.store_name + ' · Art + Commerce';
            }
        } catch (e) {
            // intentionally silent — see comment above
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
        }
    }

    bindElements() {
        this.el = {
            introOverlay: document.getElementById('introOverlay'),
            splitContainer: document.getElementById('mainContent'),
            mainImage: document.getElementById('mainImage'),
            mainVideo: document.getElementById('mainVideo'),
            textContent: document.getElementById('textContent'),
            productFrame: document.getElementById('productFrame'),
            productHalf: document.getElementById('productHalf'),
            infoHalf: document.getElementById('infoHalf'),
            infoContainer: document.getElementById('infoContainer'),
            productTitle: document.getElementById('productTitle'),
            productCreator: document.getElementById('productCreator'),
            descriptionText: document.getElementById('descriptionText'),
            priceRow: document.getElementById('priceRow'),
            priceTag: document.getElementById('priceTag'),
            originalPrice: document.getElementById('originalPrice'),
            stockBadge: document.getElementById('stockBadge'),
            bgVideoTop: document.getElementById('bgVideoTop'),
            bgImageTop: document.getElementById('bgImageTop'),
            bgVideoBottom: document.getElementById('bgVideoBottom'),
            bgImageBottom: document.getElementById('bgImageBottom'),
            heartButton: document.getElementById('heartButton'),
            cartButton: document.getElementById('cartButton'),
            shareButton: document.getElementById('shareButton'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            pageIndicator: document.getElementById('pageIndicator'),
            currencyDisplay: document.getElementById('currencyDisplay'),
            gridOverlay: document.getElementById('gridOverlay'),
            gridContainer: document.getElementById('gridContainer'),
            checkoutOverlay: document.getElementById('checkoutOverlay'),
            checkoutPanel: document.getElementById('checkoutPanel'),
            loading: document.getElementById('loading'),
            notification: document.getElementById('notification'),
            galleryBrand: document.getElementById('galleryBrand'),
            bankDetailsPanel: document.getElementById('bankDetailsPanel'),
            bankLocalDetails: document.getElementById('bankLocalDetails'),
            bankDomDetails: document.getElementById('bankDomDetails'),
            bankRefNumber: document.getElementById('bankRefNumber'),
            whatsappProofBtn: document.getElementById('whatsappProofBtn')
        };
    }

    async loadProducts() {
        this.showLoading(true);
        try {
            const response = await fetch('/.netlify/functions/get-products');
            const data = await response.json();
            if (data && data.length > 0) {
                this.products = data;
            } else {
                throw new Error('No products from API');
            }
        } catch (e) {
            console.log('Using fallback products:', e);
            this.products = [
                { product_id: '1', title: 'Archive Tee', author: 'V.', description: '100% cotton, screen printed by hand.\nLimited edition.', type: 'merch', base_price: 45, stock: 10, orientation: 'square', image_url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800', variations: [] },
                { product_id: '2', title: 'Desert Landscape', author: 'V.', description: 'Archival photograph from the high desert.\nSigned and numbered.', type: 'print', base_price: 195, stock: 5, orientation: 'landscape', image_url: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800', variations: ['https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800'] },
                { product_id: '3', title: 'Silent Currents', author: 'V.', description: 'Original mixed media on canvas, 2024.\nA unique piece.', type: 'original', base_price: 8500, stock: 1, orientation: 'portrait', image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800', variations: [] }
            ];
        }
        this.updateDisplay();
        this.showLoading(false);
    }

    loadSaved() {
        const saved = localStorage.getItem('vgallery_saved');
        if (saved) {
            try {
                this.savedItems = new Set(JSON.parse(saved));
            } catch (e) {}
        }
    }

    updateDisplay() {
        if (!this.products.length) return;
        const p = this.products[this.currentIndex];
        if (!p) return;

        this.renderMedia(p);
        this.renderText(p);
        this.renderFrame(p);
        this.renderBackgrounds(p);

        if (this.el.heartButton) {
            const isSaved = this.savedItems.has(p.product_id);
            this.el.heartButton.classList.toggle('saved', isSaved);
            this.el.heartButton.innerHTML = isSaved ? '♥' : '♡';
        }
        if (this.el.pageIndicator) {
            this.el.pageIndicator.textContent = (this.currentIndex + 1) + '/' + this.products.length;
        }
        if (this.el.prevBtn) this.el.prevBtn.disabled = this.currentIndex === 0;
        if (this.el.nextBtn) this.el.nextBtn.disabled = this.currentIndex === this.products.length - 1;

        if (this.el.stockBadge) {
            const showStock = p.show_stock !== false;
            this.el.stockBadge.style.display = showStock ? '' : 'none';
            if (showStock) {
                if (p.stock <= 0) {
                    this.el.stockBadge.textContent = 'Sold Out';
                    this.el.stockBadge.classList.add('sold-out');
                } else if (p.stock <= 2) {
                    this.el.stockBadge.textContent = 'Low Stock (' + p.stock + ')';
                    this.el.stockBadge.classList.remove('sold-out');
                } else {
                    this.el.stockBadge.textContent = '';
                    this.el.stockBadge.classList.remove('sold-out');
                }
            }
        }

        this.currentVariations = p.variations || [];
        if (this.zoomActive) this.removeZoom();
    }

    // media_kind-aware rendering: image (default), video, or text/meditation.
    // Falls back to 'image' for any product created before migration 003.
    renderMedia(p) {
        const kind = p.media_kind || (p.type === 'text' ? 'text' : 'image');
        const splitContainer = this.el.splitContainer;

        if (this.el.mainImage) this.el.mainImage.style.display = 'none';
        if (this.el.mainVideo) { this.el.mainVideo.style.display = 'none'; this.el.mainVideo.pause(); }
        if (this.el.textContent) this.el.textContent.style.display = 'none';
        if (splitContainer) splitContainer.classList.toggle('text-mode', kind === 'text');

        if (kind === 'text') {
            if (this.el.textContent) {
                this.el.textContent.style.display = 'flex';
                this.el.textContent.textContent = p.content || p.description || '';
            }
        } else if (kind === 'video') {
            if (this.el.mainVideo) {
                this.el.mainVideo.style.display = 'block';
                this.el.mainVideo.src = p.image_url || '';
                this.el.mainVideo.autoplay = p.video_autoplay !== false;
                this.el.mainVideo.loop = p.video_loop !== false;
                this.el.mainVideo.muted = p.video_muted !== false;
                if (p.video_autoplay !== false) this.el.mainVideo.play().catch(() => {});
            }
        } else {
            if (this.el.mainImage) {
                this.el.mainImage.style.display = 'block';
                this.el.mainImage.src = p.image_url || '';
                this.el.mainImage.alt = p.title || '';
            }
        }
    }

    renderText(p) {
        if (this.el.productTitle) this.el.productTitle.textContent = p.title || '';

        if (this.el.productCreator) {
            const showAuthor = p.show_author !== false;
            this.el.productCreator.style.display = showAuthor ? '' : 'none';
            this.el.productCreator.textContent = p.author || 'V.';
        }

        if (this.el.infoContainer) {
            const order = p.content_order === 'description-first' ? 'description-first' : 'title-first';
            this.el.infoContainer.classList.toggle('order-description-first', order === 'description-first');
            this.el.infoContainer.classList.toggle('order-title-first', order === 'title-first');
        }

        if (this.el.descriptionText) {
            this.el.descriptionText.textContent = p.description || 'No description available.';
            this.el.descriptionText.style.fontFamily = p.font_family || "'Copperplate', serif";
            this.el.descriptionText.style.fontSize = (p.font_size || 11) + 'px';
            this.el.descriptionText.style.fontWeight = p.font_weight || 400;
            this.el.descriptionText.style.textTransform = p.text_transform || 'none';
        }

        if (this.el.priceRow) {
            const showPrice = p.show_price !== false;
            this.el.priceRow.style.display = showPrice ? '' : 'none';
        }
        if (this.el.priceTag) this.el.priceTag.textContent = this.formatPrice(p.base_price);
        if (this.el.originalPrice) {
            if (p.compare_price) {
                this.el.originalPrice.textContent = this.formatPrice(p.compare_price);
                this.el.originalPrice.style.display = 'inline';
            } else {
                this.el.originalPrice.style.display = 'none';
            }
        }
    }

    renderFrame(p) {
        if (!this.el.productFrame) return;
        const frame = p.frame_style || {};
        this.el.productFrame.className = 'product-frame orientation-' + (p.orientation || 'square');
        this.el.productFrame.classList.toggle('has-frame', (frame.borderWidth || 0) > 0);
        this.el.productFrame.style.borderWidth = (frame.borderWidth || 0) + 'px';
        this.el.productFrame.style.borderColor = frame.borderColor || '#000';
        const fit = frame.objectFit || 'contain';
        if (this.el.mainImage) this.el.mainImage.style.objectFit = fit;
        if (this.el.mainVideo) this.el.mainVideo.style.objectFit = fit;
    }

    // Applies each half's own background (solid/gradient/animated/image/video),
    // independent of dark mode — dark mode overrides both to the theme default.
    renderBackgrounds(p) {
        const halves = [
            { el: this.el.productHalf, bg: p.background_top, video: this.el.bgVideoTop, image: this.el.bgImageTop },
            { el: this.el.infoHalf, bg: p.background_bottom, video: this.el.bgVideoBottom, image: this.el.bgImageBottom }
        ];
        const isDark = document.body.classList.contains('dark-mode');

        halves.forEach(({ el, bg, video, image }) => {
            if (!el) return;
            el.classList.remove('bg-pulse');
            if (video) { video.classList.remove('visible'); video.pause(); video.removeAttribute('src'); }
            if (image) { image.classList.remove('visible'); image.removeAttribute('src'); }

            if (isDark) {
                el.style.background = '';
                return;
            }

            const config = bg || { type: 'color', color1: '#f8f8f8' };
            if (config.type === 'gradient') {
                el.style.background = `linear-gradient(135deg, ${config.color1 || '#f8f8f8'}, ${config.color2 || '#e0e0e0'})`;
            } else if (config.type === 'animated') {
                el.style.background = config.color1 || '#f8f8f8';
                el.classList.add('bg-pulse');
            } else if (config.type === 'image' && config.mediaUrl && image) {
                el.style.background = config.color1 || '#f8f8f8';
                image.src = config.mediaUrl;
                image.classList.add('visible');
            } else if (config.type === 'video' && config.mediaUrl && video) {
                el.style.background = config.color1 || '#f8f8f8';
                video.src = config.mediaUrl;
                video.classList.add('visible');
                video.play().catch(() => {});
            } else {
                el.style.background = config.color1 || '#f8f8f8';
            }
        });
    }

    formatPrice(usd) {
        const rate = this.exchangeRates[this.selectedCurrency] || 1;
        const symbols = { USD: '$', EUR: '€', GBP: '£', NGN: '₦' };
        const value = usd * rate;
        if (this.selectedCurrency === 'NGN') {
            return symbols[this.selectedCurrency] + value.toFixed(0);
        }
        return symbols[this.selectedCurrency] + value.toFixed(2);
    }

    cycleCurrency() {
        const currencies = ['USD', 'EUR', 'GBP', 'NGN'];
        const idx = (currencies.indexOf(this.selectedCurrency) + 1) % currencies.length;
        this.selectedCurrency = currencies[idx];
        localStorage.setItem('vgallery_currency', this.selectedCurrency);
        if (this.el.currencyDisplay) this.el.currencyDisplay.textContent = this.selectedCurrency;
        this.updateDisplay();
    }

    toggleZoom() {
        if (this.zoomActive) {
            this.removeZoom();
        } else {
            this.el.splitContainer.classList.add('zoom-mode');
            this.zoomActive = true;
            this.variationIndex = 0;
            const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations];

            const dots = document.createElement('div');
            dots.className = 'variation-dots';
            for (let i = 0; i < allImages.length; i++) {
                const d = document.createElement('div');
                d.className = 'dot' + (i === 0 ? ' active' : '');
                d.onclick = (function (idx) {
                    return function () {
                        this.variationIndex = idx;
                        this.el.mainImage.src = allImages[idx];
                        const allDots = document.querySelectorAll('.variation-dots .dot');
                        for (let j = 0; j < allDots.length; j++) {
                            allDots[j].classList.toggle('active', j === idx);
                        }
                    }.bind(this);
                }.bind(this))(i);
                dots.appendChild(d);
            }
            document.body.appendChild(dots);

            const zoomHandler = () => {
                const all = [this.products[this.currentIndex].image_url, ...this.currentVariations];
                this.variationIndex = (this.variationIndex + 1) % all.length;
                this.el.mainImage.src = all[this.variationIndex];
                const dotElements = document.querySelectorAll('.variation-dots .dot');
                for (let i = 0; i < dotElements.length; i++) {
                    dotElements[i].classList.toggle('active', i === this.variationIndex);
                }
            };
            this.el.productFrame.onclick = zoomHandler.bind(this);
        }
    }

    removeZoom() {
        this.el.splitContainer.classList.remove('zoom-mode');
        this.zoomActive = false;
        const dots = document.querySelector('.variation-dots');
        if (dots) dots.remove();
        this.el.productFrame.onclick = () => this.toggleZoom();
        this.updateDisplay();
    }

    async toggleSave() {
        const p = this.products[this.currentIndex];
        if (this.savedItems.has(p.product_id)) {
            this.savedItems.delete(p.product_id);
            this.showNotification('Removed from saved');
        } else {
            this.savedItems.add(p.product_id);
            this.showNotification('Saved to collection');
        }
        localStorage.setItem('vgallery_saved', JSON.stringify([...this.savedItems]));
        this.updateDisplay();

        try {
            await fetch('/.netlify/functions/toggle-like', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: p.product_id, sessionId: this.sessionId })
            });
        } catch (e) {}
    }

    nextProduct() {
        if (this.currentIndex < this.products.length - 1) {
            this.currentIndex++;
            this.updateDisplay();
        }
    }

    prevProduct() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateDisplay();
        }
    }

    async shareProduct() {
        try {
            if (typeof html2canvas !== 'undefined') {
                const canvas = await html2canvas(this.el.splitContainer, { scale: 2 });
                const link = document.createElement('a');
                link.download = 'v-gallery-share.png';
                link.href = canvas.toDataURL();
                link.click();
                this.showNotification('Screenshot saved');
            } else {
                this.showNotification('Share feature ready');
            }
        } catch (e) {
            this.showNotification('Share unavailable');
        }
    }

    openCheckout() {
        const p = this.products[this.currentIndex];
        if (p.stock <= 0) {
            this.showNotification('Sold out');
            return;
        }
        this.checkoutQuantity = 1;
        this.selectedPaymentProvider = 'paystack';
        if (this.el.bankDetailsPanel) this.el.bankDetailsPanel.classList.remove('active');
        document.querySelectorAll('input[name="paymentProvider"]').forEach(r => { r.checked = r.value === 'paystack'; });
        document.querySelectorAll('.payment-method-option').forEach(o => o.classList.toggle('selected', o.querySelector('input').value === 'paystack'));

        const previewDiv = document.getElementById('checkoutProductPreview');
        if (previewDiv) {
            const thumbHtml = p.image_url
                ? '<img src="' + Utils.escapeAttr(p.image_url) + '" style="width:80px; height:80px; object-fit:cover; border-radius:4px;">'
                : '<div style="width:80px; height:80px; border-radius:4px; background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:11px; color:#888;">Text</div>';
            previewDiv.innerHTML = '<div style="display:flex; gap:15px; align-items:center;">' + thumbHtml + '<div><strong>' + Utils.escapeHtml(p.title) + '</strong><br>' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div></div>';
        }
        const qtySpan = document.getElementById('checkoutQuantity');
        if (qtySpan) qtySpan.innerText = '1';
        this.updateCheckoutTotal();
        this.el.checkoutPanel.classList.add('active');
        this.el.checkoutOverlay.classList.add('active');
    }

    closeCheckout() {
        this.el.checkoutPanel.classList.remove('active');
        this.el.checkoutOverlay.classList.remove('active');
    }

    updateQuantity(delta) {
        const p = this.products[this.currentIndex];
        const newQty = this.checkoutQuantity + delta;
        if (newQty >= 1 && newQty <= p.stock) {
            this.checkoutQuantity = newQty;
            const qtySpan = document.getElementById('checkoutQuantity');
            if (qtySpan) qtySpan.innerText = this.checkoutQuantity;
            this.updateCheckoutTotal();
        }
    }

    updateCheckoutTotal() {
        const p = this.products[this.currentIndex];
        const shippingSelect = document.getElementById('checkoutShippingSelect');
        const isNGN = this.selectedCurrency !== 'USD';
        const standardRate = isNGN ? 5000 : 7;
        const expressRate = isNGN ? 12000 : 15;
        const shipping = shippingSelect ? (shippingSelect.value === 'standard' ? standardRate : expressRate) : standardRate;
        const total = (p.base_price * this.checkoutQuantity) + shipping;
        const totalSpan = document.getElementById('checkoutTotal');
        if (totalSpan) totalSpan.innerText = this.formatPrice(total);
    }

    selectPaymentProvider(provider) {
        this.selectedPaymentProvider = provider;
        document.querySelectorAll('.payment-method-option').forEach(o => {
            o.classList.toggle('selected', o.querySelector('input').value === provider);
        });
        if (this.el.bankDetailsPanel) this.el.bankDetailsPanel.classList.remove('active');
    }

    renderBankDetails(response) {
        const { bank_details, order_number, amount, currency, whatsapp_number } = response;

        if (this.el.bankLocalDetails) {
            const l = bank_details.local;
            this.el.bankLocalDetails.innerHTML =
                `Bank: ${Utils.escapeHtml(l.bank_name)}<br>` +
                `Account #: ${Utils.escapeHtml(l.account_number)}<br>` +
                `Account name: ${Utils.escapeHtml(l.account_name)}`;
        }
        if (this.el.bankDomDetails) {
            const d = bank_details.domiciliary;
            this.el.bankDomDetails.innerHTML =
                `Bank: ${Utils.escapeHtml(d.bank_name)}<br>` +
                `Account #: ${Utils.escapeHtml(d.account_number)}<br>` +
                `Account name: ${Utils.escapeHtml(d.account_name)}<br>` +
                `SWIFT: ${Utils.escapeHtml(d.swift_code)}`;
        }
        if (this.el.bankRefNumber) this.el.bankRefNumber.textContent = order_number;
        if (this.el.bankDetailsPanel) this.el.bankDetailsPanel.classList.add('active');

        this.lastBankOrder = { order_number, amount, currency };

        if (this.el.whatsappProofBtn && whatsapp_number) {
            this.el.whatsappProofBtn.onclick = () => {
                const message = encodeURIComponent(
                    `Hi V. Gallery, I've sent payment for order ${order_number} ` +
                    `(${amount} ${currency}). Attaching proof of transfer.`
                );
                window.open(`https://wa.me/${whatsapp_number}?text=${message}`, '_blank');
            };
        }

        this.showNotification('Order created — see bank details below. Order #: ' + order_number);
    }

    async processPayment() {
        const p = this.products[this.currentIndex];
        const email = document.getElementById('checkoutEmail').value;
        const name = document.getElementById('checkoutName').value;

        if (!email || !name) {
            this.showNotification('Please fill email and name');
            return;
        }

        const providerInput = document.querySelector('input[name="paymentProvider"]:checked');
        const paymentProvider = providerInput ? providerInput.value : 'paystack';
        const currency = paymentProvider === 'flutterwave' ? this.selectedCurrency : 'NGN';

        this.showLoading(true);
        try {
            const response = await fetch('/.netlify/functions/initialize-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    name: name,
                    phone: document.getElementById('checkoutPhone')?.value || '',
                    productId: p.product_id,
                    quantity: this.checkoutQuantity,
                    shippingMethod: document.getElementById('checkoutShippingSelect')?.value || 'standard',
                    address: document.getElementById('checkoutAddress')?.value || '',
                    city: '',
                    zip: '',
                    paymentProvider: paymentProvider,
                    currency: currency,
                    discountCode: document.getElementById('checkoutDiscountCode')?.value?.trim() || ''
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Payment failed');
            }

            if (data.provider === 'bank_transfer') {
                this.renderBankDetails(data);
            } else if (data.authorization_url) {
                // Paystack / Flutterwave hosted checkout — redirect there.
                window.location.href = data.authorization_url;
            } else {
                this.showNotification('Order created! Order #: ' + data.order_number);
                this.closeCheckout();
            }
        } catch (e) {
            this.showNotification(e.message);
        } finally {
            this.showLoading(false);
        }
    }

    openGrid() {
        this.renderGrid('all');
        this.el.gridOverlay.classList.add('active');
    }

    closeGrid() {
        this.el.gridOverlay.classList.remove('active');
    }

    renderGrid(filter) {
        let filtered = this.products;
        if (filter === 'saved') {
            filtered = this.products.filter(p => this.savedItems.has(p.product_id));
        } else if (filter !== 'all') {
            filtered = this.products.filter(p => p.type === filter);
        }

        let html = '';
        for (let i = 0; i < filtered.length; i++) {
            const p = filtered[i];
            const kind = p.media_kind || (p.type === 'text' ? 'text' : 'image');
            let thumb;
            if (kind === 'video') {
                thumb = '<video src="' + Utils.escapeAttr(p.image_url) + '" muted loop playsinline></video>';
            } else if (kind === 'text') {
                thumb = '<div class="grid-item-text-thumb">' + Utils.escapeHtml((p.content || p.title || '').slice(0, 60)) + '</div>';
            } else {
                thumb = '<img src="' + Utils.escapeAttr(p.image_url) + '" loading="lazy" alt="' + Utils.escapeAttr(p.title) + '">';
            }
            html += '<div class="grid-item" data-action="view-product" data-id="' + Utils.escapeAttr(p.product_id) + '" tabindex="0" role="button">' +
                thumb +
                '<div class="grid-item-info">' + Utils.escapeHtml(p.title) + '<br>' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div>' +
                '</div>';
        }
        if (this.el.gridContainer) this.el.gridContainer.innerHTML = html;

        const filterBtns = document.querySelectorAll('.filter-btn');
        for (let i = 0; i < filterBtns.length; i++) {
            filterBtns[i].classList.toggle('active', filterBtns[i].dataset.filter === filter);
        }
    }

    viewProduct(productId) {
        const idx = this.products.findIndex(p => p.product_id === productId);
        if (idx !== -1) {
            this.currentIndex = idx;
            this.updateDisplay();
            this.closeGrid();
        }
    }

    filterGrid(filter) {
        this.renderGrid(filter);
    }

    showIntro() {
        if (this.el.introOverlay) this.el.introOverlay.classList.remove('hidden');
        if (this.el.splitContainer) this.el.splitContainer.classList.remove('active');
    }

    enterGallery() {
        if (this.el.introOverlay) this.el.introOverlay.classList.add('hidden');
        setTimeout(() => {
            if (this.el.splitContainer) this.el.splitContainer.classList.add('active');
        }, 300);
    }

    showLoading(show) {
        if (this.el.loading) this.el.loading.classList.toggle('active', show);
    }

    showNotification(message) {
        if (this.el.notification) {
            this.el.notification.textContent = message;
            this.el.notification.classList.add('active');
            setTimeout(() => {
                if (this.el.notification) this.el.notification.classList.remove('active');
            }, 4000);
        }
    }

    setupEvents() {
        if (this.el.prevBtn) this.el.prevBtn.onclick = () => this.prevProduct();
        if (this.el.nextBtn) this.el.nextBtn.onclick = () => this.nextProduct();
        if (this.el.heartButton) this.el.heartButton.onclick = () => this.toggleSave();
        if (this.el.cartButton) this.el.cartButton.onclick = () => this.openCheckout();
        if (this.el.shareButton) this.el.shareButton.onclick = () => this.shareProduct();
        if (this.el.currencyDisplay) this.el.currencyDisplay.onclick = () => this.cycleCurrency();
        if (this.el.productFrame) this.el.productFrame.onclick = () => this.toggleZoom();
        if (this.el.galleryBrand) this.el.galleryBrand.ondblclick = () => document.body.classList.toggle('dark-mode');

        const siteLogo = document.getElementById('siteLogo');
        if (siteLogo) siteLogo.onclick = () => this.showIntro();

        const gridIcon = document.getElementById('gridIconTop');
        if (gridIcon) gridIcon.onclick = () => this.openGrid();

        const shippingSelect = document.getElementById('checkoutShippingSelect');
        if (shippingSelect) shippingSelect.onchange = () => this.updateCheckoutTotal();

        document.querySelectorAll('input[name="paymentProvider"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.selectPaymentProvider(e.target.value));
        });

        const filterBtns = document.querySelectorAll('.filter-btn');
        for (let i = 0; i < filterBtns.length; i++) {
            filterBtns[i].onclick = () => this.filterGrid(filterBtns[i].dataset.filter);
        }

        // CSP-friendly event delegation for all data-action elements (no inline onclick=)
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            switch (action) {
                case 'close-grid':
                    this.closeGrid();
                    break;
                case 'close-checkout-overlay':
                    if (e.target === target) this.closeCheckout();
                    break;
                case 'qty-dec':
                    this.updateQuantity(-1);
                    break;
                case 'qty-inc':
                    this.updateQuantity(1);
                    break;
                case 'place-order':
                    this.processPayment();
                    break;
                case 'close-checkout':
                    this.closeCheckout();
                    break;
                case 'view-product':
                    this.viewProduct(target.dataset.id);
                    break;
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const target = e.target.closest('[data-action="view-product"]');
            if (!target) return;
            e.preventDefault();
            this.viewProduct(target.dataset.id);
        });
    }

    setupSwipe() {
        let startX = 0;
        let startY = 0;
        document.addEventListener('touchstart', (e) => {
            if (this.el.checkoutPanel?.classList.contains('active') || this.el.gridOverlay?.classList.contains('active')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        document.addEventListener('touchend', (e) => {
            if (this.el.checkoutPanel?.classList.contains('active') || this.el.gridOverlay?.classList.contains('active')) return;
            const diffX = e.changedTouches[0].clientX - startX;
            const diffY = e.changedTouches[0].clientY;
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                if (diffX > 0) {
                    this.prevProduct();
                } else {
                    this.nextProduct();
                }
            }
        });
    }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new HybridApp();
    window.app = app;
});
