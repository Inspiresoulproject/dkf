# DKF Email Verification Deployment

This release verifies email ownership for **Volunteer** and **Device Donation** inquiries. Contact submissions still use Turnstile and send immediately. Email format and phone format checks remain in place.

## Required Coolify settings

Preserve existing `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`.

Add these **runtime** variables:

- `PUBLIC_BASE_URL=https://digitalkidsfoundation.org`
- `VERIFICATION_DATA_DIR=/app/data`
- `VERIFICATION_ENCRYPTION_KEY`: generate once using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Store securely in Coolify; **do not commit or change this key** while pending submissions exist.

**Required persistent storage:** Mount a Coolify persistent directory/volume to `/app/data` in the application container. The pending-submission store is encrypted at rest and stored in `/app/data/pending-verifications.json`. Without persistent storage, pending applications will be lost on redeploy. Back up the volume securely. This file store is designed for **one running DKF application instance**, not multiple replicas. Use a transactional database for multi-instance deployments.

## Workflow

1. User completes Volunteer or Device Donation form and passes Turnstile.
2. Server sends a verification link to the submitted email; DKF receives **no application yet**.
3. User clicks the link within 30 minutes; server sends the saved application to DKF through Resend and marks link used.
4. Contact form sends to DKF immediately after Turnstile.

## Testing

- Verify valid contact submission still reaches DKF immediately.
- Submit volunteer and device inquiries; check that only the applicant receives the initial verification message.
- Click each verification link and confirm the application reaches DKF once.
- Retry a used link: should show expired/already used.
- Test expired link after 30 minutes.
- Restart the container before clicking a fresh link and verify the pending record survives (persistent volume required).
- Confirm Turnstile rejects missing or invalid tokens server-side.

## Notes

- Verification proves control of an email inbox at verification time, not identity or truthfulness of submitted details.
- The verification link is a single-use GET link. Some email-security scanners automatically open links; if this affects users, switch to a confirmation POST page.
- A server restart during the brief forwarding step can leave an application marked processing. Review logs and manually resolve such rare cases. For stronger guarantees use a transactional database and queue.
- The app's existing in-memory rate limiter resets on restart; add edge rate limits in Cloudflare for stronger abuse protection.
- Do not deploy without the persistent volume and encryption key.
