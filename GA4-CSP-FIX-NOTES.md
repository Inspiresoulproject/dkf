# DKF Google Analytics / CSP fix — November 2026

Updated `server.js` global Content-Security-Policy to permit the existing Google Tag Manager container `GTM-K5BLFBNP`, Google Analytics collection for `G-9H2PMKKH2N` (configured in GTM), Tag Assistant preview, the existing Formspree AJAX CDN script, and Cloudflare Web Analytics beacon. Existing CSP restrictions (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, etc.) remain in place.

## Deploy and verify
1. Deploy this complete project using the existing DKF deployment process. The change is not live until deployment.
2. Hard-refresh https://digitalkidsfoundation.org/ and check Chrome DevTools Console. Confirm `gtm.js` and `@formspree/ajax` are no longer blocked by CSP.
3. In GTM, Preview container `GTM-K5BLFBNP`. Confirm the existing Google Analytics tag for `G-9H2PMKKH2N` fires. If it does, publish the GTM workspace (if not already published).
4. Visit the site in a non-blocking browser and check GA4 Realtime / DebugView for a page_view. Tag Assistant success alone does not establish GA4 collection.
5. Test contact and laptop donation forms. Do not record form conversions before a confirmed successful submission; do not record PayPal purchases from a click or unverified redirect.

Note: If a reverse proxy or hosting platform overwrites Content-Security-Policy, update that layer too. Browser extensions can also interfere with preview. A few ancillary `data:` connection warnings may remain; these are not a reason to loosen `connect-src` globally.
