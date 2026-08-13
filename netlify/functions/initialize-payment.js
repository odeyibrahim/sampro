import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { getSettings } from './_lib/settings.js';

const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
    'Content-Type': 'application/json'
};

function getClientIp(event) {
    const fwd = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
    return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const body = JSON.parse(event.body || '{}');
        const { email, name, phone, items, address, city, zip, country, paymentProvider, currency, discountCode } = body;

        // Validate required fields
        if (!email || !name || !phone || !address || !city || !zip || !country) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, error: 'Missing required fields' })
            };
        }

        if (!Array.isArray(items) || items.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, error: 'No items in cart' })
            };
        }

        // Validate each item has required fields
        for (const item of items) {
            if (!item.productId || !item.quantity || item.quantity < 1) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ success: false, error: 'Invalid item in cart' })
                };
            }
        }

        const provider = paymentProvider || 'paystack';
        const orderCurrency = currency || 'NGN';

        // Fetch settings for store config
        const settings = await getSettings(supabase);
        const storeCountry = (settings.store_country || 'Nigeria').toLowerCase();
        const localTaxRate = parseFloat(settings.local_tax_rate) || 0;

        // Fetch product details from DB
        const productIds = items.map(i => i.productId);
        const { data: products, error: pError } = await supabase
            .from('products')
            .select('product_id, title, base_price, stock, image_url')
            .in('product_id', productIds);

        if (pError) throw pError;

        if (!products || products.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, error: 'Products not found' })
            };
        }

        // Build product map
        const productMap = {};
        products.forEach(p => { productMap[p.product_id] = p; });

        // Calculate subtotal
        let subtotal = 0;
        const orderItems = items.map(item => {
            const p = productMap[item.productId];
            if (!p) return null;
            const unitPrice = item.unitPrice || p.base_price || 0;
            subtotal += unitPrice * item.quantity;
            return {
                product_id: item.productId,
                product_title: p.title,
                quantity: item.quantity,
                unit_price: unitPrice,
                image_url: p.image_url
            };
        }).filter(Boolean);

        // Calculate shipping
        const customerCountry = country.toLowerCase();
        const isLocal = customerCountry.length > 0 && storeCountry.indexOf(customerCountry) !== -1;

        // Try shipping zones
        let shippingCost = 0;
        let shippingDays = '';
        const { data: zones } = await supabase
            .from('shipping_zones')
            .select('*')
            .eq('is_active', true);

        if (zones && zones.length > 0 && customerCountry) {
            for (const zone of zones) {
                const zoneCountry = (zone.country_code || '').toLowerCase();
                if (zoneCountry && customerCountry.indexOf(zoneCountry) !== -1) {
                    shippingCost = parseFloat(zone.cost) || 0;
                    shippingDays = zone.estimated_days || '';
                    break;
                }
            }
        }

        // Fallback shipping
        if (shippingCost === 0) {
            if (orderCurrency === 'NGN') {
                shippingCost = isLocal ? 5000 : 15000;
            } else {
                shippingCost = isLocal ? 7 : 25;
            }
            shippingDays = isLocal ? '3-5' : '1-2 weeks';
        }

        // Calculate tax (only for local)
        const taxRate = isLocal ? localTaxRate / 100 : 0;
        const tax = Math.round(subtotal * taxRate * 100) / 100;

        // Calculate discount
        let discountAmount = 0;
        let discountLabel = '';
        if (discountCode) {
            const { data: discountRow } = await supabase
                .from('discount_codes')
                .select('*')
                .eq('code', discountCode.toUpperCase().trim())
                .eq('is_active', true)
                .single();

            if (discountRow) {
                if (discountRow.discount_type === 'percentage') {
                    discountAmount = Math.round(subtotal * (parseFloat(discountRow.discount_value) || 0) / 100 * 100) / 100;
                } else {
                    discountAmount = parseFloat(discountRow.discount_value) || 0;
                }
                discountLabel = discountRow.code;
            }
        }

        const total = Math.max(0, subtotal + shippingCost + tax - discountAmount);
        const totalInKobo = Math.round(total * 100); // For Paystack (kobo)

        // Generate order number
        const orderNumber = 'VG-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

        // Create order in database
        const orderPayload = {
            order_number: orderNumber,
            customer_email: email,
            customer_name: name,
            customer_phone: phone,
            shipping_address: address,
            shipping_city: city,
            shipping_zip: zip,
            shipping_country: country,
            items: orderItems,
            subtotal: subtotal,
            shipping_cost: shippingCost,
            shipping_days: shippingDays,
            tax: tax,
            discount_amount: discountAmount,
            discount_code: discountLabel || null,
            total_amount: total,
            currency: orderCurrency,
            payment_provider: provider,
            payment_status: 'pending',
            status: 'pending',
            ip_address: getClientIp(event)
        };

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert(orderPayload)
            .select('id, order_id, order_number')
            .single();

        if (orderError) {
            console.error('Order creation error:', orderError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ success: false, error: 'Failed to create order' })
            };
        }

        // Handle payment providers
        if (provider === 'bank_transfer') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    provider: 'bank_transfer',
                    order_number: orderNumber,
                    amount: total,
                    currency: orderCurrency,
                    bank_details: {
                        local: {
                            bank: settings.bank_name || 'Not configured',
                            account_number: settings.bank_account || 'Not configured',
                            account_name: settings.bank_account_name || 'Not configured'
                        },
                        domiciliary: {
                            bank: settings.bank_name_usd || 'Not configured',
                            account_number: settings.bank_account_usd || 'Not configured',
                            account_name: settings.bank_account_name_usd || 'Not configured'
                        }
                    },
                    whatsapp_number: settings.whatsapp_number || '',
                    reference: orderNumber,
                    breakdown: { subtotal, shipping: shippingCost, tax, discount: discountAmount, total }
                })
            };
        }

        // Paystack
        if (provider === 'paystack') {
            const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
            if (!paystackSecret) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: false, error: 'Paystack not configured' })
                };
            }

            const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + paystackSecret,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    amount: totalInKobo,
                    currency: orderCurrency === 'NGN' ? 'NGN' : orderCurrency,
                    reference: orderNumber,
                    metadata: {
                        custom_fields: [
                            { display_name: 'Order', variable_name: 'order_number', value: orderNumber }
                        ]
                    }
                })
            });

            const paystackData = await paystackRes.json();

            if (paystackData.status && paystackData.data.authorization_url) {
                // Update order with payment reference
                await supabase
                    .from('orders')
                    .update({
                        payment_reference: paystackData.data.reference,
                        payment_provider: 'paystack'
                    })
                    .eq('order_number', orderNumber);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        provider: 'paystack',
                        authorization_url: paystackData.data.authorization_url,
                        reference: paystackData.data.reference,
                        order_number: orderNumber,
                        amount: total,
                        currency: orderCurrency,
                        breakdown: { subtotal, shipping: shippingCost, tax, discount: discountAmount, total }
                    })
                };
            } else {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: false, error: paystackData.message || 'Paystack initialization failed' })
                };
            }
        }

        // Flutterwave
        if (provider === 'flutterwave') {
            const flutterwaveSecret = process.env.FLUTTERWAVE_SECRET_KEY;
            if (!flutterwaveSecret) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: false, error: 'Flutterwave not configured' })
                };
            }

            const flutterwaveRes = await fetch('https://api.flutterwave.com/v3/payments', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + flutterwaveSecret,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tx_ref: orderNumber,
                    amount: total,
                    currency: orderCurrency,
                    customer: { email, name, phone_number: phone },
                    redirect_url: (process.env.SITE_URL || '') + '/?order=' + orderNumber
                })
            });

            const fwData = await flutterwaveRes.json();

            if (fwData.status === 'success' && fwData.data.link) {
                await supabase
                    .from('orders')
                    .update({
                        payment_reference: orderNumber,
                        payment_provider: 'flutterwave'
                    })
                    .eq('order_number', orderNumber);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        provider: 'flutterwave',
                        authorization_url: fwData.data.link,
                        reference: orderNumber,
                        order_number: orderNumber,
                        amount: total,
                        currency: orderCurrency,
                        breakdown: { subtotal, shipping: shippingCost, tax, discount: discountAmount, total }
                    })
                };
            } else {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: false, error: fwData.message || 'Flutterwave initialization failed' })
                };
            }
        }

        // Unknown provider
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Unknown payment provider: ' + provider })
        };

    } catch (error) {
        console.error('Initialize payment error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: 'Payment initialization failed: ' + error.message })
        };
    }
};
