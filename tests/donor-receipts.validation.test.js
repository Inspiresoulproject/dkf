'use strict';
// Dependency-free validation smoke tests, with stubs for runtime-only integrations.
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='express')return {Router:()=>({use(){},get(){},post(){},patch(){}})};
  if(request==='pg')return {Pool:class {}};
  if(request==='pdfkit')return class {};
  if(request==='./dkf-access-auth')return {verifyAdmin:(req,res,next)=>next()};
  return original.call(this,request,parent,isMain);
};
const {validate}=require('../donor-receipts');
Module._load=original;
const sample={donor_name:'Michael',donor_email:'test@test.com',document_type:'receipt',donation_type:'laptop',donation_date:'2026-11-07',quantity:'23',description:'23 laptops',consideration_type:'none'};
let valid=validate(sample);
assert.equal(valid.quantity,23);
assert.equal(valid.donor_email,'test@test.com');
assert.equal(valid.monetary_amount,null);
assert.throws(()=>validate({...sample,quantity:'1'}),/Description mentions 23 devices but quantity is 1/);
assert.throws(()=>validate({...sample,donation_date:'2026-02-30'}),/valid donation date/);
assert.throws(()=>validate({...sample,donor_email:'wrong'}),/Valid donor email/);
assert.throws(()=>validate({...sample,donation_type:'unknown'}),/Invalid donation type/);
assert.throws(()=>validate({...sample,consideration_type:'provided',consideration_value:''}),/goods\/services/);
valid=validate({...sample,document_type:'acknowledgment_letter',donation_type:'monetary',quantity:null,description:'Fundraiser gift',monetary_amount:'100.50'});
assert.equal(valid.monetary_amount,100.50);
assert.equal(valid.quantity,null);
assert.throws(()=>validate({...sample,monetary_amount:'500'}),/Do not value in-kind/);
console.log('PASS: 10 donation validation checks');
