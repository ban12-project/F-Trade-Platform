# Facebook root login form review — 2026-10-29

Related: #668 and #674. This is runtime compatibility evidence, not successful account authentication.

A read-only inspection of the existing account browser at 06:49 UTC observed the exact URL `https://www.facebook.com/`, one visible `POST` form with ID `login_form`, and no `action` attribute. Its resolved action was the same root URL. The visible email and password inputs had names `email` and `pass`, types `text` and `password`, belonged to that form, and were neither disabled nor read-only. Input values, credentials, cookies and account identifiers were not collected by this probe.

The current main-branch fill contract rejects this form because its resolved action is not a login path. The explicit `facebook-root-implicit` option addresses this observed shape only. Existing scope, origin, expiry, unique-field and one-use checks still apply. This option fills fields only and does not submit or expand the version 2 automatic flow.

After merging current main into the fix branch, all 22 isolated Chromium fill tests and TypeScript checking passed. Tests include the reviewed root case and refusal without opt-in, with an explicit or foreign action, duplicate fields, wrong origin, broader selectors, or automatic-flow opt-in.

Deployment, a freshly reviewed account-specific configuration and actual login acceptance remain required. The unrelated expired profile found on the node must not be treated as current account authorization.
