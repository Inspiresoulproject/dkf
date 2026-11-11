# Digital Kids Foundation — Coolify + Resend

## Coolify
Build strategy: Dockerfile
Exposed port: 3000

Environment variables (set in Coolify; do not commit secrets):
```
RESEND_API_KEY=re_xxxxxxxxx
MAIL_FROM=website@digitalkidsfoundation.org
MAIL_TO=help@digitalkidsfoundation.org
```

The sending domain must be verified in Resend.

Endpoints: `POST /api/submit`, `GET /health`.

## SEO additions
- Canonical URL and index/follow directives
- Open Graph and Twitter metadata
- NGO structured data (JSON-LD)
- `/robots.txt`
- `/sitemap.xml`

After deployment, submit `https://digitalkidsfoundation.org/sitemap.xml` in Google Search Console and request indexing for the homepage.

## Final launch configuration (November 2026)

### PayPal verified donation tracking

The site includes a verification-ready PayPal path. Add these variables in Coolify before enabling fundraising conversion optimization:

- `PAYPAL_MODE=live` (use `sandbox` for testing)
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_RECEIVER_EMAIL`
- `GA4_MEASUREMENT_ID=G-9H2PMKKH2N`
- `GA4_API_SECRET`
- `DATABASE_URL`
- `PUBLIC_BASE_URL=https://digitalkidsfoundation.org`

Configure PayPal IPN to send notifications to:

`https://digitalkidsfoundation.org/api/paypal/ipn`

See `PAYPAL-VERIFICATION-SETUP.md` for the full setup and test flow.

### Coolify proxy setting

Confirm `TRUST_PROXY_HOPS` matches the Cloudflare-to-Coolify proxy chain. Keep it at `1` only when one trusted proxy hop reaches the Node application.

### Build reproducibility

All package versions are pinned. A `package-lock.json` should be generated and committed from a network-connected development machine, then the Dockerfile can be changed from `npm install --omit=dev` to `npm ci --omit=dev`.
