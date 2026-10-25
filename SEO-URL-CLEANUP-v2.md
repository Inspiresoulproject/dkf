# DKF SEO URL Cleanup v2

Based on DKF Security & SEO Update v1.

- `/about-us/` -> 301 `/#about` (opens About view in existing single-page app).
- `/faq/` -> 301 `/#faq` (opens FAQ view).
- Eleven retired WordPress-style URLs -> 410 Gone.
- Unknown URLs -> 404 instead of homepage 200.
- Donation success URL -> noindex via X-Robots-Tag.
- Existing APIs, email verification, and form handlers remain before routing rules.

## Test in staging before deploying

Run `curl.exe -I` against `/`, `/about-us/`, `/faq/`, `/category/health/`, `/tag/t-shirt/`, `/not-a-real-page/`, `/donation-success`, `/robots.txt`, `/sitemap.xml`, and `/api/verification-config`.

Expected: 200, 301, 301, 410, 410, 404, 200 with noindex, 200, 200, 200. Test the About/FAQ navigation in a browser and complete a volunteer verification and donation flow.

The `/#about` and `/#faq` destinations are browser-side views, not independently indexable pages. Dedicated SEO pages are a separate future enhancement.

If you use Nginx independently of Node, its `try_files ... /index.html` fallback must also be removed; the Dockerfile in this package runs Express directly.

Do not overwrite production until staging checks pass.
