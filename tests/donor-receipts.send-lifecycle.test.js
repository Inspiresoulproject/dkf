'use strict';
// Offline regression test: preview must record a review even when PostgreSQL's
// timestamp has sub-millisecond precision that is lost in JSON serialization.
const assert=require('node:assert/strict');
const { EventEmitter }=require('node:events');
const Module=require('node:module');

const api='/api/laptops/admin/donor-receipts';
const routes={get:new Map(),post:new Map()};
const receipt={
  id:2, reference:'DKF-2026-000002',donor_name:'Staging Test Donor',donor_email:'stage@example.test',
  document_type:'receipt',donation_type:'laptop',donation_date:'2026-11-07',quantity:1,
  description:'One used laptop',consideration_type:'none',consideration_description:null,
  consideration_value:null,monetary_amount:null,verification_code:'0123456789abcdef0123456789abcdef',status:'draft',updated_at:new Date('2026-11-07T21:42:31.123Z')
};
let previewRecorded=false,sendCalls=0;
class FakePool{
  async query(sql,args){
    if(sql.includes('CREATE TABLE'))return {rows:[],rowCount:0};
    if(sql.startsWith('SELECT') && sql.includes('issued_pdf FROM dkf_donor_receipts'))return {rows:[{...receipt,issued_pdf:null}]};
    if(sql.includes('SET last_previewed_at=NOW()')){
      assert.match(sql,/date_trunc\('milliseconds',updated_at\)/);
      assert.equal(args[0],receipt.id);
      previewRecorded=true;return {rows:[{id:receipt.id}],rowCount:1};
    }
    if(sql.includes("SET status='sending'")){
      assert.match(sql,/date_trunc\('milliseconds',updated_at\)/);
      assert.match(sql,/last_previewed_at >= updated_at/);
      assert.equal(args[2],receipt.updated_at.toISOString());
      if(!previewRecorded||receipt.status!=='draft')return {rows:[],rowCount:0};
      receipt.status='sending';receipt.approved_by=args[1];return {rows:[{...receipt}],rowCount:1};
    }
    if(sql.includes('SET issued_pdf=')){receipt.issued_pdf=args[1];receipt.verification_seal=args[2];receipt.issued_pdf_sha256=args[3];return {rows:[],rowCount:1};}
    if(sql.includes('INSERT INTO dkf_receipt_audit'))return {rows:[],rowCount:1};
    if(sql.includes("SET status='sent'")){
      assert.equal(receipt.status,'sending');
      receipt.status='sent';receipt.sent_at=new Date();receipt.resend_email_id=args[1];return {rows:[],rowCount:1};
    }
    throw Error('Unexpected SQL: '+sql.slice(0,180));
  }
}
class FakePDF extends EventEmitter{
  constructor(){super();this.y=120;}
  rect(){return this;} roundedRect(){return this;} fill(){return this;}
  font(){return this;} fontSize(){return this;} fillColor(){return this;}
  text(){return this;} image(){return this;} moveTo(){return this;}
  lineTo(){return this;} strokeColor(){return this;} stroke(){return this;}
  save(){return this;} opacity(){return this;} rotate(){return this;}
  restore(){return this;} heightOfString(){return 13;} addPage(){return this;}
  end(){process.nextTick(()=>{this.emit('data',Buffer.from('%PDF-stub'));this.emit('end');});}
}
const fakeRouter={use(){},get(p,h){routes.get.set(p,h);},post(p,h){routes.post.set(p,h);},patch(){}};
const oldLoad=Module._load;
Module._load=function(name,parent,main){
  if(name==='express')return {Router:()=>fakeRouter};
  if(name==='pg')return {Pool:FakePool};
  if(name==='pdfkit')return FakePDF;
  if(name==='qrcode')return {toBuffer:async()=>Buffer.from('stub-qr')};
  if(name==='./dkf-access-auth')return {verifyAdmin:(req,res,next)=>next()};
  return oldLoad.call(this,name,parent,main);
};
try{require('../donor-receipts');}finally{Module._load=oldLoad;}
function response(){return {
  statusCode:200,headers:{},data:null,
  status(n){this.statusCode=n;return this;},set(k,v){this.headers[k]=v;return this;},
  json(x){this.data=x;return this;},send(x){this.data=x;return this;}
};}
const prevKey=process.env.RESEND_API_KEY,prevMail=process.env.MAIL_FROM,prevSigning=process.env.DKF_RECEIPT_SIGNING_KEY,prevFetch=global.fetch;
process.env.RESEND_API_KEY='test-only-no-real-send';process.env.MAIL_FROM='test@digitalkidsfoundation.org';process.env.DKF_RECEIPT_SIGNING_KEY='11'.repeat(32);
global.fetch=async()=>{sendCalls++;return {ok:true,status:200,json:async()=>({id:'eml-test-123'})};};
(async()=>{
  // A send before the server records a preview must not be possible.
  const send=routes.post.get(api+'/:id/send');assert.ok(send);
  const data={confirmedReceived:true,confirmedPreview:true,expectedUpdatedAt:receipt.updated_at.toISOString()};
  const noPreview=response();await send({params:{id:2},body:data,dkfAdminEmail:'admin@example.test'},noPreview);
  assert.equal(noPreview.statusCode,409);assert.equal(sendCalls,0);
  // GET preview should persist last_previewed_at even though SQL timestamps have microseconds.
  const getPdf=routes.get.get(api+'/:id/pdf');assert.ok(getPdf);
  const pdfReply=response();await getPdf({params:{id:2}},pdfReply);
  assert.equal(pdfReply.statusCode,200);assert.equal(previewRecorded,true);
  assert.match(pdfReply.headers['Content-Type'],/pdf/);
  // Previewed draft sends exactly once, updates status, records Resend acceptance.
  const accepted=response();await send({params:{id:2},body:data,dkfAdminEmail:'admin@example.test'},accepted);
  assert.equal(accepted.data.status,'sent');assert.equal(receipt.status,'sent');assert.equal(receipt.resend_email_id,'eml-test-123');assert.equal(sendCalls,1);
  // Duplicate clicks are blocked even if the client tries to send again.
  const duplicate=response();await send({params:{id:2},body:data,dkfAdminEmail:'admin@example.test'},duplicate);
  assert.equal(duplicate.statusCode,409);assert.equal(sendCalls,1);
  console.log('PASS: preview recorded, send marked Sent, and duplicate send blocked (simulated Resend; no emails sent)');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  global.fetch=prevFetch;
  if(prevKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=prevKey;
  if(prevMail===undefined)delete process.env.MAIL_FROM;else process.env.MAIL_FROM=prevMail;
  if(prevSigning===undefined)delete process.env.DKF_RECEIPT_SIGNING_KEY;else process.env.DKF_RECEIPT_SIGNING_KEY=prevSigning;
});
