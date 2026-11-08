#!/usr/bin/env node
'use strict';
// Replace existing Brooklyn announcement and move it below the completed Our Focus section.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(__dirname,'brooklyn-focus-banner.html'),'utf8').trim();
const css=fs.readFileSync(path.join(__dirname,'brooklyn-focus-banner.css'),'utf8').trim();
const oldIntro='/* Brooklyn Digital Access Initiative - homepage feature */';
const newIntro='/* Brooklyn Digital Access Initiative — homepage feature, directly after Our Focus */';
const newMarker='<!-- Upcoming Brooklyn Digital Access Initiative — placed directly after Our Focus -->';
const oldMarker='<!-- Upcoming Brooklyn Digital Access Initiative: planning announcement, not a report of laptops distributed -->';
const target='<!-- Process -->';
const change = file => {
  let s=fs.readFileSync(file,'utf8');
  if(!s.includes(target))throw new Error(`Missing process anchor in ${file}`);
  const focus=s.indexOf('<p class="eyebrow">Our Focus</p>');
  if(focus<0)throw new Error(`Missing Our Focus section in ${file}`);
  if(s.includes(newMarker) && s.indexOf(newMarker)>focus && s.indexOf(newMarker)<s.indexOf(target)){
    console.log(`Already updated: ${path.relative(root,file)}`);return;
  }
  // First remove the old banner; only replace the known section so unrelated code stays intact.
  const from=s.includes(oldMarker)?oldMarker : (s.includes(newMarker)?newMarker:null);
  if(!from)throw new Error(`Missing expected Brooklyn banner in ${file}`);
  const first=s.indexOf(from);
  const secEnd=s.indexOf('</section>',first);
  if(secEnd<0)throw new Error(`Could not identify Brooklyn section end in ${file}`);
  s=s.slice(0,first)+s.slice(secEnd+'</section>'.length).replace(/^\s*\n/,'\n');
  // Insert new section directly after the Our Focus section, before How It Works.
  const i=s.indexOf(target);
  const pos=s.lastIndexOf('</section>',i);
  const f=s.indexOf('<p class="eyebrow">Our Focus</p>');
  if(pos<0 || !(f<pos && pos<i) || s.slice(pos+'</section>'.length,i).trim()!==''){
    throw new Error(`Our Focus does not directly precede How It Works in ${file}`);
  }
  s=s.slice(0,i)+html+'\n'+s.slice(i);
  // Swap only the Brooklyn CSS block, keeping other homepage styles unchanged.
  let cssStart=s.indexOf(oldIntro);
  if(cssStart<0) cssStart=s.indexOf(newIntro);
  if(cssStart<0)throw new Error(`Cannot identify Brooklyn CSS block in ${file}`);
  const start=s.lastIndexOf('<style>',cssStart);
  const end=s.indexOf('</style>',cssStart);
  if(start<0 || end<0)throw new Error(`Broken Brooklyn style block in ${file}`);
  s=s.slice(0,start)+'<style>\n'+css+'\n</style>'+s.slice(end+'</style>'.length);
  fs.writeFileSync(file,s,'utf8');
  console.log(`Updated: ${path.relative(root,file)}`);
};
const visual=path.join(root,'public','images','dkf-brooklyn-focus-hero.webp');
if(!fs.existsSync(visual))throw new Error('Missing public/images/dkf-brooklyn-focus-hero.webp; copy image first.');
for(const file of [path.join(root,'index.html'),path.join(root,'public','index.html')]) change(file);
console.log('Banner is now below Our Focus; live link: /brooklyn-digital-access/');
