# DKF Section Spacing Update — November 8, 2026

This release reduces vertical whitespace while retaining the DKF site design, section order, working Donate Laptop / Become a Partner navigation, and dark-green Stories section.

Changes:
- Homepage: non-hero main sections reduced from the large 90–110px layout to ~68px vertical spacing on desktop, 54px on tablets, and 36px on small phones.
- Homepage announcement: reduced to 25px top/bottom desktop and 20px mobile.
- The gap below section headings reduced to 2.1rem desktop / 1.55rem mobile.
- Initiative page: main sections reduced to 68px desktop, 58px tablet, and 46px mobile; its hero, stat bar, and closing section were also tightened.
- No change to donor receipt logic, database, forms, administration, or content.

Updated files:
- public/index.html
- index.html
- public/brooklyn-digital-access/index.html

The CSS is added in a separate style block near the end of each page's head for easy future tuning.

Deployment: replace site files using the latest repository as the source of truth, review diffs, then deploy via Coolify. Refresh browser with Ctrl+Shift+R after deployment. Test mobile and laptop applications before sharing new links.
