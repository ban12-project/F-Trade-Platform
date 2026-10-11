# M2 reviewed video captions — 2026-10-11

Issue: #594. All test records, accounts and media bytes are synthetic; these checks do not establish a real platform publication receipt.

Videos previously always submitted an empty caption. The publication form now offers an optional approved marketing record owned by the same project for the same product. The exact body, content version and latest Gate 01 approval identify the confirmed caption. Migration `0045_facebook_video_caption_source` adds a nullable manifest column, preserving captionless video and image records.

Submission validates the preview again after private media reads and before commit. Dispatch and final authorization revalidate the saved caption source. A different caption cannot create a second attempt for the same video version and media digest. Changing the selected caption clears the form's confirmation. Controls wait for form initialization to prevent a selection being lost during hydration.

## Validation

- 23 migrated PostgreSQL caption cases passed: approved source, project ownership, product match, changed body/version/approval, revoked review, changes during media reads, dispatch revalidation, repeat submission, image compatibility and captionless video compatibility. Rejected submissions leave no publication, job or audit writes.
- Existing 194 social human authorization cases and 12 publication startup/rollback/idempotency cases passed.
- Actual Next.js form browser regression passed: the same MP4 has distinct caption variants, switching clears confirmation, unconfirmed input sends no request, and an unauthenticated confirmed request remains rejected.
- TypeScript, Drizzle metadata and changed-file formatting passed. Next.js 16.3.8 Turbopack reported no compilation or runtime errors; React Compiler remained enabled and the mounted form was inspected through React DevTools.

Real video acceptance still requires the current account, audience, exact media and reviewed platform receipt contract. This change does not itself authorize a post or establish M2 acceptance.
