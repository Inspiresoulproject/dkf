# DKF Admin Cloudflare Access / Microsoft 365

Cloudflare team: `cool-glitter-cd9e.cloudflareaccess.com`.

In Coolify set:

- `CF_ACCESS_AUD` = `42f46fa3bfdce86d83d9b8a00d8005fdcf60ba35035553a04ef155a632e0a78c`
- `DKF_ADMIN_EMAILS` = `help@digitalkidsfoundation.org` (comma-separated if more authorized administrators)

**Keep the Cloudflare Access application enabled**, protecting `/laptop-admin`, `/laptop-admin/*`, `/api/laptops/admin`, and `/api/laptops/admin/*`. Confirm exact matching in Cloudflare's UI and test. Do not protect public applicant endpoints.

Admin HTML and APIs validate the Access JWT signature against Cloudflare signing keys, issuer, audience, expiration, and allowed administrator email. Admin-key input is removed; `LAPTOP_ADMIN_KEY` is no longer needed for these routes. If `CF_ACCESS_AUD` is absent, admin access fails closed.

Deployment: commit website files, set env vars in Coolify, redeploy. Verify authorized login and that API calls without a valid Cloudflare assertion return 401. Verify public laptop submission and verification remain operational. Logout from Cloudflare Access does not necessarily log out from Microsoft 365.

Security: If Cloudflare Access has a Bypass rule for admin paths, remove it. Ensure origin is not reachable directly outside Cloudflare. No live deployment or end-to-end testing has been performed.
