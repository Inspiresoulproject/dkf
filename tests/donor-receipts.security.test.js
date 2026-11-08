'use strict';
/** Offline security regression tests. Uses fake database and fake PDF renderer; no real emails. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const EventEmitter=require('node:events');
const routes={get:new Map(),post:new Map()};
const originalLoad=Module._load;
const originalKey=process.env.DKF_RECEIPT_SIGNING_KEY;
process.env.DKF_RECEIPT_SIGNING_KEY='ab'.repeat(32);
const row={
  id:42,reference:'DKF-2026-000042',verification_code:'a1b2c3d4e5f60123456789abcdef0123',
  donor_name:'Sample <Business>',donor_email:'private@example.test',document_type:'receipt',
  donation_type:'laptop',quantity:2,donation_date:'2026-11-07',description:'2 Dell laptops',
  consideration_type:'none',consideration_description:null,consideration_value:null,monetary_amount:null,
  status:'sent',issued_pdf:Buffer.from('%PDF-1.7 sample'),issued_pdf_sha256:null,verification_seal:null,
  revoked_at:null,updated_at:new Date('2026-11-08T01:00:00Z')
};
let qrUrls=[];
class StubPDF extends EventEmitter {
  constructor(){super();this.y=100;}
  rect(){return this;}roundedRect(){return this;}fill(){return this;}
  font(){return this;}fontSize(){return this;}fillColor(){return this;}
  text(){return this;}image(){return this;}moveTo(){return this;}
  lineTo(){return this;}strokeColor(){return this;}stroke(){return this;}
  save(){return this;}opacity(){return this;}rotate(){return this;}restore(){return this;}
  heightOfString(){return 14;}addPage(){return this;}
  end(){process.nextTick(()=>{this.emit('data',Buffer.from('%PDF stub'));this.emit('end');});}
}
const fakeRouter={
  use(){},get(name,...handlers){routes.get.set(name,handlers.at(-1));},
  post(name,...handlers){routes.post.set(name,handlers.at(-1));},patch(){}
};
class FakePool {
  async query(sql,params){
    if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rowCount:0,rows:[]};
    if(sql.includes('SELECT * FROM dkf_donor_receipts WHERE reference=')){
      const match=params[0]===row.reference&&params[1]===row.verification_code;
      return {rowCount:match?1:0,rows:match?[{...row}]:[]};
    }
    if(sql.includes('SET revoked_at=NOW()')){
      if(row.status!=='sent'||row.revoked_at||params[3]!==row.reference)return {rowCount:0,rows:[]};
      row.revoked_at=new Date();return {rowCount:1,rows:[{id:row.id,reference:row.reference}]};
    }
    if(sql.includes('INSERT INTO dkf_receipt_audit'))return {rowCount:1,rows:[]};
    throw Error('Unexpected SQL in security test '+sql.slice(0,130));
  }
}
Module._load=function(name,parent,isMain){
  if(name==='express')return {Router:()=>fakeRouter};
  if(name==='pg')return {Pool:FakePool};
  if(name==='pdfkit')return StubPDF;
  if(name==='qrcode')return {toBuffer:async(url)=>{qrUrls.push(url);return Buffer.from('fake-png');}};
  if(name==='./dkf-access-auth')return {verifyAdmin:(_req,_res,next)=>next()};
  return originalLoad.call(this,name,parent,isMain);
};
let mod;
try{mod=require('../donor-receipts');}finally{Module._load=originalLoad;}
function res(){return {statusCode:200,headers:{},body:null,status(code){this.statusCode=code;return this;},type(t){this.headers['content-type']=t;return this;},set(k,v){this.headers[k]=v;return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;}};}
(async()=>{
  assert.equal(mod.sealReceipt(row).length,64);
  row.verification_seal=mod.sealReceipt(row);
  row.issued_pdf_sha256=crypto.createHash('sha256').update(row.issued_pdf).digest('hex');
  assert.equal(mod.sealedRowValid(row),true);
  assert.equal(mod.sealedRowValid({...row,quantity:9}),false,'tampered donation details invalid');
  assert.equal(mod.sealedRowValid({...row,issued_pdf:Buffer.from('tampered')}),false,'tampered stored PDF invalid');
  assert.equal(mod.sealedRowValid({...row,verification_seal:'bad'}),false,'invalid HMAC invalid');
  const pdf=await mod.receiptPdf(row,false);
  assert.ok(pdf.length>0);
  assert.equal(qrUrls.at(-1),`https://digitalkidsfoundation.org/verify-donation/${row.reference}?code=${row.verification_code}`);
  const handler=routes.get.get('/verify-donation/:reference');
  assert.ok(handler,'public verification route must be registered');
  const req={params:{reference:row.reference},query:{code:row.verification_code},ip:'127.0.0.1'};
  let out=res();await handler(req,out);
  assert.match(out.body,/Verified DKF document/);
  assert.match(out.body,/Sample &lt;Business&gt;/,'public output escapes HTML');
  assert.doesNotMatch(out.body,/private@example.test/,'must not leak donor email');
  assert.match(out.body,/Choose PDF to check/);
  assert.match(out.body,/data-sha256="[a-f0-9]{64}"/);
  out=res();await handler({...req,query:{code:'0'.repeat(32)}},out);
  assert.match(out.body,/Not verified/);
  row.quantity=7;
  out=res();await handler(req,out);
  assert.match(out.body,/Not verified/,'tampered record never displays verified');
  row.quantity=2;
  row.status='draft';out=res();await handler(req,out);assert.match(out.body,/Not verified/,'unissued draft cannot verify');
  row.status='sent';
  const revoke=routes.post.get('/api/laptops/admin/donor-receipts/:id/revoke');
  assert.ok(revoke);
  out=res();await revoke({params:{id:row.id},body:{reference:row.reference,reason:'Issued to the wrong donor'},dkfAdminEmail:'security-admin@example.test'},out);
  assert.equal(out.body.status,'revoked');
  assert.ok(row.revoked_at);
  out=res();await handler(req,out);
  assert.match(out.body,/Receipt revoked/);
  assert.doesNotMatch(out.body,/Choose PDF to check/);
  out=res();await revoke({params:{id:row.id},body:{reference:row.reference,reason:'Issued to the wrong donor'},dkfAdminEmail:'security-admin@example.test'},out);
  assert.equal(out.statusCode,409,'revocation cannot be repeated');
  console.log('PASS: HMAC, PDF digest, QR URL, public verification, privacy, rejection, and revocation checks');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  if(originalKey===undefined)delete process.env.DKF_RECEIPT_SIGNING_KEY;else process.env.DKF_RECEIPT_SIGNING_KEY=originalKey;
});
