import { createClient } from '@supabase/supabase-js';
import { sendPaymentConfirmedEmail } from './_lib/email.js';

// Called by /payment-callback.html right after the customer is
// redirected back from Paystack/Flutterwave's hosted checkout page.
//
// This is NOT the authoritative source of truth for "was this paid" —
// the webhooks are. This endpoint exists purely so the customer sees an
// immediate, accurate confirmation screen instead of staring at a
// "pending" order for a few seconds while the webhook catches up.
// Calling mark_order_paid() from here is safe because it's idempotent:
// whichever of (this callback / the webhook) arrives first does the
// work, and the second one is a harmless no-op.

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const params = event.queryStringParameters || {};
        const { provider, reference } = params;

        if (!provider || !reference) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing provider or reference' }) };
        }

        const supabase = createClient(
            process.env.VITE_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        let verified = false;
        let transactionId = null;

        if (provider === 'paystack') {
            const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
                headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });
            const data = await resp.json();
            verified = data?.status === true && data?.data?.status === 'success';
            transactionId = data?.data?.id;

        } else if (provider === 'flutterwave') {
            // Flutterwave's redirect includes transaction_id in the query string.
            const transactionIdParam = params.transaction_id;
            if (transactionIdParam) {
                const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionIdParam}/verify`, {
                    headers: { 'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
                });
                const data = await resp.json();
                verified = data?.status === 'success' && data?.data?.status === 'successful' && data?.data?.tx_ref === reference;
                transactionId = data?.data?.id;
            }
        } else {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown provider' }) };
        }

        if (verified) {
            const { data: markResult } = await supabase.rpc('mark_order_paid', {
                p_reference: reference,
                p_payment_method: provider,
                p_transaction_id: transactionId ? String(transactionId) : null
            });

            if (markResult?.success && !markResult.already_processed) {
                const { data: orderForEmail } = await supabase
                    .from('orders')
                    .select('order_id, customer_email, customer_name, total_amount, currency')
                    .eq('payment_reference', reference)
                    .maybeSingle();
                if (orderForEmail) await sendPaymentConfirmedEmail(orderForEmail);
            }
        }

        // Report current order status back to the callback page regardless.
        const { data: order } = await supabase
            .from('orders')
            .select('order_id, payment_status, total_amount, currency')
            .eq('payment_reference', reference)
            .maybeSingle();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                verified,
                order_number: order?.order_id || reference,
                payment_status: order?.payment_status || (verified ? 'paid' : 'pending'),
                amount: order?.total_amount,
                currency: order?.currency
            })
        };

    } catch (error) {
        console.error('Verify payment error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Verification failed' }) };
    }
};
