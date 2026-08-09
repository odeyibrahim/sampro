class HybridApp {
    constructor() {
        this.products = [];
        this.currentIndex = 0;
        this.savedItems = new Set();
        this.selectedCurrency = 'USD';
        this.exchangeRates = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1500 };
        this.checkoutQuantity = 1;
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
        this.deferredInstallPrompt = null;
        this.sessionId = localStorage.getItem('session_id') || 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem('session_id', this.sessionId);
        this.init();
    }

    async init() {
        this.bindElements();
        await this.loadProducts();
        this.loadSaved();
        this.loadCurrency();
        this.setupEvents();
        this.setupSwipe();
        this.setupPwa();
        this.updateOfflineBanner();
        this.loadStoreSettings();
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
        } catch (e) {
            // intentionally silent
        }
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
        const slug = p.slug;
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
            if (this.el.currencyDisplay) this.el.currencyDisplay.textContent = saved;
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
            this.products = [
                { product_id: '1', title: 'Archive Tee', author: 'V.', description: '100% cotton, screen printed by hand.\nLimited edition.', type: 'merch', base_price: 45, stock: 10, orientation: 'square', image_url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800', variations: [] },
                { product_id: '2', title: 'Desert Landscape', author: 'V.', description: 'Archival photograph from the high desert.\nSigned and numbered.', type: 'print', base_price: 195, stock: 5, orientation: 'landscape', image_url: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800', variations: ['https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800'] },
                { product_id: '3', title: 'Silent Currents', author: 'V.', description: 'Original mixed media on canvas, 2024.\nA unique piece.', type: 'original', base_price: 8500, stock: 1, orientation: 'portrait', image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800', variations: [] }
            ];
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

        this.currentVariations = p.variations || [];
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
        if (this.el.checkoutPanel && this.el.checkoutPanel.classList.contains('active')) {
            this.updateCheckoutTotal();
        }
    }

    handleImageTap() {
        const p = this.products[this.currentIndex];
        if (p && (p.media_kind === 'text' || p.type === 'text')) return;

        if (this.doubleTapTimer) {
            clearTimeout(this.doubleTapTimer);
            this.doubleTapTimer = null;
            this.toggleExpand();
            return;
        }
        this.doubleTapTimer = setTimeout(() => {
            this.doubleTapTimer = null;
            // If the product has variations, cycle to the next image instead of zooming
            const allImages = [this.products[this.currentIndex].image_url, ...this.currentVariations].filter(Boolean);
            if (allImages.length > 1) {
                const next = (this.variationIndex + 1) % allImages.length;
                this.showVariation(next);
            } else {
                this.toggleZoom();
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
            const p = this.products[this.currentIndex];
            if (p) this.renderFrame(p);
        } else {
            frame.classList.add('expanded');
            document.body.style.overflow = 'hidden';
            this.el.splitContainer.classList.add('fullview-active');
        }
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
                ? '<img src="' + Utils.escapeAttr(p.image_url) + '" style="width:70px; height:70px; object-fit:cover; border-radius:4px;">'
                : '<div style="width:70px; height:70px; border-radius:4px; background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:11px; color:#888;">Text</div>';
            previewDiv.innerHTML = '<div class="order-item" style="display:flex; gap:15px; align-items:center;">' + thumbHtml + '<div><div class="order-item-title">' + Utils.escapeHtml(p.title) + '</div><div class="order-item-price">' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div></div></div>';
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

        const subtotal = p.base_price * this.checkoutQuantity;
        const tax = subtotal * 0.08;
        const total = subtotal + shipping + tax;

        if (this.el.checkoutSubtotal) this.el.checkoutSubtotal.innerText = this.formatPrice(subtotal);
        if (this.el.checkoutShipping) this.el.checkoutShipping.innerText = this.formatPrice(shipping);
        if (this.el.checkoutTax) this.el.checkoutTax.innerText = this.formatPrice(tax);
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
        document.body.style.overflow = 'hidden';
    }

    closeGrid() {
        this.el.gridOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    toggleGridDetails() {
        this.gridDetailsVisible = !this.gridDetailsVisible;
        document.querySelectorAll('.grid-item-info').forEach(el => {
            el.classList.toggle('hidden', !this.gridDetailsVisible);
        });
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
            const infoClass = this.gridDetailsVisible ? '' : ' hidden';
            const showPrice = p.show_price !== false;
            const isSaved = this.savedItems.has(p.product_id);
            
            // Restored grid-item-title, grid-item-price, and grid-item-meta (type + saved)
            html += '<div class="grid-item" data-action="view-product" data-id="' + Utils.escapeAttr(p.product_id) + '" tabindex="0" role="button">' +
                thumb +
                '<div class="grid-item-info' + infoClass + '">' +
                    '<div class="grid-item-title">' + Utils.escapeHtml(p.title) + '</div>' +
                    (showPrice ? '<div class="grid-item-price">' + Utils.escapeHtml(this.formatPrice(p.base_price)) + '</div>' : '') +
                    '<div class="grid-item-meta">' +
                        '<span class="grid-item-type">' + Utils.escapeHtml(p.type || '') + '</span>' +
                        (isSaved ? '<span class="grid-item-saved">♥</span>' : '') +
                    '</div>' +
                '</div>' +
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
        this.currentVariations = p.variations || [];
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
        return (this.el.checkoutPanel && this.el.checkoutPanel.classList.contains('active')) ||
               (this.el.gridOverlay && this.el.gridOverlay.classList.contains('active')) ||
               (this.el.shareOverlay && this.el.shareOverlay.classList.contains('active'));
    }

    setupEvents() {
        // SEO URL: handle browser back/forward
        window.addEventListener('popstate', (e) => this._onPopState(e));

        if (this.el.prevBtn) this.el.prevBtn.onclick = () => this.prevProduct();
        if (this.el.nextBtn) this.el.nextBtn.onclick = () => this.nextProduct();
        if (this.el.heartButton) this.el.heartButton.onclick = () => this.toggleSave();
        if (this.el.cartButton) this.el.cartButton.onclick = () => this.openCheckout();
        if (this.el.currencyDisplay) this.el.currencyDisplay.onclick = () => this.cycleCurrency();
        document.querySelectorAll('[data-action="close-grid"]').forEach(function(el) {
            el.onclick = function() { app.closeGrid(); };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.closeGrid(); } };
        });
        document.querySelectorAll('[data-action="close-checkout"]').forEach(function(el) {
            el.onclick = function() { app.closeCheckout(); };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.closeCheckout(); } };
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

        const shippingSelect = document.getElementById('checkoutShippingSelect');
        if (shippingSelect) shippingSelect.onchange = () => this.updateCheckoutTotal();

        document.querySelectorAll('input[name="paymentProvider"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.selectPaymentProvider(e.target.value));
        });

        const filterBtns = document.querySelectorAll('.filter-btn');
        for (let i = 0; i < filterBtns.length; i++) {
            filterBtns[i].onclick = () => this.filterGrid(filterBtns[i].dataset.filter);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeCheckout();
                this.closeGrid();
                this.closeShare();
            }
            if (!this.isModalOpen()) {
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
            if (this.isModalOpen()) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            if (this.isModalOpen()) return;
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
}

let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new HybridApp();
    window.app = app;
});
