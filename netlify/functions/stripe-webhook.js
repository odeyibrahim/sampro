import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { sendPaymentConfirmedEmail } from './_lib/email.js';

// Stripe Dashboard → Developers → Webhooks → add endpoint:
//   https://your-site/.netlify/functions/stripe-webhook
// Listen for: checkout.session.completed
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

        const sig = event.headers['stripe-signature'];
        if (!sig) {
            console.warn('Stripe webhook: missing signature — rejecting.');
            return { statusCode: 401, body: 'Missing signature' };
        }

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        let stripeEvent;
        try {
            stripeEvent = stripe.webhooks.constructEvent(
                rawBody,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.warn('Stripe webhook: signature verification failed:', err.message);
            return { statusCode: 401, body: 'Invalid signature' };
        }

        // Always ack with 200 once the signature is valid
        if (stripeEvent.type === 'checkout.session.completed') {
            const session = stripeEvent.data.object;
            const reference = session.metadata?.order_number;
            const paymentIntent = session.payment_intent;

            if (session.payment_status === 'paid' && reference && reference.length <= 100) {
                const supabase = createClient(
                    process.env.VITE_SUPABASE_URL,
                    process.env.SUPABASE_SERVICE_ROLE_KEY
                );

                const { data, error } = await supabase.rpc('mark_order_paid', {
                    p_reference: reference,
                    p_payment_method: 'stripe',
                    p_transaction_id: paymentIntent ? String(paymentIntent) : null
                });

                if (error || !data?.success) {
                    console.error('Stripe webhook: mark_order_paid failed', error, data);
                } else {
                    console.log('Stripe webhook: order confirmed', reference, data.already_processed ? '(already processed)' : '');

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
        console.error('Stripe webhook error:', error);
        return { statusCode: 200, body: JSON.stringify({ received: true, error: 'internal' }) };
    }
};
