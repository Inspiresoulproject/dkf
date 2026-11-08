# DKF Brooklyn Digital Access Initiative patch

The small patch ZIP contains a standalone public program page and a non-destructive homepage integration script.

## Apply to an existing DKF repository

1. Back up your repo/commit first.
2. Copy the `public/` and `tools/` folders from the small patch into your existing DKF repo, keeping the current homepage and backend files intact.
3. Run `node tools/apply-brooklyn-initiative.js` from the DKF repo root.
4. Review all changed files with `git diff`, and deploy through your existing GitHub/Coolify flow.

The script detects whether the banner has already been installed, and skips duplicate modifications.
If your existing markup has changed, the script stops with an error instead of guessing where to insert navigation.

The initiative target is **40–50 laptops** and remains a proposed goal. No applications are presented as open.
