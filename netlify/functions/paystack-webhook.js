import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendPaymentConfirmedEmail } from './_lib/email.js';

// Paystack Dashboard → Settings → API Keys & Webhooks → set this
// function's URL as the webhook: https://your-site/.netlify/functions/paystack-webhook
// Paystack signs every webhook with your SECRET key — no separate
// webhook secret to configure on their side.
//
// SECURITY: No CORS header needed — this is a server-to-server endpoint
// called by Paystack's infrastructure, never by a browser.

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        const rawBody = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : (event.body || '');

        // SECURITY: Reject empty or oversized bodies
        if (!rawBody || rawBody.length > 100000) {
            return { statusCode: 400, body: 'Invalid payload' };
        }

        const signature = event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature'];
        const expectedHash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(rawBody)
            .digest('hex');

        if (!signature || signature !== expectedHash) {
            console.warn('Paystack webhook: signature mismatch — rejecting.');
            return { statusCode: 401, body: 'Invalid signature' };
        }

        const payload = JSON.parse(rawBody);

        // Always ack with 200 once the signature is valid, even if our
        // own processing hits an error below.
        if (payload.event === 'charge.success') {
            const { reference, id: transactionId, status } = payload.data;

            // SECURITY: Validate reference format before using it
            if (status === 'success' && reference && reference.length <= 100) {
                const supabase = createClient(
                    process.env.VITE_SUPABASE_URL,
                    process.env.SUPABASE_SERVICE_ROLE_KEY
                );

                const { data, error } = await supabase.rpc('mark_order_paid', {
                    p_reference: reference,
                    p_payment_method: 'paystack',
                    p_transaction_id: String(transactionId)
                });

                if (error || !data?.success) {
                    console.error('Paystack webhook: mark_order_paid failed', error, data);
                } else {
                    console.log('Paystack webhook: order confirmed', reference, data.already_processed ? '(already processed)' : '');

                    if (!data.already_processed) {
                        const { data: order } = await supabase
                            .from('orders')
                            .select('order_id, customer_email, customer_name, total_amount, currency')
                            .eq('payment_reference', reference)
                            .maybeSingle();
                        if (order) await sendPaymentConfirmedEmail(order);
                    }
                }
            }
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };

    } catch (error) {
        console.error('Paystack webhook error:', error);
        return { statusCode: 200, body: JSON.stringify({ received: true, error: 'internal' }) };
    }
};
