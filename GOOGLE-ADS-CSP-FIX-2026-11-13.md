# Google Ads CSP Fix - 2026-11-13

Updated the global `Content-Security-Policy` in `server.js` to allow the Google Ads endpoints that Tag Assistant reported as blocked while preserving the rest of the existing CSP.

Added to `script-src`:
- `https://www.googleadservices.com`
- `https://www.google.com`
- `https://googleads.g.doubleclick.net`

Added to `connect-src`:
- `https://www.googleadservices.com`
- `https://googleads.g.doubleclick.net`
- `https://pagead2.googlesyndication.com`
- `https://www.google.com`
- `https://ad.doubleclick.net`

The existing `img-src 'self' data: https:` already permits HTTPS image/beacon requests, and the existing `frame-src` already permits Google Tag Manager.

After deployment, re-run Tag Assistant Preview and submit the Donate Laptops form. Confirm that the CSP warning is gone and that `laptop_donation_submit` appears in the Tag Assistant event timeline and in GA4 Realtime.
