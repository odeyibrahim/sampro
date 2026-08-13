// Lightweight IP-based rate limiter for public endpoints.
// Insert-only design: each request inserts a row, old rows expire
// via the time window. No updates needed — just count recent rows.
//
// Usage (inside a Netlify function handler):
//   import { rateLimit, getClientIp } from './_lib/rate-limit.js';
//   const ip = getClientIp(event);
//   const allowed = await rateLimit(supabase, ip, 'toggle-like', 50, 60);
//   if (!allowed) return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests' }) };

/**
 * Get client IP — prefers Netlify's real-IP header over X-Forwarded-For.
 * x-nf-client-connection-ip is set by Netlify's edge and cannot be spoofed
 * by the client, unlike X-Forwarded-For which is user-supplied.
 */
export function getClientIp(event) {
    // Netlify's authoritative header (can't be forged by client)
    const nfIp = event.headers['x-nf-client-connection-ip'];
    if (nfIp) return nfIp;

    // Fallback: first IP in X-Forwarded-For (set by Netlify proxy)
    const fwd = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
    if (fwd) return fwd.split(',')[0].trim();

    return 'unknown';
}

/**
 * Check rate limit for a given IP + endpoint.
 * Returns true if the request is allowed, false if rate-limited.
 *
 * @param {object} supabase - Supabase client
 * @param {string} ip - Client IP address
 * @param {string} endpoint - Endpoint identifier (e.g. 'toggle-like', 'initialize-payment')
 * @param {number} maxHits - Max requests allowed in the window
 * @param {number} windowMinutes - Time window in minutes
 * @returns {Promise<boolean>}
 */
export async function rateLimit(supabase, ip, endpoint, maxHits, windowMinutes) {
    const bucketKey = ip + ':' + endpoint;
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    try {
        // Count recent hits for this bucket
        const { count, error } = await supabase
            .from('rate_limits')
            .select('id', { count: 'exact', head: true })
            .eq('bucket_key', bucketKey)
            .gte('created_at', windowStart);

        if (error) {
            console.error('Rate limit check error:', error);
            // Fail open — don't block requests if DB is having issues
            return true;
        }

        if ((count || 0) >= maxHits) {
            return false; // Rate limited
        }

        // Record this hit
        await supabase
            .from('rate_limits')
            .insert({ bucket_key: bucketKey });

        // Probabilistic cleanup: 1% chance to delete old rows.
        // This avoids needing a separate cron job while keeping the table small.
        if (Math.random() < 0.01) {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            supabase
                .from('rate_limits')
                .delete()
                .lt('created_at', cutoff)
                .then(() => {})
                .catch(() => {});
        }

        return true; // Allowed
    } catch (err) {
        console.error('Rate limit error:', err);
        // Fail open
        return true;
    }
}
