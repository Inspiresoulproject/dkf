# DKF Laptop Assistance — staging build

## Status
This package contains an initial implementation. It has passed JavaScript syntax checks but has **not** been tested against your live PostgreSQL, Resend, or Turnstile accounts. Do not deploy to production without a staging test and backup.

## Routes
- `/request-a-laptop/` — unified Individual / School / Organization application.
- `/application-status/` — email-authenticated status lookup.
- `/laptop-admin/` — initial management UI. **Protect with Cloudflare Access (identity + MFA) before public deployment.** It uses an additional `LAPTOP_ADMIN_KEY` header for API calls, which is not a replacement for identity-based authentication.
- `/api/laptops/*` — API routes.

## Coolify environment
Keep all existing environment variables unchanged. Set `DATABASE_URL` to the PostgreSQL *internal* URL and set `LAPTOP_ADMIN_KEY` to a new randomly generated secret (at least 32 random bytes). Do not share either value. Keep `RESEND_API_KEY`, `MAIL_FROM`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `PUBLIC_BASE_URL` configured.

## Database
On app startup, `laptop-system.js` creates five tables with `CREATE TABLE IF NOT EXISTS`: `laptop_applications`, `laptop_tokens`, `laptop_history`, `laptop_inventory`, `laptop_allocations`. For production, use a dedicated migration process and least-privilege application account. Existing verification-store.js and /app/data are untouched.

## Important safeguards
- Email verification required before application enters review.
- 30-minute verification links and 15-minute one-time status links.
- Application status is only disclosed after an emailed verification link is used.
- No child names or ID numbers requested.
- No equipment guarantee; inventory allocation only for approved applications and ready devices.
- Admin changes are audited by status and notes, but the prototype uses a shared admin key rather than named admin identities. For production, implement named admin identities, MFA, and more granular audit records.
- Protect personal data with PostgreSQL backups, retention rules, access reviews, and incident-response procedures.
- Cloudflare Turnstile hostname check currently expects `digitalkidsfoundation.org`, matching the existing backend; a separate staging hostname requires a corresponding change and Turnstile configuration.
- Because the public site has a US/Ghana Cloudflare country rule, applicants in other countries will be unable to access the form.
- Backup Cloudflare Worker site is not updated by this package; manual failover will not automatically support these new routes. Plan backup integration before relying on failover for laptop applications.

## Before launch
1. Test in a staging Coolify application connected to a staging PostgreSQL database, not the production database.
2. Confirm internal network connectivity and DB schema initialization.
3. Test Resend delivery, Turnstile, verification expiry, duplicate clicks, applicant status, review actions, inventory, allocation, and fulfillment.
4. Place `/laptop-admin/*` AND `/api/laptops/admin/*` behind Cloudflare Access; ensure no bypass to origin.
5. Confirm PostgreSQL backups and test restoration.
6. Confirm privacy policy and retention policy cover laptop application records.
7. Take a production backup and deploy only after successful staging tests.
