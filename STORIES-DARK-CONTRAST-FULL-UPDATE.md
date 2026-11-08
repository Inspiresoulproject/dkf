# Digital Kids Foundation — Full Website Release / Stories Contrast Fix

This complete website package is based on the last DKF Stories Dark Green Design Full release and includes the later targeted contrast correction.

## Confirmed changes
- Stories section: permanent dark forest-green background (#24361f), white heading and quotes, olive cards, teal borders, light-colored author names.
- Playfair Display headings and Lato body text remain on the public homepage and the Brooklyn Digital Access Initiative page.
- The Brooklyn Digital Access Initiative keeps its 40–50-laptop target and links for Donate Laptops and Become a Partner.
- Existing donor receipt/backend/admin files are retained.

## Deployment precautions
- Do not overwrite uncommitted or newer live-repository changes with an older ZIP without reviewing the diff.
- For a repository that has advanced since the prior full release, prefer the separate targeted hotfix from DKF_Stories_Contrast_Fix_Patch.zip, or cherry-pick the homepage changes rather than replacing everything.
- Apply this archive to a staging deployment, check the homepage Stories section, Initiative page, forms, and admin tools, then deploy with Coolify.
- No live site or database has been changed by creating this ZIP.
