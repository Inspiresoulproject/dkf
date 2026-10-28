'use strict';
const express=require('express'), crypto=require('crypto'), {Pool}=require('pg');
const router=express.Router();
const pool=new Pool({connectionString:process.env.DATABASE_URL, max:5, connectionTimeoutMillis:5000});
const base=(process.env.PUBLIC_BASE_URL||'https://digitalkidsfoundation.org').replace(/\/$/,'');
const emailOK=e=>typeof e==='string'&&e.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
const statuses=['submitted','under_review','more_information_needed','waitlisted','approved','declined','ready_for_allocation','fulfilled'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emailShell = (heading, content) => `<div style="background:#f0f7f5;padding:30px 12px;font-family:Arial,sans-serif;color:#183b34"><div style="max-width:600px;margin:0 auto"><div style="background:#153b34;color:#fff;padding:25px 28px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:24px;color:#fff">Digital Kids Foundation</h1><p style="margin:6px 0 0;color:#e2eee8;font-size:14px">Laptop Assistance Program</p></div><div style="background:#fff;padding:28px;border:1px solid #e2ebe7;border-radius:0 0 12px 12px;line-height:1.7"><h2 style="color:#b68a25;margin-top:0">${heading}</h2>${content}<p style="margin-top:28px">With appreciation,<br><strong>Digital Kids Foundation Team</strong></p><p><a href="https://digitalkidsfoundation.org" style="color:#167a6a">Visit our website</a></p></div></div></div>`;
const mail=async(to,subject,text,html)=>{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:`Digital Kids Foundation <${process.env.MAIL_FROM}>`,to:[to],subject,text,...(html?{html}:{})}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Email delivery failed');};
const verifyEmailHtml = (p,link) => emailShell('Confirm your email address',`<p>Hello ${escapeHtml(p.applicant_name)},</p><p>Thank you for applying to the Digital Kids Foundation Laptop Assistance Program. To complete your request, please confirm your email address.</p><p style="text-align:center;margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#b68a25;color:#153b34;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px">Verify my email</a></p><p style="font-size:14px">This verification link expires in <strong>30 minutes</strong>.</p><p style="background:#f0f7f5;padding:14px 16px;border-radius:8px"><strong>Important:</strong> Submitting an application does not guarantee a laptop. Once your email is verified, our team aims to respond within 10 business days.</p><p style="font-size:13px;color:#52645d">If you did not submit this request, you may ignore this email.</p>`);
const receiptHtml = (p,reference) => emailShell('Application received',`<p>Dear ${escapeHtml(p.applicant_name)},</p><p>Thank you for applying to the Digital Kids Foundation Laptop Assistance Program. Your email has been verified and we have received your application.</p><p style="background:#f0f7f5;padding:14px 16px;border-radius:8px"><strong>Application reference:</strong> ${escapeHtml(reference)}</p><p><strong>What happens next?</strong> Our team will review your request and aims to contact you within <strong>10 business days</strong>. We will contact you directly if we need additional information.</p><p><strong>Please note:</strong> Receiving an application does not guarantee a laptop. Assistance depends on eligibility, donated equipment and available program resources.</p><p>You do not need to check your application status.</p>`);
const verifiedPage = (title, content) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} | Digital Kids Foundation</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f0f7f5;font-family:Arial,sans-serif;color:#183b34;padding:20px;box-sizing:border-box}.card{background:white;max-width:620px;border-radius:16px;overflow:hidden;box-shadow:0 12px 35px #163d3020}.head{background:#153b34;color:#fff;padding:28px}.head h1{margin:0;font-size:24px}.body{padding:32px;line-height:1.7}.body h2{color:#b68a25;margin-top:0}.ref{background:#f0f7f5;border-radius:8px;padding:12px 16px}a{color:#167a6a}</style></head><body><main class="card"><div class="head"><h1>Digital Kids Foundation</h1><div>Laptop Assistance Program</div></div><div class="body"><h2>${escapeHtml(title)}</h2>${content}<p><a href="/">Return to DKF website</a></p></div></main></body></html>`;
// Applicant-facing acknowledgments and internal notifications are sent only after verification.
const applicantReceipt = (p, reference) => `Dear ${p.applicant_name},\n\nThank you for applying to the Digital Kids Foundation Laptop Assistance Program.\n\nWe have received your verified application (reference: ${reference}). Receiving your application does not guarantee that a laptop will be provided. Equipment availability depends on donated devices, eligibility, and program resources.\n\nOur team will review your application and aims to get back to you within 10 business days. You do not need to check your application status; we will contact you directly by email if we need additional information or have an update.\n\nSincerely,\nDigital Kids Foundation Team`;
const staffReceipt = (p, reference) => {
  const labels = {reference:'Reference',kind:'Applicant type',applicant_name:'Applicant name',email:'Email',phone:'Phone',country:'Country',location:'Location',organization:'School / organization',child_age:'Child age',grade:'Grade',quantity:'Laptops requested',computer_access:'Current computer access',internet_access:'Internet access',need:'Challenges / need',impact:'How laptops support learning',financial_difficulty:'Financial difficulty',consent:'Consent'};
  const fields = {...p, reference};
  return 'New verified DKF Laptop Assistance application\n\n' + Object.entries(labels).map(([key,label])=>`${label}: ${fields[key] == null || fields[key] === '' ? 'Not provided' : String(fields[key])}`).join('\n') + '\n\nReview the application in the secured DKF management system.';
};
const statusEmail = (p,status) => {
  const templates = {
    submitted: {
      subject:'We have received your laptop assistance request',
      heading:'Your request has been received',
      paragraphs:[
        'Thank you for your interest in the Digital Kids Foundation Laptop Assistance Program. Your request has been received and is in our review queue.',
        'Our team aims to respond within 10 business days. No further action is needed unless we contact you for additional information.'
      ],closing:'Thank you for giving us the opportunity to review your request.'
    },
    under_review: {
      subject:'We are reviewing your laptop assistance request',
      heading:'Your request is under review',
      paragraphs:[
        'We wanted to let you know that our team has started reviewing your laptop assistance request.',
        'We are carefully considering the information you provided. You do not need to take any action at this stage. We will contact you directly when there is an update.'
      ],closing:'Thank you for your patience while we complete our review.'
    },
    more_information_needed: {
      subject:'Action needed: More information about your laptop request',
      heading:'We need a little more information',
      paragraphs:[
        'Thank you for submitting your laptop assistance request. To continue our review, we need some additional information.',
        'Please contact our team at help@digitalkidsfoundation.org and include your reference number. We will explain what information is needed. Please do not email sensitive documents unless our team provides a secure way to share them.'
      ],closing:'We look forward to hearing from you so we can continue the review.'
    },
    waitlisted: {
      subject:'Update: Your laptop assistance request is on our waiting list',
      heading:'Your request is on our waiting list',
      paragraphs:[
        'We have reviewed your laptop assistance request. At this time, we are unable to move forward because available equipment and program resources are limited.',
        'Your request has been placed on our waiting list. This is not a guarantee that a laptop will become available. If we are able to move forward, our team will contact you directly.'
      ],closing:'We appreciate your understanding and continued interest in our program.'
    },
    approved: {
      subject:'Your laptop assistance request passed initial review',
      heading:'Your request passed initial review',
      paragraphs:[
        'We are pleased to let you know that your laptop assistance request has passed our initial review.',
        'This is an approval to proceed to the next stage, not a confirmation of a laptop award. Equipment availability and any final eligibility checks still apply. Our team will contact you if a laptop can be allocated and to discuss next steps.'
      ],closing:'Thank you for your patience as we work through the next stage.'
    },
    declined: {
      subject:'Decision on your laptop assistance request',
      heading:'A decision about your request',
      paragraphs:[
        'Thank you for taking the time to apply to the Digital Kids Foundation Laptop Assistance Program.',
        'After reviewing your request, we regret that we are unable to offer laptop assistance at this time. We know this may be disappointing, and we appreciate the opportunity to consider your needs.'
      ],closing:'We wish you and your family or organization all the best.'
    },
    ready_for_allocation: {
      subject:'Next steps for your laptop assistance request',
      heading:'Your request is moving to equipment allocation',
      paragraphs:[
        'Your laptop assistance request has progressed to the equipment allocation stage.',
        'Our team is checking device availability and any remaining arrangements. Please wait for us to contact you before making pickup or delivery plans. This update does not confirm a distribution date.'
      ],closing:'We look forward to sharing the next steps when arrangements are confirmed.'
    },
    fulfilled: {
      subject:'Your laptop assistance request is complete',
      heading:'Your laptop assistance request is complete',
      paragraphs:[
        'Our records show that the laptop assistance associated with your request has been completed.',
        'We hope the equipment supports learning and access to digital opportunities. If you believe this message was sent in error, please contact help@digitalkidsfoundation.org and include your reference number.'
      ],closing:'Thank you for being part of the Digital Kids Foundation community.'
    }
  };
  const t=templates[status];
  if(!t)throw Error('Unsupported application status');
  const greeting=`Dear ${p.applicant_name},`;
  const footer='Kind regards,\nDigital Kids Foundation Team';
  const body=[greeting,...t.paragraphs,`Application reference: ${p.reference}`,t.closing,footer].join('\n\n');
  const html=emailShell(t.heading,`<p>${escapeHtml(greeting)}</p>${t.paragraphs.map(v=>`<p>${escapeHtml(v)}</p>`).join('')}<p style="background:#f0f7f5;padding:14px 16px;border-radius:8px"><strong>Application reference:</strong> ${escapeHtml(p.reference)}</p><p>${escapeHtml(t.closing)}</p>`);
  return {subject:t.subject,body,html};
};
const schema=`CREATE TABLE IF NOT EXISTS laptop_applications (id BIGSERIAL PRIMARY KEY,reference TEXT UNIQUE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('individual','school','organization')),applicant_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,country TEXT NOT NULL CHECK(country IN ('US','GH')),location TEXT NOT NULL,organization TEXT,child_age INTEGER,grade TEXT,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),computer_access TEXT NOT NULL, internet_access TEXT,need TEXT NOT NULL,impact TEXT NOT NULL,financial_difficulty TEXT,consent BOOLEAN NOT NULL DEFAULT FALSE,status TEXT NOT NULL DEFAULT 'submitted',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS laptop_tokens(id BIGSERIAL PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,payload JSONB,application_id BIGINT REFERENCES laptop_applications(id),expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS laptop_history(id BIGSERIAL PRIMARY KEY,application_id BIGINT NOT NULL REFERENCES laptop_applications(id),status TEXT NOT NULL,notes TEXT,actor TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS laptop_inventory(id BIGSERIAL PRIMARY KEY,asset_tag TEXT UNIQUE NOT NULL,brand TEXT,model TEXT,condition TEXT NOT NULL DEFAULT 'pending_refurbishment',notes TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS laptop_allocations(id BIGSERIAL PRIMARY KEY,application_id BIGINT NOT NULL REFERENCES laptop_applications(id),inventory_id BIGINT NOT NULL UNIQUE REFERENCES laptop_inventory(id),status TEXT NOT NULL DEFAULT 'reserved',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),fulfilled_at TIMESTAMPTZ);`;
async function init(){await pool.query(schema);console.log('Laptop assistance schema ready');}
const ready=Boolean(process.env.DATABASE_URL&&process.env.RESEND_API_KEY&&process.env.MAIL_FROM&&process.env.TURNSTILE_SECRET_KEY);
router.get('/api/laptops/config',(_,res)=>res.json({enabled:ready,siteKey:process.env.TURNSTILE_SITE_KEY||null}));
async function turnstile(token,ip){if(!token)return false;const p=new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:token});if(ip)p.set('remoteip',ip);const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:p,signal:AbortSignal.timeout(8000)});const j=await r.json();return j.success===true&&j.hostname==='digitalkidsfoundation.org';}
const limiter=new Map();function limited(req,res,next){const ip=req.ip,now=Date.now(),a=(limiter.get(ip)||[]).filter(t=>now-t<3600000);if(a.length>=8)return res.status(429).json({error:'Too many requests'});a.push(now);limiter.set(ip,a);next();}setInterval(()=>{const n=Date.now();for(const [k,a] of limiter){const b=a.filter(t=>n-t<3600000);if(b.length)limiter.set(k,b);else limiter.delete(k)}},3600000).unref();
router.post('/api/laptops/apply',limited,async(req,res)=>{try{if(!ready)return res.status(503).json({error:'Applications are not yet available'});const x=req.body||{};if(x.website)return res.json({ok:true});if(!['individual','school','organization'].includes(x.kind)||!emailOK(x.email)||!['US','GH'].includes(x.country)||!x.consent)return res.status(400).json({error:'Please complete the required fields'});for(const k of ['applicant_name','location','need','impact','computer_access'])if(typeof x[k]!=='string'||!x[k].trim()||x[k].length>1500)return res.status(400).json({error:`Invalid ${k}`});if(typeof x.phone!=='string'||!/^\+?[0-9() .-]{7,30}$/.test(x.phone.trim())||x.phone.replace(/\D/g,'').length<7||x.phone.replace(/\D/g,'').length>15)return res.status(400).json({error:'Please enter a valid phone number'});if(x.applicant_name.length>150||x.location.length>200||x.computer_access.length>100)return res.status(400).json({error:'Field too long'});const q=Number(x.quantity);if(!Number.isInteger(q)||q<1||q>1000||(x.kind==='individual'&&q!==1))return res.status(400).json({error:'Invalid laptop quantity'});if(x.kind!=='individual'&&(!x.organization||String(x.organization).length>200))return res.status(400).json({error:'Organization or school name required'});if(x.kind==='individual'&&(!Number.isInteger(Number(x.child_age))||Number(x.child_age)<3||Number(x.child_age)>25))return res.status(400).json({error:'Enter the child age'});if(!await turnstile(x.turnstileToken,req.ip))return res.status(403).json({error:'Security verification failed'});const payload={kind:x.kind,applicant_name:x.applicant_name.trim(),email:x.email.trim().toLowerCase(),phone:String(x.phone||'').slice(0,30),country:x.country,location:x.location.trim(),organization:String(x.organization||'').slice(0,200),child_age:x.kind==='individual'?Number(x.child_age):null,grade:String(x.grade||'').slice(0,80),quantity:q,computer_access:x.computer_access,internet_access:String(x.internet_access||'').slice(0,80),need:x.need,impact:x.impact,financial_difficulty:String(x.financial_difficulty||'').slice(0,80),consent:true};const token=crypto.randomBytes(32).toString('hex');await pool.query('INSERT INTO laptop_tokens(token_hash,kind,payload,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'30 minutes\')',[hash(token),'apply',payload]);try{await mail(payload.email,'Confirm your email — Digital Kids Foundation',`Hello ${payload.applicant_name},\n\nPlease confirm your email address to complete your laptop assistance application:\n\n${base}/laptop-verify?token=${token}\n\nThis link expires in 30 minutes. Submitting a request does not guarantee a laptop. We aim to respond within 10 business days after verification.`,verifyEmailHtml(payload,`${base}/laptop-verify?token=${token}`));}catch(e){await pool.query('DELETE FROM laptop_tokens WHERE token_hash=$1',[hash(token)]);throw e;}res.json({ok:true,message:'Check your email for a verification link.'});}catch(e){console.error('Laptop application error:',e.message);res.status(500).json({error:'Unable to process request right now'})}});
router.get('/laptop-verify',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const token=String(req.query.token||'');
  if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).send('Invalid verification link');
  const client=await pool.connect();
  let applicant,reference;
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM laptop_tokens WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',[hash(token),'apply']);
    if(!r.rows.length){await client.query('ROLLBACK');return res.status(410).send('Verification link expired or already used');}
    applicant=r.rows[0].payload;
    reference='DKF-LAP-'+crypto.randomBytes(5).toString('hex').toUpperCase();
    const fields=['reference','kind','applicant_name','email','phone','country','location','organization','child_age','grade','quantity','computer_access','internet_access','need','impact','financial_difficulty','consent'];
    const values=fields.map(f=>f==='reference'?reference:(applicant[f]??null));
    const a=await client.query(`INSERT INTO laptop_applications(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,values);
    await client.query('INSERT INTO laptop_history(application_id,status,actor) VALUES($1,$2,$3)',[a.rows[0].id,'submitted','system']);
    await client.query('UPDATE laptop_tokens SET used_at=NOW(),payload=NULL,application_id=$2 WHERE id=$1',[r.rows[0].id,a.rows[0].id]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');console.error('Laptop verify:',e.message);return res.status(500).send('Unable to verify now');}
  finally{client.release();}
  // Each notification is independent: one failed email must not prevent the other.
  try{await mail(applicant.email,'We received your DKF laptop assistance application',applicantReceipt(applicant,reference),receiptHtml(applicant,reference));}
  catch(e){console.error('Laptop applicant confirmation email failed:',e.message);}
  const notifyTo=process.env.LAPTOP_NOTIFY_EMAIL||process.env.MAIL_TO;
  if(notifyTo && emailOK(notifyTo)){
    try{await mail(notifyTo,`[DKF] New verified laptop application — ${reference}`,staffReceipt(applicant,reference));}
    catch(e){console.error('Laptop staff notification email failed:',e.message);}
  }else{console.error('Laptop staff notification not sent: configure LAPTOP_NOTIFY_EMAIL or MAIL_TO');}
  res.type('html').send(verifiedPage('Email verified — application received',`<p>Thank you for applying to Digital Kids Foundation.</p><p class="ref"><strong>Reference:</strong> ${escapeHtml(reference)}</p><p>We have received your application. Our team aims to contact you within <strong>10 business days</strong>.</p><p>Receiving an application does not guarantee a laptop. We will contact you directly if we need more information or have an update.</p>`));
});
router.post('/api/laptops/status-request',limited,async(req,res)=>{try{const email=String(req.body.email||'').toLowerCase().trim(),ref=String(req.body.reference||'').trim().toUpperCase();if(!emailOK(email)||!/^DKF-LAP-[A-F0-9]{10}$/.test(ref))return res.status(400).json({error:'Invalid details'});const a=await pool.query('SELECT id FROM laptop_applications WHERE reference=$1 AND email=$2',[ref,email]);if(a.rows.length){const t=crypto.randomBytes(32).toString('hex');await pool.query('INSERT INTO laptop_tokens(token_hash,kind,application_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'15 minutes\')',[hash(t),'status',a.rows[0].id]);await mail(email,'DKF application status link',`View your application status: ${base}/laptop-status-verify?token=${t}\nLink expires in 15 minutes.`)}res.json({ok:true,message:'If the details match an application, a status link will be emailed.'});}catch(e){console.error('Status request:',e.message);res.status(500).json({error:'Please try again later'})}});
router.get('/laptop-status-verify',async(req,res)=>{res.set('Cache-Control','no-store');const t=String(req.query.token||'');if(!/^[a-f0-9]{64}$/.test(t))return res.status(400).send('Invalid link');const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query(`UPDATE laptop_tokens SET used_at=NOW() WHERE token_hash=$1 AND kind='status' AND used_at IS NULL AND expires_at>NOW() RETURNING application_id`,[hash(t)]);if(!r.rows.length){await c.query('ROLLBACK');return res.status(410).send('Expired or used link')}const a=await c.query('SELECT reference,status,created_at FROM laptop_applications WHERE id=$1',[r.rows[0].application_id]);await c.query('COMMIT');res.type('html').send(`<html><meta name="robots" content="noindex"><body style="font:18px system-ui;max-width:650px;margin:60px auto"><h1>Application status</h1><p>Reference: ${a.rows[0].reference}</p><p>Status: <strong>${a.rows[0].status.replaceAll('_',' ')}</strong></p><p>Submitted: ${new Date(a.rows[0].created_at).toISOString().slice(0,10)}</p></body></html>`)}catch(e){await c.query('ROLLBACK');res.status(500).send('Unavailable')}finally{c.release()}});
const {verifyAdmin:admin}=require('./dkf-access-auth');
router.get('/api/laptops/admin/me',admin,(req,res)=>res.json({email:req.dkfAdminEmail}));
router.get('/api/laptops/admin/applications',admin,async(req,res)=>{try{const r=await pool.query('SELECT * FROM laptop_applications ORDER BY created_at DESC LIMIT 300');res.json(r.rows)}catch(e){res.status(500).json({error:'Database error'})}});
router.patch('/api/laptops/admin/applications/:id',admin,async(req,res)=>{
 const status=String(req.body.status||''),notes=String(req.body.notes||'').slice(0,2000);
 if(!statuses.includes(status))return res.status(400).json({error:'Invalid status'});
 const c=await pool.connect();let applicant,changed=false;
 try{
   await c.query('BEGIN');
   const old=await c.query('SELECT id,email,reference,applicant_name,status FROM laptop_applications WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!old.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Not found'});}
   applicant=old.rows[0];changed=applicant.status!==status;
   if(changed)await c.query('UPDATE laptop_applications SET status=$1,updated_at=NOW() WHERE id=$2',[status,req.params.id]);
   await c.query('INSERT INTO laptop_history(application_id,status,notes,actor) VALUES($1,$2,$3,$4)',[req.params.id,status,notes,req.dkfAdminEmail]);
   await c.query('COMMIT');
   let emailSent=false;
   if(changed){try{const m=statusEmail(applicant,status);await mail(applicant.email,m.subject,m.body,m.html);emailSent=true;}catch(e){console.error('Status email delivery failed:',e.message);}}
   res.json({ok:true,statusChanged:changed,emailSent});
 }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Application review:',e.message);res.status(500).json({error:'Database error'});}finally{c.release();}
});
router.get('/api/laptops/admin/inventory',admin,async(req,res)=>{try{res.json((await pool.query('SELECT * FROM laptop_inventory ORDER BY id DESC')).rows)}catch(e){res.status(500).json({error:'Database error'})}});
router.post('/api/laptops/admin/inventory',admin,async(req,res)=>{try{const {asset_tag,brand,model,condition,notes}=req.body;if(!asset_tag||String(asset_tag).length>100||!['pending_refurbishment','ready','retired'].includes(condition))return res.status(400).json({error:'Invalid inventory'});const r=await pool.query('INSERT INTO laptop_inventory(asset_tag,brand,model,condition,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[asset_tag,String(brand||'').slice(0,100),String(model||'').slice(0,100),condition,String(notes||'').slice(0,1000)]);res.json(r.rows[0])}catch(e){res.status(409).json({error:'Unable to add inventory'})}});
router.post('/api/laptops/admin/allocate',admin,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const a=await c.query('SELECT * FROM laptop_applications WHERE id=$1 FOR UPDATE',[req.body.application_id]);const item=await c.query('SELECT * FROM laptop_inventory WHERE id=$1 FOR UPDATE',[req.body.inventory_id]);if(!a.rows.length||!item.rows.length||!['approved','ready_for_allocation'].includes(a.rows[0].status)||item.rows[0].condition!=='ready')throw Error('Application or device not eligible');const count=await c.query('SELECT COUNT(*)::int AS n FROM laptop_allocations WHERE application_id=$1',[req.body.application_id]);if(count.rows[0].n>=a.rows[0].quantity)throw Error('Requested quantity already allocated');await c.query('INSERT INTO laptop_allocations(application_id,inventory_id) VALUES($1,$2)',[req.body.application_id,req.body.inventory_id]);await c.query('COMMIT');res.json({ok:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:'Cannot allocate this device (check availability and approval)'})}finally{c.release()}});
router.get('/api/laptops/admin/allocations',admin,async(req,res)=>{try{res.json((await pool.query('SELECT a.*,i.asset_tag,p.reference FROM laptop_allocations a JOIN laptop_inventory i ON i.id=a.inventory_id JOIN laptop_applications p ON p.id=a.application_id ORDER BY a.id DESC')).rows)}catch(e){res.status(500).json({error:'Database error'})}});
router.patch('/api/laptops/admin/allocations/:id',admin,async(req,res)=>{if(req.body.status!=='fulfilled')return res.status(400).json({error:'Invalid status'});const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query("UPDATE laptop_allocations SET status='fulfilled',fulfilled_at=NOW() WHERE id=$1 AND status='reserved' RETURNING application_id",[req.params.id]);if(!r.rows.length)throw Error('Not found');const counts=await c.query("SELECT COUNT(*) FILTER (WHERE status='fulfilled')::int done,COUNT(*)::int total FROM laptop_allocations WHERE application_id=$1",[r.rows[0].application_id]);const app=await c.query('SELECT quantity FROM laptop_applications WHERE id=$1',[r.rows[0].application_id]);if(counts.rows[0].done>=app.rows[0].quantity){await c.query("UPDATE laptop_applications SET status='fulfilled',updated_at=NOW() WHERE id=$1",[r.rows[0].application_id]);await c.query('INSERT INTO laptop_history(application_id,status,actor) VALUES($1,$2,$3)',[r.rows[0].application_id,'fulfilled',req.dkfAdminEmail])}await c.query('COMMIT');res.json({ok:true})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:'Cannot fulfill allocation'})}finally{c.release()}});
module.exports={router,init,ready};
