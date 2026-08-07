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

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                store_name: settings.store_name,
                logo_url: settings.logo_url,
                whatsapp_number: settings.whatsapp_number
            })
        };
    } catch (error) {
        console.error('Get settings error:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ store_name: 'V. Gallery', logo_url: '', whatsapp_number: '' })
        };
    }
};
