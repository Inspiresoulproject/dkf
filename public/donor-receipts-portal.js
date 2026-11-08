'use strict';
/* Embedded Donor Receipts tab in the DKF laptop administrator portal. */
(() => {
  const $ = id => document.getElementById(id);
  const API = '/api/laptops/admin/donor-receipts';
  const ids = ['donorDocumentType','donorDonationType','donorName','donorEmail','donorDate','donorQuantity','donorAmount','donorDescription','donorBenefitType','donorBenefitDescription','donorBenefitValue'];
  let current = null;
  let previewUrl = null;
  let previewed = false;
  let dirty = false;
  let busy = false;
  const labels = {laptop:'Laptop',desktop:'Desktop',tablet:'Tablet',accessories:'Accessories',other_equipment:'Other equipment',monetary:'Monetary',other:'Other property'};
  const today = () => {const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10);};
  const displayDate = value => value ? new Date(value).toLocaleString() : '—';
  const labelStatus = s => ({draft:'Draft',sending:'Sending',sent:'Sent — accepted by provider',needs_review:'Check email delivery'})[s] || s;
  const notify = (message, isError=false) => {const e=$('donorNotice'); e.textContent=message; e.classList.toggle('error',isError);};
  const show = (id,visible) => $(id).classList.toggle('donor-hidden',!visible);

  async function request(url,method='GET',payload) {
    const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error || `Request failed (${response.status})`);
    return result;
  }
  function clearPreview() {
    previewed=false;
    $('donorReviewed').checked=false;
    $('donorReceived').checked=false;
    $('donorPdf').removeAttribute('src');
    show('donorPdf',false);
    show('donorPdfEmpty',true);
    show('donorPdfLink',false);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl=null;
    updateControls();
  }
  function changeFields() {
    const cash = $('donorDonationType').value === 'monetary';
    show('donorQuantityBox',!cash);
    show('donorAmountBox',cash);
    $('donorAmount').required=cash;
    $('donorQuantity').required=!cash;
    const provided=$('donorBenefitType').value === 'provided';
    show('donorBenefitExtra',provided);
    $('donorBenefitDescription').required=provided;
    $('donorBenefitValue').required=provided;
  }
  function data() {return {
    document_type:$('donorDocumentType').value,donation_type:$('donorDonationType').value,
    donor_name:$('donorName').value,donor_email:$('donorEmail').value,donation_date:$('donorDate').value,
    quantity:$('donorDonationType').value==='monetary'?null:$('donorQuantity').value,monetary_amount:$('donorDonationType').value==='monetary'?$('donorAmount').value:null,
    description:$('donorDescription').value,consideration_type:$('donorBenefitType').value,
    consideration_description:$('donorBenefitDescription').value,consideration_value:$('donorBenefitValue').value
  };}
  function fill(r) {
    const vals = {
      donorDocumentType:r.document_type,donorDonationType:r.donation_type,donorName:r.donor_name,donorEmail:r.donor_email,
      donorDate:String(r.donation_date || '').slice(0,10),donorQuantity:r.quantity,
      donorAmount:r.monetary_amount,donorDescription:r.description,donorBenefitType:r.consideration_type,
      donorBenefitDescription:r.consideration_description,donorBenefitValue:r.consideration_value
    };
    for(const id of ids) $(id).value=vals[id] == null ? '' : String(vals[id]);
    changeFields(); dirty=false;
  }
  function updateControls() {
    const locked=!!current && current.status!=='draft';
    const lockedByRequest=locked || busy;
    $('donorSave').disabled=lockedByRequest;
    $('donorPreview').disabled=busy || (locked && current?.status!=='sent');
    $('donorNew').disabled=busy;
    $('donorRefresh').disabled=busy;
    $('donorSend').disabled=busy || locked || !previewed || dirty || !$('donorReceived').checked || !$('donorReviewed').checked;
    for(const id of ids)$(id).disabled=lockedByRequest;
    $('donorState').textContent = current ? `${current.reference} · ${labelStatus(current.status)}` : 'New draft';
    $('donorFormHeading').textContent = current ? `${current.reference} · ${labelStatus(current.status)}` : 'Create receipt draft';
    if(current?.status==='needs_review')$('donorPdfEmpty').textContent='Delivery acceptance was not confirmed. Contact the administrator to check Resend logs before any manual follow-up. This receipt cannot be resent automatically.';
    else $('donorPdfEmpty').textContent='Save a draft to generate the PDF using the approved Digital Kids Foundation receipt design.';
  }
  function validForm() {
    changeFields();
    if(!$('donorForm').checkValidity()){$('donorForm').reportValidity();return false;}
    return true;
  }
  async function saveDraft() {
    if(!validForm()) return false;
    if(current && current.status!=='draft')throw Error('Only unsent drafts can be edited. Select New to make another record.');
    const body=data();
    const result=await request(current ? `${API}/${current.id}` : API,current?'PATCH':'POST',body);
    current=result;dirty=false;clearPreview();updateControls();
    notify(`${result.reference} saved as a draft. Select Generate / Review PDF before sending.`);
    await history().catch(err=>notify(err.message,true));
    return true;
  }
  async function preview() {
    if(busy)return;
    busy=true;updateControls();
    try {
      // Force a newly saved draft for every revision before PDF review.
      if(!current || (current.status==='draft' && dirty)) {
        if(!await saveDraft())return;
      }
      if(!current) return;
      const response=await fetch(`${API}/${current.id}/pdf`,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok){const problem=await response.json().catch(()=>({}));throw Error(problem.error||'Unable to preview PDF');}
      const data=await response.blob();
      clearPreview();
      previewUrl=URL.createObjectURL(data);
      $('donorPdf').src=previewUrl;
      show('donorPdf',true);
      show('donorPdfEmpty',false);
      const link=$('donorPdfLink');link.href=`${API}/${current.id}/pdf`;show('donorPdfLink',true);
      previewed=current.status==='draft';
      notify(`${current.reference}: PDF loaded. Verify every field and then check both confirmations to enable sending.`);
    } catch(e){notify(e.message,true);} finally {busy=false;updateControls();}
  }
  async function history() {
    const rows=await request(API);
    const target=$('donorHistory');target.replaceChildren();
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='No donor receipts yet.';tr.append(td);target.append(tr);return;}
    for(const r of rows) {
      const tr=document.createElement('tr');
      const vals=[r.reference,r.donor_name,r.document_type==='receipt'?'Donation receipt':'Acknowledgment letter',labels[r.donation_type]||r.donation_type,labelStatus(r.status),displayDate(r.sent_at)];
      for(const v of vals){const td=document.createElement('td');td.textContent=String(v??'');tr.append(td);}
      const td=document.createElement('td');
      const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='Open';b.addEventListener('click',()=>openReceipt(r.id));td.append(b);
      tr.append(td);target.append(tr);
    }
  }
  async function openReceipt(id) {
    if(busy)return;
    busy=true;updateControls();
    try{
      current=await request(`${API}/${id}`);
      fill(current);clearPreview();updateControls();
      if(current.status==='sent'){
        // Only issued documents are accessible as final PDFs; they are read-only.
        const response=await fetch(`${API}/${id}/pdf`,{credentials:'same-origin',cache:'no-store'});
        if(response.ok){previewUrl=URL.createObjectURL(await response.blob());$('donorPdf').src=previewUrl;show('donorPdf',true);show('donorPdfEmpty',false);$('donorPdfLink').href=`${API}/${id}/pdf`;show('donorPdfLink',true);}
      }
      notify(current.status==='sent'?`${current.reference}: email accepted by Resend, ${current.sent_at ? displayDate(current.sent_at) : ''}. Provider acceptance does not prove inbox delivery.`:`${current.reference} loaded. Review or update this draft as needed.`);
    }catch(e){notify(e.message,true);}finally{busy=false;updateControls();}
  }
  function newDraft() {
    current=null;dirty=false;$('donorForm').reset();$('donorDate').value=today();changeFields();clearPreview();updateControls();
    notify('New donor receipt draft. Enter the details, save, and review the PDF before emailing.');
  }
  async function send() {
    if(!current || current.status!=='draft' || !previewed || dirty || !$('donorReceived').checked || !$('donorReviewed').checked || busy)return;
    if(!confirm(`SEND FINAL PDF ${current.reference} to ${current.donor_email}?\n\nThis email cannot be recalled. Confirm the donation was received and the PDF is correct.`)) return;
    busy=true;updateControls();
    try{
      const result=await request(`${API}/${current.id}/send`,'POST',{confirmedReceived:true,confirmedPreview:true,expectedUpdatedAt:current.updated_at});
      current=await request(`${API}/${current.id}`);
      clearPreview();updateControls();await history();
      notify(`${result.reference}: email accepted by Resend for ${result.recipient}. Verify delivery in Resend if necessary.`);
    }catch(e){notify(e.message,true);if(current)current=await request(`${API}/${current.id}`).catch(()=>current);updateControls();await history().catch(()=>{});}
    finally{busy=false;updateControls();}
  }
  for(const id of ids){$(id).addEventListener('input',()=>{dirty=true;clearPreview();changeFields();updateControls();});}
  $('donorForm').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;updateControls();try{await saveDraft();}catch(err){notify(err.message,true);}finally{busy=false;updateControls();}});
  $('donorPreview').addEventListener('click',preview);
  $('donorSend').addEventListener('click',send);
  $('donorNew').addEventListener('click',newDraft);
  $('donorRefresh').addEventListener('click',()=>history().then(()=>notify('Receipt history refreshed.')).catch(err=>notify(err.message,true)));
  $('donorReceived').addEventListener('change',updateControls);
  $('donorReviewed').addEventListener('change',updateControls);
  newDraft();
  (async()=>{try{await request('/api/laptops/admin/me');await history();notify('Receipt history loaded. Only DKF administrators can create or send receipts.');}catch(e){notify('Unable to access donor receipt records: '+e.message,true);}})();
})();
