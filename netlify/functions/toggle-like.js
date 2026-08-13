import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIp } from './_lib/rate-limit.js';

export const handler = async (event) => {
    // SECURITY: CORS origin must match SITE_URL exactly.
    // Empty string if SITE_URL is not set — browser will block cross-origin requests.
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

        // SECURITY: Rate limit — 50 likes per IP per hour
        const ip = getClientIp(event);
        const allowed = await rateLimit(supabase, ip, 'toggle-like', 50, 60);
        if (!allowed) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
        }

        let requestBody = {};
        try {
            requestBody = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
        }

        const { productId, sessionId } = requestBody;

        if (!productId || !sessionId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID and Session ID required' }) };
        }

        // SECURITY: Validate session_id length to prevent abuse via absurdly long strings
        if (sessionId.length > 128) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid session ID' }) };
        }

        const { data: existing } = await supabase
            .from('product_likes')
            .select('id')
            .eq('product_id', productId)
            .eq('session_id', sessionId)
            .maybeSingle();

        if (existing) {
            await supabase.from('product_likes').delete().eq('id', existing.id);
            await supabase.rpc('decrement_likes', { p_product_id: productId });
            return { statusCode: 200, headers, body: JSON.stringify({ liked: false }) };
        } else {
            await supabase.from('product_likes').insert({ product_id: productId, session_id: sessionId });
            await supabase.rpc('increment_likes', { p_product_id: productId });
            return { statusCode: 200, headers, body: JSON.stringify({ liked: true }) };
        }
    } catch (error) {
        console.error('Toggle like error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to toggle like' }) };
    }
};
