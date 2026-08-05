# V. Gallery — Setup Guide

A gallery + e-commerce site with three payment paths: **Paystack**, **Flutterwave**,
and **direct bank / domiciliary transfer**. Products, orders, and stock live in a
real database (Supabase). All money-related logic — computing prices, verifying
payments, and confirming orders — happens server-side; the browser is never
trusted with anything that affects a price or an order's paid status.

Follow the steps in order. Steps 1–4 get the backend working; step 5 gets you
live payments; step 6 deploys it.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up → **New project**.
2. Once it's created, go to **SQL Editor** → **New query**.
3. Open `supabase/migrations/001_complete_schema.sql` from this project, paste
   its entire contents in, and click **Run**. You should see
   `✅ Schema v2 complete...` at the bottom.
4. Do the same with `supabase/migrations/002_gap_fixes.sql` — paste and run it
   too (after 001). You should see `✅ Schema v3 complete...`. This adds
   discount codes, configurable shipping rates, a configurable tax rate, and
   refunds.
5. Do the same with `supabase/migrations/003_product_design_system.sql` —
   paste and run it too (after 002). You should see `✅ Schema v4 complete...`.
   This adds the full per-product design system: media kind (image/video/
   text), independent top/bottom backgrounds, typography, visibility
   toggles, content order, and video playback settings.
6. Go to **Project Settings → API**. Copy two values — you'll need them shortly:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **service_role secret** (NOT the `anon` key) → this is `SUPABASE_SERVICE_ROLE_KEY`

   The service role key is powerful — it bypasses all database security rules.
   It must **only** ever live in Netlify's server-side environment variables,
   never in any file that ships to the browser. Nothing in this project puts
   it there — just make sure you don't paste it anywhere else later.

## 2. Set your admin password

The admin login refuses to work at all until this is set — there is no
default password and no "demo mode."

1. Pick a strong password.
2. Generate its bcrypt hash. If you have Node.js installed locally:
   ```bash
   npm install
   npm run hash-password -- "your-chosen-password"
   ```
   This prints a hash starting with `$2a$10$...` — copy the whole thing.
3. You'll paste this into Netlify as `ADMIN_PASSWORD_HASH` in step 7.

Keep the plaintext password somewhere safe (a password manager) — only the
hash goes into the app, and hashes can't be reversed back into the password.

## 3. Set up Paystack

1. Create an account at [paystack.com](https://paystack.com).
2. **Settings → API Keys & Webhooks**. Copy your **Public Key** and **Secret
   Key** (use the Test keys first — switch to Live keys once you've tested
   an end-to-end order).
3. In the same page, under **Webhooks**, set the webhook URL to:
   ```
   https://YOUR-SITE.netlify.app/.netlify/functions/paystack-webhook
   ```
   (You'll fill in your real domain once it's deployed in step 7 — you can
   come back and set this afterward.)
   Paystack signs webhook calls using your Secret Key automatically — there's
   no separate webhook secret to configure on their side.

## 4. Set up Flutterwave

1. Create an account at [flutterwave.com](https://flutterwave.com).
2. **Settings → API** (Dashboard). Copy your **Public Key** and **Secret Key**
   (start with Test mode keys).
3. **Settings → Webhooks**. Set:
   - **URL**: `https://YOUR-SITE.netlify.app/.netlify/functions/flutterwave-webhook`
   - **Secret Hash**: make up a long random string (e.g. generate one at
     [random.org](https://www.random.org/strings/) or run
     `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
     and paste it here. You'll use this exact same string as
     `FLUTTERWAVE_WEBHOOK_SECRET_HASH` in step 7 — Flutterwave sends it back
     on every webhook call so the function can confirm the call really came
     from them.

## 5. Set up transactional email (optional but recommended)

Without this, the site still works fully — orders just won't get an emailed
receipt/confirmation, only the on-screen one.

1. Create an account at [resend.com](https://resend.com) and verify a sending
   domain (or use their onboarding domain for testing).
2. Create an API key.
3. You'll set `RESEND_API_KEY` and `FROM_EMAIL` (must be an address on your
   verified domain) in step 7.

## 6. Set up your bank / domiciliary details

No account creation needed here — this is just informational text shown to
customers who choose "Direct Bank / Domiciliary Transfer" at checkout. Have
ready:

- **Local (NGN) account**: bank name, account number, account name
- **Domiciliary (USD) account**: bank name, account number, account name,
  SWIFT code

Orders paid this way stay **pending** until you personally check your bank
statement and click **Confirm Payment** next to that order in the admin
dashboard — there's no automatic verification for bank transfers, since
there's no API to check against. Nothing about stock or "paid" status changes
until you do that.

## 7. Deploy to Netlify

1. Push this project to a GitHub repository.
2. In [Netlify](https://app.netlify.com), **Add new site → Import an existing
   project**, and connect that repository. Netlify will read `netlify.toml`
   automatically (publish dir `public`, functions dir `netlify/functions`).
3. Before the first deploy finishes mattering, go to **Site configuration →
   Environment variables** and add every one of these (see `.env.example`
   for the full annotated list):

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `SITE_URL` | `https://your-actual-site-name.netlify.app` |
   | `ADMIN_PASSWORD_HASH` | from step 2 |
   | `PAYSTACK_PUBLIC_KEY` | from step 3 |
   | `PAYSTACK_SECRET_KEY` | from step 3 |
   | `FLUTTERWAVE_PUBLIC_KEY` | from step 4 |
   | `FLUTTERWAVE_SECRET_KEY` | from step 4 |
   | `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | from step 4 |
   | `BANK_LOCAL_NAME` / `BANK_LOCAL_ACCOUNT_NUMBER` / `BANK_LOCAL_ACCOUNT_NAME` | from step 6 |
   | `BANK_DOM_NAME` / `BANK_DOM_ACCOUNT_NUMBER` / `BANK_DOM_ACCOUNT_NAME` / `BANK_DOM_SWIFT_CODE` | from step 6 |
   | `WHATSAPP_NUMBER` | your number, country code + digits only, e.g. `2348012345678` |
   | `RESEND_API_KEY` | from step 5 (optional — leave blank to skip emails) |
   | `FROM_EMAIL` | from step 5 (optional) |

4. Trigger a deploy (**Deploys → Trigger deploy → Deploy site**) so the
   functions pick up the new environment variables.
5. Now go back to Paystack and Flutterwave's webhook settings (steps 3–4)
   and paste in your real `https://your-site.netlify.app/.netlify/functions/...`
   webhook URLs if you hadn't already.

## 8. Test it end-to-end (in test mode)

1. Visit your live site, enter the gallery, add something to cart.
2. Try each payment path:
   - **Paystack** (test mode): use Paystack's [test
     cards](https://paystack.com/docs/payments/test-payments/) — you'll be
     redirected to `payment-callback.html`, which should say "Payment
     confirmed."
   - **Flutterwave** (test mode): use Flutterwave's [test
     cards](https://developer.flutterwave.com/docs/integration-guides/testing-helpers) —
     same redirect flow.
   - **Bank transfer**: you'll see the bank details panel appear inline —
     confirm it shows your real account details, then go to `/admin`, log
     in, open **Orders**, and click **Confirm Payment** on that order. Stock
     for the product should drop by the ordered quantity.
3. Check **Supabase → Table Editor → orders** — each test order should show
   `payment_status = paid` and the matching product's `stock` should have
   gone down. Check **products** table stock directly to confirm.
4. Once everything checks out, swap your Paystack/Flutterwave keys from Test
   to Live in Netlify's environment variables and redeploy.

## 9. Ongoing admin use

- **Admin panel**: `https://your-site.netlify.app/admin`
- Log in with the password you chose in step 2 (not the hash — the actual
  password).
- From there you can add/edit/delete products, view orders, confirm bank
  transfers, refund orders, manage discount codes, and view customers.
- Sessions last 24 hours, or until you log out (logout now actually
  invalidates the session server-side, not just on the device you were on).
- Five failed login attempts from the same IP within 15 minutes triggers a
  temporary lockout — this resets automatically after the window passes.

### Discount codes

**Admin → Discount Codes** — create a code as a percent-off or fixed-amount
discount, optionally scoped to one currency, with an optional usage limit
and expiry. Validation happens server-side in `create_pending_order()`, so
an invalid/expired/exhausted code is always rejected before payment starts,
not just hidden in the UI.

### Store settings, shipping rates & tax

**Admin → Settings** — store name, logo URL, WhatsApp number, and both tax
rates are now editable right there (no more Supabase Table Editor needed for
these). The storefront picks up the store name and logo automatically via a
new public `get-settings` endpoint (fails soft — if it's ever unreachable,
the site just keeps its default "V." branding rather than breaking).

Shipping rates (`shipping_rates` table — one row per method+currency) are
also editable in the same tab now.

### Catalog export/import

Same screen: **Export JSON** downloads the full catalog; **Import JSON**
re-uploads it (matches on `id` — present updates in place, absent creates a
new product, so re-importing an export is safe to repeat). **Export PDF**
generates a text-based catalog (title, category, price, stock, description)
directly with jsPDF — not a screenshot of the storefront, since the admin
panel is a separate page with no product display in its own DOM to capture,
and deliberately has no embedded images so it doesn't depend on third-party
image hosts allowing cross-origin fetches from the admin CSP.

### Refunds

**Admin → Orders → Refund** on any paid order. For Paystack/Flutterwave
orders this calls the provider's real refund API using the stored
transaction ID — money actually moves. For bank-transfer orders there's no
refund API to call (same as there was no payment API to call going in), so
this only records that you already sent the money back manually. Either
way it restocks the item by default and reduces the customer's recorded
lifetime spend.

## What to know before you rely on this in production

- **Webhooks are the source of truth** for "was this paid" — the
  `payment-callback.html` page you see right after paying is just a fast,
  friendly confirmation screen; if it ever shows "still processing," the
  order will still complete automatically once the webhook (which usually
  arrives within seconds) lands.
- **Stock decrements only happen once payment is confirmed** — an
  abandoned or unpaid checkout never touches inventory.
- **CORS** on the API functions defaults to your `SITE_URL`. If you add a
  custom domain later, update `SITE_URL` in Netlify's environment variables
  to match it.
- **Rotate keys** if you ever suspect a secret leaked (Paystack/Flutterwave
  dashboards let you regenerate secret keys instantly).

---

## Appendix: frontend structure & hardening notes

`public/` is organized as:

```
index.html, payment-callback.html    Public storefront (no admin UI/logic present at all)
css/styles.css                       Public storefront styles
js/app.js, utils.js, payment-callback.js
admin/index.html, dashboard.html, admin.css, admin-app.js, admin-login.js
manifest.json, sw.js, robots.txt, sitemap.xml
```

Changes made when splitting this out of the original single-file build:

- **Auth**: admin pages hold only an opaque server-issued token in
  `sessionStorage` (cleared on tab close). The client never decides who's
  authorized — every `admin-operations` call re-checks the token against
  `admin_sessions` server-side, which is the real boundary.
- **Escaping**: all product/order/customer data and the payment-callback's
  URL parameters are passed through `Utils.escapeHtml`/`escapeAttr` before
  reaching the DOM.
- **CSP**: every page sets a `Content-Security-Policy` meta tag. No inline
  `onclick=` anywhere — replaced with `data-action` attributes and a single
  delegated listener, both on the storefront and in admin, which is what
  makes running without `'unsafe-inline'` in `script-src` possible.
- **a11y**: skip link, `<main>` landmark, `aria-live` regions, visually-hidden
  `<label>`s on every input, focus-visible outlines.
- **SEO/PWA**: meta description, OG tags, `Organization` JSON-LD, canonical
  URL, `manifest.json`, offline-cache `sw.js` (excludes `/admin/`,
  `/.netlify/`, and `/payment-callback.html` from the cache on purpose).
- `robots.txt` disallows `/admin/`; `sitemap.xml` only lists the storefront.

### Minified build (already included, in `dist/`)

`dist/` is a complete mirror of `public/` (+ `netlify/functions`,
`supabase/migrations`, `netlify.toml`, `package.json`) with every `.css`/
`.js` file minified — comments and insignificant whitespace stripped, same
filenames and paths as `public/` so nothing needs re-wiring. It was built
offline with `tools/minify.py`, a small character-level state machine that
is aware of JS strings/template literals/regex literals so it can't corrupt
code the way a naive `s/\/\/.*//` regex would; every JS file in `dist/` is
re-validated with `node --check` as part of the build. To deploy the
minified version instead, either point Netlify's publish directory at
`dist/`, or `rsync`/copy `dist/`'s contents over `public/` before pushing.

For **real** identifier mangling (variable/function renaming, dead-code
elimination), run the `build` script in `package.json` — `terser --mangle`
on the JS, `csso` on the CSS, `html-minifier-terser` on the HTML — in an
environment with npm registry access:
```bash
npm install
npm run build
```
This sandbox has no network access to npm, so that real-terser pass is not
what produced the `dist/` folder in this zip; `tools/minify.py` was used
instead specifically because it's safe to run without a real JS parser.

**On "obfuscation":** minification and identifier mangling raise the bar
against casual copy-paste but do not make client-side JavaScript secret —
anyone can still view-source and deminify it (even mangled, `terser
--mangle` output un-minifies to readable-if-ugly code in seconds with any
formatter). There's no obfuscator wired into this project on purpose: the
real security work is the server-side auth and escaping described above —
minification is a size optimization, not a security control, and shipping
`eval`-based or string-encoded "obfuscation" would also conflict with the
strict CSP (`script-src` with no `unsafe-eval`) already in place on every
page.

### Still needed before launch

- `public/icons/icon-192.png`, `public/icons/icon-512.png` (referenced by
  `manifest.json` — none were generated here)
- `public/favicon.ico`

---

## What changed vs. the draft files that were uploaded to this project

The `app.js`, `dashboard.html`, `index.html`, `payment-callback.html`, and
`styles.css` that were attached to this update request were an **earlier,
regressed draft** — not the version above. Diffing them against this
project's real backend (`netlify/functions/*`, `supabase/migrations/*`)
showed the draft:

- used a different, incompatible product shape (`id`/`basePrice`/`image`
  instead of the real `product_id`/`base_price`/`image_url`/`media_kind`
  columns the database and Netlify functions actually use — the draft
  would render an empty/broken storefront against this backend),
- had no XSS escaping in `payment-callback.html`'s inline script (the
  `order_number`/`reference` query-string values went straight into
  `innerHTML`),
- stored the admin session in `localStorage` instead of `sessionStorage`,
- used inline `onclick="..."` handlers instead of the `data-action` +
  delegated-listener pattern, which blocks shipping a `script-src` CSP
  without `'unsafe-inline'`,
- was missing the product design system entirely (media kind, per-half
  backgrounds, typography, visibility toggles), discount codes, settings,
  and the service-worker/PWA wiring.

This package **replaces** those five files with the versions above, which
match the real backend contract and keep the security/SEO/accessibility
work already present in this project (CSP, escaping, sessionStorage,
`data-action` delegation, `robots.txt`/`sitemap.xml`/`manifest.json`,
skip-link + `aria-live` + focus-visible styling). A `prefers-reduced-motion`
rule was added to `styles.css` as the one genuinely new enhancement beyond
what the project already had.
