(function() {
    'use strict';

    // ============ CONSTANTS ============
    const LS_KEYS = {
        PRODUCTS: 'vgallery_products',
        SAVED: 'vgallery_saved',
        ORDERS: 'vgallery_orders',
        CUSTOMERS: 'vgallery_customers',
        CURRENCY: 'vgallery_currency',
        BRAND: 'vgallery_brand',
        LOGO: 'vgallery_logo',
        SETTINGS: 'vgallery_settings',
        SESSION_ID: 'vgallery_session',
        DARK: 'vgallery_dark',
        ADMIN_HASH: 'vgallery_admin_hash',
        OFFLINE_QUEUE: 'vgallery_offline_queue'
    };

    const CONFIG = {
        DEFAULT_FRAME: { borderWidth: 0, borderColor: '#000000', objectFit: 'contain' },
        DEFAULT_BG: { type: 'color', color1: '#f8f8f8', color2: '#e0e0e0', mediaUrl: '' },
        DEFAULT_FONT: { fontFamily: "'Copperplate', serif", fontSize: 11, fontWeight: 400, textTransform: 'none' },
        exchangeRates: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1500 }
    };

    // ============ APP CLASS ============
    class VGalleryApp {
        constructor() {
            this.products = [];
            this.currentIndex = 0;
            this.savedItems = new Set();
            this.selectedCurrency = 'USD';
            this.checkoutQuantity = 1;
            this.selectedShipping = 'standard';
            this.selectedPaymentProvider = 'paystack';
            this.orders = [];
            this.customers = new Map();
            this.zoomActive = false;
            this.gridDetailsVisible = true;
            this.adminAuthed = false;
            this.editingId = null;
            this.editingBgHalf = 'top';
            this.settings = { storeName: 'V. Gallery', shipStd: 7, shipExp: 15, whatsapp: '2349012345678' };
            this.deferredInstallPrompt = null;
            this.uploadedFileData = null;
            this.doubleTapTimer = null;
            this.isOnline = navigator.onLine;

            this.initDOM();
            this.bindMethods();
        }

        initDOM() {
            const ids = [
                'introOverlay', 'splitContainer', 'contentWrapper', 'productFrame',
                'mainImage', 'mainVideo', 'textContent', 'infoContainer',
                'productTitle', 'productCreator', 'descriptionText', 'priceTag', 'originalPrice',
                'stockBadge', 'heartButton', 'buyNowBtn', 'shareButton', 'pageIndicator',
                'prevBtn', 'nextBtn', 'gridOverlay', 'gridContainer', 'checkoutOverlay',
                'checkoutPanel', 'loading', 'notification', 'logoContainer', 'logoImage',
                'currencyDisplay', 'shareOverlay', 'shareImage', 'galleryBrand', 'priceRow',
                'checkoutProductPreview', 'checkoutQuantity', 'checkoutSubtotal',
                'checkoutShipping', 'checkoutTax', 'checkoutTotal', 'checkoutEmail',
                'checkoutName', 'checkoutAddress', 'checkoutCity', 'checkoutZip',
                'shippingStandardPrice', 'shippingExpressPrice',
                'adminOverlay', 'adminPanel', 'totalRevenue', 'totalOrders', 'totalProducts',
                'lowStockCount', 'recentOrdersBody', 'adminProductsBody', 'adminOrdersBody',
                'adminCustomersBody', 'editModal', 'editModalTitle', 'editTitle', 'editAuthor',
                'editDescription', 'editType', 'editPrice', 'editStock', 'editOrientation',
                'editImageUrl', 'previewMain', 'previewVideo',
                'standardShipping', 'expressShipping', 'storeName', 'logoPreview',
                'offlineBanner', 'installToast', 'syncBadge', 'adminGearBtn',
                'bankDetailsPanel', 'bankLocalDetails', 'bankDomDetails', 'bankRefNumber',
                'whatsappProofBtn', 'fileUploadSection', 'fileSizeWarning',
                'adminLoginOverlay', 'adminLoginHint', 'adminPasscodeInput', 'adminLoginError',
                'bgPanelTop', 'bgPanelBottom', 'videoControls', 'textSection', 'mediaSection',
                'deleteProductBtn', 'editProductType', 'editFontFamily', 'editFontWeight',
                'editFontSize', 'editTextTransform', 'editBorderWidth', 'editBorderColor',
                'editObjectFit', 'editTextContent', 'editVideoAutoplay', 'editVideoLoop',
                'editVideoMuted', 'deviceFileUpload', 'editShowAuthor', 'editShowPrice',
                'editShowStock', 'editContentOrder', 'bgVideoTop', 'bgImageTop',
                'bgVideoBottom', 'bgImageBottom'
            ];

            this.el = {};
            ids.forEach(id => {
                this.el[id] = document.getElementById(id);
            });
        }

        bindMethods() {
            const methods = [
                'enterGallery', 'nextProduct', 'prevProduct', 'openGrid', 'closeGrid',
                'updateProductDisplay', 'toggleSave', 'shareProduct', 'downloadShare',
                'closeShare', 'toggleZoom', 'openCheckout', 'closeCheckout',
                'updateQuantity', 'selectShipping', 'processPayment', 'whatsappInquiry',
                'openAdmin', 'closeAdmin', 'switchAdminTab', 'openEditModal', 'closeEditModal',
                'saveProduct', 'deleteCurrentProduct', 'cycleCurrency', 'showNotification',
                'formatPrice', 'toggleGridDetails', 'uploadLogo', 'saveSettings',
                'changePasscode', 'logoutAdmin', 'exportData', 'importData', 'exportPdf',
                'filterGrid', 'viewProduct', 'toggleBgHalf', 'updateBgColorRow',
                'toggleProductTypeUI', 'handleDeviceFileUpload',
                'handleImageTap', 'showTerms', 'showPrivacy', 'closeModal'
            ];
            methods.forEach(m => { this[m] = this[m].bind(this); });
        }

        async init() {
            this.showLoading(true);
            try {
                await this.loadProducts();
                await this.loadSavedItems();
                await this.loadOrders();
                await this.loadCustomers();
                await this.fetchExchangeRates();
                this.loadCurrency();
                this.loadLogo();
                this.loadSettings();
                this.loadDarkMode();
                this.setupEventListeners();
                this.setupSwipe();
                this.setupKeyboard();
                this.setupPwa();
                this.updateOfflineBanner();
                this.updateSyncBadge();
                this.showIntro();
            } catch (error) {
                this.showNotification('Failed to initialize', 'error');
            } finally {
                this.showLoading(false);
            }
        }

        // ============ DATA LOADING ============
        async loadProducts() {
            try {
                const res = await fetch('/.netlify/functions/get-products');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length) {
                        this.isOnline = true;
                        this.products = data;
                        localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(data));
                        return;
                    }
                }
                throw new Error('no server data');
            } catch (e) {
                this.isOnline = false;
                const stored = localStorage.getItem(LS_KEYS.PRODUCTS);
                if (stored) {
                    this.products = JSON.parse(stored);
                } else {
                    const initial = JSON.parse(document.getElementById('initial-products').textContent);
                    this.products = initial;
                    localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(initial));
                }
            }
        }

        async loadSavedItems() {
            const saved = localStorage.getItem(LS_KEYS.SAVED);
            this.savedItems = new Set(saved ? JSON.parse(saved) : []);
        }

        async loadOrders() {
            try {
                const res = await fetch('/.netlify/functions/get-orders');
                if (res.ok) {
                    this.orders = await res.json();
                    localStorage.setItem(LS_KEYS.ORDERS, JSON.stringify(this.orders));
                    return;
                }
            } catch (e) {}
            const stored = localStorage.getItem(LS_KEYS.ORDERS);
            this.orders = stored ? JSON.parse(stored) : [];
        }

        async loadCustomers() {
            const stored = localStorage.getItem(LS_KEYS.CUSTOMERS);
            if (stored) {
                this.customers = new Map(JSON.parse(stored));
            }
        }

        async fetchExchangeRates() {
            try {
                const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
                const data = await response.json();
                CONFIG.exchangeRates = { USD: 1, ...data.rates };
            } catch (error) {}
        }

        loadCurrency() {
            const saved = localStorage.getItem(LS_KEYS.CURRENCY);
            if (saved) {
                this.selectedCurrency = saved;
                if (this.el.currencyDisplay) this.el.currencyDisplay.textContent = saved;
            }
        }

        loadLogo() {
            const logo = localStorage.getItem(LS_KEYS.LOGO);
            if (logo) {
                this.el.logoImage.src = logo;
                this.el.logoContainer.classList.add('has-logo');
            }
        }

        loadSettings() {
            const saved = localStorage.getItem(LS_KEYS.SETTINGS);
            if (saved) {
                try { this.settings = { ...this.settings, ...JSON.parse(saved) }; } catch (e) {}
            }
        }

        loadDarkMode() {
            if (localStorage.getItem(LS_KEYS.DARK) === '1') {
                document.body.classList.add('dark-mode');
            }
        }

        saveProducts() {
            localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(this.products));
        }

        // ============ INTRO ============
        showIntro() {
            this.el.introOverlay.classList.remove('hidden');
            this.el.splitContainer.classList.remove('active');
        }

        enterGallery() {
            this.el.introOverlay.classList.add('hidden');
            setTimeout(() => {
                this.el.splitContainer.classList.add('active');
                this.updateProductDisplay();
            }, 300);
        }

        // ============ PRODUCT DISPLAY ============
        updateProductDisplay(opts = {}) {
            const p = this.products[this.currentIndex];
            if (!p) return;

            if (opts.animate === false) {
                this.renderProductContent();
                return;
            }

            this.el.infoContainer.classList.add('transitioning');
            setTimeout(() => {
                this.renderProductContent();
                requestAnimationFrame(() => {
                    this.el.infoContainer.classList.remove('transitioning');
                });
            }, 160);
        }

        renderProductContent() {
            const p = this.products[this.currentIndex];
            if (!p) return;

            // Reset zoom/expand
            this.el.productFrame.classList.remove('zoom-active', 'expanded');
            this.el.productFrame.style.position = '';
            this.el.productFrame.style.top = '';
            this.el.productFrame.style.left = '';
            this.el.productFrame.style.width = '';
            this.el.productFrame.style.height = '';
            this.el.productFrame.style.zIndex = '';
            this.el.productFrame.style.padding = '';
            this.el.productFrame.style.border = '';
            this.zoomActive = false;
            this.el.splitContainer.classList.remove('fullview-active');

            const isVideo = p.productType === 'video';
            const isText = p.productType === 'text';

            this.el.mainImage.style.display = 'none';
            this.el.mainImage.classList.remove('loaded');
            this.el.mainVideo.style.display = 'none';
            this.el.mainVideo.classList.remove('loaded');
            this.el.textContent.style.display = 'none';
            this.el.splitContainer.classList.remove('text-mode');

            if (isText) {
                this.el.splitContainer.classList.add('text-mode');
                this.el.textContent.style.display = 'flex';
                this.el.textContent.textContent = p.content || p.description || '';
                this.el.textContent.style.fontFamily = p.fontFamily || CONFIG.DEFAULT_FONT.fontFamily;
                this.el.textContent.style.fontSize = (p.fontSize || CONFIG.DEFAULT_FONT.fontSize) + 'px';
                this.el.textContent.style.fontWeight = p.fontWeight || CONFIG.DEFAULT_FONT.fontWeight;
                this.el.textContent.style.textTransform = p.textTransform || CONFIG.DEFAULT_FONT.textTransform;
            } else if (isVideo) {
                this.el.mainVideo.style.display = 'block';
                this.el.mainVideo.src = p.image || '';
                this.el.mainVideo.autoplay = p.videoAutoplay !== undefined ? p.videoAutoplay : true;
                this.el.mainVideo.loop = p.videoLoop !== undefined ? p.videoLoop : true;
                this.el.mainVideo.muted = p.videoMuted !== undefined ? p.videoMuted : true;
                this.el.mainVideo.playsinline = true;
                this.el.mainVideo.onloadeddata = () => this.el.mainVideo.classList.add('loaded');
                this.el.mainVideo.onerror = () => {
                    this.el.mainVideo.classList.add('loaded');
                };
            } else {
                this.el.mainImage.style.display = 'block';
                this.el.mainImage.src = p.image || '';
                this.el.mainImage.alt = p.title || '';
                this.el.mainImage.onload = () => this.el.mainImage.classList.add('loaded');
                this.el.mainImage.onerror = () => {
                    this.el.mainImage.src = 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800';
                    this.el.mainImage.classList.add('loaded');
                };
            }

            this.el.productTitle.textContent = p.title || '';

            const showAuthor = p.showAuthor !== false;
            this.el.productCreator.textContent = p.author || 'V.';
            this.el.productCreator.classList.toggle('hidden', !showAuthor);

            const order = p.contentOrder === 'description-first' ? 'description-first' : 'title-first';
            this.el.infoContainer.classList.toggle('order-title-first', order === 'title-first');
            this.el.infoContainer.classList.toggle('order-description-first', order === 'description-first');

            this.el.descriptionText.textContent = p.description || '';
            this.el.descriptionText.classList.toggle('hidden', !p.description);
            this.el.descriptionText.style.fontFamily = p.fontFamily || CONFIG.DEFAULT_FONT.fontFamily;
            this.el.descriptionText.style.fontSize = (p.fontSize || CONFIG.DEFAULT_FONT.fontSize) + 'px';
            this.el.descriptionText.style.fontWeight = p.fontWeight || CONFIG.DEFAULT_FONT.fontWeight;
            this.el.descriptionText.style.textTransform = p.textTransform || CONFIG.DEFAULT_FONT.textTransform;

            const showPrice = p.showPrice !== false;
            this.el.priceRow.classList.toggle('hidden', !showPrice);
            if (showPrice) {
                this.el.priceTag.textContent = this.formatPrice(p.basePrice);
                if (p.originalPrice) {
                    this.el.originalPrice.textContent = this.formatPrice(p.originalPrice);
                    this.el.originalPrice.style.display = 'inline';
                } else {
                    this.el.originalPrice.style.display = 'none';
                }
            }

            this.updateStockBadge(p);
            this.updateSaveButton();
            this.applyFrameStyle(p);
            this.applyBackgrounds(p);
            this.applyOrientation(p);

            this.el.pageIndicator.textContent = `${this.currentIndex + 1}/${this.products.length}`;
            this.el.prevBtn.disabled = this.currentIndex === 0;
            this.el.nextBtn.disabled = this.currentIndex === this.products.length - 1;
        }

        updateStockBadge(product) {
            const badge = this.el.stockBadge;
            const showStock = product.showStock !== false;
            if (!showStock) {
                badge.textContent = '';
                badge.className = 'stock-badge';
                badge.style.display = 'none';
                return;
            }
            badge.style.display = '';
            if (product.stock <= 0) {
                badge.textContent = 'Sold Out';
                badge.className = 'stock-badge sold-out';
            } else if (product.stock <= 2) {
                badge.textContent = `Low Stock (${product.stock})`;
                badge.className = 'stock-badge low-stock';
            } else {
                badge.textContent = '';
                badge.className = 'stock-badge';
            }
        }

        updateSaveButton() {
            const p = this.products[this.currentIndex];
            this.el.heartButton.classList.toggle('saved', p && this.savedItems.has(p.id));
            this.el.heartButton.innerHTML = (p && this.savedItems.has(p.id)) ? '♥' : '♡';
        }

        applyFrameStyle(product) {
            const frame = this.el.productFrame;
            frame.classList.remove('has-frame');
            frame.style.border = '';
            frame.style.padding = '';

            if (product.frame && product.frame.borderWidth > 0) {
                frame.classList.add('has-frame');
                frame.style.borderColor = product.frame.borderColor || '#2c2c2c';
                frame.style.borderWidth = product.frame.borderWidth + 'px';
                frame.style.padding = '5px';
            }
        }

        applyBackgrounds(product) {
            const topHalf = document.getElementById('topHalf');
            const bottomHalf = document.getElementById('bottomHalf');
            const isDark = document.body.classList.contains('dark-mode');

            const halves = [
                { el: topHalf, bg: product.backgroundTop, video: this.el.bgVideoTop, image: this.el.bgImageTop },
                { el: bottomHalf, bg: product.backgroundBottom, video: this.el.bgVideoBottom, image: this.el.bgImageBottom }
            ];

            halves.forEach(({ el, bg, video, image }) => {
                el.classList.remove('bg-pulse');
                bg = bg || CONFIG.DEFAULT_BG;

                video.classList.remove('visible');
                video.pause();
                video.removeAttribute('src');
                image.classList.remove('visible');
                image.removeAttribute('src');

                if (isDark) {
                    el.style.background = 'var(--bg-top)';
                    return;
                }

                if (bg.type === 'color') {
                    el.style.background = bg.color1 || '#f8f8f8';
                } else if (bg.type === 'gradient') {
                    el.style.background = `linear-gradient(135deg, ${bg.color1 || '#f8f8f8'}, ${bg.color2 || '#e0e0e0'})`;
                } else if (bg.type === 'animated') {
                    el.style.background = bg.color1 || '#f8f8f8';
                    el.classList.add('bg-pulse');
                } else if (bg.type === 'image' && bg.mediaUrl) {
                    el.style.background = bg.color1 || '#f8f8f8';
                    image.src = bg.mediaUrl;
                    image.classList.add('visible');
                } else if (bg.type === 'video' && bg.mediaUrl) {
                    el.style.background = bg.color1 || '#f8f8f8';
                    video.src = bg.mediaUrl;
                    video.classList.add('visible');
                    video.play().catch(() => {});
                } else {
                    el.style.background = bg.color1 || '#f8f8f8';
                }
            });
        }

        applyOrientation(product) {
            const orientation = product.orientation || 'square';
            const isText = product.productType === 'text';
            const frame = this.el.productFrame;
            frame.className = 'product-frame';
            frame.classList.add('orientation-' + orientation);
            if (product.frame && product.frame.borderWidth > 0) {
                frame.classList.add('has-frame');
            }
            if (this.zoomActive) frame.classList.add('zoom-active');

            const fit = (product.frame && product.frame.objectFit) || 'contain';
            this.el.mainImage.style.objectFit = fit;
            this.el.mainVideo.style.objectFit = fit;
        }

        // ============ NAVIGATION ============
        nextProduct() {
            if (this.currentIndex < this.products.length - 1) {
                this.currentIndex++;
                this.updateProductDisplay();
            }
        }

        prevProduct() {
            if (this.currentIndex > 0) {
                this.currentIndex--;
                this.updateProductDisplay();
            }
        }

        viewProduct(id) {
            const index = this.products.findIndex(p => p.id === id);
            if (index !== -1) {
                this.currentIndex = index;
                this.closeGrid();
                this.updateProductDisplay({ animate: false });
            }
        }

        // ============ IMAGE INTERACTION ============
        handleImageTap(e) {
            e.stopPropagation();
            const p = this.products[this.currentIndex];
            if (p && p.productType === 'text') return;

            if (this.doubleTapTimer) {
                clearTimeout(this.doubleTapTimer);
                this.doubleTapTimer = null;
                this.toggleExpand();
                return;
            }
            this.doubleTapTimer = setTimeout(() => {
                this.doubleTapTimer = null;
                this.toggleZoom();
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
                frame.style.position = '';
                frame.style.top = '';
                frame.style.left = '';
                frame.style.width = '';
                frame.style.height = '';
                frame.style.zIndex = '';
                frame.style.padding = '';
                frame.style.border = '';
                document.body.style.overflow = '';
                this.el.splitContainer.classList.remove('fullview-active');
                const p = this.products[this.currentIndex];
                if (p) this.applyFrameStyle(p);
            } else {
                frame.classList.add('expanded');
                frame.style.position = 'fixed';
                frame.style.top = '0';
                frame.style.left = '0';
                frame.style.width = '100vw';
                frame.style.height = '100vh';
                frame.style.zIndex = '3000';
                frame.style.padding = '40px';
                frame.style.border = 'none';
                frame.classList.remove('has-frame');
                document.body.style.overflow = 'hidden';
                this.el.splitContainer.classList.add('fullview-active');
            }
        }

        // ============ SAVE / SHARE ============
        toggleSave() {
            const p = this.products[this.currentIndex];
            if (!p) return;

            if (this.savedItems.has(p.id)) {
                this.savedItems.delete(p.id);
                this.showNotification('Removed from saved');
            } else {
                this.savedItems.add(p.id);
                this.showNotification('Saved to collection');
            }
            localStorage.setItem(LS_KEYS.SAVED, JSON.stringify([...this.savedItems]));
            this.updateSaveButton();
        }

        async shareProduct() {
            const p = this.products[this.currentIndex];
            if (!p) return;

            this.showLoading(true);
            try {
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
                this.showNotification('Share failed', 'error');
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

        // ============ GRID ============
        openGrid() {
            this.renderGrid('all');
            this.el.gridOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        closeGrid() {
            this.el.gridOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        filterGrid(filter) {
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
            this.renderGrid(filter);
        }

        toggleGridDetails() {
            this.gridDetailsVisible = !this.gridDetailsVisible;
            document.querySelectorAll('.grid-item-info').forEach(el => {
                el.classList.toggle('hidden', !this.gridDetailsVisible);
            });
        }

        renderGrid(filter) {
            let filtered = [];
            if (filter === 'saved') {
                filtered = this.products.filter(p => this.savedItems.has(p.id));
            } else if (filter === 'all') {
                filtered = this.products;
            } else {
                filtered = this.products.filter(p => p.type === filter);
            }

            this.el.gridContainer.innerHTML = filtered.map(p => `
                <div class="grid-item" onclick="app.viewProduct(${p.id})">
                    ${p.productType === 'video' ? `<video src="${p.image}" muted loop playsinline></video>` :
                      p.productType === 'text' ? `<div style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--color-light);font-size:12px;color:var(--color-gray);text-align:center;padding:10px;">${(p.content||p.title||'').substring(0,40)}</div>` :
                      `<img src="${p.image}" alt="${p.title}" loading="lazy">`}
                    <div class="grid-item-info ${this.gridDetailsVisible ? '' : 'hidden'}">
                        <div class="grid-item-title">${p.title}</div>
                        ${p.showPrice !== false ? `<div class="grid-item-price">${this.formatPrice(p.basePrice)}</div>` : ''}
                        <div class="grid-item-meta">
                            <span class="grid-item-type">${p.type}</span>
                            ${this.savedItems.has(p.id) ? '<span class="grid-item-saved">♡</span>' : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }

        // ============ CHECKOUT ============
        openCheckout() {
            const p = this.products[this.currentIndex];
            if (!p || p.stock <= 0) {
                this.showNotification('Item sold out', 'error');
                return;
            }

            this.checkoutQuantity = 1;
            this.selectedShipping = 'standard';
            this.selectedPaymentProvider = 'paystack';
            this.el.bankDetailsPanel.classList.remove('active');

            document.querySelectorAll('input[name="paymentProvider"]').forEach(r => r.checked = r.value === 'paystack');
            document.querySelectorAll('.payment-method-option').forEach(o => {
                o.classList.toggle('selected', o.querySelector('input').value === 'paystack');
            });
            document.querySelectorAll('.shipping-option').forEach(o => {
                o.classList.toggle('selected', o.querySelector('input').value === 'standard');
                o.querySelector('input').checked = o.querySelector('input').value === 'standard';
            });

            this.updateCheckoutDisplay();
            this.el.checkoutPanel.classList.add('active');
            this.el.checkoutOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        closeCheckout() {
            this.el.checkoutPanel.classList.remove('active');
            this.el.checkoutOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        updateCheckoutDisplay() {
            const p = this.products[this.currentIndex];
            if (!p) return;

            this.el.checkoutProductPreview.innerHTML = `
                <div class="order-item">
                    <img src="${p.image}" alt="${p.title}">
                    <div class="order-item-details">
                        <div class="order-item-title">${p.title}</div>
                        <div class="order-item-price">${this.formatPrice(p.basePrice)}</div>
                    </div>
                </div>
            `;

            this.el.checkoutQuantity.textContent = this.checkoutQuantity;

            const isArt = p.type === 'original' || p.basePrice > 1000;
            const subtotal = p.basePrice * this.checkoutQuantity;
            const shipping = isArt ? 0 : (this.selectedShipping === 'express' ? this.settings.shipExp : this.settings.shipStd) * this.checkoutQuantity;
            const tax = isArt ? 0 : subtotal * 0.08;
            const total = subtotal + shipping + tax;

            this.el.checkoutSubtotal.textContent = this.formatPrice(subtotal);
            this.el.checkoutShipping.textContent = isArt ? 'Quote' : this.formatPrice(shipping);
            this.el.checkoutTax.textContent = this.formatPrice(tax);
            this.el.checkoutTotal.textContent = this.formatPrice(total);
            this.el.shippingStandardPrice.textContent = this.formatPrice(this.settings.shipStd);
            this.el.shippingExpressPrice.textContent = this.formatPrice(this.settings.shipExp);

            document.getElementById('decreaseQty').disabled = this.checkoutQuantity <= 1;
            document.getElementById('increaseQty').disabled = this.checkoutQuantity >= p.stock;
        }

        updateQuantity(delta) {
            const p = this.products[this.currentIndex];
            const newQty = this.checkoutQuantity + delta;
            if (newQty >= 1 && newQty <= p.stock) {
                this.checkoutQuantity = newQty;
                this.updateCheckoutDisplay();
            }
        }

        selectShipping(type) {
            this.selectedShipping = type;
            document.querySelectorAll('.shipping-option').forEach(opt => {
                opt.classList.toggle('selected', opt.querySelector('input').value === type);
                opt.querySelector('input').checked = opt.querySelector('input').value === type;
            });
            this.updateCheckoutDisplay();
        }

        validateCheckoutForm() {
            let isValid = true;
            const email = this.el.checkoutEmail.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                document.getElementById('emailError').textContent = 'Valid email required';
                this.el.checkoutEmail.classList.add('error');
                isValid = false;
            } else {
                document.getElementById('emailError').textContent = '';
                this.el.checkoutEmail.classList.remove('error');
            }

            const name = this.el.checkoutName.value.trim();
            if (!name) {
                document.getElementById('nameError').textContent = 'Name required';
                this.el.checkoutName.classList.add('error');
                isValid = false;
            } else {
                document.getElementById('nameError').textContent = '';
                this.el.checkoutName.classList.remove('error');
            }

            const address = this.el.checkoutAddress.value.trim();
            if (!address) {
                document.getElementById('addressError').textContent = 'Address required';
                this.el.checkoutAddress.classList.add('error');
                isValid = false;
            } else {
                document.getElementById('addressError').textContent = '';
                this.el.checkoutAddress.classList.remove('error');
            }
            return isValid;
        }

        async processPayment(method) {
            if (!this.validateCheckoutForm()) {
                this.showNotification('Please fill all required fields', 'error');
                return;
            }

            const p = this.products[this.currentIndex];
            const email = this.el.checkoutEmail.value.trim();
            const name = this.el.checkoutName.value.trim();
            const address = this.el.checkoutAddress.value.trim();
            const city = this.el.checkoutCity.value.trim();
            const zip = this.el.checkoutZip.value.trim();

            const paymentMethod = this.selectedPaymentProvider || 'paystack';
            const isArt = p.type === 'original' || p.basePrice > 1000;
            const subtotal = p.basePrice * this.checkoutQuantity;
            const shipping = isArt ? 0 : (this.selectedShipping === 'express' ? this.settings.shipExp : this.settings.shipStd) * this.checkoutQuantity;
            const tax = isArt ? 0 : subtotal * 0.08;
            const total = subtotal + shipping + tax;

            this.showLoading(true);

            if (!navigator.onLine) {
                const order = {
                    id: 'OFFLINE-' + Date.now(),
                    productId: p.id,
                    productTitle: p.title,
                    quantity: this.checkoutQuantity,
                    amount: total,
                    paymentMethod: paymentMethod,
                    customer: { email, name, address: `${address}, ${city} ${zip}` },
                    status: 'offline-queued',
                    date: new Date().toISOString()
                };
                this.orders.push(order);
                localStorage.setItem(LS_KEYS.ORDERS, JSON.stringify(this.orders));
                this.pushOfflineQueue(order);
                this.showNotification("You're offline — order saved for later", 'warning');
                this.closeCheckout();
                this.showLoading(false);
                return;
            }

            try {
                if (paymentMethod === 'bank_transfer') {
                    const orderNumber = 'VG-' + Date.now().toString(36).toUpperCase();
                    this.renderBankDetails({ order_number: orderNumber, amount: total, currency: this.selectedCurrency });
                    const order = {
                        id: orderNumber,
                        productId: p.id,
                        productTitle: p.title,
                        quantity: this.checkoutQuantity,
                        amount: total,
                        paymentMethod: 'bank_transfer',
                        customer: { email, name, address: `${address}, ${city} ${zip}` },
                        status: 'pending',
                        date: new Date().toISOString()
                    };
                    this.orders.push(order);
                    localStorage.setItem(LS_KEYS.ORDERS, JSON.stringify(this.orders));
                    this.updateCustomerData(order.customer);
                } else if (paymentMethod === 'paystack') {
                    const handler = PaystackPop.setup({
                        key: 'pk_test_your_key_here',
                        email: email,
                        amount: Math.round(total * 100),
                        currency: this.selectedCurrency,
                        ref: `VG-${Date.now()}`,
                        metadata: {
                            product_id: p.id,
                            product_title: p.title,
                            quantity: this.checkoutQuantity
                        },
                        callback: (response) => {
                            this.paymentSuccess(response, email, name, address, city, zip);
                        },
                        onClose: () => {
                            this.showLoading(false);
                            this.showNotification('Payment cancelled');
                        }
                    });
                    handler.openIframe();
                    return;
                } else {
                    this.showNotification('Flutterwave payment simulated — success', 'success');
                    setTimeout(() => {
                        this.paymentSuccess({ reference: `FLW-${Date.now()}` }, email, name, address, city, zip);
                    }, 1500);
                    return;
                }
            } catch (e) {
                this.showNotification('Payment failed: ' + e.message, 'error');
            }
            this.showLoading(false);
        }

        paymentSuccess(response, email, name, address, city, zip) {
            this.showLoading(false);
            const p = this.products[this.currentIndex];
            const order = {
                id: response.reference,
                productId: p.id,
                productTitle: p.title,
                quantity: this.checkoutQuantity,
                amount: p.basePrice * this.checkoutQuantity,
                paymentMethod: this.selectedPaymentProvider,
                customer: { email, name, address: `${address}, ${city} ${zip}` },
                status: 'paid',
                date: new Date().toISOString()
            };
            this.orders.push(order);
            localStorage.setItem(LS_KEYS.ORDERS, JSON.stringify(this.orders));
            p.stock -= this.checkoutQuantity;
            this.saveProducts();
            this.updateCustomerData(order.customer);
            this.showNotification('Payment successful!', 'success');
            this.closeCheckout();
            this.updateProductDisplay({ animate: false });
        }

        renderBankDetails(data) {
            this.el.bankLocalDetails.innerHTML = 'Bank: GTBank<br>Account #: 0123456789<br>Name: V. Gallery';
            this.el.bankDomDetails.innerHTML = 'Bank: GTBank<br>Account #: 0123456789<br>Name: V. Gallery<br>SWIFT: GTBINGLA';
            this.el.bankRefNumber.textContent = data.order_number;
            this.el.bankDetailsPanel.classList.add('active');
            this.el.whatsappProofBtn.onclick = () => {
                const msg = encodeURIComponent(`Hi ${this.settings.storeName}, payment sent for order ${data.order_number} (${data.amount} ${data.currency}).`);
                window.open(`https://wa.me/${this.settings.whatsapp}?text=${msg}`, '_blank');
            };
        }

        updateCustomerData(customer) {
            const existing = this.customers.get(customer.email) || {
                email: customer.email,
                name: customer.name,
                orders: 0,
                totalSpent: 0,
                lastOrder: null
            };
            existing.orders++;
            existing.totalSpent += this.products[this.currentIndex].basePrice * this.checkoutQuantity;
            existing.lastOrder = new Date().toISOString();
            this.customers.set(customer.email, existing);
            localStorage.setItem(LS_KEYS.CUSTOMERS, JSON.stringify([...this.customers]));
        }

        whatsappInquiry() {
            const p = this.products[this.currentIndex];
            const message = encodeURIComponent(`Hi, interested in *${p.title}* by ${p.author || 'V.'}.\nPrice: ${this.formatPrice(p.basePrice)}\nQuantity: ${this.checkoutQuantity}`);
            window.open(`https://wa.me/${this.settings.whatsapp}?text=${message}`, '_blank');
        }

        // ============ CURRENCY ============
        cycleCurrency() {
            const currencies = ['USD', 'EUR', 'GBP', 'NGN'];
            const currentIdx = currencies.indexOf(this.selectedCurrency);
            this.selectedCurrency = currencies[(currentIdx + 1) % currencies.length];
            localStorage.setItem(LS_KEYS.CURRENCY, this.selectedCurrency);
            this.el.currencyDisplay.textContent = this.selectedCurrency;
            this.updateProductDisplay({ animate: false });
            if (this.el.checkoutPanel.classList.contains('active')) {
                this.updateCheckoutDisplay();
            }
        }

        formatPrice(usd) {
            const rate = CONFIG.exchangeRates[this.selectedCurrency] || 1;
            const converted = usd * rate;
            const symbols = { USD: '$', EUR: '€', GBP: '£', NGN: '₦' };
            return (symbols[this.selectedCurrency] || '$') + converted.toFixed(this.selectedCurrency === 'NGN' ? 0 : 2);
        }

        // ============ ADMIN ============
        openAdmin() {
            if (!this.adminAuthed) {
                this.openAdminLogin();
                return;
            }
            this.switchAdminTab('dashboard');
            this.renderAdminDashboard();
            this.renderAdminProducts();
            this.renderAdminOrders();
            this.renderAdminCustomers();
            this.el.storeName.value = this.settings.storeName;
            this.el.standardShipping.value = this.settings.shipStd;
            this.el.expressShipping.value = this.settings.shipExp;
            document.getElementById('settingWhatsapp').value = this.settings.whatsapp;
            this.updateSyncBadge();
            this.el.adminOverlay.classList.add('active');
            this.el.adminPanel.classList.add('active');
            this.el.adminGearBtn.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        closeAdmin() {
            this.el.adminOverlay.classList.remove('active');
            this.el.adminPanel.classList.remove('active');
            this.el.adminGearBtn.classList.remove('active');
            document.body.style.overflow = '';
        }

        async sha256(text) {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        openAdminLogin() {
            const setup = !localStorage.getItem(LS_KEYS.ADMIN_HASH);
            this.el.adminLoginHint.textContent = setup ? 'Set a passcode to protect this dashboard.' : 'Enter your passcode.';
            this.el.adminPasscodeInput.value = '';
            this.el.adminLoginError.textContent = '';
            this.el.adminLoginOverlay.classList.add('active');
        }

        closeAdminLogin() {
            this.el.adminLoginOverlay.classList.remove('active');
        }

        async submitAdminLogin() {
            const pass = this.el.adminPasscodeInput.value;
            if (pass.length < 4) {
                this.el.adminLoginError.textContent = 'Passcode must be at least 4 characters.';
                return;
            }
            const storedHash = localStorage.getItem(LS_KEYS.ADMIN_HASH);
            if (!storedHash) {
                const hash = await this.sha256(pass);
                localStorage.setItem(LS_KEYS.ADMIN_HASH, hash);
                this.adminAuthed = true;
                this.closeAdminLogin();
                this.showNotification('Passcode set. Welcome in.');
                this.openAdmin();
                return;
            }
            const hash = await this.sha256(pass);
            if (hash === storedHash) {
                this.adminAuthed = true;
                this.closeAdminLogin();
                this.openAdmin();
            } else {
                this.el.adminLoginError.textContent = 'Incorrect passcode.';
            }
        }

        logoutAdmin() {
            this.adminAuthed = false;
            this.closeAdmin();
            this.showNotification('Logged out');
        }

        changePasscode() {
            localStorage.removeItem(LS_KEYS.ADMIN_HASH);
            this.closeAdmin();
            this.openAdminLogin();
        }

        switchAdminTab(tab) {
            document.querySelectorAll('.admin-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            document.querySelectorAll('.admin-section').forEach(s => {
                const sectionId = 'admin' + tab.charAt(0).toUpperCase() + tab.slice(1);
                s.classList.toggle('active', s.id === sectionId);
            });
        }

        renderAdminDashboard() {
            const revenue = this.orders.reduce((s, o) => s + (o.amount || 0), 0);
            this.el.totalRevenue.textContent = this.formatPrice(revenue);
            this.el.totalOrders.textContent = this.orders.length;
            this.el.totalProducts.textContent = this.products.length;
            this.el.lowStockCount.textContent = this.products.filter(p => p.stock <= 2).length;
            this.el.recentOrdersBody.innerHTML = this.orders.slice(-6).reverse().map(o => `
                <tr><td>${String(o.id).slice(0,10)}</td><td>${o.customer?.name||'N/A'}</td><td>${this.formatPrice(o.amount||0)}</td><td>${o.status||'pending'}</td><td>${new Date(o.date).toLocaleDateString()}</td></tr>
            `).join('');
        }

        renderAdminProducts() {
            this.el.adminProductsBody.innerHTML = this.products.map(p => `
                <tr>
                    <td><img src="${p.image}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;"></td>
                    <td>${p.title}</td>
                    <td>${p.productType||'image'}</td>
                    <td>${this.formatPrice(p.basePrice)}</td>
                    <td><input type="number" value="${p.stock}" min="0" onchange="app.updateStock(${p.id}, this.value)" style="width:56px;padding:4px;"></td>
                    <td>
                        <button class="admin-btn" onclick="app.openEditModal(${p.id})">Edit</button>
                        <button class="admin-btn admin-btn-danger" onclick="app.deleteProduct(${p.id})">Delete</button>
                    </td>
                </tr>
            `).join('');
        }

        renderAdminOrders() {
            this.el.adminOrdersBody.innerHTML = this.orders.map(o => `
                <tr>
                    <td>${String(o.id).slice(0,10)}</td>
                    <td>${o.customer?.name||'N/A'}</td>
                    <td>${o.productTitle} × ${o.quantity||1}</td>
                    <td>${this.formatPrice(o.amount||0)}</td>
                    <td>${o.paymentMethod||'paystack'}</td>
                    <td>
                        <select onchange="app.updateOrderStatus('${o.id}', this.value)">
                            <option value="paid" ${o.status==='paid'?'selected':''}>Paid</option>
                            <option value="processing" ${o.status==='processing'?'selected':''}>Processing</option>
                            <option value="shipped" ${o.status==='shipped'?'selected':''}>Shipped</option>
                            <option value="delivered" ${o.status==='delivered'?'selected':''}>Delivered</option>
                        </select>
                    </td>
                    <td>${new Date(o.date).toLocaleDateString()}</td>
                </tr>
            `).join('');
        }

        renderAdminCustomers() {
            const customers = [...this.customers.values()];
            this.el.adminCustomersBody.innerHTML = customers.map(c => `
                <tr><td>${c.name}</td><td>${c.email}</td><td>${c.orders}</td><td>${this.formatPrice(c.totalSpent)}</td><td>${c.lastOrder ? new Date(c.lastOrder).toLocaleDateString() : 'Never'}</td></tr>
            `).join('');
        }

        updateStock(productId, newStock) {
            const product = this.products.find(p => p.id === productId);
            if (product) {
                product.stock = parseInt(newStock);
                this.saveProducts();
                this.showNotification('Stock updated');
            }
        }

        updateOrderStatus(orderId, status) {
            const order = this.orders.find(o => o.id === orderId);
            if (order) {
                order.status = status;
                localStorage.setItem(LS_KEYS.ORDERS, JSON.stringify(this.orders));
                this.showNotification('Order status updated');
            }
        }

        deleteProduct(productId) {
            if (this.products.length <= 1) {
                this.showNotification('Cannot delete the last product', 'error');
                return;
            }
            if (!confirm('Delete this product?')) return;
            this.products = this.products.filter(p => p.id !== productId);
            this.saveProducts();
            if (this.currentIndex >= this.products.length) {
                this.currentIndex = Math.max(0, this.products.length - 1);
            }
            this.renderAdminProducts();
            this.updateProductDisplay({ animate: false });
            this.showNotification('Product deleted');
        }

        // ============ EDIT MODAL ============
        openEditModal(productId = null) {
            this.editingId = productId;
            this.uploadedFileData = null;

            if (productId) {
                const p = this.products.find(p => p.id === productId);
                if (p) {
                    this.el.editModalTitle.textContent = 'Edit Product';
                    this.el.editTitle.value = p.title || '';
                    this.el.editAuthor.value = p.author || 'V.';
                    this.el.editShowAuthor.checked = p.showAuthor !== false;
                    this.el.editDescription.value = p.description || '';
                    this.el.editContentOrder.value = p.contentOrder === 'description-first' ? 'description-first' : 'title-first';
                    this.el.editType.value = p.type || 'original';
                    this.el.editPrice.value = p.basePrice || '';
                    this.el.editShowPrice.checked = p.showPrice !== false;
                    this.el.editStock.value = p.stock || 1;
                    this.el.editShowStock.checked = p.showStock !== false;
                    this.el.editOrientation.value = p.orientation || 'square';
                    this.el.editImageUrl.value = p.image || '';
                    this.el.editProductType.value = p.productType || 'image';
                    this.el.editTextContent.value = p.content || '';
                    this.el.editVideoAutoplay.checked = p.videoAutoplay !== undefined ? p.videoAutoplay : true;
                    this.el.editVideoLoop.checked = p.videoLoop !== undefined ? p.videoLoop : true;
                    this.el.editVideoMuted.checked = p.videoMuted !== undefined ? p.videoMuted : true;
                    this.el.editBorderWidth.value = (p.frame && p.frame.borderWidth) || 0;
                    this.el.editBorderColor.value = (p.frame && p.frame.borderColor) || '#000000';
                    this.el.editObjectFit.value = (p.frame && p.frame.objectFit) || 'contain';
                    this.el.editFontFamily.value = p.fontFamily || CONFIG.DEFAULT_FONT.fontFamily;
                    this.el.editFontWeight.value = p.fontWeight || CONFIG.DEFAULT_FONT.fontWeight;
                    this.el.editFontSize.value = p.fontSize || CONFIG.DEFAULT_FONT.fontSize;
                    this.el.editTextTransform.value = p.textTransform || CONFIG.DEFAULT_FONT.textTransform;
                    this.loadBgPanel('top', p.backgroundTop);
                    this.loadBgPanel('bottom', p.backgroundBottom);
                    this.el.deleteProductBtn.style.display = 'block';
                }
            } else {
                this.el.editModalTitle.textContent = 'Add Product';
                this.el.editTitle.value = '';
                this.el.editAuthor.value = 'V.';
                this.el.editShowAuthor.checked = true;
                this.el.editDescription.value = '';
                this.el.editContentOrder.value = 'title-first';
                this.el.editType.value = 'original';
                this.el.editPrice.value = '';
                this.el.editShowPrice.checked = true;
                this.el.editStock.value = '1';
                this.el.editShowStock.checked = true;
                this.el.editOrientation.value = 'square';
                this.el.editImageUrl.value = '';
                this.el.editProductType.value = 'image';
                this.el.editTextContent.value = '';
                this.el.editVideoAutoplay.checked = true;
                this.el.editVideoLoop.checked = true;
                this.el.editVideoMuted.checked = true;
                this.el.editBorderWidth.value = '0';
                this.el.editBorderColor.value = '#000000';
                this.el.editObjectFit.value = 'contain';
                this.el.editFontFamily.value = CONFIG.DEFAULT_FONT.fontFamily;
                this.el.editFontWeight.value = CONFIG.DEFAULT_FONT.fontWeight;
                this.el.editFontSize.value = CONFIG.DEFAULT_FONT.fontSize;
                this.el.editTextTransform.value = CONFIG.DEFAULT_FONT.textTransform;
                this.loadBgPanel('top', CONFIG.DEFAULT_BG);
                this.loadBgPanel('bottom', CONFIG.DEFAULT_BG);
                this.el.deleteProductBtn.style.display = 'none';
            }

            this.toggleBgHalf('top');
            this.toggleProductTypeUI();
            this.el.previewMain.style.display = 'none';
            this.el.previewVideo.style.display = 'none';
            this.el.fileSizeWarning.classList.remove('visible');
            document.getElementById('deviceFileUpload').value = '';
            this.el.editModal.classList.add('active');
        }

        closeEditModal() {
            this.el.editModal.classList.remove('active');
        }

        toggleBgHalf(half) {
            this.editingBgHalf = half;
            document.querySelectorAll('.bg-half-toggle button').forEach(b => {
                b.classList.toggle('active', b.dataset.half === half);
            });
            this.el.bgPanelTop.classList.toggle('active', half === 'top');
            this.el.bgPanelBottom.classList.toggle('active', half === 'bottom');
        }

        loadBgPanel(half, bg) {
            bg = bg || CONFIG.DEFAULT_BG;
            const sel = document.querySelector(`.bg-type-select[data-half="${half}"]`);
            if (sel) sel.value = bg.type || 'color';
            const color1 = document.querySelector(`.bg-color1[data-half="${half}"]`);
            if (color1) color1.value = bg.color1 || '#f8f8f8';
            const color2 = document.querySelector(`.bg-color2[data-half="${half}"]`);
            if (color2) color2.value = bg.color2 || '#e0e0e0';
            const mediaUrl = document.querySelector(`.bg-media-url[data-half="${half}"]`);
            if (mediaUrl) mediaUrl.value = bg.mediaUrl || '';
            this.updateBgColorRow(half);
        }

        updateBgColorRow(half) {
            const sel = document.querySelector(`.bg-type-select[data-half="${half}"]`);
            const row = document.querySelector(`.bg-color2-row[data-half="${half}"]`);
            const mediaRow = document.querySelector(`.bg-media-row[data-half="${half}"]`);
            if (row && sel) {
                row.style.display = sel.value === 'gradient' ? 'flex' : 'none';
            }
            if (mediaRow && sel) {
                mediaRow.classList.toggle('visible', sel.value === 'image' || sel.value === 'video');
            }
        }

        toggleProductTypeUI() {
            const type = this.el.editProductType.value;
            const isVideo = type === 'video';
            const isText = type === 'text';

            this.el.mediaSection.style.display = (type === 'image' || isVideo) ? 'block' : 'none';
            this.el.videoControls.classList.toggle('visible', isVideo);
            this.el.textSection.classList.toggle('visible', isText);
            this.el.fileUploadSection.classList.toggle('visible', type === 'image' || isVideo);
        }

        handleDeviceFileUpload(input) {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                const isVideo = file.type.startsWith('video/');
                const isImage = file.type.startsWith('image/');

                if (!isVideo && !isImage) {
                    this.showNotification('Please select an image or video file', 'error');
                    return;
                }

                if (file.size > 5 * 1024 * 1024) {
                    this.el.fileSizeWarning.classList.add('visible');
                } else {
                    this.el.fileSizeWarning.classList.remove('visible');
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    this.uploadedFileData = e.target.result;
                    if (isImage) {
                        this.el.previewMain.src = e.target.result;
                        this.el.previewMain.style.display = 'block';
                        this.el.previewVideo.style.display = 'none';
                    } else if (isVideo) {
                        this.el.previewVideo.src = e.target.result;
                        this.el.previewVideo.style.display = 'block';
                        this.el.previewMain.style.display = 'none';
                    }
                    this.el.editImageUrl.value = '';
                };
                reader.readAsDataURL(file);
            }
        }

        deleteCurrentProduct() {
            if (this.editingId) {
                this.closeEditModal();
                this.deleteProduct(this.editingId);
            }
        }

        saveProduct(event) {
            event.preventDefault();

            const title = this.el.editTitle.value.trim();
            if (!title) { this.showNotification('Title is required', 'error'); return; }

            const productType = this.el.editProductType.value;
            const url = this.el.editImageUrl.value.trim();
            const imageData = this.uploadedFileData || url;

            if ((productType === 'image' || productType === 'video') && !imageData) {
                this.showNotification('Please provide an image URL or upload a file', 'error');
                return;
            }
            if (productType === 'text' && !this.el.editTextContent.value.trim()) {
                this.showNotification('Text content is required for text products', 'error');
                return;
            }

            const readBg = (half) => ({
                type: document.querySelector(`.bg-type-select[data-half="${half}"]`).value,
                color1: document.querySelector(`.bg-color1[data-half="${half}"]`).value,
                color2: document.querySelector(`.bg-color2[data-half="${half}"]`).value,
                mediaUrl: document.querySelector(`.bg-media-url[data-half="${half}"]`).value.trim()
            });

            const product = {
                id: this.editingId || Date.now(),
                title: title,
                author: this.el.editAuthor.value.trim() || 'V.',
                showAuthor: this.el.editShowAuthor.checked,
                description: this.el.editDescription.value.trim(),
                contentOrder: this.el.editContentOrder.value,
                type: this.el.editType.value,
                basePrice: parseFloat(this.el.editPrice.value) || 0,
                showPrice: this.el.editShowPrice.checked,
                stock: parseInt(this.el.editStock.value) || 0,
                showStock: this.el.editShowStock.checked,
                orientation: this.el.editOrientation.value,
                image: imageData,
                productType: productType,
                content: this.el.editTextContent.value.trim() || '',
                videoAutoplay: this.el.editVideoAutoplay.checked,
                videoLoop: this.el.editVideoLoop.checked,
                videoMuted: this.el.editVideoMuted.checked,
                frame: {
                    borderWidth: parseInt(this.el.editBorderWidth.value) || 0,
                    borderColor: this.el.editBorderColor.value || '#000000',
                    objectFit: this.el.editObjectFit.value || 'contain'
                },
                backgroundTop: readBg('top'),
                backgroundBottom: readBg('bottom'),
                fontFamily: this.el.editFontFamily.value,
                fontWeight: parseInt(this.el.editFontWeight.value) || 400,
                fontSize: parseInt(this.el.editFontSize.value) || 11,
                textTransform: this.el.editTextTransform.value || 'none'
            };

            if (this.editingId) {
                const index = this.products.findIndex(p => p.id === this.editingId);
                if (index !== -1) {
                    this.products[index] = { ...this.products[index], ...product };
                }
            } else {
                this.products.push(product);
                this.currentIndex = this.products.length - 1;
            }

            this.saveProducts();
            this.closeEditModal();
            this.renderAdminProducts();
            this.updateProductDisplay({ animate: false });
            this.showNotification(this.editingId ? 'Product updated' : 'Product added');
        }

        // ============ SETTINGS ============
        saveSettings() {
            this.settings.storeName = this.el.storeName.value.trim() || 'V. Gallery';
            this.settings.shipStd = parseFloat(this.el.standardShipping.value) || 0;
            this.settings.shipExp = parseFloat(this.el.expressShipping.value) || 0;
            this.settings.whatsapp = document.getElementById('settingWhatsapp').value.trim();
            localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(this.settings));
            localStorage.setItem(LS_KEYS.BRAND, this.settings.storeName);
            this.el.galleryBrand.textContent = 'v.gallery.shop';
            this.showNotification('Settings saved');
        }

        uploadLogo(input) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    localStorage.setItem(LS_KEYS.LOGO, e.target.result);
                    this.el.logoImage.src = e.target.result;
                    this.el.logoContainer.classList.add('has-logo');
                    if (this.el.logoPreview) {
                        this.el.logoPreview.src = e.target.result;
                        this.el.logoPreview.style.display = 'block';
                    }
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        // ============ DATA EXPORT/IMPORT ============
        exportData() {
            const blob = new Blob([JSON.stringify(this.products, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vgallery_catalog_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showNotification('Catalog exported');
        }

        importData() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        if (!Array.isArray(data)) throw new Error('bad format');
                        this.products = data;
                        this.saveProducts();
                        this.currentIndex = 0;
                        this.updateProductDisplay({ animate: false });
                        this.renderAdminProducts();
                        this.showNotification('Catalog restored');
                    } catch (err) {
                        this.showNotification('Invalid catalog file', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }

        async exportPdf() {
            if (!window.jspdf) {
                this.showNotification('PDF library unavailable', 'error');
                return;
            }
            this.showLoading(true);
            try {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
                const pageWidth = pdf.internal.pageSize.getWidth();
                const originalIndex = this.currentIndex;
                for (let i = 0; i < this.products.length; i++) {
                    this.currentIndex = i;
                    this.updateProductDisplay({ animate: false });
                    await new Promise(r => setTimeout(r, 350));
                    const canvas = await html2canvas(this.el.splitContainer, {
                        scale: 1.5,
                        backgroundColor: '#ffffff',
                        useCORS: true,
                        logging: false
                    });
                    const imgData = canvas.toDataURL('image/png');
                    const imgHeight = (canvas.height * pageWidth) / canvas.width;
                    if (i > 0) pdf.addPage();
                    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, imgHeight, undefined, 'FAST');
                }
                pdf.save(`vgallery_catalog_${new Date().toISOString().slice(0,10)}.pdf`);
                this.currentIndex = originalIndex;
                this.updateProductDisplay({ animate: false });
                this.showNotification('PDF exported');
            } catch (e) {
                this.showNotification('PDF export failed', 'error');
            }
            this.showLoading(false);
        }

        // ============ PWA & OFFLINE ============
        setupPwa() {
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('sw.js').catch(() => {});
                });
            }

            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredInstallPrompt = e;
                const dismissed = sessionStorage.getItem('vgallery_install_dismissed');
                if (!dismissed) this.el.installToast.classList.add('active');
            });

            document.getElementById('installConfirm').onclick = async () => {
                this.el.installToast.classList.remove('active');
                if (this.deferredInstallPrompt) {
                    this.deferredInstallPrompt.prompt();
                    await this.deferredInstallPrompt.userChoice;
                    this.deferredInstallPrompt = null;
                }
            };
            document.getElementById('installDismiss').onclick = () => {
                this.el.installToast.classList.remove('active');
                sessionStorage.setItem('vgallery_install_dismissed', '1');
            };

            window.addEventListener('online', () => {
                this.isOnline = true;
                this.updateOfflineBanner();
                this.updateSyncBadge();
                this.flushOfflineQueue();
            });
            window.addEventListener('offline', () => {
                this.isOnline = false;
                this.updateOfflineBanner();
                this.updateSyncBadge();
            });
        }

        updateOfflineBanner() {
            this.el.offlineBanner.classList.toggle('active', !this.isOnline);
        }

        updateSyncBadge() {
            if (this.el.syncBadge) {
                this.el.syncBadge.textContent = this.isOnline ? 'Synced' : 'Local mode';
                this.el.syncBadge.className = 'sync-badge ' + (this.isOnline ? 'online' : 'offline');
            }
        }

        pushOfflineQueue(item) {
            const q = JSON.parse(localStorage.getItem(LS_KEYS.OFFLINE_QUEUE) || '[]');
            q.push(item);
            localStorage.setItem(LS_KEYS.OFFLINE_QUEUE, JSON.stringify(q));
        }

        flushOfflineQueue() {
            const q = JSON.parse(localStorage.getItem(LS_KEYS.OFFLINE_QUEUE) || '[]');
            if (q.length) {
                this.showNotification(`You're back online — ${q.length} order(s) waiting`, 'warning');
            }
        }

        // ============ EVENT LISTENERS ============
        setupEventListeners() {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeCheckout();
                    this.closeGrid();
                    this.closeAdmin();
                    this.closeEditModal();
                    this.closeShare();
                    this.closeAdminLogin();
                }
                if (!this.isModalOpen()) {
                    if (e.key === 'ArrowRight') this.nextProduct();
                    if (e.key === 'ArrowLeft') this.prevProduct();
                    if (e.key === 's' || e.key === 'S') this.toggleSave();
                }
            });

            this.el.heartButton.addEventListener('click', () => this.toggleSave());
            this.el.shareButton.addEventListener('click', () => this.shareProduct());

            document.querySelectorAll('input[name="paymentProvider"]').forEach(r => {
                r.addEventListener('change', (e) => {
                    this.selectedPaymentProvider = e.target.value;
                    document.querySelectorAll('.payment-method-option').forEach(o => {
                        o.classList.toggle('selected', o.querySelector('input').value === e.target.value);
                    });
                    this.el.bankDetailsPanel.classList.remove('active');
                });
            });

            document.getElementById('adminLoginCancel').onclick = () => this.closeAdminLogin();
            document.getElementById('adminLoginSubmit').onclick = () => this.submitAdminLogin();
            this.el.adminPasscodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.submitAdminLogin();
            });

            let brandTapCount = 0, brandTapTimer;
            this.el.galleryBrand.addEventListener('click', () => {
                brandTapCount++;
                clearTimeout(brandTapTimer);
                brandTapTimer = setTimeout(() => { brandTapCount = 0; }, 320);
                if (brandTapCount === 2) {
                    brandTapCount = 0;
                    document.body.classList.toggle('dark-mode');
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem(LS_KEYS.DARK, isDark ? '1' : '0');
                    this.showNotification('Dark mode: ' + (isDark ? 'on' : 'off'));
                    this.updateProductDisplay({ animate: false });
                }
            });
        }

        setupSwipe() {
            let startX = 0;
            document.addEventListener('touchstart', (e) => {
                if (this.isModalOpen()) return;
                startX = e.touches[0].clientX;
            });
            document.addEventListener('touchend', (e) => {
                if (this.isModalOpen()) return;
                const diff = e.changedTouches[0].clientX - startX;
                if (Math.abs(diff) > 50) {
                    diff > 0 ? this.prevProduct() : this.nextProduct();
                }
            });
        }

        isModalOpen() {
            return this.el.checkoutPanel?.classList.contains('active') ||
                   this.el.gridOverlay?.classList.contains('active') ||
                   this.el.adminOverlay?.classList.contains('active') ||
                   this.el.editModal?.classList.contains('active') ||
                   this.el.shareOverlay?.classList.contains('active') ||
                   this.el.adminLoginOverlay?.classList.contains('active');
        }

        // ============ UTILITIES ============
        showLoading(show) {
            this.el.loading.classList.toggle('active', show);
        }

        showNotification(message, type = 'success') {
            const notification = this.el.notification;
            notification.textContent = message;
            notification.className = 'notification ' + type;
            notification.classList.add('active');
            clearTimeout(this._notifTimer);
            this._notifTimer = setTimeout(() => notification.classList.remove('active'), 3000);
        }

        showTerms() {
            document.getElementById('termsModal').classList.add('active');
        }

        showPrivacy() {
            document.getElementById('privacyModal').classList.add('active');
        }

        closeModal(type) {
            document.getElementById(type + 'Modal').classList.remove('active');
        }
    }

    // ============ INIT ============
    window.app = new VGalleryApp();
    window.app.init();
})();
