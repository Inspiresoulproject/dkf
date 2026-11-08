#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const old = "if (section === 'about' || section === 'faq') go(section);";
const newer = `if (['about','faq','donate','contact','donate-device','contact-partner'].includes(section)) {
    const page = section === 'donate-device' ? 'donate' : (section === 'contact-partner' ? 'contact' : section);
    go(page);
    if (section === 'donate-device') switchDonate('device');
    if (section === 'contact-partner') {
      const subject = document.querySelector('#pg-contact select[name="subject"]');
      if (subject) subject.value = 'Corporate / School Partnership';
    }
  }`;
for (const f of ['index.html','public/index.html']) {
  const file = path.join(root,f);
  if (!fs.existsSync(file)) throw new Error(`Missing homepage: ${file}`);
  const input = fs.readFileSync(file,'utf8');
  const occurrences = input.split(old).length-1;
  if (occurrences === 2) {
    fs.writeFileSync(file,input.split(old).join(newer));
    console.log(`Updated deep links: ${f}`);
  } else if (input.includes("'contact-partner'") && input.includes("'donate-device'")) {
    console.log(`Already supports deep links: ${f}`);
  } else {
    throw new Error(`Unexpected homepage navigation structure in ${f}; left unchanged. Compare with the supplied full version.`);
  }
}
console.log('Test from Initiative page: /#donate-device and /#contact-partner');
