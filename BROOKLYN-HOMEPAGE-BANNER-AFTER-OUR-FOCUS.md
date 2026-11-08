# DKF Homepage — Brooklyn Digital Access Banner After Our Focus

This patch updates the homepage to display the approved, photo-based Brooklyn Digital Access Initiative banner **after the full “Our Focus” section and before “How It Works”**. It preserves the existing DKF branding on the laptop and keeps the CTA as a real, clickable link to `/brooklyn-digital-access/`.

## Apply safely to your current GitHub repository

1. Make a backup or commit your current repository first.
2. Copy `public/images/dkf-brooklyn-focus-hero.webp` and all three files in `tools/` into the matching locations in your DKF repository.
3. From the DKF repo root, run: `node tools/apply-brooklyn-focus-banner.js`.
4. Review `git diff`, commit, and push; Coolify can deploy from GitHub as before.
5. Refresh the homepage and verify placement on desktop/mobile.

Only `index.html` and `public/index.html` are modified by the script. It does **not** modify the database, receipt system, admin credentials, donation forms, or any other pages. The script is idempotent after successful application and intentionally errors if it cannot identify the expected sections.

## Notes
- The banner continues to show 40–50 laptops as an **upcoming goal**, not secured inventory.
- The “Planning stage” visual pill is removed from this homepage section, as requested. The initiative remains upcoming; no application opening is implied.
- The illustration of children is AI-created and is labeled “Illustrative image”, not presented as photos of actual DKF beneficiaries.
- A real HTML link opens the initiative details. No action is performed on click apart from navigation.
- No live hosting changes are made by producing this ZIP.
