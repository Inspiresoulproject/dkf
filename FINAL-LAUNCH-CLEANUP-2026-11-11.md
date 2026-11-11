# Final launch cleanup — November 11, 2026

This release:

- softens unsupported operating and response-time claims;
- expands the Privacy Policy for GTM, GA4, Google Ads, cookies, security providers and PayPal;
- changes direct-submission email titles to remove the misleading word “Verified”;
- limits individual laptop-assistance applicants to children ages 3–17;
- removes the stale root `index.html` (Express serves `public/index.html`);
- adds PayPal verification-ready server infrastructure and a server-only GA4 purchase path;
- preserves the existing laptop-donation and corporate-partnership lead events.

PayPal purchase reporting remains inactive until the required production environment variables are configured in Coolify.
