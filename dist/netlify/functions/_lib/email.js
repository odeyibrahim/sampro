// Shared order-email helper, imported by the webhook and admin
// functions. NOT deployed as its own endpoint — the leading
// underscore in the folder name keeps Netlify from routing to it.
//
// Uses Resend's plain HTTP API (https://resend.com) via fetch, so no
// extra SDK/dependency is required. Swap the RESEND_API_URL call for
// any other transactional email provider's API if you prefer one —
// the calling code (webhooks, admin-operations) doesn't need to change.
//
// Email is NOT security- or money-critical, unlike admin auth or
// payment verification, so this fails *soft*: if RESEND_API_KEY or
// FROM_EMAIL isn't set, we log a warning and continue — a missing
// email integration should never block an order from completing.

const RESEND_API_URL = 'https://api.resend.com/emails';

function money(amount, currency) {
    const n = parseFloat(amount || 0);
    return `${currency || 'NGN'} ${n.toFixed(2)}`;
}

async function sendEmail({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.FROM_EMAIL;

    if (!apiKey || !from) {
        console.warn('Email not sent (RESEND_API_KEY / FROM_EMAIL not configured):', subject, '->', to);
        return { skipped: true };
    }

    try {
        const resp = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ from, to, subject, html })
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            console.error('Email send failed:', resp.status, errText);
            return { success: false };
        }

        return { success: true };
    } catch (err) {
        // Never let an email failure bubble up and fail the order/webhook.
        console.error('Email send error:', err);
        return { success: false };
    }
}

/**
 * Sent once, right after a bank_transfer order is created (pending —
 * before any money has actually moved), so the customer has the bank
 * details and reference number in writing, not just on-screen.
 */
async function sendOrderReceivedEmail(order, storeName) {
    const { customer_email, customer_name, order_id, total_amount, currency, bank_details, whatsapp_number } = order;
    const brand = storeName || 'V. Gallery';

    const html = `
        <p>Hi ${escapeHtml(customer_name)},</p>
        <p>We've received your order <strong>${escapeHtml(order_id)}</strong> for ${money(total_amount, currency)}.</p>
        <p>It's marked <strong>pending</strong> until we can confirm your bank/domiciliary transfer. Please transfer
        using reference <strong>${escapeHtml(order_id)}</strong>, then send proof of payment via WhatsApp${whatsapp_number ? ' to +' + escapeHtml(whatsapp_number) : ''}.</p>
        ${bank_details ? `
        <p><strong>Local (NGN):</strong><br>
        ${escapeHtml(bank_details.local?.bank_name)}<br>
        ${escapeHtml(bank_details.local?.account_number)} — ${escapeHtml(bank_details.local?.account_name)}</p>
        <p><strong>Domiciliary (USD):</strong><br>
        ${escapeHtml(bank_details.domiciliary?.bank_name)}<br>
        ${escapeHtml(bank_details.domiciliary?.account_number)} — ${escapeHtml(bank_details.domiciliary?.account_name)}<br>
        SWIFT: ${escapeHtml(bank_details.domiciliary?.swift_code)}</p>
        ` : ''}
        <p>— ${escapeHtml(brand)}</p>
    `;

    return sendEmail({ to: customer_email, subject: `Order received — ${order_id}`, html });
}

/**
 * Sent once payment is actually confirmed — called from the same
 * place that calls mark_order_paid(), and only when that call reports
 * already_processed === false, so a webhook retry never sends a
 * second confirmation email for the same order.
 */
async function sendPaymentConfirmedEmail(order, storeName) {
    const { customer_email, customer_name, order_id, total_amount, currency } = order;
    const brand = storeName || 'V. Gallery';

    const html = `
        <p>Hi ${escapeHtml(customer_name)},</p>
        <p>Your payment for order <strong>${escapeHtml(order_id)}</strong> (${money(total_amount, currency)}) is confirmed.
        We'll be in touch about shipping.</p>
        <p>— ${escapeHtml(brand)}</p>
    `;

    return sendEmail({ to: customer_email, subject: `Payment confirmed — ${order_id}`, html });
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

export { sendOrderReceivedEmail, sendPaymentConfirmedEmail };
