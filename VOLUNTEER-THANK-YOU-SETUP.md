# Automated volunteer thank-you email

After successful volunteer email verification and successful delivery of the application to DKF, the server sends a personalized thank-you email to the verified volunteer via the existing Resend integration.

No new environment variables are required. Keep `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO`, `VERIFICATION_ENCRYPTION_KEY`, `VERIFICATION_DATA_DIR`, and Turnstile variables configured.

If the thank-you email fails, the verified application remains submitted and the error is logged. The thank-you is attempted once per successful verification; an already-used verification link cannot resend it.

To deploy: copy `server.js` into your existing DKF repository, commit and push, and redeploy in Coolify. Test with an email address you own.
