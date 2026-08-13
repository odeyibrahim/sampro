import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
    // SECURITY: CORS origin must match SITE_URL exactly.
    const siteUrl = process.env.SITE_URL || '';
    const headers = {
        'Access-Control-Allow-Origin': siteUrl,
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

        // SECURITY: Explicit column select — never SELECT * on public endpoints.
        // Only returns public-facing columns; internal config like is_active,
        // updated_at, etc. are excluded.
        const { data, error } = await supabase
            .from('products')
            .select(`
                product_id, title, slug, author, description, type, media_kind,
                base_price, compare_price, stock, orientation, image_url,
                variations, content, frame_style, background_top, background_bottom,
                font_family, font_size, font_weight, text_transform,
                show_author, show_price, show_stock, show_share,
                content_order, video_autoplay, video_loop, video_muted,
                tags, is_featured, collection, sort_order,
                likes_count, views_count, sales_count, created_at
            `)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data || [])
        };
    } catch (error) {
        console.error('Get products error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify([])
        };
    }
};
