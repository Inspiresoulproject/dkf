#!/usr/bin/env node
/**
 * DKF homepage Stories section: high contrast, dark forest green.
 * Safe, focused, repeatable fix for public/index.html (the file served by Express).
 * Run from the root of the DKF Git repository: node apply-stories-fix.js
 */
const fs = require('fs');
const path = require('path');
const TARGETS = ['public/index.html', 'index.html'];
const START = '<!-- DKF STORIES CONTRAST FIX START -->';
const END = '<!-- DKF STORIES CONTRAST FIX END -->';
const STYLE = `${START}
<style id="dkf-stories-contrast-fix">
/* Deliberately scoped to the Stories section. Prevent older site rules from washing it out. */
section.dkf-stories-theme,
section.dkf-stories-theme.section-dark,
section.dkf-stories-theme.stories-section {
  background: #24361f !important;
  background-color: #24361f !important;
  background-image: none !important;
  color: #ffffff !important;
}
section.dkf-stories-theme .sh h2 {
  color: #ffffff !important;
  font-family: 'Playfair Display', Georgia, serif !important;
  font-size: clamp(2.05rem, 3.7vw, 3.15rem);
  font-weight: 700;
  line-height: 1.22;
  letter-spacing: -0.025em;
}
section.dkf-stories-theme .sh h2 .t-teal {
  color: #5da6a2 !important;
}
section.dkf-stories-theme .eyebrow {
  color: #5da6a2 !important;
  font-family: 'Lato', Arial, sans-serif !important;
  font-weight: 900;
  letter-spacing: .18em;
}
section.dkf-stories-theme .g3 { align-items: stretch; }
section.dkf-stories-theme .tcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 335px;
  padding: 2rem 2.1rem;
  background: #35472f !important;
  background-image: none !important;
  border: none !important;
  border-left: 4px solid #60a8a4 !important;
  border-radius: 24px;
  box-shadow: none;
  color: #ffffff !important;
}
section.dkf-stories-theme .tcard blockquote {
  margin: 0 0 1.5rem;
  color: #f6f6f0 !important;
  font-family: 'Playfair Display', Georgia, serif !important;
  font-size: clamp(.97rem, 1.05vw, 1.08rem);
  font-style: italic;
  font-weight: 600;
  line-height: 1.85;
}
section.dkf-stories-theme .tcard-auth {
  display: flex;
  align-items: center;
  gap: .8rem;
  margin-top: auto;
}
section.dkf-stories-theme .tcard-av {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #5ba5a1 !important;
  box-shadow: none;
  color: #ffffff !important;
  font-family: 'Lato', Arial, sans-serif !important;
  font-weight: 900;
}
section.dkf-stories-theme .tcard-name {
  color: #ffffff !important;
  font-family: 'Lato', Arial, sans-serif !important;
  font-weight: 900;
}
section.dkf-stories-theme .tcard-role {
  color: #c3cebf !important;
  font-family: 'Lato', Arial, sans-serif !important;
}
@media (max-width: 900px) {
  section.dkf-stories-theme .g3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 650px) {
  section.dkf-stories-theme .g3 { grid-template-columns: 1fr; }
  section.dkf-stories-theme .tcard { min-height: auto; padding: 1.65rem; }
}
</style>
${END}`;
function patch(original) {
  let html = original;
  // Remove a prior instance of this same hotfix, so applying twice never duplicates it.
  const existing = html.indexOf(START);
  if (existing !== -1) {
    const to = html.indexOf(END, existing);
    if (to === -1) throw new Error('Found partial Stories fix block; refusing to edit.');
    html = html.slice(0, existing) + html.slice(to + END.length).replace(/^\r?\n/, '');
  }
  const anchor = html.indexOf('<!-- Testimonials -->');
  const phrase = html.indexOf('What a laptop');
  if (anchor < 0 || phrase < anchor) throw new Error('Cannot find expected homepage Stories section; refusing to alter other sections.');
  const start = html.indexOf('<section', anchor);
  const openEnd = html.indexOf('>', start);
  if (start < 0 || openEnd < 0 || phrase < openEnd) throw new Error('Unexpected Stories section markup.');
  let opening = html.slice(start, openEnd + 1);
  if (!opening.includes('class=')) {
    opening = opening.replace('<section', '<section class="dkf-stories-theme"');
  } else {
    opening = opening.replace(/class=["']([^"']*)["']/, (_, current) => `class="${current.includes('dkf-stories-theme') ? current : current + ' dkf-stories-theme'}"`);
  }
  // Inline fallback keeps dark section readable even if an older stylesheet wins in the cascade.
  if (!opening.includes('background:#24361f!important')) {
    if (!opening.includes('style=')) opening = opening.replace(/>$/, ' style="background:#24361f!important;color:#fff!important;">');
    else opening = opening.replace(/style=["']([^"']*)["']/, (_, existingStyles) => `style="${existingStyles};background:#24361f!important;color:#fff!important;"`);
  }
  html = html.slice(0, start) + opening + html.slice(openEnd + 1);
  const updatedAnchor = html.indexOf('<!-- Testimonials -->');
  html = html.slice(0, updatedAnchor) + STYLE + '\n' + html.slice(updatedAnchor);
  return html;
}
let count = 0;
for (const rel of TARGETS) {
  const filename = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(filename)) continue;
  const original = fs.readFileSync(filename, 'utf8');
  const html = patch(original);
  fs.writeFileSync(filename, html, 'utf8');
  count += 1;
  console.log('Updated:', rel);
}
if (!count) {
  console.error('No homepage index found. Run from the DKF repository root.');
  process.exitCode = 1;
}
