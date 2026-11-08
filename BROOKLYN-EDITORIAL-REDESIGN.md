# Brooklyn Digital Access Initiative — Editorial Redesign

This update redesigns only the public Initiative page and adds support for direct links into the existing DKF homepage's Donate and Contact sections.

## Design decisions
- Classic editorial design: DM Serif Display headings, Inter body, restrained forest-green/gold palette, generous spacing, human-centered storytelling.
- Existing approved DKF branding retained. Image reused from previous DKF banner and cropped to focus on the students; it is clearly labeled an illustrative image, **not** an actual DKF distribution event.
- 40–50 laptops is a **planned goal**, not equipment received or distributed.
- Applications for the initiative remain **not yet open**.

## Links
- **Donate laptops**: `/#donate-device` opens the homepage Donate page, with **Donate a Device** selected.
- **Become a community partner**: `/#contact-partner` opens the homepage Contact Us page and selects **Corporate / School Partnership**.
- Both pages can also be accessed by their ordinary generic fragments (`/#donate` and `/#contact`).

## Safe patch installation (best for a current live Git repository)
1. Commit or back up your current repository first.
2. Copy `public/brooklyn-digital-access/index.html` and `public/images/dkf-brooklyn-initiative-story.webp` from the patch into matching paths in your repository.
3. Copy `tools/apply-brooklyn-editorial-links.js` into your repository.
4. From the repository root run: `node tools/apply-brooklyn-editorial-links.js`.
5. Inspect `git diff`, then commit and push. Coolify may deploy from GitHub.
6. Check the page at `/brooklyn-digital-access/`, then test both buttons in a new browser tab. The address bar may show `/#donate-device` or `/#contact-partner`; those fragments are handled by the homepage script.

The script only changes the homepage's known hash-routing code. It does **not** alter the database, admin portal, email templates, donor receipts, or application logic. If the live repository has a different homepage structure, the script stops rather than guessing.

## Staging checklist
- Desktop, tablet, and mobile layout; no horizontal scrolling.
- Header/logo loads, and the hero photo loads with the illustrative-image note.
- Donate link opens the **device donation form**, not PayPal; Contact link opens the **Contact Us** form with partnership as subject.
- Initiative applications remain clearly not open; no claims of donated devices or distribution.
- Check existing forms and authentication in staging before deploying to production.

This ZIP is not a live deployment.
