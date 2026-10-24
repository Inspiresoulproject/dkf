# Digital Kids Foundation deployment

This package combines the latest DKF Editorial mobile app-style website, PayPal hosted donation button, corrected volunteer form, and dedicated PayPal return page with the existing Express/Resend backend.

## Coolify
1. Back up your current production project and environment variables.
2. Replace the files in your existing GitHub repository with the contents of this folder (do not include a nested DKF folder).
3. Commit and push to the branch Coolify deploys, or deploy this folder through your existing process.
4. Preserve RESEND_API_KEY, MAIL_FROM and MAIL_TO in Coolify. Do not commit secrets.
5. Ensure Coolify uses the existing Dockerfile and internal application port 3000.
6. Verify https://digitalkidsfoundation.org/health returns {"ok":true}.
7. Verify https://digitalkidsfoundation.org/donation-success displays the thank-you page.
8. Set the PayPal completed donation redirect URL to https://digitalkidsfoundation.org/donation-success (only after the page is live).
9. Test all mobile navigation and contact/volunteer/device inquiry forms, including Resend delivery.
10. Test PayPal popup with care: the button is LIVE, not sandbox. Check payment status in PayPal. A return-page visit is not payment proof.

PayPal hosted button ID: TK69TPXPFTBSY. PayPal checkout is independent of the Resend inquiry forms.

This ZIP is prepared for deployment, but it has not been pushed or deployed or end-to-end tested.
