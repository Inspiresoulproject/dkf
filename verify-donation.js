
'use strict';
(() => {
  const input=document.getElementById('localPdf');
  const result=document.getElementById('pdfCheckResult');
  const sha=document.getElementById('pdfExpectedSha')?.dataset.sha256;
  if(!input||!sha)return;
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];if(!file)return;
    if(!file.name.toLowerCase().endsWith('.pdf')){result.textContent='Choose a PDF file.';return;}
    if(file.size>25*1024*1024){result.textContent='File too large to check here (25 MB limit).';return;}
    if(!globalThis.crypto?.subtle){result.textContent='File checking needs a secure browser (HTTPS).';return;}
    result.textContent='Checking this file locally...';
    try{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      const got=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      result.textContent=got===sha?'MATCH: This is the exact PDF file stored by DKF.':'DOES NOT MATCH: This PDF file differs from the issued DKF original. Do not rely on it.';
      result.style.color=got===sha?'#186947':'#a23e25';
    }catch(e){result.textContent='Unable to check this file in your browser.';}
  });
})();
