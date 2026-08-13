import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIp } from './_lib/rate-limit.js';

// Public endpoint — no auth required. Returns active shipping
// zones grouped by country so the checkout form can populate a
// country dropdown and show per-method costs.

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

        // SECURITY: Rate limit — 60 requests per IP per minute on public GET
        const ip = getClientIp(event);
        const allowed = await rateLimit(supabase, ip, 'get-shipping-zones', 60, 1);
        if (!allowed) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
        }

        // SECURITY: Explicit column select — only public-facing columns
        const { data: zones, error } = await supabase
            .from('shipping_zones')
            .select('country_code, country_name, method, currency, cost, estimated_days')
            .eq('is_active', true)
            .order('country_code', { ascending: true })
            .order('method', { ascending: true });

        if (error) {
            console.error('Shipping zones error:', error);
            return { statusCode: 200, headers, body: JSON.stringify({ zones: [], countries: [] }) };
        }

        // Build a deduplicated country list for the dropdown
        const countryMap = {};
        const zoneMap = {};

        for (const z of (zones || [])) {
            if (!countryMap[z.country_code]) {
                countryMap[z.country_code] = z.country_name;
            }
            const key = z.country_code + ':' + z.currency;
            if (!zoneMap[key]) zoneMap[key] = {};
            zoneMap[key][z.method] = {
                cost: parseFloat(z.cost),
                estimated_days: z.estimated_days || ''
            };
        }

        const countries = Object.keys(countryMap)
            .filter(c => c !== 'ROW')
            .sort((a, b) => countryMap[a].localeCompare(countryMap[b]))
            .map(code => ({ code, name: countryMap[code] }));
        if (countryMap['ROW']) {
            countries.push({ code: 'ROW', name: countryMap['ROW'] });
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ zones: zoneMap, countries })
        };
    } catch (error) {
        console.error('Get shipping zones error:', error);
        return { statusCode: 200, headers, body: JSON.stringify({ zones: {}, countries: [] }) };
    }
};
