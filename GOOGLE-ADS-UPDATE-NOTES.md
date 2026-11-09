# DKF Google Ad Grants website update (2026-11-09)

## Content corrections
- Pickup: case-by-case, subject to availability; no universal free-pickup promise.
- Certified wiping: described as available for eligible devices; verify actual certification and documentation before publishing.
- Donation impact: removed unsupported dollar-to-device claims from the homepage impact panel.
- Historical impact: 12 laptops attributed to predecessor community project before DKF incorporation, including FAQ clarification.

## Tracking groundwork added
- `contact_form_submit` is pushed to `window.dataLayer` only when `/api/submit` confirms a contact form was accepted.
- `laptop_donation_submit` is pushed on the one-time successful email verification response after a device donation inquiry is forwarded. It is not fired on initial form submit.
- No GA4/GTM measurement ID was supplied; no analytics container or tracking tags have been installed. These dataLayer events alone do not transmit data to Google.
- Corporate partnership inquiries currently use the generic contact form and cannot be reliably separated without a dedicated form or validated category field.
- PayPal uses a hosted Donate button. No completed-donation tracking was installed because the uploaded project does not include a verified PayPal transaction-confirmation webhook or API integration. Do not track PayPal button clicks as purchases.

## Required before enabling ads
1. Supply and install the correct GTM container, with privacy/consent configuration as appropriate.
2. Configure GTM custom-event triggers and GA4 tags for `contact_form_submit` and `laptop_donation_submit`; verify in Tag Assistant and GA4 DebugView.
3. Build a dedicated corporate partnership form and only emit `corporate_partner_submit` on successful server acceptance.
4. Add a PayPal server-verified capture/webhook flow with idempotent transaction IDs; then emit GA4 `purchase` with verified value and USD currency.
5. Link GA4 to Ad Grants Google Ads account and import appropriate key events; avoid double-counting.
6. Check copy against actual operating policies, especially data-wiping certification and records of the 12 historical laptops.

## Deployment
This package is an edited source copy, not a live website deployment. Review diffs and test in staging before deploying. Original project dependencies and server configuration are unchanged.
