# Temporary automatic CI pause

Effective 2026-10-31 at the user's request, tracked by #711. Restore before final MVP1 acceptance. This is an explicit temporary exception to the repository's normal Issue → branch → PR → CI → squash workflow.

PRs and squash merge remain required. Run appropriate local checks and record their exact results and limitations in each PR; absence of CI is not evidence of correctness. Do not describe unexecuted checks as passed. Business Human Gates and the paused DM acceptance scope remain unchanged.

Validation workflows retain their jobs and manual `workflow_dispatch` triggers. Automatic PR/push validation triggers are paused. The browser image workflow retains its main push release trigger and reusable release-validation dependency; these release checks still run when publishing images. The VPS release workflow also retains automatic main releases and its focused admission/release checks (#733); this does not restore the paused general PR checks. Vercel configuration and automatic application deployment are unchanged.

The main branch's required status checks are temporarily removed. Preserve PR protection, enforced administrators, linear history, and the force-push/deletion prohibitions.

## Restore before final acceptance

1. Restore only the workflow trigger sections from commit `9183e8a323ccd16800366ca8c108f841f1571334` (the parent of this change), preserving any newer jobs, steps, inputs and fixes. Remove the temporary dispatch additions only if unnecessary; retain manual acceptance access.
2. Restore required status checks with `strict: true` and these exact checks, all GitHub Actions app ID `15368`: `repository-validate`, `production-build`, `product-stream-postgres`, `harbor-compatibility`, `playwright-chromium`. PATCH `/repos/ban12-project/F-Trade-Platform/branches/main/protection/required_status_checks` with the versioned restoration payload below. Do not replace unrelated branch protections.
3. Read back branch protection and workflow triggers, then execute all applicable final-head checks. Re-enable automatic checks before claiming final acceptance. Successful deployment alone does not establish acceptance.

Restoration payload: [required-status-checks.json](../../.github/required-status-checks.json).
