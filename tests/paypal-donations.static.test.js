'use strict';
const fs = require('fs');
const assert = require('assert');

const moduleText = fs.readFileSync('paypal-donations.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const success = fs.readFileSync('public/donation-success/index.html', 'utf8');

assert(moduleText.includes('/api/paypal/ipn'), 'IPN route missing');
assert(moduleText.includes('/api/paypal/donation-complete'), 'completion verification route missing');
assert(moduleText.includes('transaction_id'), 'transaction ID dedupe/GA4 parameter missing');
assert(moduleText.includes("name: 'purchase'"), 'server-side GA4 purchase event missing');
assert(moduleText.includes('PAYPAL_RECEIVER_EMAIL'), 'recipient validation missing');
assert(moduleText.includes('GA4_API_SECRET'), 'GA4 API secret gate missing');
assert(html.includes("notify_url:'https://digitalkidsfoundation.org/api/paypal/ipn'"), 'Donate SDK IPN URL missing');
assert(html.includes('onComplete: async function(params)'), 'Donate SDK completion callback missing');
assert(!html.includes("dataLayer.push({event:'purchase'"), 'purchase must not be sent from unverified client code');
assert(success.includes("status==='verified'"), 'verified donation success state missing');
console.log('PASS: PayPal verification, dedupe, and server-side GA4 purchase wiring present');
