import { createClient } from '@supabase/supabase-js';
import { sendOrderReceivedEmail } from './_lib/email.js';
import { getSettings } from './_lib/settings.js';
import { rateLimit, getClientIp } from './_lib/rate-limit.js';

const VALID_PROVIDERS = ['paystack', 'flutterwave', 'bank_transfer'];

export const handler = async (event) => {
    // SECURITY: CORS origin must match SITE_URL exactly.
    const headers = {
        'Access-Control-Allow-Origin': process.env.SITE_URL || '',
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

        // SECURITY: Rate limit — 10 order attempts per IP per 10 minutes
        const ip = getClientIp(event);
        const allowed = await rateLimit(supabase, ip, 'initialize-payment', 10, 10);
        if (!allowed) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many order attempts. Try again later.' }) };
        }

        let body = {};
        try {
            body = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
        }

        const {
            email, name, phone,
            productId, quantity,          // legacy single-product fields
            items,                       // new multi-item cart array
            shippingMethod, address, city, zip,
            paymentProvider, currency, discountCode,
            country
        } = body;

        // Normalize items array (support both old single-product and new multi-item)
        let orderItems = [];
        if (Array.isArray(items) && items.length > 0) {
            orderItems = items.map(it => ({
                product_id: it.productId || it.product_id,
                quantity: parseInt(it.quantity, 10) || 1
            }));
        } else if (productId && quantity) {
            orderItems = [{ product_id: productId, quantity: parseInt(quantity, 10) }];
        }

        // --- Validation ---
        if (!email || !name || orderItems.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
        }
        const provider = VALID_PROVIDERS.includes(paymentProvider) ? paymentProvider : 'paystack';
        const orderCurrency = provider === 'flutterwave' && currency === 'USD' ? 'USD' : (currency || 'NGN');

        // SECURITY: Rate limit discount code attempts — 20 per IP per 10 minutes
        if (discountCode) {
            const discountAllowed = await rateLimit(supabase, ip, 'discount-attempt', 20, 10);
            if (!discountAllowed) {
                return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many discount attempts. Try again later.' }) };
            }
        }

        // --- Create the order server-side (server computes the total) ---
        const { data: orderData, error: orderError } = await supabase.rpc('create_pending_order', {
            p_customer_email: email,
            p_customer_name: name,
            p_customer_phone: phone || '',
            p_items: orderItems,
            p_discount_code: discountCode || null,
            p_shipping_method: shippingMethod || 'standard',
            p_customer_address: { street: address || '', city: city || '', zip: zip || '' },
            p_payment_provider: provider,
            p_currency: orderCurrency,
            p_country: country || ''
        });

        if (orderError || !orderData || !orderData.success) {
            console.error('Order creation error:', orderError, orderData);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: orderData?.error || 'Failed to create order' })
            };
        }

        const { order_id, order_number, amount, breakdown } = orderData;
        const siteUrl = process.env.SITE_URL || 'http://localhost:8888';

        // ============================================================
        // BANK TRANSFER / DOMICILIARY — no external API call. The order
        // stays "pending" until an admin manually confirms receipt via
        // the dashboard (which calls mark_order_paid the same way the
        // webhooks do).
        // ============================================================
        if (provider === 'bank_transfer') {
            await supabase.rpc('set_payment_reference', { p_order_id: order_id, p_reference: order_number });

            const settings = await getSettings(supabase);
            const whatsappNumber = settings.whatsapp_number || process.env.WHATSAPP_NUMBER || '';
            const storeName = settings.store_name || 'V. Gallery';

            const bankDetails = {
                local: {
                    bank_name: process.env.BANK_LOCAL_NAME || '',
                    account_number: process.env.BANK_LOCAL_ACCOUNT_NUMBER || '',
                    account_name: process.env.BANK_LOCAL_ACCOUNT_NAME || ''
                },
                domiciliary: {
                    bank_name: process.env.BANK_DOM_NAME || '',
                    account_number: process.env.BANK_DOM_ACCOUNT_NUMBER || '',
                    account_name: process.env.BANK_DOM_ACCOUNT_NAME || '',
                    swift_code: process.env.BANK_DOM_SWIFT_CODE || ''
                }
            };

            await sendOrderReceivedEmail({
                customer_email: email,
                customer_name: name,
                order_id: order_number,
                total_amount: amount,
                currency: orderCurrency,
                bank_details: bankDetails,
                whatsapp_number: whatsappNumber
            }, storeName);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    provider: 'bank_transfer',
                    order_number,
                    amount,
                    breakdown,
                    currency: orderCurrency,
                    bank_details: bankDetails,
                    whatsapp_number: whatsappNumber,
                    message: `Transfer ${amount} ${orderCurrency} using reference ${order_number}, then send proof of payment via WhatsApp.`
                })
            };
        }

        // ============================================================
        // PAYSTACK
        // ============================================================
        if (provider === 'paystack') {
            const amountInSubunit = Math.round(parseFloat(amount) * 100);

            const paymentResponse = await fetch('https://api.paystack.co/transaction/initialize', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    amount: amountInSubunit,
                    currency: orderCurrency,
                    reference: order_number,
                    callback_url: `${siteUrl}/payment-callback.html?provider=paystack&reference=${order_number}`,
                    metadata: { order_id, order_number }
                })
            });

            const paymentData = await paymentResponse.json();

            if (!paymentData.status) {
                return { statusCode: 502, headers, body: JSON.stringify({ error: paymentData.message || 'Paystack initialization failed' }) };
            }

            await supabase.rpc('set_payment_reference', { p_order_id: order_id, p_reference: order_number });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    provider: 'paystack',
                    authorization_url: paymentData.data.authorization_url,
                    reference: order_number,
                    order_number,
                    amount,
                    breakdown
                })
            };
        }

        // ============================================================
        // FLUTTERWAVE
        // ============================================================
        if (provider === 'flutterwave') {
            const paymentResponse = await fetch('https://api.flutterwave.com/v3/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tx_ref: order_number,
                    amount: amount,
                    currency: orderCurrency,
                    redirect_url: `${siteUrl}/payment-callback.html?provider=flutterwave&reference=${order_number}`,
                    customer: { email, name, phonenumber: phone || '' },
                    customizations: { title: 'V. Gallery', description: `Order ${order_number}` },
                    meta: { order_id, order_number }
                })
            });

            const paymentData = await paymentResponse.json();

            if (paymentData.status !== 'success') {
                return { statusCode: 502, headers, body: JSON.stringify({ error: paymentData.message || 'Flutterwave initialization failed' }) };
            }

            await supabase.rpc('set_payment_reference', { p_order_id: order_id, p_reference: order_number });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    provider: 'flutterwave',
                    authorization_url: paymentData.data.link,
                    reference: order_number,
                    order_number,
                    amount,
                    breakdown
                })
            };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported payment provider' }) };

    } catch (error) {
        console.error('Payment error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Payment initialization failed: ' + error.message }) };
    }
};
