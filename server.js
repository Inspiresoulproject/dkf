const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./verification-store');
const app = express();
const PORT = process.env.PORT || 3000;

// Set TRUST_PROXY_HOPS only after confirming Coolify's actual proxy chain.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'X-Frame-Options':'DENY',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy':'same-origin-allow-popups',
    'Content-Security-Policy':"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://www.paypal.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.paypalobjects.com https://www.paypal.com; frame-src https://challenges.cloudflare.com https://www.paypal.com https://www.sandbox.paypal.com; connect-src 'self' https://challenges.cloudflare.com https://www.paypal.com https://www.paypalobjects.com"
  });
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.set('Strict-Transport-Security','max-age=31536000');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const hits = new Map();
// Single-instance limiter. Use Cloudflare WAF or shared storage for multi-instance deployments.
const rateWindowMs = 10 * 60 * 1000;
setInterval(() => { const cutoff=Date.now()-rateWindowMs; for (const [ip,times] of hits) { const live=times.filter(t=>t>cutoff); if (live.length) hits.set(ip,live); else hits.delete(ip); } },rateWindowMs).unref();
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

const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://digitalkidsfoundation.org').replace(/\/$/, '');
const verificationEnabled = () => Boolean(process.env.VERIFICATION_ENCRYPTION_KEY && process.env.RESEND_API_KEY);

app.get('/health', (req,res) => res.json({ok:true}));
app.get('/api/verification-config', (req,res) => res.json({enabled: verificationEnabled()}));
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

function buildNotification(type, data, mailFrom, mailTo, replyTo) {
  const labels = {contact:'Contact Message', volunteer:'Verified Volunteer Application', donation:'Verified Device Donation Submission'};
  const ignored = new Set(['formType','website','turnstileToken','cf-turnstile-response','_subject','_next','_captcha','_replyto']);
  const rows = Object.entries(data).filter(([k]) => !ignored.has(k)).map(([k,v]) =>
    `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">${esc(k.replace(/[_-]+/g,' '))}</td><td style="padding:8px;border:1px solid #ddd">${esc(v)}</td></tr>`
  ).join('');
  const html = `<h2>Digital Kids Foundation — ${esc(labels[type])}</h2><p>Submitted from digitalkidsfoundation.org</p><table style="border-collapse:collapse;width:100%">${rows}</table>`;
  const text = `${labels[type]}\n\n` + Object.entries(data).filter(([k]) => !ignored.has(k)).map(([k,v]) => `${k}: ${v}`).join('\n');
  const payload = {from:`Digital Kids Foundation Website <${mailFrom}>`,to:[mailTo],subject:`[DKF Website] ${labels[type]}`,html,text};
  if (replyTo && validEmail(replyTo)) payload.reply_to = replyTo;
  return payload;
}
async function sendMail(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload), signal:AbortSignal.timeout(12000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Resend error',r.status,body); return {ok:false}; }
  return {ok:true,id:body.id};
}

function volunteerThankYou(data, mailFrom) {
  const firstName = String(data.first_name || data.firstName || data.name || '').trim().split(/\s+/)[0].slice(0, 70);
  const greeting = firstName ? `Dear ${firstName},` : 'Dear Volunteer,';
  const role = String(data.role || '').trim();
  const roles = {
    'Community Outreach': {
      title: 'Community Outreach',
      detail: 'Thank you for your interest in connecting with communities, spreading awareness of our mission, and helping us reach potential supporters and donors.'
    },
    'Grant Writing': {
      title: 'Grant Writing',
      detail: 'Thank you for offering your interest in researching funding opportunities and helping us develop compelling grant proposals to support digital access.'
    },
    'Content & Photography': {
      title: 'Content & Photography',
      detail: 'Thank you for your interest in sharing stories, creating engaging content, and helping document our mission through photography and communications.'
    },
    'Open to Any Role': {
      title: 'Open to Any Role',
      detail: 'Thank you for your flexibility and willingness to contribute wherever your skills and interests can best support our mission.'
    }
  };
  const selected = roles[role] || roles['Open to Any Role'];
  const intro = 'Thank you for offering your time and talents to Digital Kids Foundation!';
  const next = 'We have received your volunteer application. Our team will review it and reach out if there is a suitable opportunity. This message is an acknowledgment, not confirmation of a volunteer placement.';
  const closing = 'Together, we can help expand access to technology and digital learning for children in need.';
  return {
    from: `Digital Kids Foundation <${mailFrom}>`,
    to: [data.email],
    subject: `Thank you for your interest in ${selected.title} — Digital Kids Foundation`,
    text: `${greeting}\n\n${intro}\n\nArea of interest: ${selected.title}\n\n${selected.detail}\n\n${next}\n\n${closing}\n\nWith appreciation,\nDigital Kids Foundation Team\nhttps://digitalkidsfoundation.org`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#183b34;line-height:1.7"><div style="background:#153b34;color:#fff;padding:24px 28px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:24px">Digital Kids Foundation</h1></div><div style="padding:28px;border:1px solid #e2ebe7;border-radius:0 0 12px 12px"><p>${esc(greeting)}</p><h2 style="color:#b68a25">Thank you for stepping forward!</h2><p>${esc(intro)}</p><p style="background:#f0f7f5;padding:12px 16px;border-radius:8px"><strong>Your area of interest:</strong> ${esc(selected.title)}</p><p>${esc(selected.detail)}</p><p>${esc(next)}</p><p>${esc(closing)}</p><p>With appreciation,<br><strong>Digital Kids Foundation Team</strong></p><p><a href="https://digitalkidsfoundation.org" style="color:#167a6a">Visit our website</a></p></div></div>`
  };
}

app.get('/verify-email', async (req,res) => {
  res.set('Cache-Control','no-store');
  const token = typeof req.query.token === 'string' && /^[a-f0-9]{64}$/.test(req.query.token) ? req.query.token : null;
  if (!token) return res.status(400).send(verificationPage('Invalid verification link','Please check the link in your email.'));
  try {
    const pending = await store.claim(token);
    if (!pending) return res.status(410).send(verificationPage('Link unavailable','This link may have expired, already been used, or require support. Please contact our team if you already submitted an application.'));
    // Record dispatch intent before sending to avoid automatic duplicate forwarding after a crash.
    await store.markDispatching(token);
    const {type,data} = pending;
    const result = await sendMail(buildNotification(type,data,process.env.MAIL_FROM || 'website@digitalkidsfoundation.org',process.env.MAIL_TO || 'help@digitalkidsfoundation.org',data.email));
    await store.finish(token,result.ok);
    if (!result.ok) return res.status(502).send(verificationPage('Temporary email issue','We could not confirm delivery. Please contact our team if you do not hear back; do not submit repeatedly.'));
    if (type === 'volunteer') {
      try {
        const thankYou = await sendMail(volunteerThankYou(data, process.env.MAIL_FROM || 'website@digitalkidsfoundation.org'));
        if (!thankYou.ok) console.error('Volunteer thank-you email could not be delivered for verified application.');
      } catch (err) { console.error('Volunteer thank-you email error:', err); }
    }
    return res.send(verificationPage('Thank you for reaching out!','Your submission has been received by Digital Kids Foundation. Our team will review it and contact you if further information is needed.'));
  } catch(e) { console.error('Email verification failed:',e); return res.status(500).send(verificationPage('Verification unavailable','Please try again later or contact our team.')); }
});
function verificationPage(title,message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)} | DKF</title><style>body{font-family:system-ui,sans-serif;background:#f0f7f5;color:#1c3632;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{background:white;border-radius:20px;padding:40px;max-width:560px;box-shadow:0 10px 40px #163d3020;text-align:center}a{color:#177a70}</style></head><body><main class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">Return to DKF website</a></p></main></body></html>`;
}

app.post('/api/submit', rateLimit, async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.MAIL_FROM || 'website@digitalkidsfoundation.org';
    const mailTo = process.env.MAIL_TO || 'help@digitalkidsfoundation.org';
    if (!apiKey) return res.status(500).json({ok:false,error:'Email service is not configured.'});

    const data = req.body || {};
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 40 || Object.entries(data).some(([k,v]) => k.length > 80 || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') || String(v).length > 4000)) return res.status(400).json({ok:false,error:'Invalid or oversized submission.'});
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
    if (type === 'website') return res.status(400).json({ok:false,error:'Unknown form type.'});
    const labels = {contact:'Contact Message', volunteer:'Volunteer Application', donation:'Device Donation Submission'};
    if (type !== 'contact') {
      if (!verificationEnabled()) return res.status(503).json({ok:false,error:'Email verification is temporarily unavailable. Please try again later.'});
      const token = crypto.randomBytes(32).toString('hex');
      await store.save(token, {type, data});
      const link = `${BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
      const result = await sendMail({
        from:`Digital Kids Foundation <${mailFrom}>`, to:[data.email],
        subject:'Confirm your email — Digital Kids Foundation',
        text:`Please confirm your email address to complete your ${labels[type].toLowerCase()}.\n\n${link}\n\nThis link expires in 30 minutes. If you did not submit a form, ignore this email.`,
        html:`<h2>Confirm your email address</h2><p>To complete your ${esc(labels[type].toLowerCase())}, please verify your email address:</p><p><a href="${esc(link)}">Verify my email</a></p><p>This link expires in 30 minutes. If you did not submit a form, ignore this email.</p>`
      });
      if (!result.ok) { await store.discard(token); return res.status(502).json({ok:false,error:'Could not send verification email. Please try again later.'}); }
      return res.json({ok:true,verificationRequired:true});
    }
    const result = await sendMail(buildNotification(type, data, mailFrom, mailTo, replyTo));
    if (!result.ok) return res.status(502).json({ok:false,error:'Unable to send your submission right now.'});
    return res.json({ok:true,id:result.id});
  } catch (e) {
    console.error('Submit error', e);
    return res.status(500).json({ok:false,error:'Unable to send your submission right now.'});
  }
});

// SEO cleanup: redirect only genuine replacements, not unrelated pages.
// Legacy WordPress homepage: consolidate its search signals with the current homepage.
app.get(['/home', '/home/'], (req, res) => res.redirect(301, 'https://digitalkidsfoundation.org/'));

app.get(['/about-us', '/about-us/'], (req, res) => res.redirect(301, '/#about'));
app.get(['/faq', '/faq/'], (req, res) => res.redirect(301, '/#faq'));

// Retired URLs from the previous website with no matching current content.
const retiredPaths = [
  '/tag/landing', '/category/volunteer',
  '/turning-your-emergency-donation-into-instant-aid',
  '/category/health',
  '/it-service-case-studies-accelerate-business-fly-success-tech',
  '/tag/t-shirt', '/category/donation', '/category/charity',
  '/donations/sed-diam-nonum', '/category/education',
  '/best-less-published-their-supplier-lists'
];
const retired = new Set(retiredPaths);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const normalized = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  if (!retired.has(normalized)) return next();
  res.set('Cache-Control', 'public, max-age=3600');
  return res.status(410).type('text/plain').send('This page has been permanently removed.');
});

app.get(['/donation-success', '/donation-success/'], (req,res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', 'donation-success', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
// Do not return a homepage (200) for arbitrary nonexistent paths.
app.use((req, res) => res.status(404).type('text/plain').send('Page not found.'));
app.listen(PORT, '0.0.0.0', () => console.log(`DKF listening on ${PORT}`));
