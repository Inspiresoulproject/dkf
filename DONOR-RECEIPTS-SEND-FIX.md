# DKF Donor Receipt — Send/Status Fix

## Problem reported

Receipts such as `DKF-2026-000001` and `DKF-2026-000002` remain **Draft** with no Sent At date after the PDF was previewed and the administrator confirmed sending.

## Root cause and correction

PostgreSQL `TIMESTAMPTZ` values can have **microseconds**, but node-postgres converts them to JavaScript `Date` objects with **millisecond** precision. The original code compared those values for exact equality in two places:

1. On PDF GET, the SQL update recording `last_previewed_at` could fail silently, so the browser showed the preview while the database still had no recorded review.
2. On Send POST, the version check could reject the same draft with HTTP 409 before Resend was called, leaving the record in Draft.

**Both** comparisons now compare at millisecond precision with PostgreSQL `date_trunc('milliseconds', updated_at)`. The preview route now checks `rowCount` and displays an explicit stale-preview error instead of treating an unrecorded preview as successful.

The browser script also distinguishes provider acceptance from subsequent history-refresh failures and locks the record once the API has confirmed it as sent, preventing repeat sends. Its script URL is versioned to avoid serving an outdated cached script.

## What to do with existing drafts

1. **Before sending, check the Resend dashboard** for the receipt references. If Resend shows a previously accepted email, don't send a duplicate. Have an admin reconcile the database status with the provider event.
2. Back up your website/database and deploy this fixed project to staging first. No database schema migration is necessary for this fix.
3. Open `https://digitalkidsfoundation.org/laptop-admin/#donors` and hard-refresh (`Ctrl+Shift+R`).
4. Click **Open** for the existing Draft receipt, then **Generate / Review PDF** again. Confirm the actual donation and PDF details, then **Send PDF to Donor by Email**.
5. A successful Resend API response should update the history to **Sent — accepted by provider**, with a **Sent at** timestamp. Provider acceptance is not a guarantee of inbox delivery; verify the email event in Resend.
6. If it remains Draft, copy the exact notice above the form and the network response of the `POST /api/laptops/admin/donor-receipts/:id/send` request (do not share passwords, keys, or tokens). Review Coolify logs for backend errors.

## Files changed in this hotfix

- `donor-receipts.js` — two SQL precision fixes; preview-result error check; explicit send rejection error.
- `public/donor-receipts-portal.js` — preserve confirmed send state if a history refresh fails; clearer notices.
- `public/laptop-admin/index.html` — versioned browser script URL.
- `tests/donor-receipts.send-lifecycle.test.js` — offline simulated preview/send/duplicate-send tests.

## Tests completed

- `node --check donor-receipts.js` — PASS
- `node --check public/donor-receipts-portal.js` — PASS
- `node tests/donor-receipts.validation.test.js` — PASS (10 validation assertions)
- `node tests/donor-receipts.send-lifecycle.test.js` — PASS (simulated backend and Resend response; **no real messages sent**)

Limitations: a live database connection and production Resend event could not be tested here. The actual provider status must be verified in the Resend dashboard.
