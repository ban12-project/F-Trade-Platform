# Follow-up strategy preview — 2026-10-23

Issue #661. MVP1 sections 22 and 29 require distinct strategies for six customer scenarios. The form previously changed delivery gating when selecting a scenario, while the next-action text above it still represented the saved plan. It now previews the selected scenario's existing domain strategy and human-escalation flag before saving. React Hook Form `useWatch` drives the preview directly; no duplicated policy, derived-state effect or request is introduced.

The preview uses the existing shadcn Alert with a polite status region. Human escalation remains a recommendation, not approval. Saving the plan and manually sending a reply remain separate actions; existing authorization and Gate 03 checks are unchanged.

## Observed validation

- TypeScript and targeted Biome CI passed.
- In the isolated local Next.js testing route, all six selections displayed their respective policy labels. Price objection, sample and lead-time scenarios displayed the human-intervention reminder.
- A marked synthetic reply draft survived switching scenarios. The saved next-action text remained unchanged; neither save nor send was clicked. No database, channel or customer operation was performed.
- Next.js MCP reported no configuration or session errors.
- Screenshot (ignored): `tmp/rfq-history-644/follow-up-strategy.png`.

This is a UI behavior check on synthetic data, not real follow-up effectiveness or DM acceptance. Full CI remains subject to the final PR head.
