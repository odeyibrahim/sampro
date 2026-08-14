import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendPaymentConfirmedEmail } from './_lib/email.js';

// Stripe Dashboard → Developers → Webhooks:
//   URL: https://your-site/.netlify/functions/stripe-webhook
//   Events to listen for: checkout.session.completed
//   Signing secret: whsec_... (set as STRIPE_WEBHOOK_SECRET env var)
//
// SECURITY: No CORS header needed — this is a server-to-server endpoint
// called by Stripe's infrastructure, never by a browser.

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        const rawBody = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : (event.body || '');

        // SECURITY: Reject empty or oversized bodies
        if (!rawBody || rawBody.length > 500000) {
            return { statusCode: 400, body: 'Invalid payload' };
        }

        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not set');
            return { statusCode: 500, body: 'Webhook not configured' };
        }

        // SECURITY: Verify Stripe webhook signature.
        // Stripe sends the signature in the Stripe-Signature header.
        // Format: t=<timestamp>,v1=<signature>
        const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
        if (!sigHeader) {
            console.warn('stripe-webhook: missing signature header — rejecting');
            return { statusCode: 401, body: 'Missing signature' };
        }

        // Parse the signature header
        const sigParts = sigHeader.split(',');
        let timestamp = '';
        let signature = '';
        for (const part of sigParts) {
            const [key, val] = part.split('=');
            if (key === 't') timestamp = val;
            if (key === 'v1') signature = val;
        }

        if (!timestamp || !signature) {
            console.warn('stripe-webhook: malformed signature header');
            return { statusCode: 401, body: 'Invalid signature' };
        }

        // Reconstruct the signed payload
        const signedPayload = timestamp + '.' + rawBody;
        const expectedSig = crypto
            .createHmac('sha256', webhookSecret)
            .update(signedPayload)
            .digest('hex');

        // SECURITY: Constant-time comparison to prevent timing attacks
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
            console.warn('stripe-webhook: signature mismatch — rejecting');
            return { statusCode: 401, body: 'Invalid signature' };
        }

        // SECURITY: Reject webhooks older than 5 minutes to prevent replay attacks
        const webhookAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
        if (webhookAge > 300) {
            console.warn('stripe-webhook: stale webhook (' + webhookAge + 's old) — rejecting');
            return { statusCode: 400, body: 'Stale webhook' };
        }

        const payload = JSON.parse(rawBody);

        // Handle the checkout completion event
        if (payload.type === 'checkout.session.completed') {
            const session = payload.data?.object;
            if (!session || session.payment_status !== 'paid') {
                return { statusCode: 200, body: JSON.stringify({ received: true }) };
            }

            const orderNumber = session.client_reference_id || session.metadata?.order_number;
            const paymentIntentId = session.payment_intent;

            if (!orderNumber || orderNumber.length > 100) {
                console.warn('stripe-webhook: invalid order_number', orderNumber);
                return { statusCode: 200, body: JSON.stringify({ received: true }) };
            }

            const supabase = createClient(
                process.env.VITE_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY
            );

            const { data, error } = await supabase.rpc('mark_order_paid', {
                p_reference: orderNumber,
                p_payment_method: 'stripe',
                p_transaction_id: paymentIntentId ? String(paymentIntentId) : null
            });

            if (error || !data?.success) {
                console.error('Stripe webhook: mark_order_paid failed', error, data);
            } else {
                console.log('Stripe webhook: order confirmed', orderNumber, data.already_processed ? '(already processed)' : '');

                if (!data.already_processed) {
                    const { data: order } = await supabase
                        .from('orders')
                        .select('order_id, customer_email, customer_name, total_amount, currency')
                        .eq('payment_reference', orderNumber)
                        .maybeSingle();
                    if (order) await sendPaymentConfirmedEmail(order);
                }
            }
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };

    } catch (error) {
        console.error('Stripe webhook error:', error);
        return { statusCode: 200, body: JSON.stringify({ received: true, error: 'internal' }) };
    }
};
