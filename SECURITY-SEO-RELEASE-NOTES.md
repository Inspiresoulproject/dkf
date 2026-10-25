# DKF Security & SEO Update v1 — staging candidate

## Changes
- Security headers (CSP with Turnstile and PayPal allowances, frame protection, nosniff, referrer and permissions policy). Check CSP in browser console on all forms and PayPal before production.
- Verification processing recovery: an interrupted claim **before** dispatch can return to pending after two minutes. Once external dispatch begins, an interrupted or uncertain delivery is marked `needs_review` to prevent automatic duplicate applications. This requires manual support; it is not an automatic resend.
- Bounded in-memory rate-limit map; use Cloudflare WAF rate limiting for distributed protection.
- Basic input field/count/length validation.
- Canonical, social preview tags, and conservative NGO structured data.
- One H1 retained; other H1 tags changed to H2.
- Node 22 base image.

## Important caveats
- A successful admin notification followed by a crash before thank-you mail may mean no thank-you message. Do not retry the admin notification automatically. A transactional email queue is needed for stronger delivery guarantees.
- Existing persisted records are preserved; keep the same `/app/data` volume and encryption key.
- TRUST_PROXY_HOPS defaults to 1: confirm actual proxy chain before changing.
- HSTS only set when Express detects HTTPS or forwarded HTTPS; configure TLS and HSTS at Cloudflare as well.
- Inline scripts and styles require `unsafe-inline` in this first-pass CSP. A nonce/hash-based CSP is a future improvement.
- External PayPal flow and Turnstile must be smoke-tested.
- Rate limiting remains single-instance only.
- The site remains a single-page app; this release does not create new indexable landing pages.
- `npm install` remains in Dockerfile until a tested package-lock.json is generated.

## Staging tests
1. Confirm homepage, mobile navigation, donation button, contact form, volunteer and device donation forms.
2. Submit volunteer with each role; verify once; confirm one admin email and one role-based thank-you.
3. Test expired token, repeat-click, and invalid token; check no duplicate notifications.
4. Inspect browser console for CSP errors, particularly PayPal popup and Turnstile.
5. Check response headers and crawlable `/robots.txt`, `/sitemap.xml`.
6. Test rollback; backup persistent volume before deploying.
