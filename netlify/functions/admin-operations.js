import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPaymentConfirmedEmail } from './_lib/email.js';
import { getSettings } from './_lib/settings.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

function getClientIp(event) {
    const fwd = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
    return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

// Shared by create_product/update_product. Builds the full set of
// writable product columns — including frame_style/background_top/
// background_bottom/content/tags/compare_price/is_featured, which
// existed in the schema but were never wired up until now, plus the
// design-system columns added in migration 003 (media_kind,
// typography, visibility toggles, content order, video settings).
function productFieldsFromData(data) {
    const fields = {
        title: data.title,
        author: data.author || 'V.',
        description: data.description || '',
        type: data.type || 'merch',
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
        is_featured: !!data.is_featured
    };
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
                const { data: newProduct, error: createError } = await supabase
                    .from('products')
                    .insert({
                        product_id: newProductId,
                        ...productFieldsFromData(data),
                        is_active: true
                    })
                    .select()
                    .single();

                if (createError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: createError.message }) };
                }
                result = newProduct;
                break;
            }

            case 'update_product': {
                const { data: updatedProduct, error: updateError } = await supabase
                    .from('products')
                    .update({
                        ...productFieldsFromData(data),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', data.id)
                    .select()
                    .single();

                if (updateError) {
                    return { statusCode: 500, headers, body: JSON.stringify({ error: updateError.message }) };
                }
                result = updatedProduct;
                break;
            }

            case 'delete_product': {
                await supabase.from('products').update({ is_active: false }).eq('id', data.id);
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

            default:
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid operation: ' + operation }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (error) {
        console.error('Admin error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Operation failed: ' + error.message }) };
    }
};
