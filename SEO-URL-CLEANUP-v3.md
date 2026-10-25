# DKF SEO URL Cleanup v3

Based on the supplied DKF SEO URL Cleanup v2 archive.

## Change

- Added `GET`/`HEAD` 301 redirect from `/home` and `/home/` to `https://digitalkidsfoundation.org/`.
- Route is before the legacy URL handling, static files, and final 404 handler.
- All other files and features are unchanged.

## Verify after deployment

`curl.exe -I https://digitalkidsfoundation.org/home/` should return 301 with `Location: https://digitalkidsfoundation.org/`.
`curl.exe -I https://digitalkidsfoundation.org/` should return 200.
`curl.exe -I https://digitalkidsfoundation.org/category/health/` should return 410.
`curl.exe -I https://digitalkidsfoundation.org/wp-json/` should return 404.

Test on staging first. Updating the ZIP alone does not update the live site; deploy the revised files to Coolify.
