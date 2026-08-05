-- ============================================================
-- V. GALLERY — SCHEMA v3 (gap-closing additions)
-- Run this AFTER 001_complete_schema.sql, in Supabase SQL Editor.
--
-- Adds:
--   - discount_codes table + real validation/application in
--     create_pending_order() (the column already existed on
--     orders — it was just never populated)
--   - shipping_rates table, so shipping cost is looked up per
--     method+currency instead of a hardcoded flat 7/15
--   - settings table for a configurable tax rate per currency
--     (defaults to 0 — opt in by editing the row in Supabase's
--     Table Editor, no redeploy needed)
--   - mark_order_refunded(): the counterpart to mark_order_paid(),
--     called by admin-operations.js after a real refund is issued
--     through Paystack/Flutterwave (or manually, for bank transfer)
-- ============================================================

-- ---------------------------------------------------------------
-- DISCOUNT CODES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
    value DECIMAL(10,2) NOT NULL,
    currency TEXT, -- NULL = applies regardless of order currency
    is_active BOOLEAN DEFAULT true,
    usage_limit INTEGER, -- NULL = unlimited
    times_used INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(UPPER(code));

-- ---------------------------------------------------------------
-- SHIPPING RATES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    method TEXT NOT NULL,   -- 'standard' | 'express'
    currency TEXT NOT NULL, -- 'NGN' | 'USD'
    cost DECIMAL(10,2) NOT NULL,
    label TEXT,
    UNIQUE(method, currency)
);

INSERT INTO shipping_rates (method, currency, cost, label) VALUES
    ('standard', 'USD', 7, 'Standard Shipping'),
    ('express',  'USD', 15, 'Express Shipping'),
    ('standard', 'NGN', 5000, 'Standard Shipping'),
    ('express',  'NGN', 12000, 'Express Shipping')
ON CONFLICT (method, currency) DO NOTHING;

-- ---------------------------------------------------------------
-- SETTINGS (currently just tax rates — a generic key/value table
-- so more config can be added later without another migration)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Off by default. To turn on e.g. 7.5% VAT on NGN orders, update
-- this row's value to '0.075' in Supabase's Table Editor.
INSERT INTO settings (key, value) VALUES
    ('tax_rate_ngn', '0'),
    ('tax_rate_usd', '0')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------
-- RLS — same pattern as 001: service-role key only, default-deny
-- for anon on all three new tables.
-- ---------------------------------------------------------------
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- CREATE PENDING ORDER (v3) — now actually applies discount codes,
-- looks up shipping from shipping_rates instead of a hardcoded
-- flat rate, and applies a configurable tax rate. Same signature
-- as v2, so no changes needed in initialize-payment.js's call site
-- other than actually passing a real discount code through.
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
    v_shipping DECIMAL := 0;
    v_tax DECIMAL := 0;
    v_tax_rate DECIMAL := 0;
    v_discount_amount DECIMAL := 0;
    v_discount_row RECORD;
    v_has_discount BOOLEAN := false;
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

    -- --- Shipping: looked up per method+currency, admin-editable in
    -- Supabase's Table Editor without a redeploy. Falls back to 0
    -- (rather than erroring the whole order) if a rate is missing,
    -- so a misconfigured table can't block checkout entirely.
    SELECT cost INTO v_shipping FROM shipping_rates
    WHERE method = COALESCE(p_shipping_method, 'standard') AND currency = p_currency;
    v_shipping := COALESCE(v_shipping, 0);

    -- --- Discount code: validated server-side. A missing/expired/
    -- exhausted/wrong-currency code is rejected here, before any
    -- payment is initialized — never silently ignored.
    IF p_discount_code IS NOT NULL AND TRIM(p_discount_code) <> '' THEN
        SELECT * INTO v_discount_row FROM discount_codes
        WHERE UPPER(code) = UPPER(TRIM(p_discount_code))
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (usage_limit IS NULL OR times_used < usage_limit)
          AND (currency IS NULL OR currency = p_currency);

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired discount code');
        END IF;

        v_has_discount := true;

        IF v_discount_row.type = 'percent' THEN
            v_discount_amount := ROUND(v_subtotal * (v_discount_row.value / 100), 2);
        ELSE
            v_discount_amount := LEAST(v_discount_row.value, v_subtotal); -- never a negative subtotal
        END IF;
    END IF;

    -- --- Tax: configurable per currency via the settings table,
    -- applied to (subtotal - discount), off (0) by default.
    SELECT value::DECIMAL INTO v_tax_rate FROM settings WHERE key = 'tax_rate_' || lower(p_currency);
    v_tax_rate := COALESCE(v_tax_rate, 0);
    v_tax := ROUND((v_subtotal - v_discount_amount) * v_tax_rate, 2);

    v_total := GREATEST(v_subtotal - v_discount_amount + v_shipping + v_tax, 0);

    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');

    INSERT INTO orders (
        order_id, customer_email, customer_name, customer_phone,
        items, discount_code, discount_amount, subtotal, shipping_cost,
        tax_amount, total_amount, currency,
        payment_provider, shipping_method, customer_address, order_status
    ) VALUES (
        v_order_number, p_customer_email, p_customer_name, p_customer_phone,
        p_items,
        CASE WHEN v_discount_amount > 0 THEN UPPER(TRIM(p_discount_code)) ELSE NULL END,
        v_discount_amount, v_subtotal, v_shipping,
        v_tax, v_total, p_currency,
        p_payment_provider, p_shipping_method, p_customer_address, 'pending'
    ) RETURNING id INTO v_order_id;

    IF v_has_discount THEN
        UPDATE discount_codes SET times_used = times_used + 1 WHERE id = v_discount_row.id;
    END IF;

    INSERT INTO customers (email, name, phone)
    VALUES (p_customer_email, p_customer_name, p_customer_phone)
    ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name, phone = EXCLUDED.phone;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_number,
        'amount', v_total,
        'currency', p_currency,
        'breakdown', jsonb_build_object(
            'subtotal', v_subtotal,
            'shipping', v_shipping,
            'tax', v_tax,
            'discount', v_discount_amount
        )
    );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- MARK ORDER REFUNDED
-- Called by admin-operations.js's 'refund_order' operation AFTER
-- the actual refund has been issued through Paystack's/Flutterwave's
-- API (or, for bank_transfer orders, after the admin has manually
-- sent the money back — there's no refund API for that path).
-- This function only ever updates OUR records; it never moves money
-- itself. Restocking is optional (p_restock) since a damaged/
-- non-returnable item might be refunded without going back on shelf.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_order_refunded(
    p_order_id UUID,
    p_refund_reference TEXT DEFAULT NULL,
    p_restock BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_order.payment_status != 'paid' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only paid orders can be refunded (current status: ' || v_order.payment_status || ')');
    END IF;

    IF p_restock THEN
        FOR v_item IN SELECT * FROM jsonb_to_recordset(v_order.items) AS x(product_id TEXT, quantity INT)
        LOOP
            UPDATE products
            SET stock = stock + v_item.quantity,
                sales_count = GREATEST(sales_count - v_item.quantity, 0),
                updated_at = NOW()
            WHERE product_id = v_item.product_id;
        END LOOP;
    END IF;

    UPDATE orders
    SET payment_status = 'refunded',
        order_status = 'cancelled',
        notes = COALESCE(notes || E'\n', '') || 'Refunded' || COALESCE(' (' || p_refund_reference || ')', ''),
        updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE customers
    SET total_spent = GREATEST(total_spent - v_order.total_amount, 0),
        updated_at = NOW()
    WHERE email = v_order.customer_email;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_order.order_id);
END;
$$ LANGUAGE plpgsql;

SELECT '✅ Schema v3 complete — discount codes, configurable shipping/tax, and refunds are set up.' as status;
