# Contact Us Mobile Layout Fix v4

## Root cause
Coolify runs `server.js`, and Express serves `public/index.html`. Earlier responsive changes existed mainly in the separate root `index.html`, while the served `public/index.html` still contained an inline two-column grid.

## Changes
- Updated both `public/index.html` and root `index.html`.
- Replaced the Contact page's inline grid with `.dkf-contact-layout`.
- Added `.dkf-contact-sidebar` only to the Contact Information sidebar.
- Forced a single-column layout at widths up to 900px.
- Preserved Cloudflare Turnstile and the existing form submission code.
- Preserved the desktop two-column layout.

## Verification
Rendered at a 397 × 678 CSS viewport using Chromium DevTools Protocol:
- Document scroll width: 397px
- Contact layout width: 365px
- Contact form width: 365px
- Contact sidebar width: 365px
- Sidebar begins below the form, not beside it

Deployment marker in the served page:
`data-contact-layout-version="v4"`
