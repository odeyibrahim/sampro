import { createClient } from '@supabase/supabase-js';
import { getSettings } from './_lib/settings.js';

// Public counterpart to get-products.js. Deliberately returns only the
// subset of `settings` that's safe to expose with no auth: branding
// (store name, logo) and the WhatsApp number, which is already sent to
// the browser via initialize-payment's bank_transfer response anyway.
// Tax rates and anything added to `settings` later are NOT included
// here by default — only fields explicitly picked below ever leave
// this function, so a future admin-only setting can't leak by accident.

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

        // Safe public fields — exchange_rates and logo_size are needed
        // for price display and branding; backdrop fields let the storefront
        // reflect admin customisation. live_rates_enabled tells the storefront
        // whether to fetch live rates from the API or use admin-set rates.
        const publicFields = {
            store_name: settings.store_name,
            logo_url: settings.logo_url,
            logo_size: settings.logo_size,
            whatsapp_number: settings.whatsapp_number,
            exchange_rates: settings.exchange_rates,
            live_rates_enabled: settings.live_rates_enabled !== 'false',
            bg_color1: settings.bg_color1,
            bg_color2: settings.bg_color2,
            bg_image: settings.bg_image,
            bg_half: settings.bg_half
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(publicFields)
        };
    } catch (error) {
        console.error('Get settings error:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ store_name: 'V. Gallery', logo_url: '', logo_size: '36', whatsapp_number: '' })
        };
    }
};
