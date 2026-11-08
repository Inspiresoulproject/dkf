# Brooklyn Digital Access Initiative — 40–50 laptop target

## Summary
This update adds a permanent public page at `/brooklyn-digital-access/` and links to it from the DKF homepage, desktop/mobile navigation, and the homepage footer.

Program goal: **40–50 laptops** for the planned Brooklyn first pilot. The page deliberately describes this as a *target*, not a confirmed quantity received or distributed.

## Public-facing guardrails
- Status: **Planning and partner outreach**.
- **Applications for this initiative are not yet open**.
- No confirmed partners, donations, dates, or recipients are claimed.
- Corporate donors and community partners can inquire at `help@digitalkidsfoundation.org` through pre-addressed mail links.
- Donation acknowledgment will follow verification of actual property received, rather than a promised tax value.
- Guardian participation and privacy are noted for future application screening.

## Deployment
Use existing DKF deployment flow with Coolify/GitHub; no database migration, API credentials, or environment-variable changes are required.

For the small patch ZIP (recommended if your live repo has newer changes):
1. Extract `DKF/` into a working clone of your repository. This adds the new page, DKF logo and the `tools` script without replacing your existing homepage or backend.
2. Run `node tools/apply-brooklyn-initiative.js` from the repository root.
3. Review `git diff` and commit only the intended changes.
4. Push the branch deployed by Coolify.

The script safely adds the homepage announcement, navigation links, and sitemap entries. It can be run more than once.

Do not overwrite `.env` or your production database. The full project ZIP additionally contains the previously developed donor-receipt security V2 code; review Git diff if your live repository has changed since that version.

## Post-deploy checks
1. Visit `https://digitalkidsfoundation.org/brooklyn-digital-access/` on desktop and mobile.
2. Confirm “40–50 laptops” appears and there is no claim that 40–50 have already been donated.
3. Test both `mailto:` buttons with a configured email app.
4. Confirm `https://digitalkidsfoundation.org/` homepage, navigation, applications, and donor admin still work.
5. Confirm the sitemap includes the new public page.
6. Check that donors understand there is **no confirmed application opening date**.

Note: The site is not deployed by this file creation. Publishing still requires GitHub/Coolify deployment.
