# DKF Donor Receipts — Visible Security Design v2

This is an **additive design-and-integrity upgrade** to the existing donor receipts module. It keeps the current approved Digital Kids Foundation logo, green/gold layout, Resend attachment workflow, administrator confirmations, 128-bit verification QR, SHA-256 PDF digest, HMAC database seal, immutable archived issued PDF, and revocation features.

## New visual elements on *newly issued* receipts

1. **Watermark:** Subtle DKF lettering and a thin, pale rosette behind document content. This makes the receipt distinctive but is not itself anti-copy protection.
2. **Unique document seal ID:** A 16-character uppercase hex code derived from the server-held HMAC-SHA256 over canonical receipt fields. This appears inside a pale green security strip at the bottom of every issued page.
3. **Matching website record:** The official verification page displays the same document seal ID alongside verified donor and donation details; a recipient can compare it with the PDF.
4. **QR code + verification link:** Preserved from the previous secure version. The website checks issuance, server-side seal, stored PDF digest, and revocation status.
5. **PDF file check:** The public page already checks the selected PDF's SHA-256 hash **locally in the browser** against the exact PDF originally stored, so modifying the PDF makes the file check fail. The file is not uploaded.
6. **Unambiguous drafts:** Preview PDFs show `DRAFT`, `NOT ISSUED`, and no actual document seal ID.

## Important security limitations

- No watermark, QR code, or visible security seal prevents someone from copying, printing, photographing, forwarding, or visually imitating a PDF.
- The visible seal ID is a **comparison aid**, not an independently trusted signature. Always check the official DKF verification site and, when relevant, use the PDF-file check.
- The system's HMAC protects the receipt database and web verification. It is **not** a PDF-format cryptographic/PAdES digital signature. A true digitally signed PDF would require a trusted signing certificate and additional infrastructure.
- An unchanged duplicate of the genuinely issued PDF has the same valid file hash; use donor records and receipt history to detect improper use.

## Backward compatibility

- Existing issued PDFs are **not regenerated, modified, resent, or invalidated** by the layout change.
- Existing secure v1 records retain `document_format_version=1` and their v1 HMAC serialization. The official verifier labels them as the previous format, without requesting a seal ID that isn't printed in their original PDF.
- New receipts change to `document_format_version=2` atomically at issuance. This version number is part of the data signed by the server HMAC, so switching formats in the database makes a signature mismatch.
- If an older record has no archived PDF, the application now refuses to silently recreate an apparently issued document.
- The PostgreSQL schema migration is additive (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). **Back up the database before deployment.**

## Production configuration

The existing secret `DKF_RECEIPT_SIGNING_KEY` must stay unchanged and available only on the server in Coolify. The upgrade does **not** require a new secret. Changing the key breaks verification of already issued secure receipts.

Required environment variables remain: `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `DKF_RECEIPT_SIGNING_KEY`, and the app's existing administration authorization configuration.

The site uses the existing `pdfkit` and `qrcode` dependencies and existing Cloudflare/Coolify deployment configuration.

## Verification checklist (staging first)

- [ ] Back up PostgreSQL and save a copy of the current deployed files.
- [ ] Verify `DKF_RECEIPT_SIGNING_KEY` still matches the existing secure deployment; do not rotate it.
- [ ] Deploy to staging first and run `node --check donor-receipts.js` plus the three tests in `tests/`.
- [ ] Preview a test draft. It should be visibly marked DRAFT / NOT ISSUED and verify as Not verified.
- [ ] Verify an actual test donation, then manually issue **one** test PDF to an authorized test mailbox only. Check the watermark, QR, document seal ID and sender branding.
- [ ] Scan QR and check that the website's verified seal matches the 16-character ID on the PDF, then compare donor name, receipt number, date, quantity/amount and description.
- [ ] Upload/select the emailed PDF in the verification page. It should show exact-file MATCH. Modify a copy and check that it shows DOES NOT MATCH.
- [ ] Verify a legacy v1 secure PDF still validates and is labeled as previous format, without a printed seal requirement.
- [ ] Revoke the test receipt in admin; verification should show Revoked.
- [ ] Check email sending only happens after manual admin review and send confirmation; confirm duplicate-send protection remains active.
- [ ] Test existing laptop application, inventory, distribution workflows.

## File notes

- `donor-receipts.js`: Added the visible seal and background watermark, versioned HMAC, and archived-PDF safety check.
- `public/laptop-admin/index.html`: Updated the brief security description.
- `tests/donor-receipts.security.test.js`: Added v2 integrity/seal checks.
- `tests/donor-receipts.send-lifecycle.test.js`: Checks new issued version and one-send lifecycle.
- `docs/DKF_Secure_Receipt_Design_Preview.pdf`: **Visual mockup only**, deliberately marked SAMPLE / NOT ISSUED; this PDF is not a real signed/issued donation receipt. It was rendered independently to show design direction because this environment does not have the app's Node PDF runtime dependencies installed.

**No real donor email is sent, and no live DKF database or deployment is altered by this ZIP.**
