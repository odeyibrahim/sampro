class HybridApp {
    constructor() {
        this.products = [];
        this.currentIndex = 0;
        this.savedItems = new Set();
        this.selectedCurrency = 'NGN';  // Default: Naira (matches store base)
        this.exchangeRates = { NGN: 1, USD: 0.000667, EUR: 0.000613, GBP: 0.000527 };  // NGN-centric (matches server)
        this.cart = [];  // [{ productId, quantity, addedAt }]
        this.cartOpen = false;
        this.checkoutRevealed = false;
        this.shippingZones = {};  // { 'NG:NGN': { standard: { cost, estimated_days }, express: ... } }
        this.shippingCountries = [];  // [{ code, name }]
        this.selectedCountry = '';
        this.ratesSource = 'fallback';  // 'live' | 'cached' | 'manual' | 'fallback'
        this.storeCountryCode = '';  // Store's base country (from admin settings)
        this.localTaxRate = 0.075;  // Default 7.5%, overridden by admin settings
        // Display labels for internal type values.
        // Used in grid items and anywhere type is shown to visitors.
        // 'text' is omitted — text products are identified by media_kind,
        // not type, so they never show a type badge.
        this.TYPE_LABELS = {
            original: 'Original',
            print: 'Print',
            merch: 'Product',
            craft: 'Handmade'
        };
        this.zoomActive = false;
        this.expandedActive = false;
        this.variationIndex = 0;
        this.currentVariations = [];
        this._displayTimer = null;
        this._variationDots = null;
        this.selectedPaymentProvider = 'paystack';
        this.lastBankOrder = null;
        this.gridDetailsVisible = true;
        this.doubleTapTimer = null;
        this._activeCollection = null;
        this.deferredInstallPrompt = null;
        this.sessionId = localStorage.getItem('session_id') || 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem('session_id', this.sessionId);
        this._loadCart();
        this.init();
    }

    async init() {
        this.bindElements();
        // CURRENCY FIX: Load currency preference BEFORE products render,
        // so the first updateDisplay() shows the correct currency.
        this.loadCurrency();
        this.loadSaved();
        this._updateCartBadge();
        // CURRENCY FIX: Load admin settings (which include exchange rates)
        // BEFORE fetching live rates, so admin-configured rates aren't
        // overwritten by a slower async fetch.
        await this.loadStoreSettings();
        await this.loadProducts();
        // CURRENCY FIX: Only fetch live rates if admin hasn't disabled them.
        // This runs AFTER loadStoreSettings so _liveRatesEnabled is set.
        this.fetchCurrencyRates();
        this.fetchShippingZones();
        this.setupEvents();
        this.setupSwipe();
        this.setupPwa();
        this.setupAdminSync();
        this.updateOfflineBanner();
        const enterBtn = document.getElementById('enterGalleryBtn');
        if (enterBtn) enterBtn.onclick = () => this.enterGallery();
        this.setRandomVerse();
        this.showIntro();
    }

    async loadStoreSettings() {
        try {
            const res = await fetch('/.netlify/functions/get-settings');
            if (!res.ok) return;
            const settings = await res.json();
            const siteLogo = document.getElementById('siteLogo');
            const logoSize = parseInt(settings.logo_size) || 36;
            if (siteLogo && settings.logo_url) {
                siteLogo.innerHTML = '';
                const img = document.createElement('img');
                img.src = settings.logo_url;
                img.alt = settings.store_name || 'Store logo';
                img.style.cssText = 'max-height:' + logoSize + 'px; max-width:' + Math.round(logoSize * 3.3) + 'px; object-fit:contain; display:block;';
                siteLogo.appendChild(img);
            } else if (siteLogo && !settings.logo_url) {
                const textEl = siteLogo.querySelector('.logo-text');
                if (textEl) textEl.style.fontSize = logoSize + 'px';
            }
            if (settings.store_name) {
                document.title = settings.store_name + ' \u00b7 Art + Commerce';
                // Update visible brand element in bottom nav
                var brandEl = document.getElementById('galleryBrand');
                if (brandEl) brandEl.textContent = settings.store_name.toLowerCase().replace(/\s+/g, '.');
            }
            // Load admin-configured exchange rates
            if (settings.exchange_rates) {
                try {
                    const rates = JSON.parse(settings.exchange_rates);
                    if (rates && typeof rates === 'object') {
                        Object.keys(rates).forEach(function (c) {
                            if (typeof rates[c] === 'number' && rates[c] > 0) {
                                this.exchangeRates[c] = rates[c];
                            }
                        }.bind(this));
                    }
                } catch (e) {}
            }
            // Apply backdrop / background customisation from admin settings
            this.applyBackdropSettings(settings);
            // Store base country for shipping calculations
            if (settings.store_country) {
                this.storeCountryCode = settings.store_country.toLowerCase();
            }
            // Store local tax rate (percentage, e.g. 7.5 means 7.5%)
            if (settings.local_tax_rate !== undefined && settings.local_tax_rate !== null) {
                this.localTaxRate = parseFloat(settings.local_tax_rate) / 100;
            }
            // Store live_rates_enabled for the currency fetch
            this._liveRatesEnabled = settings.live_rates_enabled !== false;
            // If live rates are disabled, admin rates already loaded above are the final word
            if (!this._liveRatesEnabled) {
                this.ratesSource = 'manual';
            }
        } catch (e) {
            // intentionally silent
        }
    }

    async fetchCurrencyRates() {
        // CURRENCY FIX: Skip entirely if admin has disabled live rates.
        // _liveRatesEnabled is set by loadStoreSettings() which now runs
        // before this method in init().
        if (this._liveRatesEnabled === false) return;
        // Admin-configured rates were already applied in loadStoreSettings().
        try {
            const res = await fetch('/.netlify/functions/get-currency-rates');
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.rates && typeof data.rates === 'object') {
                Object.keys(data.rates).forEach(function (c) {
                    if (typeof data.rates[c] === 'number' && data.rates[c] > 0) {
                        this.exchangeRates[c] = data.rates[c];
                    }
                }.bind(this));
                this.ratesSource = data.source || 'fallback';
                this.updateDisplay();
                if (this.el.checkoutPanel && this.el.checkoutPanel.classList.contains('active')) {
                    this.updateCheckoutTotals();
                }
            }
        } catch (e) {
            // silent — hardcoded/admin rates still work
        }
    }

    async fetchShippingZones() {
        try {
            const res = await fetch('/.netlify/functions/get-shipping-zones');
            if (!res.ok) return;
            const data = await res.json();
            if (data) {
                this.shippingZones = data.zones || {};
                this.shippingCountries = data.countries || [];
            }
        } catch (e) {
            // silent — fallback shipping still works
        }
    }

    // ====== Mini-cart system ======

    _loadCart() {
        try {
            const saved = localStorage.getItem('vgallery_cart');
            if (saved) this.cart = JSON.parse(saved);
        } catch (e) {}
    }

    _saveCart() {
        try {
            localStorage.setItem('vgallery_cart', JSON.stringify(this.cart));
        } catch (e) {}
    }

    _cartCount() {
        return this.cart.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    }

    _findCartItem(productId) {
        for (let i = 0; i < this.cart.length; i++) {
            if (this.cart[i].productId === productId) return this.cart[i];
        }
        return null;
    }

    _findProductById(id) {
        for (let i = 0; i < this.products.length; i++) {
            if (this.products[i].product_id === id) return this.products[i];
        }
        return null;
    }

    addToCart() {
        const p = this.products[this.currentIndex];
        if (!p || p.stock <= 0) {
            this.showNotification('Sold out');
            return;
        }
        const existing = this._findCartItem(p.product_id);
        if (existing) {
            if (existing.quantity < p.stock) {
                existing.quantity++;
                this.showNotification(p.title + ' quantity updated');
            } else {
                this.showNotification('Max stock reached');
                return;
            }
        } else {
            this.cart.push({ productId: p.product_id, quantity: 1, addedAt: Date.now() });
            this.showNotification(p.title + ' added to cart');
        }
        this._saveCart();
        this._updateCartBadge();
        // Open cart panel so user sees the item
        this.openCart();
    }

    removeFromCart(productId) {
        this.cart = this.cart.filter(function (item) { return item.productId !== productId; });
        this._saveCart();
        this._updateCartBadge();
        this.renderCartItems();
    }

    updateCartQty(productId, delta) {
        const item = this._findCartItem(productId);
        const p = this._findProductById(productId);
        if (!item || !p) return;
        const newQty = item.quantity + delta;
        if (newQty < 1) {
            this.removeFromCart(productId);
            return;
        }
        if (newQty > p.stock) {
            this.showNotification('Max stock reached');
            return;
        }
        item.quantity = newQty;
        this._saveCart();
        this.renderCartItems();
    }

    _updateCartBadge() {
        const btn = this.el.cartButton;
        if (!btn) return;
        const count = this._cartCount();
        // Remove old badge
        const old = btn.querySelector('.cart-badge');
        if (old) old.remove();
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'cart-badge';
            badge.textContent = count > 9 ? '9+' : count;
            btn.appendChild(badge);
        }
    }

    getCartSubtotal() {
        let subtotal = 0;
        for (let i = 0; i < this.cart.length; i++) {
            const p = this._findProductById(this.cart[i].productId);
            if (p) subtotal += p.base_price * this.cart[i].quantity;
        }
        return subtotal;
    }

    getShippingInfo() {
        // Determine shipping based on address country vs store country
        const countryInput = document.getElementById('checkoutCountryInput');
        const customerCountry = (countryInput && countryInput.value.trim().toLowerCase()) || '';
        const storeCountry = (this.storeCountryCode || 'nigeria').toLowerCase();
        const isLocal = customerCountry.length > 0 && storeCountry.indexOf(customerCountry) !== -1;
        const currency = this.selectedCurrency;

        // Try zones first
        if (this.shippingZones && Object.keys(this.shippingZones).length > 0 && customerCountry) {
            // Find a matching zone key
            const keys = Object.keys(this.shippingZones);
            for (let i = 0; i < keys.length; i++) {
                if (keys[i].indexOf(':') !== -1 && keys[i].toLowerCase().indexOf(customerCountry) !== -1) {
                    const zone = this.shippingZones[keys[i]];
                    if (zone.standard) return zone.standard;
                    const firstMethod = Object.keys(zone)[0];
                    if (firstMethod) return zone[firstMethod];
                }
            }
        }

        // Fallback defaults
        if (currency === 'NGN') {
            return isLocal
                ? { cost: 5000, estimated_days: '3-5' }
                : { cost: 15000, estimated_days: '1-2 weeks' };
        }
        return isLocal
            ? { cost: 7, estimated_days: '3-5' }
            : { cost: 25, estimated_days: '1-2 weeks' };
    }

    getTaxRate() {
        const countryInput = document.getElementById('checkoutCountryInput');
        const customerCountry = (countryInput && countryInput.value.trim().toLowerCase()) || '';
        const storeCountry = (this.storeCountryCode || 'nigeria').toLowerCase();
        if (customerCountry.length > 0 && storeCountry.indexOf(customerCountry) !== -1) return this.localTaxRate;
        return 0;
    }

    openCart() {
        this.cartOpen = true;
        this.renderCartItems();
        this.el.checkoutPanel.classList.add('active');
        this.el.checkoutOverlay.classList.add('active');
    }

    closeCart() {
        this.cartOpen = false;
        this.checkoutRevealed = false;
        this.el.checkoutPanel.classList.remove('active');
        this.el.checkoutOverlay.classList.remove('active');
        // Reset accordion state
        const accordion = document.getElementById('checkoutAccordion');
        if (accordion) accordion.style.display = 'none';
        const revealBtn = document.getElementById('checkoutRevealBtn');
        if (revealBtn) revealBtn.style.display = 'none';
        // Collapse all accordion bodies
        document.querySelectorAll('.accordion-body').forEach(function (body) {
            body.style.maxHeight = null;
            body.classList.remove('open');
        });
        document.querySelectorAll('.accordion-arrow').forEach(function (arrow) {
            arrow.textContent = '▸';
        });
    }

    renderCartItems() {
        const listEl = document.getElementById('cartItemsList');
        const emptyEl = document.getElementById('cartEmpty');
        const subtotalEl = document.getElementById('cartSubtotal');
        const itemsSection = document.getElementById('cartItemsSection');
        const revealBtn = document.getElementById('checkoutRevealBtn');

        if (!listEl) return;

        if (this.cart.length === 0) {
            listEl.innerHTML = '';
            if (itemsSection) itemsSection.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
            if (revealBtn) revealBtn.style.display = 'none';
            // Hide checkout accordion when cart becomes empty
            const accordion = document.getElementById('checkoutAccordion');
            if (accordion) accordion.style.display = 'none';
            this.checkoutRevealed = false;
            return;
        }

        if (itemsSection) itemsSection.style.display = 'block';
        if (emptyEl) emptyEl.style.display = 'none';
        if (revealBtn) revealBtn.style.display = 'block';

        let html = '';
        for (let i = 0; i < this.cart.length; i++) {
            const item = this.cart[i];
            const p = this._findProductById(item.productId);
            if (!p) continue;
            const thumbHtml = p.image_url
                ? '<img src="' + Utils.escapeAttr(p.image_url) + '" alt="' + Utils.escapeAttr(p.title) + '">'
                : '<div class="cart-item-text-thumb">Text</div>';
            html += '<div class="cart-item" data-product-id="' + Utils.escapeAttr(p.product_id) + '">' +
                '<div class="cart-item-thumb">' + thumbHtml + '</div>' +
                '<div class="cart-item-details">' +
                    '<div class="cart-item-title">' + Utils.escapeHtml(p.title) + '</div>' +
                    '<div class="cart-item-price">' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div>' +
                    '<div class="cart-item-qty">' +
                        '<button class="quantity-btn" data-action="cart-qty-dec" data-pid="' + Utils.escapeAttr(p.product_id) + '" type="button" aria-label="Decrease quantity">−</button>' +
                        '<span class="cart-qty-value">' + item.quantity + '</span>' +
                        '<button class="quantity-btn" data-action="cart-qty-inc" data-pid="' + Utils.escapeAttr(p.product_id) + '" type="button" aria-label="Increase quantity">+</button>' +
                    '</div>' +
                '</div>' +
                '<button class="cart-item-remove" data-action="cart-remove" data-pid="' + Utils.escapeAttr(p.product_id) + '" type="button" aria-label="Remove">✕</button>' +
            '</div>';
        }
        listEl.innerHTML = html;

        if (subtotalEl) subtotalEl.innerText = this.formatPrice(this.getCartSubtotal());

        // If checkout was already revealed, update totals there too
        if (this.checkoutRevealed) this.updateCheckoutTotals();
    }

    revealCheckout() {
        if (this.cart.length === 0) return;
        this.checkoutRevealed = true;
        const accordion = document.getElementById('checkoutAccordion');
        if (accordion) {
            accordion.style.display = 'block';
            // Open shipping section first (user fills address, then totals auto-calculate)
            this.toggleAccordion('accordionShippingBody');
        }
        const revealBtn = document.getElementById('checkoutRevealBtn');
        if (revealBtn) revealBtn.style.display = 'none';
        this.updateCheckoutTotals();
    }

    toggleAccordion(bodyId) {
        const body = document.getElementById(bodyId);
        if (!body) return;
        const section = body.closest('.accordion-section');
        const arrow = section ? section.querySelector('.accordion-arrow') : null;
        if (body.classList.contains('open')) {
            body.style.maxHeight = null;
            body.classList.remove('open');
            if (arrow) arrow.textContent = '▸';
        } else {
            body.classList.add('open');
            body.style.maxHeight = body.scrollHeight + 'px';
            if (arrow) arrow.textContent = '▾';
        }
    }

    updateCheckoutTotals() {
        const subtotal = this.getCartSubtotal();
        const shippingInfo = this.getShippingInfo();
        const shipping = shippingInfo.cost || 0;
        const taxRate = this.getTaxRate();
        const tax = Math.round(subtotal * taxRate * 100) / 100;
        const total = subtotal + shipping + tax;

        const subtotalEl = document.getElementById('checkoutSubtotal');
        const shippingEl = document.getElementById('checkoutShipping');
        const taxEl = document.getElementById('checkoutTax');
        const totalEl = document.getElementById('checkoutTotal');

        if (subtotalEl) subtotalEl.innerText = this.formatPrice(subtotal);
        if (shippingEl) {
            let shipLabel = this.formatPrice(shipping);
            if (shippingInfo.estimated_days) {
                shipLabel += ' (' + shippingInfo.estimated_days + ')';
            }
            shippingEl.innerText = shipLabel;
        }
        if (taxEl) taxEl.innerText = this.formatPrice(tax);
        if (totalEl) totalEl.innerText = this.formatPrice(total);
    }

    showLegalModal(type) {
        const overlay = document.getElementById('legalModalOverlay');
        const modal = document.getElementById('legalModal');
        const title = document.getElementById('legalModalTitle');
        const body = document.getElementById('legalModalBody');
        if (!overlay || !modal || !title || !body) return;

        if (type === 'terms') {
            title.textContent = 'Terms of Service';
            body.innerHTML = '<div class="legal-poem">' +
                '<p>By placing an order through V. Gallery, you enter into an agreement governed by these terms. Please read carefully before proceeding.</p>' +
                '<p>All products are described as accurately as possible; however, original artworks and handmade items may carry slight, unique variations — each piece is singular by nature.</p>' +
                '<p>Digital prints are produced on archival-quality paper, designed to preserve colour and detail for generations.</p>' +
                '<p>Orders are processed within one to three business days. Shipping times vary by destination — local deliveries typically arrive within three to five business days, while international orders may take one to two weeks.</p>' +
                '<p>Returns are accepted within seven days of delivery, and only for items that arrive damaged or incorrect. Refunds are processed to the original payment method within five to ten business days.</p>' +
                '<p>V. Gallery reserves the right to refuse service at its discretion. All content, images, and designs displayed on this platform are the intellectual property of V. Gallery and may not be reproduced, distributed, or used without written permission.</p>' +
                '</div>';
        } else {
            title.textContent = 'Privacy Policy';
            body.innerHTML = '<div class="legal-poem">' +
                '<p>V. Gallery collects only the information necessary to process your order — your name, email, shipping address, and payment details.</p>' +
                '<p>Payment information is handled securely through our providers, Paystack and Flutterwave, and is never stored on our servers. We do not sell, share, or distribute your personal data to third parties for marketing purposes.</p>' +
                '<p>Your email may be used solely to send order updates and nothing more. We employ industry-standard security measures to safeguard your information at every step.</p>' +
                '<p>By using this site, you consent to the collection and use of your information as described herein. You may request the deletion of your data at any time by contacting us directly.</p>' +
                '</div>';
        }

        overlay.classList.add('active');
        modal.classList.add('active');
    }

    closeLegalModal() {
        const overlay = document.getElementById('legalModalOverlay');
        const modal = document.getElementById('legalModal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');
    }

    applyBackdropSettings(settings) {
        const root = document.documentElement;
        const productHalf = document.getElementById('productHalf');
        const infoHalf = document.getElementById('infoHalf');
        const contentWrapper = document.getElementById('contentWrapper');
        const bottomNav = document.querySelector('.bottom-nav');

        var color1 = settings.bg_color1 || '';
        var color2 = settings.bg_color2 || '';
        var bgImage = settings.bg_image || '';
        var bgHalf = settings.bg_half || ''; // 'top', 'bottom', or 'both'

        // Determine which halves get custom backgrounds
        var applyTop = !bgHalf || bgHalf === 'top' || bgHalf === 'both';
        var applyBottom = !bgHalf || bgHalf === 'bottom' || bgHalf === 'both';

        // Build background CSS value
        function buildBg(c1, c2, img) {
            if (img) {
                return 'url(' + img + ') center/cover no-repeat';
            }
            if (c1 && c2 && c1 !== c2) {
                return 'linear-gradient(135deg, ' + c1 + ', ' + c2 + ')';
            }
            if (c1) return c1;
            return '';
        }

        // Tier 3c: image only once (product half), colors for everything else
        var topBg = applyTop ? buildBg(color1, color2, bgImage) : '';
        var bottomBg = applyBottom ? buildBg(color1, color2, '') : ''; // colors only, no image repeat

        // Apply to product half (top)
        if (productHalf && topBg) {
            productHalf.style.background = topBg;
        }
        // Apply to info half (bottom)
        if (infoHalf && bottomBg) {
            infoHalf.style.background = bottomBg;
        }
        // Sync CSS variables — set on BOTH :root and body so they
        // override the body.dark-mode stylesheet rule (inline > stylesheet).
        if (color1) {
            root.style.setProperty('--bg-top', color1);
            root.style.setProperty('--bg-bottom', color1);
            document.body.style.setProperty('--bg-top', color1);
            document.body.style.setProperty('--bg-bottom', color1);
        }
        // Keep bottom-nav background in sync with the info half
        if (bottomNav && bottomBg) {
            bottomNav.style.background = bottomBg;
            bottomNav.style.backdropFilter = 'none';
        }

        // Tier 3a: Auto-contrast for nav icons and brand text against dark backgrounds
        this._applyNavContrast(color1, color2, bottomNav);
    }

    // Determine whether a background colour is "dark" (perceived luminance < 0.4)
    _isDarkColor(hex) {
        if (!hex || hex.charAt(0) !== '#') return false;
        var c = hex.replace('#', '');
        if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
        if (c.length !== 6) return false;
        var r = parseInt(c.substr(0,2),16)/255;
        var g = parseInt(c.substr(2,2),16)/255;
        var b = parseInt(c.substr(4,2),16)/255;
        var lum = 0.2126*r + 0.7152*g + 0.0722*b;
        return lum < 0.4;
    }

    _applyNavContrast(c1, c2, navEl) {
        // Sample the first colour (or second if first is missing)
        var sample = c1 || c2;
        if (!sample) return; // nothing custom applied, keep defaults

        var dark = this._isDarkColor(sample);
        var navColor = dark ? '#ffffff' : '';
        var arrowColor = dark ? 'rgba(255,255,255,0.7)' : '';
        var pageColor = dark ? 'rgba(255,255,255,0.6)' : '';

        // Brand text
        var brand = document.getElementById('galleryBrand');
        if (brand) brand.style.color = navColor;

        // Arrow buttons and page indicator
        var arrows = document.querySelectorAll('.arrow-btn');
        arrows.forEach(function(btn) { btn.style.color = arrowColor; });
        var pageInd = document.getElementById('pageIndicator');
        if (pageInd) pageInd.style.color = pageColor;

        // Nav container
        if (navEl) navEl.style.color = navColor;
    }

    // ---- SEO URL routing ----
    // Reads /product/:slug from the URL bar, finds the matching
    // product, and navigates to it.  Falls back to index 0.
    _routeFromUrl() {
        const match = window.location.pathname.match(/^\/product\/([\w\-]+)$/);
        if (!match) return;
        const slug = decodeURIComponent(match[1]);
        const idx = this.products.findIndex(p => p.slug === slug);
        if (idx !== -1) {
            this.currentIndex = idx;
        }
    }

    // Push a SEO URL into the browser history without reload.
    // Called after every product navigation (next/prev/grid click).
    _pushProductUrl() {
        const p = this.products[this.currentIndex];
        if (!p) return;
        // Use slug if set, otherwise derive one from the title
        let slug = p.slug;
        if (!slug && p.title) {
            slug = p.title.toLowerCase().trim().replace(/[\s\W]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        }
        const url = slug ? '/product/' + encodeURIComponent(slug) : '/';
        const title = p.title ? (p.title + ' · ' + document.title.split('·').pop().trim()) : document.title;
        if (window.location.pathname !== url) {
            history.pushState({ index: this.currentIndex }, title, url);
        }
        document.title = title;
        this._updateOgTags(p);
    }

    // Update Open Graph meta tags for social sharing previews.
    _updateOgTags(p) {
        if (!p) return;
        const storeName = document.getElementById('galleryBrand');
        const brand = storeName ? storeName.textContent : 'V. Gallery';
        const setMeta = (prop, content) => {
            let el = document.querySelector('meta[property="' + prop + '"]');
            if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
            el.setAttribute('content', content || '');
        };
        setMeta('og:title', p.title + ' — ' + brand);
        setMeta('og:description', (p.description || '').substring(0, 160));
        setMeta('og:image', p.image_url || '');
        setMeta('og:type', 'product');
        setMeta('og:url', window.location.href);
    }

    // Handle back/forward button
    _onPopState(e) {
        if (e.state && typeof e.state.index === 'number') {
            this.currentIndex = e.state.index;
        } else {
            this._routeFromUrl();
        }
        this.renderImmediate();
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
        }
    }

    setupPwa() {
        this.registerServiceWorker();

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredInstallPrompt = e;
            const dismissed = sessionStorage.getItem('vgallery_install_dismissed');
            if (!dismissed && this.el.installToast) {
                this.el.installToast.classList.add('active');
            }
        });

        if (this.el.installConfirm) {
            this.el.installConfirm.onclick = async () => {
                this.el.installToast.classList.remove('active');
                if (this.deferredInstallPrompt) {
                    this.deferredInstallPrompt.prompt();
                    await this.deferredInstallPrompt.userChoice;
                    this.deferredInstallPrompt = null;
                }
            };
        }
        if (this.el.installDismiss) {
            this.el.installDismiss.onclick = () => {
                this.el.installToast.classList.remove('active');
                sessionStorage.setItem('vgallery_install_dismissed', '1');
            };
        }

        window.addEventListener('online', () => this.updateOfflineBanner());
        window.addEventListener('offline', () => this.updateOfflineBanner());
    }

    updateOfflineBanner() {
        if (this.el.offlineBanner) {
            this.el.offlineBanner.classList.toggle('active', !navigator.onLine);
        }
    }

    loadCurrency() {
        const saved = localStorage.getItem('vgallery_currency');
        if (saved) {
            this.selectedCurrency = saved;
        } else if (this.el.currencyDisplay && this.el.currencyDisplay.value) {
            // CURRENCY FIX: Respect the HTML <select> default (e.g. NGN selected
            // in the Nigeria build). Previously this was ignored entirely.
            this.selectedCurrency = this.el.currencyDisplay.value;
        }
        if (this.el.currencyDisplay) this.el.currencyDisplay.value = this.selectedCurrency;
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
            whatsappProofBtn: document.getElementById('whatsappProofBtn'),
            shareOverlay: document.getElementById('shareOverlay'),
            shareImage: document.getElementById('shareImage'),
            shareDownloadBtn: document.getElementById('shareDownloadBtn'),
            shareCloseBtn: document.getElementById('shareCloseBtn'),
            installToast: document.getElementById('installToast'),
            installConfirm: document.getElementById('installConfirm'),
            installDismiss: document.getElementById('installDismiss'),
            offlineBanner: document.getElementById('offlineBanner'),
            eyeToggle: document.getElementById('eyeToggle'),
            checkoutSubtotal: document.getElementById('checkoutSubtotal'),
            checkoutShipping: document.getElementById('checkoutShipping'),
            checkoutTax: document.getElementById('checkoutTax')
        };
    }

    async loadProducts(options) {
        options = options || {};
        this.showLoading(!options.silent);
        try {
            const url = '/.netlify/functions/get-products' + (options.noCache ? '?_t=' + Date.now() : '');
            const response = await fetch(url);
            const data = await response.json();
            if (data && data.length > 0) {
                this.products = data;
                // Sort by sort_order for correct page sequence
                this.products.sort(function(a, b) {
                    var oa = (a.sort_order || 0);
                    var ob = (b.sort_order || 0);
                    if (oa !== ob) return oa - ob;
                    return (a.created_at || 0) - (b.created_at || 0);
                });
            } else {
                throw new Error('No products from API');
            }
        } catch (e) {
            // Only use fallback data on initial load, not on admin sync refreshes
            if (!options.silent) {
                this.products = [
                    { product_id: '1', title: 'Archive Tee', author: 'V.', description: '100% cotton, screen printed by hand.\nLimited edition.', type: 'merch', base_price: 45, stock: 10, orientation: 'square', image_url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800', variations: [] },
                    { product_id: '2', title: 'Desert Landscape', author: 'V.', description: 'Archival photograph from the high desert.\nSigned and numbered.', type: 'print', base_price: 195, stock: 5, orientation: 'landscape', image_url: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800', variations: ['https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800'] },
                    { product_id: '3', title: 'Silent Currents', author: 'V.', description: 'Original mixed media on canvas, 2024.\nA unique piece.', type: 'original', base_price: 8500, stock: 1, orientation: 'portrait', image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800', variations: [] }
                ];
            }
        }
        this._routeFromUrl();
        this.updateDisplay();
        this.showLoading(false);
    }

    loadSaved() {
        const saved = localStorage.getItem('vgallery_saved');
        if (saved) {
            try { this.savedItems = new Set(JSON.parse(saved)); } catch (e) {}
        }
    }

    updateDisplay() {
        if (!this.products.length) return;
        const p = this.products[this.currentIndex];
        if (!p) return;

        // Cancel any pending transition timer to prevent stale callbacks
        if (this._displayTimer) { clearTimeout(this._displayTimer); this._displayTimer = null; }

        // Update variations FIRST so renderVariationDots uses current product's data
        this.currentVariations = p.variations || [];
        this.variationIndex = 0;

        // Render immediately — no opacity transition to prevent text-disappearing glitch
        this.renderMedia(p);
        this.renderText(p);
        this.renderFrame(p);
        this.renderBackgrounds(p);
        this.renderVariationDots();

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
            this.el.stockBadge.className = 'stock-badge';
            if (showStock) {
                if (p.stock <= 0) {
                    this.el.stockBadge.textContent = 'Sold Out';
                    this.el.stockBadge.classList.add('sold-out');
                } else if (p.stock <= 2) {
                    this.el.stockBadge.textContent = 'Low Stock (' + p.stock + ')';
                    this.el.stockBadge.classList.add('low-stock');
                } else {
                    this.el.stockBadge.textContent = '';
                }
            }
        }

        if (this.zoomActive) this.removeZoom();
    }

    renderMedia(p) {
        const kind = p.media_kind || (p.type === 'text' ? 'text' : 'image');
        const splitContainer = this.el.splitContainer;

        if (this.el.mainImage) {
            this.el.mainImage.classList.remove('loaded');
            this.el.mainImage.style.display = 'none';
        }
        if (this.el.mainVideo) {
            this.el.mainVideo.classList.remove('loaded');
            this.el.mainVideo.style.display = 'none';
            this.el.mainVideo.pause();
        }
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
                this.el.mainVideo.onloadeddata = () => this.el.mainVideo.classList.add('loaded');
                this.el.mainVideo.onerror = () => this.el.mainVideo.classList.add('loaded');
                if (p.video_autoplay !== false) this.el.mainVideo.play().catch(() => {});
            }
        } else {
            if (this.el.mainImage) {
                this.el.mainImage.style.display = 'block';
                this.el.mainImage.src = p.image_url || '';
                this.el.mainImage.alt = p.title || '';
                this.el.mainImage.onload = () => this.el.mainImage.classList.add('loaded');
                this.el.mainImage.onerror = () => this.el.mainImage.classList.add('loaded');
            }
        }
    }

    renderText(p) {
        const kind = p.media_kind || (p.type === 'text' ? 'text' : 'image');
        const isTextProduct = kind === 'text';

        if (this.el.productTitle) this.el.productTitle.textContent = p.title || '';

        // For text products, description becomes a subtitle under the title
        // when content exists as the body text.
        if (this.el.productCreator && isTextProduct && p.content && p.description) {
            this.el.productCreator.textContent = p.description;
            this.el.productCreator.style.fontStyle = 'normal';
            this.el.productCreator.style.fontSize = '12px';
            this.el.productCreator.style.opacity = '0.6';
        } else if (this.el.productCreator) {
            const showAuthor = p.show_author !== false;
            this.el.productCreator.style.display = showAuthor ? '' : 'none';
            this.el.productCreator.textContent = p.author || 'V.';
            this.el.productCreator.style.fontStyle = '';
            this.el.productCreator.style.fontSize = '';
            this.el.productCreator.style.opacity = '';
        }

        if (this.el.infoContainer) {
            // For text products with body content, always show body first (content-first)
            // unless explicitly set to title-first.
            let order;
            if (isTextProduct && p.content) {
                order = p.content_order === 'title-first' ? 'title-first' : 'description-first';
            } else {
                order = p.content_order === 'description-first' ? 'description-first' : 'title-first';
            }
            this.el.infoContainer.classList.toggle('order-description-first', order === 'description-first');
            this.el.infoContainer.classList.toggle('order-title-first', order === 'title-first');
        }

        if (this.el.descriptionText) {
            // In text-mode, content_order controls layout.
            // When kind is 'text', the description div shows the dedicated
            // content field (poems, prose, long text). Description is a
            // short caption shown as subtitle if content_order puts it first.
            const kind = p.media_kind || (p.type === 'text' ? 'text' : 'image');
            const bodyText = kind === 'text'
                ? (p.content || p.description || '')
                : (p.description || 'No description available.');
            this.el.descriptionText.textContent = bodyText;
            this.el.descriptionText.style.fontFamily = p.font_family || "'Copperplate', serif";
            // In text-mode, use the product's larger font for body text;
            // in image mode, keep the smaller info-panel font.
            const isTextMode = kind === 'text';
            this.el.descriptionText.style.fontSize = isTextMode
                ? (p.font_size || 16) + 'px'
                : (p.font_size || 11) + 'px';
            this.el.descriptionText.style.fontWeight = p.font_weight || (isTextMode ? 400 : 400);
            this.el.descriptionText.style.textTransform = p.text_transform || 'none';
            // In text-mode, use italic style for literary content
            this.el.descriptionText.style.fontStyle = isTextMode ? 'italic' : 'normal';
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

    formatPrice(basePrice) {  // basePrice is in the store's base currency (NGN)
        const rate = this.exchangeRates[this.selectedCurrency] || 1;
        const symbols = { USD: '$', EUR: '€', GBP: '£', NGN: '₦' };
        const value = basePrice * rate;
        if (this.selectedCurrency === 'NGN') {
            return symbols[this.selectedCurrency] + value.toFixed(0);
        }
        return symbols[this.selectedCurrency] + value.toFixed(2);
    }

    selectCurrency(currency) {
        if (!['USD', 'EUR', 'GBP', 'NGN'].includes(currency)) return;
        this.selectedCurrency = currency;
        localStorage.setItem('vgallery_currency', this.selectedCurrency);
        if (this.el.currencyDisplay) this.el.currencyDisplay.value = this.selectedCurrency;
        this.updateDisplay();
        if (this.el.checkoutPanel && this.el.checkoutPanel.classList.contains('active')) {
            this.updateCheckoutTotals();
        }
    }

    handleImageTap() {
        const p = this.products[this.currentIndex];
        if (p && (p.media_kind === 'text' || p.type === 'text')) return;

        const frame = this.el.productFrame;
        const isExpanded = frame && frame.classList.contains('expanded');

        if (this.doubleTapTimer) {
            clearTimeout(this.doubleTapTimer);
            this.doubleTapTimer = null;
            if (isExpanded) {
                // Double-tap in expanded mode: close expanded view
                this.toggleExpand();
                return;
            }
            this.toggleExpand();
            return;
        }
        this.doubleTapTimer = setTimeout(() => {
            this.doubleTapTimer = null;
            if (isExpanded) {
                // Single tap in expanded mode: cycle to next image
                const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
                if (allImages.length > 1) {
                    const next = (this.variationIndex + 1) % allImages.length;
                    this.showVariation(next);
                }
            } else {
                // Normal mode: if variations exist, cycle image; else zoom
                const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
                if (allImages.length > 1) {
                    const next = (this.variationIndex + 1) % allImages.length;
                    this.showVariation(next);
                } else {
                    this.toggleZoom();
                }
            }
        }, 280);
    }

    toggleZoom() {
        if (this.el.productFrame.classList.contains('expanded')) return;
        this.zoomActive = !this.zoomActive;
        this.el.productFrame.classList.toggle('zoom-active', this.zoomActive);
    }

    toggleExpand() {
        const frame = this.el.productFrame;
        frame.classList.remove('zoom-active');
        this.zoomActive = false;

        if (frame.classList.contains('expanded')) {
            frame.classList.remove('expanded');
            document.body.style.overflow = '';
            this.el.splitContainer.classList.remove('fullview-active');
            this.expandedActive = false;
            // Remove expanded thumbnails
            this.removeExpandedThumbnails();
            const p = this.products[this.currentIndex];
            if (p) this.renderFrame(p);
        } else {
            frame.classList.add('expanded');
            document.body.style.overflow = 'hidden';
            this.el.splitContainer.classList.add('fullview-active');
            this.expandedActive = true;
            // Show expanded thumbnails
            this.renderExpandedThumbnails();
        }
    }

    _isExpanded() {
        return this.el.productFrame && this.el.productFrame.classList.contains('expanded');
    }

    // Renders persistent variation indicator dots below the product frame.
    // Unlike zoom-mode dots, these are always visible when variations exist,
    // allowing image navigation without entering zoom.
    renderVariationDots() {
        // Remove previous dots
        if (this._variationDots) {
            this._variationDots.remove();
            this._variationDots = null;
        }

        const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
        if (allImages.length <= 1) return;

        const dots = document.createElement('div');
        dots.className = 'product-variation-dots';
        for (let i = 0; i < allImages.length; i++) {
            const d = document.createElement('div');
            d.className = 'pv-dot' + (i === this.variationIndex ? ' active' : '');
            d.setAttribute('role', 'button');
            d.setAttribute('aria-label', 'Image ' + (i + 1));
            d.tabIndex = 0;
            const idx = i;
            d.onclick = () => this.showVariation(idx);
            d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showVariation(idx); } };
            dots.appendChild(d);
        }

        // Insert after the frame-container
        const frameContainer = document.querySelector('.frame-container');
        if (frameContainer) {
            frameContainer.appendChild(dots);
        } else if (this.el.productHalf) {
            this.el.productHalf.appendChild(dots);
        }
        this._variationDots = dots;
    }

    showVariation(idx) {
        const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
        if (idx < 0 || idx >= allImages.length) return;
        this.variationIndex = idx;

        // Cross-fade the image
        const img = this.el.mainImage;
        if (img) {
            img.style.opacity = '0';
            setTimeout(() => {
                img.src = allImages[idx];
                img.onload = () => { img.style.opacity = ''; };
                img.onerror = () => { img.style.opacity = ''; };
            }, 150);
        }

        // Update dots (both persistent and zoom)
        const updateDots = (selector) => {
            const dots = document.querySelectorAll(selector);
            for (let j = 0; j < dots.length; j++) {
                dots[j].classList.toggle('active', j === idx);
            }
        };
        updateDots('.pv-dot');
        updateDots('.variation-dots .dot');

        // Update expanded thumbnails active state
        const thumbs = document.querySelectorAll('.expanded-thumb');
        for (let j = 0; j < thumbs.length; j++) {
            thumbs[j].classList.toggle('active', j === idx);
        }
    }

    removeZoom() {
        this.zoomActive = false;
        if (this.el.productFrame) this.el.productFrame.classList.remove('zoom-active');
        if (this._variationDots) this._variationDots.style.display = '';
        this.el.productFrame.onclick = () => this.handleImageTap();
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
            this._pushProductUrl();
        }
    }

    prevProduct() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateDisplay();
            this._pushProductUrl();
        }
    }

    async shareProduct() {
        this.showLoading(true);
        try {
            if (typeof html2canvas === 'undefined') {
                this.showNotification('Share unavailable');
                return;
            }
            const canvas = await html2canvas(this.el.splitContainer, {
                scale: 2,
                backgroundColor: document.body.classList.contains('dark-mode') ? '#121212' : '#ffffff',
                useCORS: true,
                onclone: (doc, clone) => {
                    const nav = clone.querySelector('.bottom-nav');
                    if (nav) nav.style.display = 'none';
                }
            });
            this.el.shareImage.src = canvas.toDataURL('image/png');
            this.el.shareOverlay.classList.add('active');
        } catch (e) {
            this.showNotification('Share failed');
        }
        this.showLoading(false);
    }

    downloadShare() {
        const p = this.products[this.currentIndex];
        const a = document.createElement('a');
        a.download = (p ? p.title : 'share') + '.png';
        a.href = this.el.shareImage.src;
        a.click();
    }

    closeShare() {
        this.el.shareOverlay.classList.remove('active');
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
        if (this.cart.length === 0) {
            this.showNotification('Cart is empty');
            return;
        }

        // Validate shipping info
        const email = document.getElementById('checkoutEmail').value.trim();
        const phone = document.getElementById('checkoutPhone').value.trim();
        const name = document.getElementById('checkoutName').value.trim();
        const address = document.getElementById('checkoutAddress').value.trim();
        const city = document.getElementById('checkoutCity').value.trim();
        const zip = document.getElementById('checkoutZip').value.trim();
        const country = document.getElementById('checkoutCountryInput').value.trim();

        if (!email || !phone || !name || !address || !city || !zip || !country) {
            this.showNotification('Please fill all required shipping fields');
            // Open shipping accordion if not open
            const shippingBody = document.getElementById('accordionShippingBody');
            if (shippingBody && !shippingBody.classList.contains('open')) {
                this.toggleAccordion('accordionShippingBody');
            }
            return;
        }

        const providerInput = document.querySelector('input[name="paymentProvider"]:checked');
        const paymentProvider = providerInput ? providerInput.value : 'paystack';
        const currency = (paymentProvider === 'paystack' && this.selectedCurrency === 'NGN') || paymentProvider === 'bank_transfer' ? 'NGN' : this.selectedCurrency;

        // Build items array
        const items = this.cart.map(function (item) {
            const p = app._findProductById(item.productId);
            return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: p ? p.base_price : 0
            };
        });

        this.showLoading(true);
        try {
            const response = await fetch('/.netlify/functions/initialize-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    name: name,
                    phone: phone,
                    items: items,
                    address: address,
                    city: city,
                    zip: zip,
                    country: country,
                    paymentProvider: paymentProvider,
                    currency: currency,
                    discountCode: document.getElementById('checkoutDiscountCode')?.value?.trim() || ''
                })
            });

            if (!response.ok) {
                let errMsg = 'Payment failed (server error ' + response.status + ')';
                try {
                    const errData = await response.json();
                    errMsg = errData.error || errMsg;
                } catch (_) {}
                throw new Error(errMsg);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Payment failed');
            }

            if (data.breakdown) {
                if (this.el.checkoutSubtotal) this.el.checkoutSubtotal.innerText = this.formatPrice(data.breakdown.subtotal || 0);
                if (this.el.checkoutShipping) this.el.checkoutShipping.innerText = this.formatPrice(data.breakdown.shipping || 0);
                if (this.el.checkoutTax) this.el.checkoutTax.innerText = this.formatPrice(data.breakdown.tax || 0);
                const totalSpan = document.getElementById('checkoutTotal');
                if (totalSpan) totalSpan.innerText = this.formatPrice(data.breakdown.total || data.amount || 0);
            }

            if (data.provider === 'bank_transfer') {
                this.renderBankDetails(data);
            } else if (data.authorization_url) {
                window.location.href = data.authorization_url;
            } else {
                this.showNotification('Order created! Order #: ' + data.order_number);
                // Clear cart on success
                this.cart = [];
                this._saveCart();
                this._updateCartBadge();
                this.closeCart();
            }
        } catch (e) {
            this.showNotification(e.message);
        } finally {
            this.showLoading(false);
        }
    }

    openGrid() {
        // Close expanded view if active to prevent glitch
        if (this.el.productFrame && this.el.productFrame.classList.contains('expanded')) {
            this.el.productFrame.classList.remove('expanded');
            this.el.splitContainer.classList.remove('fullview-active');
            this.expandedActive = false;
            this.removeExpandedThumbnails();
        }
        this.zoomActive = false;
        this._detectContextLabel();
        this.renderGrid('all');
        this.el.gridOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this._setupCollectionDropdown();
    }

    closeGrid() {
        this.el.gridOverlay.classList.remove('active');
        document.body.style.overflow = '';
        // Close collection dropdown if open
        const dd = document.getElementById('collectionDropdown');
        if (dd) dd.classList.remove('open');
    }

    toggleGridDetails() {
        this.gridDetailsVisible = !this.gridDetailsVisible;
        document.querySelectorAll('.grid-item-info').forEach(el => {
            el.classList.toggle('hidden', !this.gridDetailsVisible);
        });
    }

    renderGrid(filter) {
        let filtered = this.products;
        if (filter === 'context') {
            // Context tab = saved/favourited items
            filtered = this.products.filter(p => this.savedItems.has(p.product_id));
        } else if (filter === 'collection') {
            // Filter by collection name (set via _activeCollection)
            if (this._activeCollection) {
                filtered = this.products.filter(p => (p.collection || '').trim() === this._activeCollection);
            }
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
            const infoClass = this.gridDetailsVisible ? '' : ' hidden';
            const showPrice = p.show_price !== false;
            const isSaved = this.savedItems.has(p.product_id);
            
            const typeLabel = this.TYPE_LABELS[p.type] || '';
            html += '<div class="grid-item" data-action="view-product" data-id="' + Utils.escapeAttr(p.product_id) + '" tabindex="0" role="button">' +
                thumb +
                '<div class="grid-item-info' + infoClass + '">' +
                    '<div class="grid-item-title">' + Utils.escapeHtml(p.title) + '</div>' +
                    (showPrice ? '<div class="grid-item-price">' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div>' : '') +
                    '<div class="grid-item-meta">' +
                        (typeLabel ? '<span class="grid-item-type">' + Utils.escapeHtml(typeLabel) + '</span>' : '') +
                        (isSaved ? '<span class="grid-item-saved">♥</span>' : '') +
                    '</div>' +
                '</div>' +
            '</div>';
        }
        if (this.el.gridContainer) this.el.gridContainer.innerHTML = html;

        // Update filter button active states
        const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
        for (let i = 0; i < filterBtns.length; i++) {
            filterBtns[i].classList.toggle('active', filterBtns[i].dataset.filter === filter);
        }
        // Update collection button state
        const collBtn = document.getElementById('collectionFilterBtn');
        if (collBtn) collBtn.classList.toggle('active', filter === 'collection' && !!this._activeCollection);
        // Update collection option states
        const collOptions = document.querySelectorAll('.collection-option');
        for (let i = 0; i < collOptions.length; i++) {
            collOptions[i].classList.toggle('active', collOptions[i].dataset.collection === this._activeCollection);
        }
    }

    // Detect dominant product type to set context tab label
    _detectContextLabel() {
        const ctxBtn = document.getElementById('contextFilterBtn');
        if (!ctxBtn) return;
        const counts = { merch: 0, craft: 0, original: 0, print: 0 };
        this.products.forEach(p => {
            if (p.media_kind === 'text') { /* text products don't count for closet/curation */ }
            else if (counts[p.type] !== undefined) counts[p.type]++;
        });
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const textCount = this.products.filter(p => p.media_kind === 'text').length;
        
        if (textCount > total) {
            ctxBtn.textContent = 'Diary';
        } else {
            const merchTotal = (counts.merch || 0) + (counts.craft || 0);
            const artTotal = (counts.original || 0) + (counts.print || 0);
            if (merchTotal > artTotal) {
                ctxBtn.textContent = 'Closet';
            } else {
                ctxBtn.textContent = 'Curation';
            }
        }
    }

    // Populate collection dropdown from actual product collection names
    _populateCollectionDropdown() {
        const dropdown = document.getElementById('collectionDropdown');
        if (!dropdown) return;
        
        // Keep the label, remove old options
        const label = dropdown.querySelector('.collection-dropdown-label');
        dropdown.innerHTML = '';
        if (label) dropdown.appendChild(label);
        
        // Get unique collection names from products
        const collections = {};
        this.products.forEach(p => {
            if (p.collection && p.collection.trim()) {
                collections[p.collection.trim()] = (collections[p.collection.trim()] || 0) + 1;
            }
        });
        
        const names = Object.keys(collections).sort();
        if (names.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.cssText = 'padding: 8px 12px; font-size: 11px; color: #888;';
            emptyMsg.textContent = 'No collections yet. Set a collection name in admin for each product.';
            dropdown.appendChild(emptyMsg);
            return;
        }
        
        names.forEach(name => {
            const btn = document.createElement('button');
            btn.className = 'collection-option';
            btn.type = 'button';
            btn.dataset.collection = name;
            btn.textContent = name + ' (' + collections[name] + ')';
            dropdown.appendChild(btn);
        });
    }

    // Setup collection dropdown toggle and option clicks
    _setupCollectionDropdown() {
        const collBtn = document.getElementById('collectionFilterBtn');
        const dropdown = document.getElementById('collectionDropdown');
        if (!collBtn || !dropdown) return;

        // Populate dropdown with current collection names
        this._populateCollectionDropdown();

        // Toggle dropdown on click
        collBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        };

        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && e.target !== collBtn) {
                dropdown.classList.remove('open');
            }
        };
        document.addEventListener('click', closeDropdown);

        // Collection option clicks
        const options = dropdown.querySelectorAll('.collection-option');
        options.forEach(opt => {
            opt.onclick = (e) => {
                e.stopPropagation();
                const coll = opt.dataset.collection;
                if (this._activeCollection === coll) {
                    // Deselect — show all
                    this._activeCollection = null;
                    this.renderGrid('all');
                } else {
                    this._activeCollection = coll;
                    this.renderGrid('collection');
                }
                dropdown.classList.remove('open');
            };
        });
    }

    viewProduct(productId) {
        const idx = this.products.findIndex(p => p.product_id === productId);
        if (idx !== -1) {
            this.currentIndex = idx;
            this.closeGrid();
            this.renderImmediate();
            this._pushProductUrl();
        }
    }

    renderImmediate() {
        if (!this.products.length) return;
        const p = this.products[this.currentIndex];
        if (!p) return;
        if (this._displayTimer) { clearTimeout(this._displayTimer); this._displayTimer = null; }
        // Update variations FIRST so dots use current product data
        this.currentVariations = p.variations || [];
        this.variationIndex = 0;
        // Remove transitioning class immediately (no fade)
        if (this.el.infoContainer) this.el.infoContainer.classList.remove('transitioning');
        this.renderMedia(p);
        this.renderText(p);
        this.renderFrame(p);
        this.renderBackgrounds(p);
        this.renderVariationDots();
        // Update chrome
        if (this.el.heartButton) {
            const isSaved = this.savedItems.has(p.product_id);
            this.el.heartButton.classList.toggle('saved', isSaved);
            this.el.heartButton.innerHTML = isSaved ? '\u2665' : '\u2661';
        }
        if (this.el.pageIndicator) {
            this.el.pageIndicator.textContent = (this.currentIndex + 1) + '/' + this.products.length;
        }
        if (this.el.prevBtn) this.el.prevBtn.disabled = this.currentIndex === 0;
        if (this.el.nextBtn) this.el.nextBtn.disabled = this.currentIndex === this.products.length - 1;
        if (this.el.stockBadge) {
            const showStock = p.show_stock !== false;
            this.el.stockBadge.style.display = showStock ? '' : 'none';
            this.el.stockBadge.className = 'stock-badge';
            if (showStock) {
                if (p.stock <= 0) { this.el.stockBadge.textContent = 'Sold Out'; this.el.stockBadge.classList.add('sold-out'); }
                else if (p.stock <= 2) { this.el.stockBadge.textContent = 'Low Stock (' + p.stock + ')'; this.el.stockBadge.classList.add('low-stock'); }
                else { this.el.stockBadge.textContent = ''; }
            }
        }
        if (this.zoomActive) this.removeZoom();
    }

    filterGrid(filter) {
        this.renderGrid(filter);
    }

    setRandomVerse() {
        var verses = [
            '"Be still, and know that I am God."',
            '"The Lord is my shepherd; I shall not want."',
            '"I can do all things through Christ who strengthens me."',
            '"For God so loved the world that he gave his only begotten Son."',
            '"The earth is the Lord\'s and the fullness thereof."',
            '"He has made everything beautiful in its time."',
            '"Trust in the Lord with all your heart."',
            '"The Lord is my light and my salvation."',
            '"Be strong and courageous. Do not be afraid."',
            '"This is the day the Lord has made; let us rejoice and be glad."',
            '"The Lord is near to the brokenhearted."',
            '"Your word is a lamp to my feet and a light to my path."',
            '"Cast all your anxiety on him because he cares for you."',
            '"The Lord bless you and keep you; the Lord make his face shine upon you."',
            '"Create in me a clean heart, O God, and renew a right spirit within me."'
        ];
        var el = document.getElementById('introPoem');
        if (el) el.textContent = verses[Math.floor(Math.random() * verses.length)];
    }

    showIntro() {
        if (this.el.introOverlay) this.el.introOverlay.classList.remove('hidden');
        if (this.el.splitContainer) this.el.splitContainer.classList.remove('active');
    }

    enterGallery() {
        if (this.el.introOverlay) this.el.introOverlay.classList.add('hidden');
        setTimeout(() => {
            if (this.el.splitContainer) this.el.splitContainer.classList.add('active');
            this.updateDisplay();
            this._pushProductUrl();
        }, 300);
    }

    showLoading(show) {
        if (this.el.loading) this.el.loading.classList.toggle('active', show);
    }

    showNotification(message, type) {
        if (this.el.notification) {
            this.el.notification.textContent = message;
            this.el.notification.className = 'notification' + (type ? ' ' + type : '');
            this.el.notification.classList.add('active');
            clearTimeout(this._notifTimer);
            this._notifTimer = setTimeout(() => {
                if (this.el.notification) this.el.notification.classList.remove('active');
            }, 4000);
        }
    }

    isModalOpen() {
        const legalModal = document.getElementById('legalModal');
        return (this.el.checkoutPanel && this.el.checkoutPanel.classList.contains('active')) ||
               (this.el.gridOverlay && this.el.gridOverlay.classList.contains('active')) ||
               (this.el.shareOverlay && this.el.shareOverlay.classList.contains('active')) ||
               (legalModal && legalModal.classList.contains('active'));
    }

    setupEvents() {
        // SEO URL: handle browser back/forward
        window.addEventListener('popstate', (e) => this._onPopState(e));

        if (this.el.prevBtn) this.el.prevBtn.onclick = () => this.prevProduct();
        if (this.el.nextBtn) this.el.nextBtn.onclick = () => this.nextProduct();
        if (this.el.heartButton) this.el.heartButton.onclick = () => this.toggleSave();
        if (this.el.cartButton) this.el.cartButton.onclick = () => this.addToCart();
        if (this.el.currencyDisplay) {
            this.el.currencyDisplay.addEventListener('change', () => {
                this.selectCurrency(this.el.currencyDisplay.value);
            });
        }
        document.querySelectorAll('[data-action="close-grid"]').forEach(function(el) {
            el.onclick = function() { app.closeGrid(); };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.closeGrid(); } };
        });
        document.querySelectorAll('[data-action="close-checkout"]').forEach(function(el) {
            el.onclick = function() { app.closeCart(); };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.closeCart(); } };
        });
        if (this.el.productFrame) this.el.productFrame.onclick = () => this.handleImageTap();
        if (this.el.eyeToggle) this.el.eyeToggle.onclick = () => this.toggleGridDetails();
        if (this.el.shareDownloadBtn) this.el.shareDownloadBtn.onclick = () => this.downloadShare();
        if (this.el.shareCloseBtn) this.el.shareCloseBtn.onclick = () => this.closeShare();

        if (this.el.galleryBrand) {
            let brandTapCount = 0, brandTapTimer;
            this.el.galleryBrand.onclick = () => {
                brandTapCount++;
                clearTimeout(brandTapTimer);
                brandTapTimer = setTimeout(() => { brandTapCount = 0; }, 320);
                if (brandTapCount === 2) {
                    brandTapCount = 0;
                    document.body.classList.toggle('dark-mode');
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('vgallery_dark', isDark ? '1' : '0');
                    this.showNotification('Dark mode: ' + (isDark ? 'on' : 'off'));
                    this.updateDisplay();
                }
            };
        }

        if (localStorage.getItem('vgallery_dark') === '1') {
            document.body.classList.add('dark-mode');
        }

        const siteLogo = document.getElementById('siteLogo');
        if (siteLogo) siteLogo.onclick = () => this.showIntro();

        const gridIcon = document.getElementById('gridIconTop');
        if (gridIcon) gridIcon.onclick = () => this.openGrid();

        // Address fields trigger shipping/tax recalculation
        const addressFields = ['checkoutCountryInput', 'checkoutZip', 'checkoutCity'];
        addressFields.forEach(function(fieldId) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', function() {
                    if (app.checkoutRevealed) app.updateCheckoutTotals();
                });
            }
        });

        // Discount code triggers recalc
        const discountInput = document.getElementById('checkoutDiscountCode');
        if (discountInput) {
            discountInput.addEventListener('input', function() {
                if (app.checkoutRevealed) app.updateCheckoutTotals();
            });
        }

        document.querySelectorAll('input[name="paymentProvider"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.selectPaymentProvider(e.target.value));
        });

        const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
        for (let i = 0; i < filterBtns.length; i++) {
            filterBtns[i].onclick = () => {
                const f = filterBtns[i].dataset.filter;
                this._activeCollection = null; // Reset collection when clicking All/Context
                this.filterGrid(f);
            };
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeCart();
                this.closeGrid();
                this.closeShare();
                this.closeLegalModal();
            }
            if (!this.isModalOpen() && !this._isExpanded()) {
                if (e.key === 'ArrowRight') this.nextProduct();
                if (e.key === 'ArrowLeft') this.prevProduct();
                if (e.key === 's' || e.key === 'S') this.toggleSave();
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            switch (action) {
                case 'close-grid':
                    this.closeGrid();
                    break;
                case 'close-checkout-overlay':
                    if (e.target === target) this.closeCart();
                    break;
                case 'cart-qty-dec':
                    this.updateCartQty(target.dataset.pid, -1);
                    break;
                case 'cart-qty-inc':
                    this.updateCartQty(target.dataset.pid, 1);
                    break;
                case 'cart-remove':
                    this.removeFromCart(target.dataset.pid);
                    break;
                case 'reveal-checkout':
                    this.revealCheckout();
                    break;
                case 'toggle-accordion':
                    this.toggleAccordion(target.dataset.target);
                    break;
                case 'place-order':
                    this.processPayment();
                    break;
                case 'close-checkout':
                    this.closeCart();
                    break;
                case 'view-product':
                    this.viewProduct(target.dataset.id);
                    break;
                case 'show-terms':
                    e.preventDefault();
                    this.showLegalModal('terms');
                    break;
                case 'show-privacy':
                    e.preventDefault();
                    this.showLegalModal('privacy');
                    break;
                case 'close-legal-modal':
                    this.closeLegalModal();
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
            if (this.isModalOpen()) return;
            if (this.el.productFrame && this.el.productFrame.classList.contains('expanded')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            if (this.isModalOpen()) return;
            if (this.el.productFrame && this.el.productFrame.classList.contains('expanded')) return;
            const diffX = e.changedTouches[0].clientX - startX;
            const diffY = e.changedTouches[0].clientY - startY;
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                if (diffX > 0) {
                    this.prevProduct();
                } else {
                    this.nextProduct();
                }
            }
        }, { passive: true });
    }

    // Expanded mode thumbnails
    renderExpandedThumbnails() {
        this.removeExpandedThumbnails();
        const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
        if (allImages.length <= 1) return;

        const container = document.createElement('div');
        container.className = 'expanded-thumbnails';
        container.id = 'expandedThumbnails';

        allImages.forEach((url, idx) => {
            const thumb = document.createElement('div');
            thumb.className = 'expanded-thumb' + (idx === this.variationIndex ? ' active' : '');
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Image ' + (idx + 1);
            img.loading = 'lazy';
            thumb.appendChild(img);
            thumb.onclick = (e) => { e.stopPropagation(); this.showVariation(idx); };
            container.appendChild(thumb);
        });

        this.el.productFrame.appendChild(container);
    }

    removeExpandedThumbnails() {
        const existing = document.getElementById('expandedThumbnails');
        if (existing) existing.remove();
    }

    // Real-time sync with admin panel
    setupAdminSync() {
        try {
            const bc = new BroadcastChannel('vgallery_admin');
            bc.onmessage = (e) => {
                if (e.data && e.data.type) this.handleAdminChange(e.data.type);
            };
        } catch(e) {}

        window.addEventListener('storage', (e) => {
            if (e.key === 'vgallery_admin_event') {
                try {
                    const data = JSON.parse(e.newValue);
                    if (data && data.type) this.handleAdminChange(data.type);
                } catch(err) {}
            }
        });
    }

    async handleAdminChange(type) {
        // Small delay to let Supabase propagate the write
        await new Promise(r => setTimeout(r, 500));
        if (type === 'products_updated') {
            await this.loadProducts({ silent: true, noCache: true });
            this.showNotification('Products updated');
        } else if (type === 'settings_updated') {
            await this.loadStoreSettings();
            await this.fetchCurrencyRates();
            this.showNotification('Settings updated');
        }
    }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new HybridApp();
    window.app = app;
});
