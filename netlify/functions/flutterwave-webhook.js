import { createClient } from '@supabase/supabase-js';
import { sendPaymentConfirmedEmail } from './_lib/email.js';

// Flutterwave Dashboard → Settings → Webhooks:
//   URL: https://your-site/.netlify/functions/flutterwave-webhook
//   Secret Hash: same value as FLUTTERWAVE_WEBHOOK_SECRET_HASH below.
// Flutterwave echoes that secret hash back in the `verif-hash` header
// on every call, so we just compare strings (no HMAC needed here).
//
// SECURITY: No CORS header needed — this is a server-to-server endpoint
// called by Flutterwave's infrastructure, never by a browser.

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        const receivedHash = event.headers['verif-hash'] || event.headers['Verif-Hash'];
        const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;

        if (!receivedHash || !expectedHash || receivedHash !== expectedHash) {
            console.warn('Flutterwave webhook: secret hash mismatch — rejecting.');
            return { statusCode: 401, body: 'Invalid signature' };
        }

        // SECURITY: Reject empty or oversized bodies
        const rawBody = event.body || '';
        if (!rawBody || rawBody.length > 100000) {
            return { statusCode: 400, body: 'Invalid payload' };
        }

        const payload = JSON.parse(rawBody);
        const data = payload.data || {};

        if ((payload.event === 'charge.completed') && data.status === 'successful') {
            const txRef = data.tx_ref;
            const transactionId = data.id;

            // SECURITY: Validate tx_ref format
            if (!txRef || txRef.length > 100) {
                console.warn('Flutterwave webhook: invalid tx_ref length');
                return { statusCode: 200, body: JSON.stringify({ received: true }) };
            }

            // Belt-and-braces: re-verify the transaction directly with
            // Flutterwave's API using our secret key, rather than trusting
            // the webhook body alone.
            const verifyResponse = await fetch(
                `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
                { headers: { 'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
            );
            const verifyData = await verifyResponse.json();

            const verified = verifyData?.status === 'success'
                && verifyData?.data?.status === 'successful'
                && verifyData?.data?.tx_ref === txRef;

            if (verified) {
                const supabase = createClient(
                    process.env.VITE_SUPABASE_URL,
                    process.env.SUPABASE_SERVICE_ROLE_KEY
                );

                const { data: result, error } = await supabase.rpc('mark_order_paid', {
                    p_reference: txRef,
                    p_payment_method: 'flutterwave',
                    p_transaction_id: String(transactionId)
                });

                if (error || !result?.success) {
                    console.error('Flutterwave webhook: mark_order_paid failed', error, result);
                } else {
                    console.log('Flutterwave webhook: order confirmed', txRef, result.already_processed ? '(already processed)' : '');

                    if (!result.already_processed) {
                        const { data: order } = await supabase
                            .from('orders')
                            .select('order_id, customer_email, customer_name, total_amount, currency')
                            .eq('payment_reference', txRef)
                            .maybeSingle();
                        if (order) await sendPaymentConfirmedEmail(order);
                    }
                }
            } else {
                console.warn('Flutterwave webhook: re-verification did not confirm success for', txRef);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };

    } catch (error) {
        console.error('Flutterwave webhook error:', error);
        return { statusCode: 200, body: JSON.stringify({ received: true, error: 'internal' }) };
    }
};
