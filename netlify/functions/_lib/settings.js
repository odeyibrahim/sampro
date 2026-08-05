// Shared helper, not an endpoint (leading underscore folder keeps
// Netlify from routing to it). Reads the generic key/value `settings`
// table (added in migration 002 for tax rates) into a plain object,
// with defaults merged in so a fresh install with no rows set still
// works — nothing here ever throws or blocks the caller.

const DEFAULTS = {
    store_name: 'V. Gallery',
    logo_url: '',
    whatsapp_number: '',
    tax_rate_ngn: '0',
    tax_rate_usd: '0'
};

async function getSettings(supabase) {
    try {
        const { data, error } = await supabase.from('settings').select('key, value');
        if (error || !data) return { ...DEFAULTS };

        const merged = { ...DEFAULTS };
        for (const row of data) {
            merged[row.key] = row.value;
        }
        return merged;
    } catch (err) {
        console.error('getSettings failed, using defaults:', err);
        return { ...DEFAULTS };
    }
}

export { getSettings, DEFAULTS };
