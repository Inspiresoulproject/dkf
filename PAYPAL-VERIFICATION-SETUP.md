# PayPal donation verification setup

The website now supports server-verified donation recording without trusting browser-only payment data.

## Required Coolify environment variables

- `DATABASE_URL` — existing DKF PostgreSQL connection
- `PAYPAL_MODE` — `live` or `sandbox`
- `PAYPAL_CLIENT_ID` — PayPal REST app client ID
- `PAYPAL_CLIENT_SECRET` — PayPal REST app secret
- `PAYPAL_RECEIVER_EMAIL` — exact email address that receives DKF PayPal donations
- `GA4_MEASUREMENT_ID` — defaults to `G-9H2PMKKH2N`
- `GA4_API_SECRET` — GA4 Measurement Protocol API secret
- `PUBLIC_BASE_URL` — `https://digitalkidsfoundation.org`

## PayPal account configuration

Configure PayPal Instant Payment Notification for:

`https://digitalkidsfoundation.org/api/paypal/ipn`

The existing Donate SDK button also sends this URL as `notify_url`. The server validates IPN messages with PayPal, requires a completed payment, verifies the receiving email, stores each transaction ID only once, and sends a GA4 `purchase` event only from the server.

The browser `onComplete` callback also requests server verification through `/api/paypal/donation-complete`. If PayPal reporting has not yet propagated the transaction, the page displays a pending-verification message and IPN can finish the verification asynchronously.

## GA4 and Google Ads

Create a GA4 Measurement Protocol API secret for the DKF web data stream and add it to Coolify as `GA4_API_SECRET`. After a sandbox or low-value live test confirms a `purchase` event with `transaction_id`, `value`, and `currency`, mark/import `purchase` as the fundraising conversion in Google Ads.

Do not make button clicks or visits to the thank-you page primary conversions.
