        function escapeHtml(value) {
            if (value === null || value === undefined) return '';
            return String(value).replace(/[&<>"']/g, function (ch) {
                switch (ch) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#39;';
                    default: return ch;
                }
            });
        }

        (async function () {
            const params = new URLSearchParams(window.location.search);
            const provider = params.get('provider');
            const reference = params.get('reference') || params.get('tx_ref');
            const transactionId = params.get('transaction_id');

            const card = document.getElementById('card');

            if (!provider || !reference) {
                card.innerHTML = `
                    <div class="icon">⚠️</div>
                    <h1>Missing payment details</h1>
                    <p>We couldn't read the payment reference from this link.</p>
                    <a class="back-link" href="/">Return to Gallery</a>
                `;
                return;
            }

            try {
                const url = `/.netlify/functions/verify-payment?provider=${encodeURIComponent(provider)}&reference=${encodeURIComponent(reference)}` +
                    (transactionId ? `&transaction_id=${encodeURIComponent(transactionId)}` : '');
                const response = await fetch(url);
                const data = await response.json();

                if (data.verified || data.payment_status === 'paid') {
                    card.innerHTML = `
                        <div class="icon">✓</div>
                        <h1>Payment confirmed</h1>
                        <p>Thank you for your order.</p>
                        <div class="order-number">${escapeHtml(data.order_number || reference)}</div>
                        <p>A confirmation has been recorded. We'll be in touch about shipping.</p>
                        <a class="back-link" href="/">Return to Gallery</a>
                    `;
                } else {
                    card.innerHTML = `
                        <div class="icon">⏳</div>
                        <h1>Still processing</h1>
                        <p>We haven't received final confirmation yet. This can take a minute —
                        your order will update automatically once it's confirmed.</p>
                        <div class="order-number">${escapeHtml(data.order_number || reference)}</div>
                        <a class="back-link" href="/">Return to Gallery</a>
                    `;
                }
            } catch (e) {
                card.innerHTML = `
                    <div class="icon">⚠️</div>
                    <h1>Couldn't confirm status</h1>
                    <p>If money left your account, your order will still be confirmed automatically —
                    contact us if you don't see an update soon.</p>
                    <div class="order-number">${escapeHtml(reference)}</div>
                    <a class="back-link" href="/">Return to Gallery</a>
                `;
            }
        })();
