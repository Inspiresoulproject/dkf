# Digital Kids Foundation — Secure Donor Receipt Verification (v1)

## What this update changes

This upgrade builds on the existing Donor Receipts tab and **does not replace the laptop applications, inventory or distribution features**.

**Newly issued** donation receipts and acknowledgment letters now include:

1. A cryptographically random **128-bit verification code**, assigned to the receipt in the database.
2. A **QR code** in the issued PDF that links to `https://digitalkidsfoundation.org/verify-donation/<receipt-number>?code=<random-code>`.
3. A **server-generated HMAC-SHA256 integrity seal** over immutable receipt details. The signing key is a server-only Coolify environment variable.
4. A **SHA-256 fingerprint of the exact issued PDF**, saved beside the archived PDF. The public verification page offers a browser-only file check that compares a selected PDF's fingerprint with the archive. The selected PDF is **not uploaded**.
5. An official website verification page that states **Verified / Not verified / Revoked**. When verified, it displays canonical receipt number, donor name, date, type, quantity/amount and description for comparison with the PDF.
6. **Revoke Receipt** for an authenticated administrator, requiring a reason and a final confirmation. Revocation is permanent through this interface, records who revoked it and why, and invalidates the public verification link. The original PDF remains archived.
7. Issue/revocation audit events in PostgreSQL, plus existing admin identity and Resend acceptance references.

### Limits to understand

No PDF or QR code can prevent copying, scanning, screenshots or forwarding. A perfect unchanged copy of a genuine receipt remains a genuine copy. Fraud prevention relies on matching its details to DKF's authoritative online record and comparing the exact PDF file fingerprint. This is **not a standards-based cryptographic/PAdES PDF digital signature** and is not an IRS guarantee.

The verified page displays donor name and donation details to anyone who has the difficult-to-guess verification link (e.g., someone scanning the QR); **it does not display donor email or internal admin details**. Avoid posting receipts publicly without donor consent.

## Required one-time Coolify setting

Before any new receipt can be sent, set the following environment variable in the DKF application:

`DKF_RECEIPT_SIGNING_KEY` = **64+ hexadecimal characters (32+ random bytes)**

Generate a key locally in Windows CMD (prints the value; paste it privately in Coolify, **never in GitHub or this chat**):

```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If Node isn't available on your PC, generate the key in a secure Node.js environment under your control. Protect and back up the key: **changing or losing it causes previously issued verified receipts to fail verification**. It is different from `RESEND_API_KEY` and must not reuse that key. Coolify redeploy is needed after saving the environment variable.

**Existing env vars are still needed:** `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, the Cloudflare Access/Microsoft Entra ID admin access settings, and any existing laptop-program values.

### Database migration and dependencies

- The existing `donor-receipts.js` runs additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations the first time it initializes. It does not remove existing receipts.
- A `dkf_receipt_audit` table is created for issuance and revocation history.
- `qrcode` was added to `package.json`. The included Dockerfile uses `npm install --omit=dev`; redeploy will install it. No separate npm command is needed in Coolify if building from this Dockerfile.
- **Back up PostgreSQL before deploying.**

## What donors will see

The donor's attached PDF has the DKF logo, receipt reference, donation acknowledgment, verification QR and short code. The email includes a DKF verification link. Scanning the QR opens the verification page on the **official domain**. Compare the displayed details with the PDF. For stronger certainty, select the PDF in the page's **Check whether the PDF was changed** control; the browser hashes the file locally and reports MATCH / DOES NOT MATCH.

## Administrator procedure

1. Open `/laptop-admin/#donors`, create or open a **draft**.
2. Confirm donation type, quantity/amount, date, donor email and description.
3. Click **Generate / Review PDF**. The QR on a **draft** verifies as **Not verified**; this is expected.
4. Confirm the donation was actually received and that the PDF was reviewed, then send using the explicit confirmation dialog.
5. After Resend accepts the email, the history shows **Sent**; the verification link should show **Verified DKF document**.
6. Open the sent receipt and click **Verify issued document** to confirm.
7. For a genuinely erroneous/fraudulent receipt, open it and choose **Revoke receipt**, enter a reason and confirm. The link now shows **Receipt revoked**. Notify the donor separately (revocation does **not** automatically send a new email).

**Do not click Send again** if a delivery is uncertain. Check the Resend dashboard first and reconcile with the receipt record. Receipt acceptance by Resend does not guarantee final mailbox delivery.

## Older receipts already sent before this upgrade

Previously emailed PDFs lack a QR / integrity seal. They remain archived, and this release **does not silently edit them, reissue them, or send duplicates**. The admin panel labels these as legacy documents. If a correction is necessary, revoke the old record (when appropriate), create a new reviewed receipt with a new reference, and explicitly communicate the replacement to the donor. Do not label old PDFs as newly verified without issuing a new document.

## Staging verification checklist

- [ ] Back up the PostgreSQL database.
- [ ] Set the signing key and build in Coolify.
- [ ] Open `/health` and `/laptop-admin/#donors`.
- [ ] Create a **test draft** with a unique test donor email. Preview PDF; QR verification should show **Not verified** while still Draft.
- [ ] Confirm factual receipt and manually send one test receipt only. Check Resend, Sent status and the verification page.
- [ ] Download the emailed PDF and select it on the public verification page: should show **MATCH**.
- [ ] Edit or regenerate a PDF with changed bytes: should show **DOES NOT MATCH**.
- [ ] Compare visible donor name, donation description/quantity and receipt number to the verifier.
- [ ] Revoke the test document from admin and confirm the public verification page shows **Receipt revoked**.
- [ ] Check existing laptop application/inventory workflows still work.
- [ ] Verify old sent receipts have **not** been resent.

## Offline checks included in this ZIP

```sh
node --check donor-receipts.js
node --check public/donor-receipts-portal.js
node --check public/verify-donation.js
node tests/donor-receipts.validation.test.js
node tests/donor-receipts.send-lifecycle.test.js
node tests/donor-receipts.security.test.js
```

The included tests use simulated PDF, PostgreSQL and Resend integrations. A real PDFKit QR rendering check, Coolify build, PostgreSQL migration and live email test must be completed in staging before production use.
