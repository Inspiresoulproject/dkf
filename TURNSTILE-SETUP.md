# DKF Cloudflare Turnstile integration

Coolify runtime environment variables:
- `TURNSTILE_SITE_KEY` = public Cloudflare widget site key
- `TURNSTILE_SECRET_KEY` = private Cloudflare widget secret key (keep out of Git)

The frontend loads the public site key from `/api/turnstile-config`, renders a widget on each form, and sends the token to `/api/submit`. The backend verifies each token with Cloudflare Siteverify and checks the hostname. If verification fails, the request is rejected before Resend sends email. The existing math challenge and contact-field validation remain.

After deploying, test all three forms on https://digitalkidsfoundation.org. Check that an invalid or missing Turnstile token returns HTTP 403 and that successful submissions still reach your inbox. PayPal donations are processed separately and are not affected.

**Email ownership verification is NOT included in this update.** It requires durable storage and a verification-link workflow and should be implemented separately.
