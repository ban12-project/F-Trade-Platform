# Follow-up strategy preview — 2026-10-23

Issue #661. MVP1 sections 22 and 29 require distinct strategies for six customer scenarios. The form previously changed delivery gating when selecting a scenario, while the next-action text above it still represented the saved plan. It now previews the selected scenario's existing domain strategy and human-escalation flag before saving. The existing React Hook Form context subscription drives the preview directly; no duplicated policy, derived-state effect or request is introduced.

The preview uses the existing shadcn Alert with a polite status region. Human escalation remains a recommendation, not approval. Saving the plan and manually sending a reply remain separate actions; existing authorization and Gate 03 checks are unchanged.

## Observed validation

- TypeScript and targeted Biome CI passed.
- In the isolated local Next.js testing route, all six selections displayed their respective policy labels. Price objection, sample and lead-time scenarios displayed the human-intervention reminder.
- A marked synthetic reply draft survived switching scenarios. The saved next-action text remained unchanged; neither save nor send was clicked. No database, channel or customer operation was performed.
- Next.js MCP reported no configuration or session errors.
- Screenshot (ignored): `tmp/rfq-history-644/follow-up-strategy.png`.

This is a UI behavior check on synthetic data, not real follow-up effectiveness or DM acceptance. Full CI remains subject to the final PR head.

## First CI failure and correction

The initial head exposed 15 database-browser failures: eleven denial checks ambiguously selected both polite live regions, while four successful submissions retained the draft after replacing the existing form subscription with `useWatch`. Restore the pre-existing subscription rather than changing form behavior for this preview. Give submission feedback its own accessible status name and scope the existing assertions to that result; do not remove the draft-clearing or authorization checks. The repository-validation job was separately cancelled at its 20-minute limit during FFmpeg installation, while production build, PostgreSQL and Harbor checks passed. Final-head validation remains required.

The independent CI setup timeout is tracked as #663. The repository-validation budget is now 30 minutes; every existing check remains enabled. The download log showed apt still fetching the libflite1 FFmpeg dependency when the previous 20-minute deadline cancelled the job.

Local production-build follow-up-access validation after the correction: 14/15 initially passed; the natural-expiry rejection showed an empty draft despite the expected denial. Two targeted repetitions and a subsequent complete 15/15 run on the same built application passed without further code changes. The original intermittent observation is retained as #664, with unknown cause; later success does not erase it. All four successful-submission draft-clearing checks passed after restoring the existing subscription. TypeScript, targeted Biome CI and workflow YAML checks passed. No production database or account browser was used.
