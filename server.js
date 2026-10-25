const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const recent = (hits.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ ok:false, error:'Too many submissions. Please try again later.' });
  recent.push(now); hits.set(key, recent); next();
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function validEmail(v) {
  const email = String(v || '').trim();
  return email.length <= 254 && /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email);
}
function validPhone(v) {
  const phone = String(v || '').trim();
  if (!phone) return true;
  if (!/^\+?[0-9() .-]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

app.get('/health', (req,res) => res.json({ok:true}));
app.get('/api/turnstile-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  res.json({ enabled: Boolean(siteKey && process.env.TURNSTILE_SECRET_KEY), siteKey: siteKey || null });
});

async function verifyTurnstile(token, ip) {
  if (!process.env.TURNSTILE_SECRET_KEY || !process.env.TURNSTILE_SITE_KEY) return false;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === 'digitalkidsfoundation.org';
  } finally { clearTimeout(timer); }
}

app.post('/api/submit', rateLimit, async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM || 'website@digitalkidsfoundation.org';
    const mailTo = process.env.MAIL_TO || 'help@digitalkidsfoundation.org';
    if (!apiKey) return res.status(500).json({ok:false,error:'Email service is not configured.'});

    const data = req.body || {};
    if (data.website) return res.json({ok:true}); // honeypot
    let turnstileOK = false;
    try { turnstileOK = await verifyTurnstile(data.turnstileToken, req.ip); }
    catch (err) { console.error('Turnstile verification unavailable:', err.message); }
    if (!turnstileOK) return res.status(403).json({ok:false,error:'Security verification failed or expired. Please try again.'});
    const type = ['contact','volunteer','donation'].includes(data.formType) ? data.formType : 'website';
    if (typeof data.email !== 'string' || !validEmail(data.email)) {
      return res.status(400).json({ok:false,error:'Please enter a valid email address.'});
    }
    if (data.phone != null && (typeof data.phone !== 'string' || !validPhone(data.phone))) {
      return res.status(400).json({ok:false,error:'Please enter a valid phone number (10–15 digits), or leave it blank.'});
    }
    const emailKey = Object.keys(data).find(k => /(^|_|-)email($|_|-)/i.test(k));
    const replyTo = emailKey && validEmail(data[emailKey]) ? data[emailKey] : undefined;
    const labels = {contact:'Contact Message', volunteer:'Volunteer Application', donation:'Donation Submission', website:'Website Submission'};

    const ignored = new Set(['formType','website','turnstileToken','cf-turnstile-response','_subject','_next','_captcha']);
    const rows = Object.entries(data).filter(([k]) => !ignored.has(k)).map(([k,v]) =>
      `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">${esc(k.replace(/[_-]+/g,' '))}</td><td style="padding:8px;border:1px solid #ddd">${esc(v)}</td></tr>`
    ).join('');
    const html = `<h2>Digital Kids Foundation — ${esc(labels[type])}</h2><p>Submitted from digitalkidsfoundation.org</p><table style="border-collapse:collapse;width:100%">${rows}</table>`;
    const text = `${labels[type]}\n\n` + Object.entries(data).filter(([k]) => !ignored.has(k)).map(([k,v]) => `${k}: ${v}`).join('\n');

    const payload = { from: `Digital Kids Foundation Website <${mailFrom}>`, to: [mailTo], subject: `[DKF Website] ${labels[type]}`, html, text };
    if (replyTo) payload.reply_to = replyTo;

    const r = await fetch('https://api.resend.com/emails', { method:'POST', headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('Resend error', r.status, body); return res.status(502).json({ok:false,error:'Unable to send your submission right now.'}); }
    return res.json({ok:true,id:body.id});
  } catch (e) {
    console.error('Submit error', e);
    return res.status(500).json({ok:false,error:'Unable to send your submission right now.'});
  }
});

app.get('/donation-success', (req,res) => res.sendFile(path.join(__dirname, 'public', 'donation-success', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`DKF listening on ${PORT}`));
