# DKF Donor Receipts — Integrated Release

## What was added

The existing secure `/laptop-admin/` sidebar has a **Donor Receipts** tab (`#donors`) using the same layout and Cloudflare Access administrator identity checks as the current portal. It supports:

- **Document type:** donation receipt or acknowledgment letter.
- **Donation type:** laptop, desktop, tablet, computer accessories, other equipment, monetary contribution, or other property.
- **Drafts:** save/edit before sending with unique references like `DKF-2026-000001`.
- **PDF preview:** embeds the generated document with the supplied Digital Kids Foundation logo and a DRAFT watermark. Also has an **Open PDF in new tab** link.
- **Review gate:** the admin confirms actual donation receipt and visually checks the donor, date, type and quantity/amount. Any edit clears the review.
- **Send:** *only* a separate explicit confirmation sends the finalized PDF via Resend as an email attachment.
- **Audit history:** receipt details, approving admin, sending time, and Resend message ID. Issued PDF bytes are retained in PostgreSQL so later logo/template edits do not change the archived issued document.
- **Ambiguous sends:** if provider acceptance is unclear, status becomes `needs_review`. The app blocks automatic resending; inspect Resend delivery logs and reconcile manually.
- **Validation:** prevents obvious quantity mismatch (for example, quantity=1, description="23 laptops"). In-kind gifts do not get a donor tax value on the receipt.

## Files changed/added

- `server.js` — mounts the new authenticated receipt API, initializes its database schema when DATABASE_URL is configured, and permits self-hosted PDF previews in the CSP.
- `package.json` — adds the PDFKit dependency.
- `public/laptop-admin/index.html` — adds the tab, form, PDF preview, send confirmations, and history.
- `public/laptop-admin-portal.js` — labels and navigates the new tab.
- `public/laptop-admin-portal.css` — donor UI styles, including responsive behavior.
- **New** `public/donor-receipts-portal.js` — client-side create, edit, preview, send and history actions.
- **New** `donor-receipts.js` — protected Express endpoints, PostgreSQL persistence, PDFKit renderer, Resend attachment sender.
- **New** `assets/dkf-logo.png` — the approved logo provided by DKF, used by PDF generation. **Do not move this file into the public directory.**
- **New** `docs/DKF_Approved_Donor_Receipt_Design_Reference.pdf` — visual template reference, SAMPLE only, not issued.
- **New** `tests/donor-receipts.validation.test.js` — offline input validation smoke tests.

## Setup in Coolify / staging

1. **Back up** the existing site and PostgreSQL database before deploying. Test in **staging** first with a staging DB and an authorized test email address. Do not enter fictional donations into production or send them to donors.
2. Use this ZIP as the updated project source. The entrypoint remains `server.js`, and your existing Dockerfile is retained. Its `npm install` step will install `pdfkit` from `package.json` during deployment. Existing dependencies remain unchanged.
3. Verify the application's existing environment variables: `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `CF_ACCESS_AUD`, `DKF_ADMIN_EMAILS`. No secrets are included in this ZIP. The signed-in admin must be allowed by `DKF_ADMIN_EMAILS`. `MAIL_FROM` must be an authorized sending address for the Resend domain.
4. Optionally set `DKF_EIN` and `DKF_MAILING_ADDRESS` **only after verifying the official values**. The template otherwise uses "Brooklyn, New York" and deliberately does not invent an EIN. Have DKF's legal/accounting reviewer approve the finalized acknowledgment text before sending actual donor tax receipts.
5. The receipt module creates/extends the PostgreSQL table `dkf_donor_receipts` on startup (`CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`). For established production databases, have your database administrator review and execute schema migrations with backups/rollback plan rather than relying solely on boot-time DDL.
6. Protect `/laptop-admin/*` AND `/api/laptops/admin/*` with Cloudflare Access at the edge, and validate tokens again at the origin (the app already uses `dkf-access-auth.js`). Restrict public origin bypasses. All receipt API routes require an approved admin JWT.
7. Visit `https://digitalkidsfoundation.org/laptop-admin/#donors` after deployment. Create a staging draft with a **test** donor email, select receipt type, review the PDF, then test an actual email only with an authorized inbox and a properly documented contribution. Inspect Resend events for delivery/bounce — `sent` means API acceptance, **not proof of delivery**.
8. Test: receipt vs acknowledgment letter; noncash vs monetary; long descriptions; mismatched quantity; stale PDF preview; changes after preview; repeat clicks; admin without permission; `needs_review`; history and archived sent PDF retrieval; other existing admin pages and public website features.
9. Confirm database backups, retention controls for donor personal information, mailbox verification, and PDF rendering before promoting the build.

## Protected API endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/laptops/admin/donor-receipts` | List most recent receipts |
| POST | `/api/laptops/admin/donor-receipts` | Create draft |
| GET | `/api/laptops/admin/donor-receipts/:id` | Retrieve a receipt |
| PATCH | `/api/laptops/admin/donor-receipts/:id` | Edit an unsent draft |
| GET | `/api/laptops/admin/donor-receipts/:id/pdf` | Preview draft / retrieve issued PDF |
| POST | `/api/laptops/admin/donor-receipts/:id/send` | Explicit confirm-and-send action |

All mutation requests must have a same-origin `Origin` header. The send endpoint also requires the latest PDF to have been generated, positive confirmations, and the matching `updated_at` version. Only one send attempt can move a draft into the `sending` state. Resend is called with an idempotency key unique to the receipt.

## Testing completed here

- Passed JavaScript syntax checks on server, new and original laptop scripts, plus receipt client script.
- Passed 10 donor data validation assertions (including quantity mismatch and invalid dates/emails).
- Passed structural checks that the tab, PDF iframe, controls, server mount and logo are present.
- **Limitations:** no live DB or Resend connection used; npm could not download packages from this container (DNS/network blocked), so an actual PDFKit rendering and integration/email delivery test is still required in staging. No emails were sent and the production website was not changed.

## PDF/legal notes

A donor acknowledgment for **noncash** items describes the property but must not assign the donor's claimed fair market value. A cash receipt includes the amount. The template records whether DKF furnished goods or services in exchange, and if so requests a description and good-faith value. An admin's approval is documented by email, **not a handwritten or digital signature**. Receipt numbers are assigned when drafts are created; unused draft numbers are expected.
