# DKF Mobile Polish and Performance Update

Updated both `public/index.html` (served by Express/Coolify) and the root fallback `index.html`.

## Changes
- Replaced “Underprivileged Kids” with “Children in Need” and aligned the mission text with DKF’s approved wording.
- Made FAQ category filters horizontally scrollable with 44px minimum tap targets.
- Increased effective tap areas for FAQ controls and compact-footer links without making the footer bulky.
- Reduced mobile hero and section spacing to shorten the homepage.
- Tightened Volunteer form spacing on mobile.
- Updated the footer copyright year to 2026.
- Extracted embedded images from the large HTML documents into `public/images/`, reducing HTML transfer and parse cost.
- Added image preloads for the mobile header logo and homepage hero image.

Forms, Cloudflare Turnstile, Google Tag Manager, GA4 events, and desktop layouts were not changed.
