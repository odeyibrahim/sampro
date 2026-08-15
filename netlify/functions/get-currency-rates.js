import { createClient } from '@supabase/supabase-js';
import { getSettings } from './_lib/settings.js';
import { rateLimit, getClientIp } from './_lib/rate-limit.js';

// Public endpoint — returns exchange rates relative to 1 NGN.
// Strategy:
//   1. If admin has disabled live rates (live_rates_enabled = 'false'),
//      return only the admin-configured rates from settings.exchange_rates.
//   2. If live rates are enabled, fetch from frankfurter.app (free, no
//      API key, ECB data). Cache in the settings table for 4 hours to
//      avoid hammering the API on every page load.
//   3. If the API is unreachable, fall back to cached rates, then to
//      admin-configured rates, then to hardcoded defaults.

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD';

const HARDCODED_FALLBACK = {
    NGN: 1,
    USD: 0.000667,
    EUR: 0.000613,
    GBP: 0.000527
};

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

        // SECURITY: Rate limit — 30 requests per IP per minute
        // (lower than other GET endpoints because each live-rate miss
        // triggers an external API call to frankfurter.app)
        const ip = getClientIp(event);
        const allowed = await rateLimit(supabase, ip, 'get-currency-rates', 30, 1);
        if (!allowed) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
        }

        const settings = await getSettings(supabase);
        const liveEnabled = settings.live_rates_enabled !== 'false';

        // Parse admin-configured manual rates (always available as override)
        let adminRates = {};
        if (settings.exchange_rates) {
            try { adminRates = JSON.parse(settings.exchange_rates); } catch (e) {}
        }

        // If live rates are disabled, return admin rates + hardcoded fallback
        if (!liveEnabled) {
            const rates = { ...HARDCODED_FALLBACK, ...adminRates };
            rates.NGN = 1;
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    rates,
                    source: 'manual',
                    updated_at: null
                })
            };
        }

        // --- Live rates path ---

        // Check cache in settings table
        const cacheAge = settings.live_rates_last_fetched
            ? Date.now() - new Date(settings.live_rates_last_fetched).getTime()
            : Infinity;

        if (cacheAge < CACHE_TTL_MS && settings.live_rates_data) {
            try {
                const cached = JSON.parse(settings.live_rates_data);
                const rates = { ...cached, ...adminRates };
                rates.NGN = 1;
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        rates,
                        source: 'cached',
                        updated_at: settings.live_rates_last_fetched
                    })
                };
            } catch (e) {
                // Cache corrupt — fall through to fetch fresh
            }
        }

        // Fetch from frankfurter.app (USD-based, then convert to NGN-centric)
        let liveRates = null;
        try {
            const resp = await fetch(FRANKFURTER_URL, {
                signal: AbortSignal.timeout(3000)
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.rates) {
                    // Frankfurter does not support NGN. Derive NGN anchor from admin rates.
                    // adminRates are NGN-centric: { NGN: 1, USD: 0.000667, ... }
                    // So 1 USD = 1/adminRates.USD NGN (if adminRates.USD > 0)
                    const ngnPerUsd = (adminRates && typeof adminRates.USD === 'number' && adminRates.USD > 0)
                        ? (1 / adminRates.USD)
                        : 1500;  // fallback
                    const ngnRates = { NGN: 1, USD: 1 / ngnPerUsd };
                    for (const [cur, usdRate] of Object.entries(data.rates)) {
                        ngnRates[cur] = usdRate / ngnPerUsd;
                    }
                    liveRates = ngnRates;
                }
            }
        } catch (e) {
            console.error('Frankfurter API fetch failed:', e.message);
        }

        if (liveRates) {
            try {
                const now = new Date().toISOString();
                await supabase.from('settings').upsert([
                    { key: 'live_rates_data', value: JSON.stringify(liveRates), updated_at: now },
                    { key: 'live_rates_last_fetched', value: now, updated_at: now }
                ], { onConflict: 'key' });
            } catch (e) {
                console.error('Failed to cache live rates:', e.message);
            }

            const rates = { ...liveRates, ...adminRates };
            rates.NGN = 1;
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    rates,
                    source: 'live',
                    updated_at: new Date().toISOString()
                })
            };
        }

        // API failed — try stale cache, then admin, then hardcoded
        if (settings.live_rates_data) {
            try {
                const stale = JSON.parse(settings.live_rates_data);
                const rates = { ...stale, ...adminRates };
                rates.NGN = 1;
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        rates,
                        source: 'stale_cache',
                        updated_at: settings.live_rates_last_fetched
                    })
                };
            } catch (e) {}
        }

        const rates = { ...HARDCODED_FALLBACK, ...adminRates };
        rates.NGN = 1;
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                rates,
                source: 'fallback',
                updated_at: null
            })
        };

    } catch (error) {
        console.error('Get currency rates error:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ rates: HARDCODED_FALLBACK, source: 'error', updated_at: null })
        };
    }
};
