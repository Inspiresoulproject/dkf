# Mobile Header Logo First-Load Fix

Updated both `public/index.html` (the file served by Express/Coolify) and the root `index.html` fallback.

On screens up to 767px wide, the color DKF logo now:

- is visible immediately on first page load;
- no longer depends on the navigation receiving the `scrolled` class;
- participates in normal layout instead of remaining absolutely positioned with zero-opacity;
- retains the existing compact mobile header and hamburger menu.

Desktop navigation behavior is unchanged.
