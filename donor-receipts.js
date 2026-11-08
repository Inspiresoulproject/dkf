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
const { verifyAdmin } = require('./dkf-access-auth');
const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
const logo = path.join(__dirname, 'assets', 'dkf-logo.png');
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
  CONSTRAINT dkf_receipt_status CHECK(status IN ('draft','sending','sent','needs_review'))
);
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS issued_pdf BYTEA;
ALTER TABLE dkf_donor_receipts ADD COLUMN IF NOT EXISTS last_previewed_at TIMESTAMPTZ;
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

function receiptPdf(receipt, draft=false){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'LETTER',margin:48,autoFirstPage:true,info:{Title:`DKF ${draft?'Draft ':''}Donation Acknowledgment ${receipt.reference}`,Author:'Digital Kids Foundation Inc.'}});
    const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('error',reject); doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const green='#103B2F', gold='#D4A32C', grey='#60726B', black='#20312C', pale='#F3F7F4', border='#DEE8E1';
    const tx=(str,x,y,opts={})=>doc.text(String(str ?? ''),x,y,{lineBreak:false,...opts});
    doc.rect(0,0,612,21).fill(green);doc.rect(0,21,612,6).fill(gold);
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
    if(draft){doc.save().opacity(.17).fillColor('#9AAA9E').font('Helvetica-Bold').fontSize(95).rotate(32,{origin:[306,410]}).text('DRAFT',155,385,{width:350,align:'center'}).restore();}
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
    doc.moveTo(48,709).lineTo(564,709).strokeColor(border).stroke();
    doc.fontSize(8).fillColor(green).text('Digital Kids Foundation Inc.  |  Brooklyn, New York',48,717);
    doc.fillColor(grey).text('digitalkidsfoundation.org',416,717,{width:148,align:'right'});
    if(draft)doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#8D5811').text('DRAFT - DO NOT EMAIL OR USE FOR TAX PURPOSES',48,731,{width:516,align:'center'});
    if(descOverflow || benefitOverflow){
      doc.addPage({size:'LETTER',margin:48});
      doc.rect(0,0,612,21).fill(green);doc.rect(0,21,612,6).fill(gold);
      try{doc.image(logo,48,45,{fit:[214,76]});}catch(e){}
      doc.font('Helvetica-Bold').fontSize(12).fillColor(green).text('Digital Kids Foundation Inc.',330,75,{width:232});
      doc.moveTo(48,142).lineTo(564,142).strokeColor(border).stroke();
      doc.font('Helvetica-Bold').fontSize(18).fillColor(green).text('DONATION DETAILS - CONTINUED',48,167);
      doc.font('Helvetica').fontSize(10).fillColor(black).text(`Receipt: ${receipt.reference}  |  Donor: ${receipt.donor_name}`,48,195,{width:510});
      let y=230;
      if(descOverflow){doc.font('Helvetica-Bold').fontSize(10).fillColor(green).text('COMPLETE DONATED PROPERTY DESCRIPTION',48,y);y+=22;doc.font('Helvetica').fontSize(10).fillColor(black).text(receipt.description,48,y,{width:512,lineGap:3});y=doc.y+24;}
      if(benefitOverflow){doc.font('Helvetica-Bold').fontSize(10).fillColor(green).text('GOODS / SERVICES PROVIDED IN EXCHANGE',48,y);y+=22;doc.font('Helvetica').fontSize(10).fillColor(black).text(benefit,48,y,{width:512,lineGap:3});}
      if(draft){doc.save().opacity(.15).fillColor('#9AAA9E').font('Helvetica-Bold').fontSize(90).rotate(32,{origin:[306,410]}).text('DRAFT',155,390,{width:350,align:'center'}).restore();}
      doc.font('Helvetica').fontSize(8).fillColor(grey).text('Digital Kids Foundation Inc.  |  digitalkidsfoundation.org',48,726,{width:516});
    }
    doc.end();
  });
}

const fields=['donor_name','donor_email','document_type','donation_type','donation_date','quantity','description','monetary_amount','consideration_type','consideration_description','consideration_value'];
const exposed = 'id,reference,donor_name,donor_email,document_type,donation_type,donation_date,quantity,description,monetary_amount,consideration_type,consideration_description,consideration_value,status,created_by,approved_by,resend_email_id,sent_at,created_at,updated_at';
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
router.post(api,async(req,res)=>{try{await ensureSchema();const d=validate(req.body);const client=await pool.connect();try{await client.query('BEGIN');const vals=fields.map(k=>d[k]);let r=await client.query(`INSERT INTO dkf_donor_receipts (${fields.join(',')},created_by) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$12) RETURNING id,donation_date`,[...vals,req.dkfAdminEmail||'admin']);const id=r.rows[0].id;const year=String(d.donation_date).slice(0,4);const reference=`DKF-${year}-${String(id).padStart(6,'0')}`;r=await client.query(`UPDATE dkf_donor_receipts SET reference=$1 WHERE id=$2 RETURNING ${exposed}`,[reference,id]);await client.query('COMMIT');res.status(201).json(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Unable to save draft'});}});
router.get(api+'/:id',async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT ${exposed} FROM dkf_donor_receipts WHERE id=$1`,[req.params.id]);if(!r.rows.length)return res.status(404).json({error:'Not found'});res.set('Cache-Control','no-store').json(r.rows[0]);}catch(e){res.status(500).json({error:'Unable to retrieve receipt'});}});
router.patch(api+'/:id',async(req,res)=>{try{await ensureSchema();const d=validate(req.body);const q=await pool.query(`UPDATE dkf_donor_receipts SET ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=NOW() WHERE id=$12 AND status='draft' RETURNING ${exposed}`,[...fields.map(k=>d[k]),req.params.id]);if(!q.rows.length)return res.status(409).json({error:'Only drafts may be edited'});res.json(q.rows[0]);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Unable to update draft'});}});
router.get(api+'/:id/pdf',async(req,res)=>{try{await ensureSchema();const r=await pool.query(`SELECT ${exposed},issued_pdf FROM dkf_donor_receipts WHERE id=$1`,[req.params.id]);if(!r.rows.length)return res.status(404).json({error:'Not found'});if(r.rows[0].status!=='draft'&&r.rows[0].status!=='sent')return res.status(409).json({error:'Delivery status needs review'});const b=r.rows[0].status==='sent' && r.rows[0].issued_pdf ? r.rows[0].issued_pdf : await receiptPdf(r.rows[0],r.rows[0].status!=='sent');
if(r.rows[0].status==='draft')await pool.query("UPDATE dkf_donor_receipts SET last_previewed_at=NOW() WHERE id=$1 AND status='draft' AND updated_at=$2",[r.rows[0].id,r.rows[0].updated_at]);
res.set('Cache-Control','private, no-store').set('X-Frame-Options','SAMEORIGIN').set('Content-Security-Policy',"default-src 'self' blob: data:; object-src blob:; frame-ancestors 'self'").set('Content-Type','application/pdf').set('Content-Disposition',`inline; filename="${r.rows[0].reference}.pdf"`).send(b);}catch(e){console.error('PDF error',e);res.status(500).json({error:'Unable to render PDF'});}});
router.post(api+'/:id/send',async(req,res)=>{
  // Explicit two-step operation: preview first, then check factual confirmations and send.
  if(req.body?.confirmedReceived!==true||req.body?.confirmedPreview!==true||!req.body?.expectedUpdatedAt)return res.status(400).json({error:'Review the current PDF and confirm the donation was received before sending'});
  let receipt;
  try{
    await ensureSchema(); const q=await pool.query(`UPDATE dkf_donor_receipts SET status='sending',approved_by=$2,updated_at=NOW() WHERE id=$1 AND status='draft' AND updated_at=$3::timestamptz AND last_previewed_at >= updated_at RETURNING ${exposed}`,[req.params.id,req.dkfAdminEmail||'admin',req.body.expectedUpdatedAt]);
    if(!q.rows.length)return res.status(409).json({error:'Receipt is not an unsent draft. Check history before trying again.'});
    receipt=q.rows[0];
    const pdf=await receiptPdf(receipt,false);
    await pool.query("UPDATE dkf_donor_receipts SET issued_pdf=$2 WHERE id=$1 AND status='sending'",[receipt.id,pdf]);
    if(!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)throw Error('Resend email sender is not configured');
    const from=`Digital Kids Foundation <${process.env.MAIL_FROM}>`;
    const subject=receipt.document_type==='acknowledgment_letter'?`Your Donation Acknowledgment Letter - ${receipt.reference}`:`Your Donation Receipt - ${receipt.reference}`;
    const plain=`Dear ${receipt.donor_name},\n\nThank you for supporting Digital Kids Foundation Inc. Please find your ${receipt.document_type==='acknowledgment_letter'?'donation acknowledgment letter':'donation receipt'} attached as a PDF.\n\nReceipt reference: ${receipt.reference}\nDonation date: ${dateFormat(receipt.donation_date)}\n\nWith gratitude,\nDigital Kids Foundation Inc.\nhelp@digitalkidsfoundation.org`;
    const html=`<div style="font:16px/1.6 Arial,sans-serif;color:#163A2F;max-width:620px;margin:auto"><h2 style="color:#103B2F">Digital Kids Foundation</h2><p>Dear ${htmlEscape(receipt.donor_name)},</p><p>Thank you for supporting our mission of digital access for children. Your donation acknowledgment is attached as a PDF.</p><p><b>Receipt reference:</b> ${htmlEscape(receipt.reference)}<br><b>Date received:</b> ${htmlEscape(dateFormat(receipt.donation_date))}</p><p>With appreciation,<br><b>Digital Kids Foundation Inc.</b></p><p><a href="https://digitalkidsfoundation.org/">digitalkidsfoundation.org</a></p></div>`;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`dkf-receipt/${receipt.id}`},body:JSON.stringify({from,to:[receipt.donor_email],subject,text:plain,html,attachments:[{filename:`${receipt.reference}.pdf`,content:pdf.toString('base64')}] }),signal:AbortSignal.timeout(20000)});
    const responseBody=await response.json().catch(()=>({}));
    if(!response.ok || !responseBody.id)throw Error(`Resend did not confirm acceptance: HTTP ${response.status}`);
    await pool.query(`UPDATE dkf_donor_receipts SET status='sent',sent_at=NOW(),resend_email_id=$2,updated_at=NOW() WHERE id=$1`,[receipt.id,responseBody.id]);
    res.json({ok:true,reference:receipt.reference,recipient:receipt.donor_email,email_id:responseBody.id,status:'sent'});
  }catch(e){
    console.error('DKF donor receipt send requires review:',e);
    if(receipt){await pool.query(`UPDATE dkf_donor_receipts SET status='needs_review',last_error=$2,updated_at=NOW() WHERE id=$1 AND status='sending'`,[receipt.id,String(e.message).slice(0,250)]).catch(()=>{});}
    res.status(502).json({error:'Email sending could not be confirmed. Do NOT send again automatically; check the Resend dashboard and receipt status to avoid duplicates.',status:'needs_review'});
  }
});
module.exports={router,ensureSchema,validate,receiptPdf};
