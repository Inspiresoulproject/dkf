'use strict';
/**
 * Apply the Brooklyn Digital Access Initiative homepage link/announcement to an existing DKF repo.
 * Idempotent and deliberately does not change backend or existing donation records.
 * Run from repo root: node tools/apply-brooklyn-initiative.js
 */
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(__dirname, 'brooklyn-announcement.css'), 'utf8');
const banner = fs.readFileSync(path.join(__dirname, 'brooklyn-announcement.html'), 'utf8');
const replacements = [
  {
    description: 'desktop navigation',
    from: `<li><a data-page="involved" href="#" onclick="go('involved');return false">Get Involved</a></li>`,
    to: `<li><a data-page="involved" href="#" onclick="go('involved');return false">Get Involved</a></li>\n<li><a href="/brooklyn-digital-access/">Brooklyn Initiative</a></li>`
  },
  {
    description: 'mobile navigation',
    from: `<a href="#" onclick="go('involved');closeMob();return false">Get Involved</a>`,
    to: `<a href="#" onclick="go('involved');closeMob();return false">Get Involved</a>\n<a href="/brooklyn-digital-access/">Brooklyn Initiative</a>`
  }
];
function applyHome(file) {
  if (!fs.existsSync(file)) throw Error(`Missing home page: ${file}`);
  let s = fs.readFileSync(file,'utf8');
  if (s.includes('<!-- Upcoming Brooklyn Digital Access Initiative:')) {
    console.log('Already contains initiative:', path.relative(repo,file));
    return;
  }
  // Validate all anchors before mutating to avoid partially updating a changed version.
  for(const r of replacements) if(!s.includes(r.from)) throw Error(`Could not find ${r.description} anchor in ${file}; please inspect it manually.`);
  if(!s.includes('<!-- Marquee -->') || !s.includes('</head>')) throw Error(`Could not find head or marquee anchor in ${file}`);
  s = s.replace('</head>',`<style>\n${css}\n</style>\n</head>`);
  for(const r of replacements) s = s.replace(r.from,r.to);
  s = s.replace('<!-- Marquee -->', banner + '<!-- Marquee -->');
  const foot = `<li><a href="#" onclick="go('about');return false">About Us</a></li><li><a href="#" onclick="go('involved');return false">Get Involved</a></li>`;
  if(s.includes(foot)) s=s.replace(foot, foot+`<li><a href="/brooklyn-digital-access/">Brooklyn Initiative</a></li>`);
  fs.writeFileSync(file,s);
  console.log('Updated',path.relative(repo,file));
}
function applySitemap(file) {
  if (!fs.existsSync(file)) throw Error(`Missing sitemap: ${file}`);
  let s=fs.readFileSync(file,'utf8');
  if(s.includes('brooklyn-digital-access')){console.log('Already contains initiative:',path.relative(repo,file));return;}
  if(!s.includes('</urlset>'))throw Error(`Invalid sitemap: ${file}`);
  const entry=`  <url>\n    <loc>https://digitalkidsfoundation.org/brooklyn-digital-access/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  fs.writeFileSync(file,s.replace('</urlset>',entry+'</urlset>'));
  console.log('Updated',path.relative(repo,file));
}
const page=path.join(repo,'public/brooklyn-digital-access/index.html');
const logo=path.join(repo,'public/images/dkf-brooklyn-logo.png');
if(!fs.existsSync(page) || !fs.existsSync(logo)) throw Error('Copy page and logo files into public/ before running this script');
// Prevalidate page anchors before applying.
for (const file of [path.join(repo,'public/index.html'),path.join(repo,'index.html')]) {
  const s=fs.readFileSync(file,'utf8');
  if(!s.includes('<!-- Upcoming Brooklyn Digital Access Initiative:')) {
    for(const r of replacements) if(!s.includes(r.from)) throw Error(`Missing ${r.description} in ${file}`);
    if(!s.includes('<!-- Marquee -->') || !s.includes('</head>'))throw Error(`Missing page anchors in ${file}`);
  }
}
applyHome(path.join(repo,'public/index.html'));
applyHome(path.join(repo,'index.html'));
applySitemap(path.join(repo,'public/sitemap.xml'));
applySitemap(path.join(repo,'sitemap.xml'));
console.log('Brooklyn Digital Access Initiative: 40–50 laptop target, ready for review/deployment.');
