'use strict';
/** DKF donor-receipts add-on for the existing Express/PostgreSQL laptop system.
 * Mount alongside laptop-system.router in server.js with app.use(require('./donor-receipts').router).
 * npm install pdfkit (plus the app's existing express and pg dependencies).
 * This module uses the same verifyAdmin session middleware as laptop-system(2).js.
 */
const express = require('express');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { verifyAdmin } = require('./dkf-access-auth');
const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
const logo = path.join(__dirname, 'assets', 'dkf-logo.png');
const verificationOrigin = 'https://digitalkidsfoundation.org';
const verifyUrl = row => `${verificationOrigin}/verify-donation/${encodeURIComponent(row.reference)}?code=${encodeURIComponent(row.verification_code)}`;
// One stable 32+-byte secret, set ONLY in Coolify. Never put this key in git or on the client.
function signingKey() {
  const hex = String(process.env.DKF_RECEIPT_SIGNING_KEY || '');
  return /^[a-f0-9]{64,}$/i.test(hex) && hex.length % 2 === 0 ? Buffer.from(hex,'hex') : null;
}
function canonicalReceipt(r) {
  // Stable serialization allows us to detect edits to issued donation details.
  const date=r.donation_date instanceof Date ? r.donation_date.toISOString().slice(0,10) : String(r.donation_date).slice(0,10);
  const money=x=>x==null ? null : Number(x).toFixed(2);
  const formatVersion = Number(r.document_format_version)===2 ? 'DKF-RECEIPT-V2' : 'DKF-RECEIPT-V1';
  return JSON.stringify([
    formatVersion,r.reference,r.verification_code,r.donor_name,r.donor_email,
    r.document_type,r.donation_type,date,r.quantity==null?null:Number(r.quantity),
    r.description,money(r.monetary_amount),r.consideration_type,
    r.consideration_description||null,money(r.consideration_value)
  ]);
}
function sealReceipt(r,key=signingKey()) {
  if(!key)throw Error('Receipt signing key missing or invalid. Set DKF_RECEIPT_SIGNING_KEY in Coolify.');
  return crypto.createHmac('sha256',key).update(canonicalReceipt(r),'utf8').digest('hex');
}
function sealedRowValid(r) {
  const key=signingKey();
  if(!key || !r.verification_seal || !r.issued_pdf_sha256 || !r.issued_pdf || !r.verification_code)return false;
  const sig=Buffer.from(String(r.verification_seal),'hex');
  if(sig.length!==32)return false;
  const expected=Buffer.from(sealReceipt(r,key),'hex');
  const currentPdf=crypto.createHash('sha256').update(r.issued_pdf).digest('hex');
  return crypto.timingSafeEqual(sig,expected) && currentPdf===r.issued_pdf_sha256;
}

const allowedTypes = new Set(['laptop', 'desktop', 'tablet', 'accessories', 'other_equipment', 'monetary', 'other']);
const display = { laptop:'Laptop', desktop:'Desktop computer', tablet:'Tablet', accessories:'Computer accessories', other_equipment:'Other computer equipment', monetary:'Monetary contribution', other:'Other donated property' };
const emailOK = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const safe = (x,max=250) => String(x ?? '').trim().slice(0,max);
const htmlEscape = value => safe(value, 2000).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const currency = value => Number(value).toLocaleString('en-US',{style:'currency',currency:'USD'});
const dateFormat = date => { const iso = date instanceof Date ? date.toISOString().slice(0,10) : String(date).slice(0,10); return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}); };

const schema = `CREATE TABLE IF NOT EXISTS dkf_donor_receipts (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT UNIQUE,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'receipt',
  donation_type TEXT NOT NULL,
  donation_date DATE NOT NULL,
  quantity INTEGER,
  description TEXT NOT NULL,
  monetary_amount NUMERIC(12,2),
  consideration_type TEXT NOT NULL DEFAULT 'none',
  consideration_description TEXT,
  consideration_value NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  resend_email_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  issued_pdf BYTEA,
  last_previewed_at TIMESTAMPTZ,
  verification_code TEXT UNIQUE,
  verification_seal TEXT,
  issued_pdf_sha256 TEXT,
  document_format_version SMALLINT NOT NULL DEFAULT 1,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoked_reason TEXT,
  CONSTRAINT dkf_receipt_status CHECK(status IN ('draft','sending','sent','needs_review'))
);
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS issued_pdf BYTEA;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS last_previewed_at TIMESTAMPTZ;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS verification_code TEXT;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS verification_seal TEXT;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS issued_pdf_sha256 TEXT;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS document_format_version SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS revoked_by TEXT;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS dkf_receipts_verify_code_uq ON dkf_donor_receipts(verification_code) WHERE verification_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS dkf_receipt_audit (
  id BIGSERIAL PRIMARY KEY, receipt_id BIGINT NOT NULL REFERENCES dkf_donor_receipts(id),
  event TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dkf_receipt_audit_idx ON dkf_receipt_audit(receipt_id,created_at DESC);
CREATE INDEX IF NOT EXISTS dkf_receipts_created_idx ON dkf_donor_receipts(created_at DESC);`;
let schemaPromise;
function ensureSchema(){ if(!schemaPromise) schemaPromise=pool.query(schema).catch(e=>{schemaPromise=null;throw e;}); return schemaPromise; }

function validate(data) {
  const x = data || {}, errors = [];
  const donor_name=safe(x.donor_name,150), donor_email=safe(x.donor_email,254).toLowerCase();
  const document_type=safe(x.document_type,30)||'receipt', donation_type=safe(x.donation_type,40);
  const donation_date=safe(x.donation_date,10), description=safe(x.description,1000);
  const consideration_type=safe(x.consideration_type,20)||'none';
  const consideration_description=safe(x.consideration_description,500);
  const quantity=x.quantity === '' || x.quantity == null ? null : Number(x.quantity);
  const monetary_amount=x.monetary_amount === '' || x.monetary_amount == null ? null : Number(x.monetary_amount);
  const consideration_value=x.consideration_value === '' || x.consideration_value == null ? null : Number(x.consideration_value);
  if(!donor_name) errors.push('Donor name is required');
  if(!emailOK(donor_email)) errors.push('Valid donor email is required');
  if(!['receipt','acknowledgment_letter'].includes(document_type)) errors.push('Invalid document type');
  if(!allowedTypes.has(donation_type)) errors.push('Invalid donation type');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(donation_date) || Number.isNaN(Date.parse(donation_date)) || new Date(donation_date).toISOString().slice(0,10)!==donation_date) errors.push('Enter a valid donation date');
  if(!description) errors.push('Description is required');
  if(donation_type === 'monetary') {
    if(monetary_amount == null || !Number.isFinite(monetary_amount) || monetary_amount<=0 || monetary_amount>100000000) errors.push('Valid USD amount required');
  } else {
    if(!Number.isInteger(quantity) || quantity<=0 || quantity>100000) errors.push('Quantity must be a positive whole number');
    if(monetary_amount != null) errors.push('Do not value in-kind contributions on the receipt');
    // Avoid the exact 1-versus-23 sample inconsistency reaching an issued receipt.
    const countMatch=description.match(/\b(\d{1,6})\s+(?:laptops?|desktops?|tablets?|computers?)\b/i);
    if(countMatch && Number(countMatch[1]) !== quantity) errors.push(`Description mentions ${countMatch[1]} devices but quantity is ${quantity}`);
  }
  if(!['none','provided'].includes(consideration_type)) errors.push('Select whether goods or services were provided in return');
  if(consideration_type==='provided' && (!consideration_description || consideration_value == null || !Number.isFinite(consideration_value) || consideration_value<0)) errors.push('Describe goods/services provided in exchange and enter their good-faith estimated USD value');
  if(errors.length) {const e = new Error(errors.join('; ')); e.status=400; throw e;}
  return { donor_name,donor_email,document_type,donation_type,donation_date,quantity:donation_type==='monetary'?null:quantity,description,
    monetary_amount:donation_type==='monetary'?monetary_amount:null,consideration_type,
    consideration_description:consideration_type==='provided'?consideration_description:null,
    consideration_value:consideration_type==='provided'?consideration_value:null };
}

// A visible document seal ID is derived from the server-held HMAC, never from a
// user-supplied number. It is a comparison aid, NOT standalone proof of validity.
// On the DKF verification page we display this same 16-character ID. The QR,
// HMAC validation, exact issued-PDF digest and revocation checks remain authoritative.
function visibleSealId(receipt,draft=false) {
  return draft ? 'NOT ISSUED' : sealReceipt(receipt).slice(0,16).toUpperCase();
}
// Decorative anti-tampering artwork is deliberately subtle and behind the text.
// Anyone can copy a watermark; authenticity must be checked online.
function securityBackdrop(doc,draft=false) {
  doc.save().opacity(0.052).strokeColor('#306E58').lineWidth(0.55);
  for(let n=0;n<11;n++)doc.ellipse(306,494,115+n*3.3,56+n*3.7).stroke();
  doc.restore();
  doc.save().opacity(draft?0.11:0.045).fillColor('#276C50')
    .font('Helvetica-Bold').fontSize(draft?95:114)
    .rotate(-27,{origin:[306,490]})
    .text(draft?'DRAFT':'DKF',150,438,{width:315,align:'center'}).restore();
}
function securityStrip(doc,receipt,draft=false,top=744) {
  const green='#103B2F', grey='#60726B';
  doc.save();
  doc.roundedRect(48,top,516,34,5).fill('#ECF4EF');
  doc.rect(48,top,4,34).fill(draft?'#B47624':'#D4A32C');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(green)
    .text('DKF DOCUMENT SEAL',60,top+5,{width:154});
  doc.font('Courier-Bold').fontSize(10).fillColor(draft?'#976729':green)
    .text(visibleSealId(receipt,draft),60,top+17,{width:180});
  doc.font('Helvetica').fontSize(8).fillColor(green)
    .text(draft?'PREVIEW ONLY - NOT A VALID DONATION RECEIPT':'SCAN THE QR CODE TO VERIFY THE ISSUED RECORD',236,top+6,{width:312,align:'right'});
  doc.font('Helvetica').fontSize(7.3).fillColor(grey)
    .text(draft?'Do not distribute or use for tax purposes.':'Match this seal ID, donation details, and PDF on the official DKF website.',236,top+20,{width:312,align:'right'});
  doc.restore();
}

async function receiptPdf(receipt, draft=false){
  const qr=receipt.verification_code && receipt.reference ? await QRCode.toBuffer(verifyUrl(receipt),{type:'png',width:240,margin:1,errorCorrectionLevel:'M'}) : null;
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'LETTER',margins:{top:48,bottom:8,left:48,right:48},autoFirstPage:true,info:{Title:`DKF ${draft?'Draft ':''}Donation Acknowledgment ${receipt.reference}`,Author:'Digital Kids Foundation Inc.'}});
    const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('error',reject); doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const green='#103B2F', gold='#D4A32C', grey='#60726B', black='#20312C', pale='#F3F7F4', border='#DEE8E1';
    const tx=(str,x,y,opts={})=>doc.text(String(str ?? ''),x,y,{lineBreak:false,...opts});
    doc.rect(0,0,612,21).fill(green);doc.rect(0,21,612,6).fill(gold);
    securityBackdrop(doc,draft);
    try{doc.image(logo,48,47,{fit:[241,83],align:'left'});}catch(e){tx('DIGITAL KIDS FOUNDATION',48,70,{fontSize:19,color:green});}
    doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text('Digital Kids Foundation Inc.',353,72,{width:210});
    doc.font('Helvetica').fontSize(9).fillColor(grey).text(process.env.DKF_MAILING_ADDRESS || 'Brooklyn, New York',353,90,{width:210,height:15,ellipsis:true});
    doc.fillColor(green).text('digitalkidsfoundation.org',353,104);
    doc.fillColor(grey).text('help@digitalkidsfoundation.org',353,118);
    if(process.env.DKF_EIN)doc.fontSize(8).fillColor(grey).text('EIN: '+process.env.DKF_EIN,353,132);
    doc.moveTo(48,139).lineTo(564,139).strokeColor(border).stroke();
    const heading=receipt.document_type==='acknowledgment_letter'?'DONATION ACKNOWLEDGMENT LETTER':'DONATION RECEIPT / ACKNOWLEDGMENT';
    doc.font('Helvetica-Bold').fontSize(16).fillColor(green).text(heading,48,155,{width:510});
    doc.font('Helvetica').fontSize(9).fillColor(grey).text(draft?'DRAFT - not valid until issued':'Official contribution acknowledgment',48,183);
    doc.roundedRect(48,206,516,101,9).fill(pale);
    const lb=(s,x,y)=>doc.font('Helvetica-Bold').fontSize(8).fillColor(grey).text(s,x,y);
    const val=(s,x,y,w=226)=>doc.font('Helvetica-Bold').fontSize(10.7).fillColor(black).text(String(s),x,y,{width:w,height:19,ellipsis:true});
    lb('RECEIPT NUMBER',62,218);val(receipt.reference,62,233);
    lb('DATE RECEIVED',330,218);val(dateFormat(receipt.donation_date),330,233);
    doc.moveTo(62,260).lineTo(549,260).strokeColor(border).stroke();
    lb('DONOR / COMPANY',62,270);val(receipt.donor_name,62,286);
    lb('DONOR EMAIL',330,270);val(receipt.donor_email,330,286);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(green).text('DONATION DETAILS',48,327);
    doc.roundedRect(48,347,516,26,5).fill(green);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
    tx('TYPE',60,356);tx(receipt.donation_type==='monetary'?'AMOUNT':'QUANTITY',219,356);tx('DESCRIPTION',332,356);
    doc.rect(48,373,516,67).fill('#F8FBF8');
    doc.font('Helvetica').fontSize(10).fillColor(black).text(display[receipt.donation_type]||'Donation',60,385,{width:143});
    doc.font('Helvetica-Bold').fontSize(10).text(receipt.donation_type==='monetary'?currency(receipt.monetary_amount):String(receipt.quantity),219,385,{width:108});
    doc.font('Helvetica').fontSize(9);
    const descOverflow=doc.heightOfString(receipt.description,{width:216}) > 47;
    doc.text(descOverflow?'See page 2 for full donation details.':receipt.description,332,385,{width:216,height:49,ellipsis:true});
    doc.font('Helvetica-Bold').fontSize(10.2).fillColor(black).text(`Dear ${receipt.donor_name},`,48,458,{width:505});
    const letterText=receipt.donation_type==='monetary'
     ? `Digital Kids Foundation Inc. gratefully acknowledges your monetary contribution of ${currency(receipt.monetary_amount)}, received on ${dateFormat(receipt.donation_date)}. Your generosity supports access to technology and digital learning opportunities for underserved children.`
     : `Digital Kids Foundation Inc. gratefully acknowledges receipt of the donated property described above on ${dateFormat(receipt.donation_date)}. Your generosity supports access to technology and digital learning opportunities for underserved children.`;
    doc.font('Helvetica').fontSize(10).fillColor(black).text(letterText,48,479,{width:516,lineGap:3,height:76,ellipsis:true});
    doc.roundedRect(48,564,516,91,7).fill(pale);
    doc.font('Helvetica-Bold').fontSize(9.3).fillColor(green).text('ACKNOWLEDGMENT & TAX INFORMATION',61,577);
    const benefit=receipt.consideration_type==='none'?'No goods or services were provided in exchange for this contribution.':`In exchange, the donor received: ${receipt.consideration_description}. Good-faith estimated value: ${currency(receipt.consideration_value)}.`;
    doc.font('Helvetica').fontSize(9).fillColor(black);
    const benefitOverflow=doc.heightOfString(benefit,{width:485}) > 27;
    doc.text(benefitOverflow?'The donor received goods/services in exchange. Details appear on page 2.':benefit,61,594,{width:485,height:29,ellipsis:true});
    if(receipt.donation_type!=='monetary')doc.fontSize(8.8).fillColor(grey).text('The Foundation does not assign a monetary value to donated property. Donors are responsible for determining value.',61,627,{width:485,height:24,ellipsis:true});
    doc.moveTo(48,667).lineTo(275,667).strokeColor(border).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text('Authorized Representative',48,675);
    doc.font('Helvetica').fontSize(8).fillColor(grey).text(draft?'Draft - not signed':`Issued by ${receipt.approved_by || 'Digital Kids Foundation Inc.'}`,48,688,{width:360});
    if(qr){
      // Scanning checks the authoritative DKF-issued record; a copied QR alone is not proof.
      doc.rect(304,662,190,43).fill('#FFFFFF');
      doc.font('Helvetica-Bold').fontSize(8).fillColor(green).text('VERIFY THIS DOCUMENT',306,668,{width:180});
      doc.font('Helvetica').fontSize(7).fillColor(grey).text('digitalkidsfoundation.org/verify-donation',306,681,{width:184});
      doc.font('Helvetica').fontSize(7).fillColor(grey).text(`Code: ${receipt.verification_code.slice(0,8).toUpperCase()}...`,306,692,{width:180});
      doc.image(qr,501,654,{width:54,height:54});
    }
    doc.moveTo(48,709).lineTo(491,709).strokeColor(border).stroke();
    doc.fontSize(8).fillColor(green).text('Digital Kids Foundation Inc.  |  Brooklyn, New York',48,717);
    doc.fillColor(grey).text('digitalkidsfoundation.org',416,717,{width:148,align:'right'});
    if(draft)doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#8D5811').text('DRAFT - DO NOT EMAIL OR USE FOR TAX PURPOSES',48,731,{width:516,align:'center'});
    securityStrip(doc,receipt,draft);
    if(descOverflow || benefitOverflow){
      doc.addPage({size:'LETTER',margins:{top:48,bottom:8,left:48,right:48}});
      doc.rect(0,0,612,21).fill(green);doc.rect(0,21,612,6).fill(gold);
      securityBackdrop(doc,draft);
      try{doc.image(logo,48,45,{fit:[214,76]});}catch(e){}
      doc.font('Helvetica-Bold').fontSize(12).fillColor(green).text('Digital Kids Foundation Inc.',330,75,{width:232});
      doc.moveTo(48,142).lineTo(564,142).strokeColor(border).stroke();
      doc.font('Helvetica-Bold').fontSize(18).fillColor(green).text('DONATION DETAILS - CONTINUED',48,167);
      doc.font('Helvetica').fontSize(10).fillColor(black).text(`Receipt: ${receipt.reference}  |  Donor: ${receipt.donor_name}`,48,195,{width:510});
      let y=230;
      if(descOverflow){doc.font('Helvetica-Bold').fontSize(10).fillColor(green).text('COMPLETE DONATED PROPERTY DESCRIPTION',48,y);y+=22;doc.font('Helvetica').fontSize(10).fillColor(black).text(receipt.description,48,y,{width:512,lineGap:3});y=doc.y+24;}
      if(benefitOverflow){doc.font('Helvetica-Bold').fontSize(10).fillColor(green).text('GOODS / SERVICES PROVIDED IN EXCHANGE',48,y);y+=22;doc.font('Helvetica').fontSize(10).fillColor(black).text(benefit,48,y,{width:512,lineGap:3});}
      doc.font('Helvetica').fontSize(8).fillColor(grey).text('Digital Kids Foundation Inc.  |  digitalkidsfoundation.org',48,726,{width:516});
      securityStrip(doc,receipt,draft);
    }
    doc.end();
  });
}

const fields=['donor_name','donor_email','document_type','donation_type','donation_date','quantity','description','monetary_amount','consideration_type','consideration_description','consideration_value'];
const exposed = 'id,reference,donor_name,donor_email,document_type,donation_type,donation_date,quantity,description,monetary_amount,consideration_type,consideration_description,consideration_value,status,created_by,approved_by,resend_email_id,sent_at,created_at,updated_at,verification_code,document_format_version,revoked_at,revoked_by,revoked_reason';
const api = '/api/laptops/admin/donor-receipts';
router.use(api, verifyAdmin);
// Same-origin JSON writes prevent off-site pages from posting with an authenticated admin session.
router.use(api, (req,res,next) => {
  if(!['POST','PATCH','PUT','DELETE'].includes(req.method))return next();
  const origin=req.get('Origin');
  try {
    if(!origin || new URL(origin).host !== req.get('host') || !['https:','http:'].includes(new URL(origin).protocol))
      return res.status(403).json({error:'Invalid request origin'});
  } catch {return res.status(403).json({error:'Invalid request origin'});}
  next();
});
router.get(api,async(req,res)=>{try{await ensureSchema();res.set('Cache-Control','no-store').json((await pool.query(`SELECT ${exposed} FROM dkf_donor_receipts ORDER BY id DESC LIMIT 500`)).rows);}catch(e){console.error('DKF receipt list:',e);res.status(500).json({error:'Unable to list receipts'});}});
router.post(api,async(req,res)=>{try{await ensureSchema();const d=validate(req.body);const client=await pool.connect();try{await client.query('BEGIN');const vals=fields.map(k=>d[k]);let r=await client.query(`INSERT INTO dkf_donor_receipts (${fields.join(',')},created_by,verification_code) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$12,$13) RETURNING id,donation_date`,[...vals,req.dkfAdminEmail||'admin',crypto.randomBytes(16).toString('hex')]);const id=r.rows[0].id;const year=String(d.donation_date).slice(0,4);const reference=`DKF-${year}-${String(id).padStart(6,'0')}`;r=await client.query(`UPDATE dkf_donor_receipts SET reference=$1 WHERE id=$2 RETURNING ${exposed}`,[reference,id]);await client.query('COMMIT');res.status(201).json(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Unable to save draft'});}});
router.get(api+'/:id',async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT ${exposed} FROM dkf_donor_receipts WHERE id=$1`,[req.params.id]);if(!r.rows.length)return res.status(404).json({error:'Not found'});res.set('Cache-Control','no-store').json(r.rows[0]);}catch(e){res.status(500).json({error:'Unable to retrieve receipt'});}});
router.patch(api+'/:id',async(req,res)=>{try{await ensureSchema();const d=validate(req.body);const q=await pool.query(`UPDATE dkf_donor_receipts SET ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=NOW() WHERE id=$12 AND status='draft' RETURNING ${exposed}`,[...fields.map(k=>d[k]),req.params.id]);if(!q.rows.length)return res.status(409).json({error:'Only drafts may be edited'});res.json(q.rows[0]);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Unable to update draft'});}});
router.get(api+'/:id/pdf',async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT ${exposed},issued_pdf FROM dkf_donor_receipts WHERE id=$1`,[req.params.id]);if(!r.rows.length)return res.status(404).json({error:'Not found'});if(r.rows[0].status!=='draft'&&r.rows[0].status!=='sent')return res.status(409).json({error:'Delivery status needs review'});
if(r.rows[0].status==='sent' && !r.rows[0].issued_pdf)return res.status(409).json({error:'Archived issued PDF is unavailable. For security, an issued document cannot be silently recreated.'});
if(r.rows[0].status==='draft' && !r.rows[0].verification_code) {
  const code=crypto.randomBytes(16).toString('hex');
  const added=await pool.query("UPDATE dkf_donor_receipts SET verification_code=$2 WHERE id=$1 AND status='draft' AND verification_code IS NULL RETURNING verification_code",[r.rows[0].id,code]);
  if(added.rowCount)r.rows[0].verification_code=added.rows[0].verification_code;
  else {const lookup=await pool.query("SELECT verification_code FROM dkf_donor_receipts WHERE id=$1 AND status='draft'",[r.rows[0].id]);if(!lookup.rows.length)return res.status(409).json({error:'Draft status changed; reload'});r.rows[0].verification_code=lookup.rows[0].verification_code;}
}
const b=r.rows[0].status==='sent' && r.rows[0].issued_pdf ? r.rows[0].issued_pdf : await receiptPdf(r.rows[0],r.rows[0].status!=='sent');
if(r.rows[0].status==='draft'){
  // PostgreSQL stores microseconds, while node-postgres serializes JS Dates to milliseconds.
  // Compare at the precision actually transported to the browser.
  const marked=await pool.query(
    "UPDATE dkf_donor_receipts SET last_previewed_at=NOW() WHERE id=$1 AND status='draft' AND date_trunc('milliseconds',updated_at)=$2::timestamptz RETURNING id",
    [r.rows[0].id,r.rows[0].updated_at]
  );
  if(!marked.rowCount)return res.status(409).json({error:'The draft changed while previewing. Reload it and generate a fresh PDF.'});
}
res.set('Cache-Control','private, no-store').set('X-Frame-Options','SAMEORIGIN').set('Content-Security-Policy',"default-src 'self' blob: data:; object-src blob:; frame-ancestors 'self'").set('Content-Type','application/pdf').set('Content-Disposition',`inline; filename="${r.rows[0].reference}.pdf"`).send(b);}catch(e){console.error('PDF error',e);res.status(500).json({error:'Unable to render PDF'});}});
router.post(api+'/:id/send',async(req,res)=>{
  // Explicit two-step operation: preview first, then check factual confirmations and send.
  if(req.body?.confirmedReceived!==true||req.body?.confirmedPreview!==true||!req.body?.expectedUpdatedAt)return res.status(400).json({error:'Review the current PDF and confirm the donation was received before sending'});
  // Without a server-only signing key, new receipts MUST NOT be issued.
  if(!signingKey())return res.status(503).json({error:'Receipt verification is not configured. Ask an administrator to set DKF_RECEIPT_SIGNING_KEY in Coolify before issuing documents.'});
  let receipt;
  try{
    await ensureSchema(); const q=await pool.query(`UPDATE dkf_donor_receipts SET status='sending',approved_by=$2,document_format_version=2,updated_at=NOW() WHERE id=$1 AND status='draft' AND date_trunc('milliseconds',updated_at)=$3::timestamptz AND last_previewed_at >= updated_at RETURNING ${exposed}`,[req.params.id,req.dkfAdminEmail||'admin',req.body.expectedUpdatedAt]);
    if(!q.rows.length)return res.status(409).json({error:'Receipt was not sent: it is not an eligible, freshly previewed draft. Reopen the receipt, generate the PDF again, and reconfirm. If delivery was previously attempted, verify it in Resend first.'});
    receipt=q.rows[0];
    if(!receipt.verification_code)throw Error('No verification code: preview this receipt again before sending.');
    const seal=sealReceipt(receipt);
    const pdf=await receiptPdf(receipt,false);
    const pdfSha=crypto.createHash('sha256').update(pdf).digest('hex');
    await pool.query("UPDATE dkf_donor_receipts SET issued_pdf=$2,verification_seal=$3,issued_pdf_sha256=$4 WHERE id=$1 AND status='sending'",[receipt.id,pdf,seal,pdfSha]);
    if(!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)throw Error('Resend email sender is not configured');
    const from=`Digital Kids Foundation <${process.env.MAIL_FROM}>`;
    const subject=receipt.document_type==='acknowledgment_letter'?`Your Donation Acknowledgment Letter - ${receipt.reference}`:`Your Donation Receipt - ${receipt.reference}`;
    const plain=`Dear ${receipt.donor_name},\n\nThank you for supporting Digital Kids Foundation Inc. Please find your ${receipt.document_type==='acknowledgment_letter'?'donation acknowledgment letter':'donation receipt'} attached as a PDF.\n\nReceipt reference: ${receipt.reference}\nDonation date: ${dateFormat(receipt.donation_date)}\nVerify this document: ${verifyUrl(receipt)}\n\nWith gratitude,\nDigital Kids Foundation Inc.\nhelp@digitalkidsfoundation.org`;
    const html=`<div style="font:16px/1.6 Arial,sans-serif;color:#163A2F;max-width:620px;margin:auto"><h2 style="color:#103B2F">Digital Kids Foundation</h2><p>Dear ${htmlEscape(receipt.donor_name)},</p><p>Thank you for supporting our mission of digital access for children. Your donation acknowledgment is attached as a PDF.</p><p><b>Receipt reference:</b> ${htmlEscape(receipt.reference)}<br><b>Date received:</b> ${htmlEscape(dateFormat(receipt.donation_date))}</p><p><b>Verify this document:</b> <a href="${htmlEscape(verifyUrl(receipt))}">Verify on the DKF website</a>. The verification page also allows you to check whether the PDF file has been altered.</p><p>With appreciation,<br><b>Digital Kids Foundation Inc.</b></p><p><a href="https://digitalkidsfoundation.org/">digitalkidsfoundation.org</a></p></div>`;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`dkf-receipt/${receipt.id}`},body:JSON.stringify({from,to:[receipt.donor_email],subject,text:plain,html,attachments:[{filename:`${receipt.reference}.pdf`,content:pdf.toString('base64')}] }),signal:AbortSignal.timeout(20000)});
    const responseBody=await response.json().catch(()=>({}));
    if(!response.ok || !responseBody.id)throw Error(`Resend did not confirm acceptance: HTTP ${response.status}`);
    await pool.query(`UPDATE dkf_donor_receipts SET status='sent',sent_at=NOW(),resend_email_id=$2,updated_at=NOW() WHERE id=$1`,[receipt.id,responseBody.id]);
    await pool.query('INSERT INTO dkf_receipt_audit(receipt_id,event,actor,detail) VALUES($1,$2,$3,$4)',[receipt.id,'issued',receipt.approved_by||'admin',responseBody.id]).catch(e=>console.error('Receipt audit log error:',e.message));
    res.json({ok:true,reference:receipt.reference,recipient:receipt.donor_email,email_id:responseBody.id,status:'sent',verify_url:verifyUrl(receipt)});
  }catch(e){
    console.error('DKF donor receipt send requires review:',e);
    if(receipt){await pool.query(`UPDATE dkf_donor_receipts SET status='needs_review',last_error=$2,updated_at=NOW() WHERE id=$1 AND status='sending'`,[receipt.id,String(e.message).slice(0,250)]).catch(()=>{});}
    res.status(502).json({error:'Email sending could not be confirmed. Do NOT send again automatically; check the Resend dashboard and receipt status to avoid duplicates.',status:'needs_review'});
  }
});
// An already-issued receipt is never deleted or altered. Revocation invalidates its public verification.
router.post(api+'/:id/revoke',async(req,res)=>{
  const reason=safe(req.body?.reason,500);
  const reference=safe(req.body?.reference,40);
  if(reason.length<10 || !/^DKF-\d{4}-\d{6,}$/.test(reference))return res.status(400).json({error:'Enter the receipt number and a reason (10 or more characters).'});
  try {
    await ensureSchema();
    const q=await pool.query("UPDATE dkf_donor_receipts SET revoked_at=NOW(),revoked_by=$2,revoked_reason=$3 WHERE id=$1 AND reference=$4 AND status='sent' AND revoked_at IS NULL RETURNING id,reference",[req.params.id,req.dkfAdminEmail||'admin',reason,reference]);
    if(!q.rowCount)return res.status(409).json({error:'Only a matching, issued, non-revoked document can be revoked.'});
    await pool.query('INSERT INTO dkf_receipt_audit(receipt_id,event,actor,detail) VALUES($1,$2,$3,$4)',[q.rows[0].id,'revoked',req.dkfAdminEmail||'admin',reason]).catch(e=>console.error('Revocation audit log error:',e.message));
    res.json({ok:true,reference:q.rows[0].reference,status:'revoked'});
  }catch(e){console.error('Revoke DKF receipt:',e.message);res.status(500).json({error:'Unable to revoke receipt'});}
});

// This public endpoint is NOT protected by administrator authentication. Its 128-bit
// random code is embedded in the QR. The page intentionally shows receipt details
// (including the name), but never exposes donor email or administrative data.
const verifyCounters=new Map();
function rateLimitVerify(req,res,next){
  const key=req.ip;const now=Date.now();const v=verifyCounters.get(key)||{n:0,start:now};
  if(now-v.start>60_000){v.n=0;v.start=now;}v.n++;verifyCounters.set(key,v);
  if(v.n>40)return res.status(429).type('text/plain').send('Too many verification requests. Please try again later.');
  next();
}
setInterval(()=>{const now=Date.now();for(const [k,v] of verifyCounters)if(now-v.start>120_000)verifyCounters.delete(k);},60_000).unref();
function verificationPage(status,r) {
  const states={valid:['Verified DKF document','valid','This document was issued by Digital Kids Foundation Inc. Compare the details below with the PDF.'],revoked:['Receipt revoked','revoked','This receipt was revoked. Do not rely on this copy; contact DKF for clarification.'],unverified:['Not verified','invalid','This document could not be verified. It may be a draft, an older document without verification, or an invalid link.']};
  const [title,state,description]=states[status];
  const details=status==='valid'?`<dl>
<dt>Receipt number</dt><dd>${htmlEscape(r.reference)}</dd>
${Number(r.document_format_version)===2?`<dt>Document seal ID</dt><dd><code>${htmlEscape(visibleSealId(r))}</code></dd>`:`<dt>Document format</dt><dd>Previously issued format (no visible seal ID)</dd>`}
<dt>Donor / company</dt><dd>${htmlEscape(r.donor_name)}</dd>
<dt>Document type</dt><dd>${r.document_type==='receipt'?'Donation receipt':'Acknowledgment letter'}</dd>
<dt>Donation date</dt><dd>${htmlEscape(dateFormat(r.donation_date))}</dd>
<dt>Donation</dt><dd>${htmlEscape(display[r.donation_type]||r.donation_type)}</dd>
<dt>Quantity / amount</dt><dd>${htmlEscape(r.donation_type==='monetary'?currency(r.monetary_amount):String(r.quantity))}</dd>
<dt>Description</dt><dd>${htmlEscape(r.description)}</dd>
</dl><section class="check"><h2>Check whether the PDF was changed</h2><p>Select the PDF saved on your device. The check runs entirely in your browser; the file is not uploaded to DKF.</p><label for="localPdf">Choose PDF to check</label><input id="localPdf" type="file" accept="application/pdf,.pdf"><p id="pdfCheckResult" role="status">No PDF selected.</p></section>`:'';
  const sha=status==='valid'?htmlEscape(r.issued_pdf_sha256):'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${title} | Digital Kids Foundation</title><style>body{font:16px/1.55 system-ui,sans-serif;background:#f4f8f5;color:#183b34;margin:0;padding:24px}.container{max-width:680px;margin:28px auto;background:white;border:1px solid #d9e5dd;border-radius:16px;overflow:hidden;box-shadow:0 8px 36px #103b2f12}header{background:#103b2f;color:white;padding:26px 32px;border-bottom:5px solid #d4a32c}header h1{font-size:21px;margin:0}main{padding:26px 32px}h2{font-size:18px}.status{font-weight:800;font-size:23px}.valid{color:#186947}.revoked,.invalid{color:#a23e25}dl{display:grid;grid-template-columns:1fr 1.6fr;gap:12px 16px;padding:20px;background:#f4f8f5;border-radius:10px}dt{color:#60726b}dd{margin:0;font-weight:650;overflow-wrap:anywhere}.check{border-top:1px solid #dce6de;margin-top:26px;padding-top:20px}.check input{display:block;margin:10px 0}footer{border-top:1px solid #dce6de;padding:16px 32px;color:#60726b;font-size:13px}a{color:#146f63}@media(max-width:560px){dl{grid-template-columns:1fr}main,header{padding:22px}}</style></head><body><div class="container"><header><h1>Digital Kids Foundation Inc.</h1><div>Official donation document verification</div></header><main><div class="status ${state}">${title}</div><p>${description}</p>${details}<p><strong>Important:</strong> For new-format receipts, compare the seal ID; always compare donor name, receipt number and gift details with the PDF. A QR or watermark can be copied onto a fake. Use the PDF-file check to detect any changed bytes in the original attachment; genuine unchanged copies will also match.</p><p>Questions? <a href="mailto:help@digitalkidsfoundation.org">Contact DKF</a>.</p></main><footer>https://digitalkidsfoundation.org &middot; Verification results are provided by DKF.</footer></div>${status==='valid'?`<div id="pdfExpectedSha" data-sha256="${sha}" hidden></div><script src="/verify-donation.js" defer></script>`:''}</body></html>`;
}
router.get('/verify-donation/:reference',rateLimitVerify,async(req,res)=>{
  res.set('Cache-Control','no-store, max-age=0').set('Pragma','no-cache').set('Referrer-Policy','no-referrer')
    .set('X-Content-Type-Options','nosniff').set('X-Frame-Options','DENY')
    .set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const reference=String(req.params.reference||''),code=String(req.query.code||'');
  if(!/^DKF-\d{4}-\d{6,}$/.test(reference)||!/^[a-f0-9]{32}$/.test(code))return res.status(200).type('html').send(verificationPage('unverified'));
  try{
    await ensureSchema();
    const q=await pool.query('SELECT * FROM dkf_donor_receipts WHERE reference=$1 AND verification_code=$2',[reference,code]);
    const r=q.rows[0];
    if(!r || r.status!=='sent'||!sealedRowValid(r))return res.status(200).type('html').send(verificationPage('unverified'));
    return res.type('html').send(verificationPage(r.revoked_at?'revoked':'valid',r));
  }catch(e){console.error('Public receipt verification:',e.message);return res.status(503).type('text/plain').send('Verification temporarily unavailable. Try again later.');}
});

module.exports={router,ensureSchema,validate,receiptPdf,sealReceipt,sealedRowValid,canonicalReceipt,visibleSealId};
