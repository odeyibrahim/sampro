-- ============================================================
-- V. GALLERY — COMPLETE DATABASE SCHEMA (v2)
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New query)
--
-- Changes from v1:
--   - orders.payment_provider (paystack | flutterwave | bank_transfer)
--   - orders.transaction_id (provider's own charge/transaction id)
--   - mark_order_paid(): single atomic, idempotent function that both
--     the webhooks AND the admin dashboard call to confirm payment.
--     It locks the order row, refuses to double-process, decrements
--     stock, and updates customer stats — all in one transaction.
--   - create_pending_order() now accepts a payment_provider param.
--   - login_attempts table for basic admin brute-force protection.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    author TEXT DEFAULT 'V.',
    description TEXT,
    type TEXT CHECK (type IN ('original', 'print', 'merch', 'craft', 'text')),
    base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    compare_price DECIMAL(10,2),
    stock INTEGER DEFAULT 0,
    orientation TEXT DEFAULT 'square',
    image_url TEXT,
    variations TEXT[] DEFAULT '{}',
    content TEXT,
    frame_style JSONB DEFAULT '{"borderWidth":0,"borderColor":"#000","padding":0,"objectFit":"contain"}',
    background JSONB DEFAULT '{"type":"color","color":"#f8f8f8"}',
    tags TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    likes_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- ORDERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id TEXT UNIQUE NOT NULL,
    customer_id UUID,
    customer_email TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    customer_address JSONB,
    items JSONB NOT NULL,
    discount_code TEXT,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'NGN',
    payment_provider TEXT CHECK (payment_provider IN ('paystack', 'flutterwave', 'bank_transfer')),
    payment_reference TEXT UNIQUE,
    transaction_id TEXT,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    order_status TEXT DEFAULT 'pending' CHECK (order_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    shipping_method TEXT,
    tracking_number TEXT,
    notes TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    addresses JSONB DEFAULT '[]'::jsonb,
    wishlist TEXT[] DEFAULT '{}',
    orders_count INTEGER DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    last_order_at TIMESTAMPTZ,
    newsletter BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- ADMIN SESSIONS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- LOGIN ATTEMPTS (basic brute-force protection on /admin login)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address TEXT NOT NULL,
    success BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- PRODUCT LIKES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id TEXT NOT NULL,
    user_id UUID REFERENCES customers(id),
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, user_id, session_id)
);

-- ---------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_product_id ON products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_reference ON orders(payment_reference);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, created_at);

-- ---------------------------------------------------------------
-- ROW LEVEL SECURITY
-- All writes happen through Netlify functions using the service-role
-- key, which bypasses RLS entirely. RLS here only governs what the
-- ANON key (never actually used by this frontend, but defense-in-depth
-- in case a key ever leaks) is allowed to see.
-- ---------------------------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active products" ON products
    FOR SELECT USING (is_active = true);
-- No policies on orders / customers / admin_sessions / login_attempts:
-- default-deny for the anon key. Only the service-role key (used
-- server-side only) can read/write these.

-- ---------------------------------------------------------------
-- LIKES HELPERS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_likes(p_product_id TEXT)
RETURNS void AS $$
BEGIN
    UPDATE products SET likes_count = likes_count + 1
    WHERE product_id = p_product_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_likes(p_product_id TEXT)
RETURNS void AS $$
BEGIN
    UPDATE products SET likes_count = GREATEST(likes_count - 1, 0)
    WHERE product_id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- CREATE PENDING ORDER
-- Computes the total SERVER-SIDE from the products table.
-- The client only ever sends product_id + quantity — never a price.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_pending_order(
    p_customer_email TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_items JSONB,
    p_discount_code TEXT,
    p_shipping_method TEXT,
    p_customer_address JSONB,
    p_payment_provider TEXT DEFAULT 'paystack',
    p_currency TEXT DEFAULT 'NGN'
)
RETURNS JSONB AS $$
DECLARE
    v_order_id UUID;
    v_order_number TEXT;
    v_subtotal DECIMAL := 0;
    v_shipping DECIMAL;
    v_total DECIMAL;
    v_item RECORD;
    v_product RECORD;
BEGIN
    -- Walk each requested line item, look up the REAL price and stock
    -- from the products table, and refuse if stock is insufficient.
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INT)
    LOOP
        SELECT * INTO v_product FROM products
        WHERE product_id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Product not found: ' || v_item.product_id);
        END IF;

        IF v_product.stock < v_item.quantity THEN
            RETURN jsonb_build_object('success', false, 'error', 'Insufficient stock for: ' || v_product.title);
        END IF;

        v_subtotal := v_subtotal + (v_product.base_price * v_item.quantity);
    END LOOP;

    -- Bank transfers / originals typically ship free or are quoted;
    -- everything else uses the flat rates below. Adjust as needed.
    v_shipping := CASE WHEN p_shipping_method = 'express' THEN 15 ELSE 7 END;
    v_total := v_subtotal + v_shipping;

    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');

    INSERT INTO orders (
        order_id, customer_email, customer_name, customer_phone,
        items, subtotal, shipping_cost, total_amount, currency,
        payment_provider, shipping_method, customer_address, order_status
    ) VALUES (
        v_order_number, p_customer_email, p_customer_name, p_customer_phone,
        p_items, v_subtotal, v_shipping, v_total, p_currency,
        p_payment_provider, p_shipping_method, p_customer_address, 'pending'
    ) RETURNING id INTO v_order_id;

    INSERT INTO customers (email, name, phone)
    VALUES (p_customer_email, p_customer_name, p_customer_phone)
    ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name, phone = EXCLUDED.phone;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_number,
        'amount', v_total,
        'currency', p_currency
    );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- MARK ORDER PAID
-- The ONE place that turns "pending" into "paid". Called by:
--   - paystack-webhook.js   (after signature verification)
--   - flutterwave-webhook.js (after signature verification)
--   - admin-operations.js  ('confirm_bank_payment', for manual
--     bank/domiciliary transfers an admin has visually confirmed)
--
-- It is idempotent: calling it twice for the same reference (e.g. a
-- webhook retry, or a webhook arriving after an admin already
-- confirmed it) is a safe no-op the second time. It locks the order
-- row (FOR UPDATE) so two near-simultaneous calls can't both pass
-- the "already paid?" check and double-decrement stock.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_order_paid(
    p_reference TEXT,
    p_payment_method TEXT,
    p_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
BEGIN
    SELECT * INTO v_order FROM orders
    WHERE payment_reference = p_reference
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found for reference: ' || p_reference);
    END IF;

    IF v_order.payment_status = 'paid' THEN
        -- Already processed by an earlier webhook/admin call. Not an error.
        RETURN jsonb_build_object('success', true, 'already_processed', true, 'order_id', v_order.id);
    END IF;

    -- Decrement stock and bump sales_count for each line item.
    FOR v_item IN SELECT * FROM jsonb_to_recordset(v_order.items) AS x(product_id TEXT, quantity INT)
    LOOP
        UPDATE products
        SET stock = GREATEST(stock - v_item.quantity, 0),
            sales_count = sales_count + v_item.quantity,
            updated_at = NOW()
        WHERE product_id = v_item.product_id;
    END LOOP;

    UPDATE orders
    SET payment_status = 'paid',
        order_status = 'processing',
        payment_method = p_payment_method,
        transaction_id = p_transaction_id,
        paid_at = NOW(),
        updated_at = NOW()
    WHERE id = v_order.id;

    UPDATE customers
    SET orders_count = orders_count + 1,
        total_spent = total_spent + v_order.total_amount,
        last_order_at = NOW(),
        updated_at = NOW()
    WHERE email = v_order.customer_email;

    RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'order_number', v_order.order_id);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- SET PAYMENT REFERENCE
-- Called right after a Paystack/Flutterwave initialize call succeeds,
-- so the order row can be matched up when the webhook arrives.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_payment_reference(
    p_order_id UUID,
    p_reference TEXT
)
RETURNS void AS $$
BEGIN
    UPDATE orders SET payment_reference = p_reference, updated_at = NOW()
    WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- LOGIN ATTEMPT HELPERS (basic brute-force protection)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION count_recent_failed_logins(p_ip TEXT, p_minutes INT DEFAULT 15)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM login_attempts
    WHERE ip_address = p_ip
      AND success = false
      AND created_at > NOW() - (p_minutes || ' minutes')::INTERVAL;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- SAMPLE PRODUCTS (safe to remove once you've added your own)
-- ---------------------------------------------------------------
INSERT INTO products (product_id, title, author, description, type, base_price, stock, orientation, image_url, variations, is_featured) VALUES
('prod_001', 'Archive Tee', 'V.', 'Archive Tee — a relic of soft cotton.\nScreen printed by hand in Los Angeles.', 'merch', 45, 10, 'square', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800', ARRAY[]::TEXT[], true),
('prod_002', 'Desert Landscape', 'V.', 'Archival photograph from the high desert.\nSigned and numbered edition of 50.', 'print', 195, 5, 'landscape', 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800', ARRAY['https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=800'], true),
('prod_003', 'Silent Currents', 'V.', 'Original mixed media on canvas, 2024.\nA unique piece.', 'original', 8500, 1, 'landscape', 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800', ARRAY[]::TEXT[], true),
('prod_004', 'Evening Study', 'V.', 'Limited edition giclée print.\nMuseum quality, archival ink.', 'print', 295, 20, 'portrait', 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=800', ARRAY['https://images.unsplash.com/photo-1549887534-1541e9326642?w=800'], true),
('prod_005', 'Silence Between Words', 'V.', 'A poem about the spaces we inhabit.\nDigital download.', 'text', 12, 999, 'square', 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800', ARRAY[]::TEXT[], false)
ON CONFLICT (product_id) DO NOTHING;

SELECT '✅ Schema v2 complete — products, orders, atomic payment confirmation, and login protection are set up.' as status;
