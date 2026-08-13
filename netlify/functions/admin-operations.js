import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPaymentConfirmedEmail } from './_lib/email.js';
import { getSettings } from './_lib/settings.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

// Helper: resolve the correct match key/value for a lookup by id or product_id.
// Prevents 'invalid input syntax for type uuid: "undefined"' when
// the client sends product_id (text) but the query used id (uuid).
function resolveId(data) {
    if (data.id) return { key: 'id', val: data.id };
    if (data.product_id) return { key: 'product_id', val: data.product_id };
    return null;
}

function getClientIp(event) {
    const fwd = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
    return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

// Helper: generate a URL-safe slug from a title.
function slugify(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s\u00A0]+/g, '-')          // spaces → hyphens
        .replace(/[^a-z0-9\-\u00C0-\u024F]+/g, '') // remove non-alphanumeric (keep accented latin)
        .replace(/-+/g, '-')                       // collapse multiple hyphens
        .replace(/^-|-$/g, '');                     // trim leading/trailing hyphens
}

// Shared by create_product/update_product. Builds the full set of
// writable product columns — including frame_style/background_top/
// background_bottom/content/tags/compare_price/is_featured, which
// existed in the schema but were never wired up until now, plus the
// design-system columns added in migration 003 (media_kind,
// typography, visibility toggles, content order, video settings),
// and the SEO slug from migration 005.
function productFieldsFromData(data, { excludeShare, excludeSlug } = {}) {
    const fields = {
        title: data.title,
        slug: excludeSlug ? undefined : (data.slug || slugify(data.title)),
        author: data.author || 'V.',
        description: data.description || '',
        type: ['original', 'print', 'merch', 'craft', 'text'].includes(data.type) ? data.type : null,
        media_kind: ['image', 'video', 'text'].includes(data.media_kind) ? data.media_kind : 'image',
        base_price: parseFloat(data.base_price) || 0,
        compare_price: data.compare_price ? parseFloat(data.compare_price) : null,
        stock: parseInt(data.stock) || 0,
        orientation: data.orientation || 'square',
        image_url: data.image_url || '',
        variations: data.variations || [],
        content: data.content || '',
        frame_style: data.frame_style || { borderWidth: 0, borderColor: '#000', padding: 0, objectFit: 'contain' },
        background_top: data.background_top || { type: 'color', color1: '#f8f8f8', color2: '#e0e0e0', mediaUrl: '' },
        background_bottom: data.background_bottom || { type: 'color', color1: '#f8f8f8', color2: '#e0e0e0', mediaUrl: '' },
        font_family: data.font_family || "'Copperplate', serif",
        font_size: parseInt(data.font_size) || 11,
        font_weight: parseInt(data.font_weight) || 400,
        text_transform: ['none', 'uppercase', 'capitalize'].includes(data.text_transform) ? data.text_transform : 'none',
        show_author: data.show_author !== false,
        show_price: data.show_price !== false,
        show_stock: data.show_stock !== false,
        content_order: data.content_order === 'description-first' ? 'description-first' : 'title-first',
        video_autoplay: data.video_autoplay !== false,
        video_loop: data.video_loop !== false,
        video_muted: data.video_muted !== false,
        tags: Array.isArray(data.tags) ? data.tags : [],
        is_featured: !!data.is_featured,
        collection: data.collection || null,
        sort_order: parseInt(data.sort_order) || 0
    };
    if (!excludeShare) {
        fields.show_share = !!data.show_share;
    }
    return fields;
}

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let requestBody = {};
        try {
            requestBody = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
        }

        const adminToken = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
        const { operation, data } = requestBody;

        // ============================================================
        // LOGIN — fails closed if ADMIN_PASSWORD_HASH isn't configured.
        // No "demo mode" fallback: an unset hash is a configuration
        // error, not an open door.
        // ============================================================
        if (operation === 'login') {
            const clientIp = getClientIp(event);

            const { data: recentFailures } = await supabase.rpc('count_recent_failed_logins', {
                p_ip: clientIp,
                p_minutes: LOCKOUT_WINDOW_MINUTES
            });

            if ((recentFailures || 0) >= MAX_FAILED_ATTEMPTS) {
                return {
                    statusCode: 429,
                    headers,
                    body: JSON.stringify({ error: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.` })
                };
            }

            const configuredHash = process.env.ADMIN_PASSWORD_HASH;
            if (!configuredHash) {
                console.error('ADMIN_PASSWORD_HASH is not set — refusing all admin logins.');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Admin login is not configured. Set ADMIN_PASSWORD_HASH.' })
                };
            }

            const { password } = data || {};
            if (!password) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Password required' }) };
            }

            const isValid = bcrypt.compareSync(password, configuredHash);

            await supabase.from('login_attempts').insert({ ip_address: clientIp, success: isValid });

            if (!isValid) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            const { error: insertError } = await supabase
                .from('admin_sessions')
                .insert({ token, expires_at: expiresAt.toISOString() });

            if (insertError) {
                console.error('Session insert error:', insertError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create session' }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true, token }) };
        }

        // ============================================================
        // Every other operation requires a valid, unexpired session.
        // ============================================================
        if (!adminToken) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin authentication required' }) };
        }

        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('*')
            .eq('token', adminToken)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired admin session' }) };
        }

        let result;

        switch (operation) {
            case 'logout': {
                await supabase.from('admin_sessions').delete().eq('token', adminToken);
                result = { success: true };
                break;
            }

            case 'get_stats': {
                const [ordersResult, revenueResult, productsResult, customersResult] = await Promise.all([
                    supabase.from('orders').select('*', { count: 'exact', head: true }),
                    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
                    supabase.from('products').select('*', { count: 'exact', head: true }),
                    supabase.from('customers').select('*', { count: 'exact', head: true })
                ]);

                const revenue = revenueResult.data || [];
                const totalRevenue = revenue.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

                result = {
                    totalRevenue,
                    totalOrders: ordersResult.count || 0,
                    totalProducts: productsResult.count || 0,
                    totalCustomers: customersResult.count || 0
                };
                break;
            }

            case 'get_products': {
                const { data: products } = await supabase
                    .from('products')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = products || [];
                break;
            }

            case 'create_product': {
                const newProductId = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                let { data: newProduct, error: createError } = await supabase
                    .from('products')
                    .insert({
                        product_id: newProductId,
                        ...productFieldsFromData(data),
                        is_active: true
                    })
                    .select()
                    .single();

                // Fallback: retry without columns that may not exist yet
                if (createError && ((createError.message || '').includes('show_share') || (createError.message || '').includes('slug'))) {
                    const opts = {};
                    if ((createError.message || '').includes('show_share')) opts.excludeShare = true;
                    if ((createError.message || '').includes('slug')) opts.excludeSlug = true;
                    const retry = await supabase
                        .from('products')
                        .insert({
                            product_id: newProductId,
                            ...productFieldsFromData(data, opts),
                            is_active: true
                        })
                        .select()
                        .single();
                    if (retry.error) return { statusCode: 500, headers, body: JSON.stringify({ error: retry.error.message }) };
                    result = retry.data;
                } else if (createError && (createError.message || '').includes('unique') && (createError.message || '').includes('slug')) {
                    // Slug collision — append random suffix
                    const baseSlug = data.slug || slugify(data.title);
                    const uniqueSlug = baseSlug + '-' + Math.random().toString(36).substr(2, 4);
                    const retry = await supabase
                        .from('products')
                        .insert({
                            product_id: newProductId,
                            ...productFieldsFromData({ ...data, slug: uniqueSlug }),
                            is_active: true
                        })
                        .select()
                        .single();
                    if (retry.error) return { statusCode: 500, headers, body: JSON.stringify({ error: retry.error.message }) };
                    result = retry.data;
                } else if (createError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: createError.message }) };
                } else {
                    result = newProduct;
                }
                break;
            }

            case 'update_product': {
                const prodMatch = resolveId(data);
                if (!prodMatch) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product id required' }) };
                let { data: updatedProduct, error: updateError } = await supabase
                    .from('products')
                    .update({
                        ...productFieldsFromData(data),
                        updated_at: new Date().toISOString()
                    })
                    .eq(prodMatch.key, prodMatch.val)
                    .select()
                    .single();

                // Fallback: retry without columns that may not exist yet
                if (updateError && ((updateError.message || '').includes('show_share') || (updateError.message || '').includes('slug'))) {
                    const opts = {};
                    if ((updateError.message || '').includes('show_share')) opts.excludeShare = true;
                    if ((updateError.message || '').includes('slug')) opts.excludeSlug = true;
                    const retry = await supabase
                        .from('products')
                        .update({
                            ...productFieldsFromData(data, opts),
                            updated_at: new Date().toISOString()
                        })
                        .eq(prodMatch.key, prodMatch.val)
                        .select()
                        .single();
                    if (retry.error) return { statusCode: 500, headers, body: JSON.stringify({ error: retry.error.message }) };
                    result = retry.data;
                } else if (updateError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: updateError.message }) };
                } else {
                    result = updatedProduct;
                }
                break;
            }

            case 'delete_product': {
                const delMatch = resolveId(data);
                if (!delMatch) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product id required' }) };
                await supabase.from('products').update({ is_active: false }).eq(delMatch.key, delMatch.val);
                result = { success: true };
                break;
            }

            case 'update_stock': {
                const { data: updatedStock, error: stockError } = await supabase
                    .from('products')
                    .update({ stock: parseInt(data.stock, 10) || 0, updated_at: new Date().toISOString() })
                    .eq('product_id', data.product_id)
                    .select()
                    .single();

                if (stockError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: stockError.message }) };
                }
                result = updatedStock;
                break;
            }

            case 'get_orders': {
                const { data: orders } = await supabase
                    .from('orders')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = orders || [];
                break;
            }

            case 'update_order_status': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order id required' }) };
                await supabase
                    .from('orders')
                    .update({ order_status: data.status, updated_at: new Date().toISOString() })
                    .eq('id', data.id);
                result = { success: true };
                break;
            }

            // ------------------------------------------------------
            // Manual confirmation for bank/domiciliary transfers.
            // The admin has looked at the actual bank statement and
            // confirmed the money landed — this reuses the exact same
            // atomic, idempotent function the webhooks call, so stock
            // decrements and customer stats update consistently no
            // matter which payment path was used.
            // ------------------------------------------------------
            case 'confirm_bank_payment': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order id required' }) };
                const { data: order } = await supabase
                    .from('orders')
                    .select('payment_reference, payment_provider, order_id, customer_email, customer_name, total_amount, currency')
                    .eq('id', data.id)
                    .single();

                if (!order) {
                    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
                }
                if (order.payment_provider !== 'bank_transfer') {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order was not placed as a bank transfer' }) };
                }

                const { data: confirmResult, error: confirmError } = await supabase.rpc('mark_order_paid', {
                    p_reference: order.payment_reference,
                    p_payment_method: 'bank_transfer',
                    p_transaction_id: `admin-confirmed-${adminToken.slice(0, 8)}`
                });

                if (confirmError || !confirmResult?.success) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: confirmError?.message || 'Failed to confirm payment' }) };
                }

                if (!confirmResult.already_processed) {
                    const settingsForEmail = await getSettings(supabase);
                    await sendPaymentConfirmedEmail(order, settingsForEmail.store_name);
                }

                result = confirmResult;
                break;
            }

            // ------------------------------------------------------
            // REFUND — for paystack/flutterwave orders, actually calls
            // the provider's refund API using the stored transaction_id
            // before touching our own records. For bank_transfer orders
            // there's no refund API to call (same as there's no payment
            // API to call) — the admin sends the money back manually,
            // outside this system, and this just records that it
            // happened. Either way, mark_order_refunded() is the only
            // thing that changes payment_status/stock, mirroring how
            // mark_order_paid() is the single choke point on the way in.
            // ------------------------------------------------------
            case 'refund_order': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order id required' }) };
                const { data: order } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('id', data.id)
                    .single();

                if (!order) {
                    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
                }
                if (order.payment_status !== 'paid') {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: `Only paid orders can be refunded (current status: ${order.payment_status})` }) };
                }

                if (order.payment_provider === 'paystack') {
                    const resp = await fetch('https://api.paystack.co/refund', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ transaction: order.transaction_id || order.payment_reference })
                    });
                    const refundData = await resp.json();
                    if (!refundData.status) {
                        return { statusCode: 502, headers, body: JSON.stringify({ error: refundData.message || 'Paystack refund failed' }) };
                    }
                } else if (order.payment_provider === 'flutterwave') {
                    const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${order.transaction_id}/refund`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
                    });
                    const refundData = await resp.json();
                    if (refundData.status !== 'success') {
                        return { statusCode: 502, headers, body: JSON.stringify({ error: refundData.message || 'Flutterwave refund failed' }) };
                    }
                }
                // bank_transfer: no API call — admin has already sent the money back manually.

                const { data: refundResult, error: refundError } = await supabase.rpc('mark_order_refunded', {
                    p_order_id: data.id,
                    p_refund_reference: data.reason || null,
                    p_restock: data.restock !== false
                });

                if (refundError || !refundResult?.success) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: refundError?.message || refundResult?.error || 'Failed to record refund' }) };
                }
                result = refundResult;
                break;
            }

            // ------------------------------------------------------
            // DISCOUNT CODES
            // ------------------------------------------------------
            case 'get_discount_codes': {
                const { data: codes } = await supabase
                    .from('discount_codes')
                    .select('*')
                    .order('created_at', { ascending: false });
                result = codes || [];
                break;
            }

            case 'create_discount_code': {
                const { data: created, error: createDiscountError } = await supabase
                    .from('discount_codes')
                    .insert({
                        code: (data.code || '').toUpperCase().trim(),
                        type: data.type === 'fixed' ? 'fixed' : 'percent',
                        value: parseFloat(data.value) || 0,
                        currency: data.currency || null,
                        usage_limit: data.usage_limit ? parseInt(data.usage_limit, 10) : null,
                        expires_at: data.expires_at || null,
                        is_active: true
                    })
                    .select()
                    .single();

                if (createDiscountError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: createDiscountError.message }) };
                }
                result = created;
                break;
            }

            case 'toggle_discount_code': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Discount code id required' }) };
                const { data: updated, error: toggleError } = await supabase
                    .from('discount_codes')
                    .update({ is_active: !!data.is_active })
                    .eq('id', data.id)
                    .select()
                    .single();

                if (toggleError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: toggleError.message }) };
                }
                result = updated;
                break;
            }

            case 'delete_discount_code': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Discount code id required' }) };
                await supabase.from('discount_codes').delete().eq('id', data.id);
                result = { success: true };
                break;
            }

            case 'get_customers': {
                const { data: customers } = await supabase
                    .from('customers')
                    .select('*')
                    .order('total_spent', { ascending: false });
                result = customers || [];
                break;
            }

            // ------------------------------------------------------
            // SETTINGS — store name, logo URL, WhatsApp number, tax
            // rates. Generic key/value upsert so the admin UI never
            // needs the Supabase Table Editor for day-to-day changes.
            // ------------------------------------------------------
            case 'get_settings': {
                result = await getSettings(supabase);
                break;
            }

            // ------------------------------------------------------
            // DASHBOARD INIT — returns stats, products (summary),
            // recent orders, and settings in one round-trip so the
            // admin doesn't fire 4 separate cold-start invocations.
            // ------------------------------------------------------
            case 'dashboard_init': {
                const [ordersResult, revenueResult, productsResult, customersResult, ordersFull, settingsResult] = await Promise.all([
                    supabase.from('orders').select('*', { count: 'exact', head: true }),
                    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
                    supabase.from('products').select('*', { count: 'exact', head: true }),
                    supabase.from('customers').select('*', { count: 'exact', head: true }),
                    supabase.from('orders').select('*').order('created_at', { ascending: false }),
                    getSettings(supabase)
                ]);

                const revenue = revenueResult.data || [];
                const totalRevenue = revenue.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

                result = {
                    stats: {
                        totalRevenue,
                        totalOrders: ordersResult.count || 0,
                        totalProducts: productsResult.count || 0,
                        totalCustomers: customersResult.count || 0
                    },
                    products: (await supabase.from('products').select('*').order('created_at', { ascending: false })).data || [],
                    orders: ordersFull.data || [],
                    settings: settingsResult
                };
                break;
            }

            case 'update_settings': {
                const updates = data && typeof data === 'object' ? data : {};
                const rows = Object.keys(updates).map((key) => ({
                    key,
                    value: String(updates[key] ?? ''),
                    updated_at: new Date().toISOString()
                }));

                if (rows.length === 0) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No settings provided' }) };
                }

                const { error: settingsError } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
                if (settingsError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: settingsError.message }) };
                }
                result = await getSettings(supabase);
                break;
            }

            // ------------------------------------------------------
            // SHIPPING RATES — one row per (method, currency). Editing
            // here writes straight to the table create_pending_order()
            // already reads from, so changes apply to checkout
            // immediately, no redeploy.
            // ------------------------------------------------------
            case 'get_shipping_rates': {
                const { data: rates } = await supabase
                    .from('shipping_rates')
                    .select('*')
                    .order('currency', { ascending: true })
                    .order('method', { ascending: true });
                result = rates || [];
                break;
            }

            case 'update_shipping_rate': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping rate id required' }) };
                const { data: updatedRate, error: rateError } = await supabase
                    .from('shipping_rates')
                    .update({ cost: parseFloat(data.cost) || 0 })
                    .eq('id', data.id)
                    .select()
                    .single();

                if (rateError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: rateError.message }) };
                }
                result = updatedRate;
                break;
            }

            // ------------------------------------------------------
            // CSV IMPORT — bulk-create products from CSV rows.
            // Each row maps to the same schema as create_product.
            // Column headers must match the field names below.
            // ------------------------------------------------------
            case 'import_csv': {
                if (!Array.isArray(data.products) || data.products.length === 0) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No products in CSV data' }) };
                }

                const MAX_CSV = 200;
                if (data.products.length > MAX_CSV) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Maximum ' + MAX_CSV + ' products per import' }) };
                }

                const rows = data.products.map(function (p) {
                    const productId = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    return {
                        product_id: productId,
                        ...productFieldsFromData(p, { excludeShare: true, excludeSlug: true }),
                        is_active: true
                    };
                });

                const { data: inserted, error: csvError } = await supabase
                    .from('products')
                    .insert(rows)
                    .select();

                if (csvError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: csvError.message }) };
                }

                result = { imported: (inserted || []).length, total: data.products.length };
                break;
            }

            // ------------------------------------------------------
            // SHIPPING ZONES — country-based shipping CRUD
            // ------------------------------------------------------
            case 'get_shipping_zones': {
                const { data: zones } = await supabase
                    .from('shipping_zones')
                    .select('*')
                    .order('country_code', { ascending: true })
                    .order('method', { ascending: true });
                result = zones || [];
                break;
            }

            case 'create_shipping_zone': {
                if (!data.country_code || !data.method || !data.currency) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'country_code, method, and currency are required' }) };
                }
                const { data: created, error: zError } = await supabase
                    .from('shipping_zones')
                    .insert({
                        country_code: data.country_code.toUpperCase().trim(),
                        country_name: data.country_name || data.country_code,
                        method: data.method,
                        currency: data.currency.toUpperCase().trim(),
                        cost: parseFloat(data.cost) || 0,
                        estimated_days: data.estimated_days || '',
                        is_active: data.is_active !== false
                    })
                    .select()
                    .single();
                if (zError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: zError.message }) };
                }
                result = created;
                break;
            }

            case 'update_shipping_zone': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping zone id required' }) };
                const updates = {};
                if (data.country_code !== undefined) updates.country_code = data.country_code.toUpperCase().trim();
                if (data.country_name !== undefined) updates.country_name = data.country_name;
                if (data.method !== undefined) updates.method = data.method;
                if (data.currency !== undefined) updates.currency = data.currency.toUpperCase().trim();
                if (data.cost !== undefined) updates.cost = parseFloat(data.cost) || 0;
                if (data.estimated_days !== undefined) updates.estimated_days = data.estimated_days;
                if (data.is_active !== undefined) updates.is_active = !!data.is_active;
                updates.updated_at = new Date().toISOString();
                const { data: updated, error: zError } = await supabase
                    .from('shipping_zones')
                    .update(updates)
                    .eq('id', data.id)
                    .select()
                    .single();
                if (zError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: zError.message }) };
                }
                result = updated;
                break;
            }

            case 'delete_shipping_zone': {
                if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping zone id required' }) };
                await supabase.from('shipping_zones').delete().eq('id', data.id);
                result = { success: true };
                break;
            }

            // ------------------------------------------------------
            // LIVE CURRENCY RATES — force-refresh or toggle
            // ------------------------------------------------------
            case 'refresh_currency_rates': {
                // Trigger a live fetch by calling the public endpoint
                // (or inline the same logic). We inline to avoid
                // a serverless-to-serverless cold start.
                try {
                    const resp = await fetch('https://api.frankfurter.app/latest?from=USD', {
                        signal: AbortSignal.timeout(5000)
                    });
                    if (resp.ok) {
                        const fdata = await resp.json();
                        if (fdata && fdata.rates) {
                            const liveRates = JSON.stringify({ USD: 1, ...fdata.rates });
                            const now = new Date().toISOString();
                            await supabase.from('settings').upsert([
                                { key: 'live_rates_data', value: liveRates, updated_at: now },
                                { key: 'live_rates_last_fetched', value: now, updated_at: now }
                            ], { onConflict: 'key' });
                            result = { success: true, rates: JSON.parse(liveRates), updated_at: now };
                        } else {
                            result = { success: false, error: 'API returned unexpected data' };
                        }
                    } else {
                        result = { success: false, error: 'API returned status ' + resp.status };
                    }
                } catch (e) {
                    result = { success: false, error: 'Fetch failed: ' + e.message };
                }
                break;
            }

            // ------------------------------------------------------
            // REORDER PRODUCTS — drag-to-sort save
            // ------------------------------------------------------
            case 'reorder_products': {
                const order = data.order;
                if (!Array.isArray(order) || order.length === 0) {
                    result = { error: 'No order data provided' };
                    break;
                }
                try {
                    // Update sort_order for each product sequentially
                    // (avoids Supabase concurrent-write conflicts)
                    let failCount = 0;
                    for (const item of order) {
                        const res = await supabase
                            .from('products')
                            .update({ sort_order: item.sort_order })
                            .eq('product_id', item.product_id);
                        if (res.error) {
                            console.error('reorder update error:', item.product_id, res.error);
                            failCount++;
                        }
                    }
                    if (failCount > 0) {
                        result = { error: failCount + ' of ' + order.length + ' updates failed' };
                    } else {
                        result = { success: true, updated: order.length };
                    }
                } catch (e) {
                    result = { error: e.message };
                }
                break;
            }

            default:
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid operation: ' + operation }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (error) {
        console.error('Admin error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Operation failed: ' + error.message }) };
    }
};
