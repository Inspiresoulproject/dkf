'use strict';

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 })
  : null;

const isSandbox = String(process.env.PAYPAL_MODE || 'live').toLowerCase() === 'sandbox';
const apiBase = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
const ipnVerifyUrl = isSandbox
  ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr'
  : 'https://ipnpb.paypal.com/cgi-bin/webscr';
const ga4MeasurementId = process.env.GA4_MEASUREMENT_ID || 'G-9H2PMKKH2N';

let accessTokenCache = null;
const clientAttempts = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, times] of clientAttempts) {
    const live = times.filter((time) => time > cutoff);
    if (live.length) clientAttempts.set(key, live);
    else clientAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

function configured() {
  return Boolean(
    pool &&
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET
  );
}

function cleanTransactionId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

function cleanCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function cleanAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 1000000
    ? Math.round(amount * 100) / 100
    : null;
}

function anonymousClientId(transactionId) {
  const hash = crypto.createHash('sha256').update(transactionId).digest();
  return `${hash.readUInt32BE(0)}.${hash.readUInt32BE(4)}`;
}

async function ensureSchema() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dkf_paypal_donations (
      transaction_id TEXT PRIMARY KEY,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      item_name TEXT,
      item_number TEXT,
      verification_source TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ga4_sent_at TIMESTAMPTZ
    )
  `);
  return true;
}

async function getPayPalAccessToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal REST credentials are not configured.');
  }
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`PayPal OAuth failed (${response.status}).`);
  }
  accessTokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in) || 900) * 1000,
  };
  return accessTokenCache.token;
}

async function findVerifiedTransaction(transactionId, claimedAmount, claimedCurrency) {
  const token = await getPayPalAccessToken();
  const end = new Date(Date.now() + 5 * 60 * 1000);
  const start = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const url = new URL(`${apiBase}/v1/reporting/transactions`);
  url.searchParams.set('start_date', start.toISOString());
  url.searchParams.set('end_date', end.toISOString());
  url.searchParams.set('transaction_id', transactionId);
  url.searchParams.set('fields', 'all');
  url.searchParams.set('page_size', '100');
  url.searchParams.set('page', '1');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`PayPal transaction verification failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  const details = Array.isArray(body.transaction_details) ? body.transaction_details : [];
  const match = details.find((entry) =>
    entry && entry.transaction_info && entry.transaction_info.transaction_id === transactionId
  );
  if (!match) return { pending: true };

  const info = match.transaction_info || {};
  if (info.transaction_status !== 'S') {
    return { pending: info.transaction_status === 'P', rejected: info.transaction_status !== 'P' };
  }

  const amount = cleanAmount(info.transaction_amount && info.transaction_amount.value);
  const currency = cleanCurrency(info.transaction_amount && info.transaction_amount.currency_code);
  if (!amount || !currency) return { rejected: true };
  if (claimedAmount && Math.abs(amount - claimedAmount) > 0.01) return { rejected: true };
  if (claimedCurrency && currency !== claimedCurrency) return { rejected: true };

  return {
    verified: true,
    transactionId,
    amount,
    currency,
    status: 'Completed',
    itemName: String(info.transaction_subject || 'Donation to Digital Kids Foundation').slice(0, 200),
    itemNumber: String(info.custom_field || 'dkf-general-donation').slice(0, 127),
    source: 'paypal_transaction_search',
  };
}

async function sendGa4Purchase(donation) {
  if (!process.env.GA4_API_SECRET) return false;
  const url = new URL('https://www.google-analytics.com/mp/collect');
  url.searchParams.set('measurement_id', ga4MeasurementId);
  url.searchParams.set('api_secret', process.env.GA4_API_SECRET);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: anonymousClientId(donation.transactionId),
      events: [{
        name: 'purchase',
        params: {
          transaction_id: donation.transactionId,
          value: donation.amount,
          currency: donation.currency,
          engagement_time_msec: 1,
          items: [{
            item_id: donation.itemNumber || 'dkf-general-donation',
            item_name: donation.itemName || 'Donation to Digital Kids Foundation',
            price: donation.amount,
            quantity: 1,
          }],
        },
      }],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  return response.ok;
}

async function recordVerifiedDonation(donation) {
  if (!pool) throw new Error('DATABASE_URL is required for verified donation recording.');
  const result = await pool.query(
    `INSERT INTO dkf_paypal_donations
       (transaction_id, amount, currency, status, item_name, item_number, verification_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (transaction_id) DO UPDATE SET
       amount=EXCLUDED.amount,
       currency=EXCLUDED.currency,
       status=EXCLUDED.status,
       item_name=COALESCE(EXCLUDED.item_name, dkf_paypal_donations.item_name),
       item_number=COALESCE(EXCLUDED.item_number, dkf_paypal_donations.item_number),
       verification_source=EXCLUDED.verification_source
     RETURNING transaction_id, amount::float8 AS amount, currency, status, item_name,
       item_number, verification_source, ga4_sent_at`,
    [
      donation.transactionId,
      donation.amount,
      donation.currency,
      donation.status,
      donation.itemName || null,
      donation.itemNumber || null,
      donation.source,
    ]
  );
  const row = result.rows[0];
  let analyticsRecorded = Boolean(row.ga4_sent_at);
  if (!analyticsRecorded) {
    analyticsRecorded = await sendGa4Purchase({
      transactionId: row.transaction_id,
      amount: row.amount,
      currency: row.currency,
      itemName: row.item_name,
      itemNumber: row.item_number,
    });
    if (analyticsRecorded) {
      await pool.query(
        'UPDATE dkf_paypal_donations SET ga4_sent_at=NOW() WHERE transaction_id=$1',
        [row.transaction_id]
      );
    }
  }
  return { transactionId: row.transaction_id, analyticsRecorded };
}

async function verifyIpn(rawBody) {
  const response = await fetch(ipnVerifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `cmd=_notify-validate&${rawBody}`,
    signal: AbortSignal.timeout(12_000),
  });
  return response.ok && (await response.text()).trim() === 'VERIFIED';
}

function mountRawRoutes(app) {
  app.post(
    '/api/paypal/ipn',
    express.raw({ type: 'application/x-www-form-urlencoded', limit: '100kb' }),
    async (req, res) => {
      try {
        if (!pool || !process.env.PAYPAL_RECEIVER_EMAIL) {
          return res.status(503).send('PayPal verification is not configured.');
        }
        const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        if (!raw || !(await verifyIpn(raw))) return res.status(400).send('Invalid IPN.');
        const data = Object.fromEntries(new URLSearchParams(raw));
        if (String(data.payment_status || '').toLowerCase() !== 'completed') {
          return res.sendStatus(200);
        }
        const transactionId = cleanTransactionId(data.txn_id);
        const amount = cleanAmount(data.mc_gross);
        const currency = cleanCurrency(data.mc_currency);
        const receiver = String(data.receiver_email || data.business || '').trim().toLowerCase();
        const expected = String(process.env.PAYPAL_RECEIVER_EMAIL).trim().toLowerCase();
        if (!transactionId || !amount || !currency || receiver !== expected) {
          return res.status(400).send('IPN details did not match DKF settings.');
        }
        await recordVerifiedDonation({
          transactionId,
          amount,
          currency,
          status: 'Completed',
          itemName: String(data.item_name || 'Donation to Digital Kids Foundation').slice(0, 200),
          itemNumber: String(data.item_number || 'dkf-general-donation').slice(0, 127),
          source: 'paypal_ipn',
        });
        return res.sendStatus(200);
      } catch (error) {
        console.error('PayPal IPN processing failed:', error.message);
        return res.status(500).send('Unable to process IPN.');
      }
    }
  );
}

function completionRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (clientAttempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 8) return res.status(429).json({ ok: false, error: 'Too many verification attempts.' });
  recent.push(now);
  clientAttempts.set(key, recent);
  next();
}

router.get('/api/paypal/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    serverVerificationEnabled: configured(),
    analyticsPurchaseEnabled: Boolean(configured() && process.env.GA4_API_SECRET),
    mode: isSandbox ? 'sandbox' : 'live',
  });
});

router.post('/api/paypal/donation-complete', completionRateLimit, async (req, res) => {
  try {
    if (!configured()) {
      return res.status(503).json({ ok: false, verified: false, pending: true });
    }
    const transactionId = cleanTransactionId(req.body && req.body.transactionId);
    const claimedAmount = cleanAmount(req.body && req.body.amount);
    const claimedCurrency = cleanCurrency(req.body && req.body.currency);
    if (!transactionId) return res.status(400).json({ ok: false, error: 'Invalid transaction ID.' });

    const verification = await findVerifiedTransaction(transactionId, claimedAmount, claimedCurrency);
    if (verification.pending) return res.status(202).json({ ok: true, verified: false, pending: true });
    if (!verification.verified) return res.status(400).json({ ok: false, verified: false });

    const recorded = await recordVerifiedDonation(verification);
    return res.json({
      ok: true,
      verified: true,
      analyticsRecorded: recorded.analyticsRecorded,
    });
  } catch (error) {
    console.error('PayPal completion verification failed:', error.message);
    return res.status(502).json({ ok: false, verified: false, pending: true });
  }
});

module.exports = {
  router,
  mountRawRoutes,
  ensureSchema,
  configured,
  cleanTransactionId,
  cleanAmount,
  cleanCurrency,
};
