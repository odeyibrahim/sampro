import { createClient } from '@supabase/supabase-js';
import { getSettings } from './_lib/settings.js';

// Public endpoint — returns exchange rates to USD.
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
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    NGN: 1500
};

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
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
            rates.USD = 1;
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
                // Merge admin overrides on top (admin can pin specific rates)
                const rates = { ...cached, ...adminRates };
                rates.USD = 1;
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

        // Fetch from frankfurter.app
        let liveRates = null;
        try {
            const resp = await fetch(FRANKFURTER_URL, {
                signal: AbortSignal.timeout(3000) // 3s timeout
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.rates) {
                    liveRates = { USD: 1, ...data.rates };
                }
            }
        } catch (e) {
            console.error('Frankfurter API fetch failed:', e.message);
        }

        if (liveRates) {
            // Persist cache
            try {
                const now = new Date().toISOString();
                await supabase.from('settings').upsert([
                    { key: 'live_rates_data', value: JSON.stringify(liveRates), updated_at: now },
                    { key: 'live_rates_last_fetched', value: now, updated_at: now }
                ], { onConflict: 'key' });
            } catch (e) {
                console.error('Failed to cache live rates:', e.message);
            }

            // Admin overrides take priority
            const rates = { ...liveRates, ...adminRates };
            rates.USD = 1;
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
                rates.USD = 1;
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

        // Ultimate fallback
        const rates = { ...HARDCODED_FALLBACK, ...adminRates };
        rates.USD = 1;
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
