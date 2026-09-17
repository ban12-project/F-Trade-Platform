# Production acceptance follow-up — 2026-09-17

Tracking: #367. This supplements the controlled acceptance report; it does not replace failed attempts or constitute a human Go decision.

## Scope and initial observations

The authenticated production administrator session successfully created an explicitly marked MOCK marketing project. The saved model configuration was visible. No synthetic login or cookie injection was used.

Social MVP1 acceptance is limited to Facebook posting and passive incoming DM follow-up to RFQ. Other social networks and unsolicited outreach are outside this acceptance scope. Real external delivery remains unverified until the configured account, fixed proxy and controlled content pass the gates.

The initial production upload of an authorized scanned PDF (16,312,857 bytes) completed and created private evidence. The catalog job reported `ready` but returned zero candidates. This is a failed acceptance result: previous controlled runs of the same file recovered catalog candidates. Production had no `F_TRADE_LOCAL_OCR_ENABLED` configuration, so the reviewed OCR image alone did not enable scanning.

## Configuration correction

The deployed source remained the reviewed main commit `1154e53f44826bb36f88f1eb9fd063064e7892d7`. The production configuration correction enables local OCR and the existing managed browser path, and creates a new private credential encryption key because no vault key or browser node existed. No existing key was replaced. Secret values are excluded from this report.

Vercel CLI verified that the configured managed browser template snapshot exists; its remaining lifetime was approximately two days at inspection. This proves availability only, not current Facebook execution capability. The legacy single-account Facebook page is not configured; the existing managed browser control plane is the intended route for further inspection.

## Production OCR repeat

After redeployment, uploading the same 16,312,857-byte PDF through the authenticated production UI returned 72 catalog candidates. The catalog job took approximately 302 seconds from creation to completion. This matches the previous controlled candidate count; it does not establish complete visual ground truth or approve engineering facts. The initial zero-candidate attempt remains recorded separately.

## Saved-model production import and cleanup

One candidate was selected through the production browser and submitted to the saved actual model. The candidate completed without a failure code and produced one `PRODUCT_REVIEW_REQUIRED` record. The browser opened its review detail and displayed the sourced identifier plus three blocking missing fields. No Gate 01 approval, engineering supplementation, publication or sales action was performed. This is a production transport/model/gating smoke test, not a repeat of the earlier twenty-record content-quality cohort.

Both temporary private Blob objects created by this run were deleted after verification. Uncached private reads returned null for each. Database audit and review records were retained, but their temporary source files are no longer available and must not be treated as usable production evidence.

## Managed browser checkpoint

The configuration-only redeployment reached READY with the same reviewed Git commit. The authenticated production UI successfully created one managed node. Its runtime has not been started, no account grant exists, and no proxy or Facebook credentials were entered. The user explicitly deferred proxy setup, so real social-channel acceptance is paused.

The managed template defaults to interactive capability. Publishing and inbox execution additionally require reviewed private page contracts and adapter configuration; node creation alone does not validate either capability.

## Pending acceptance

- Resume account-owner proxy setup and login only when the user resumes social-channel acceptance.
- Verify approved Facebook publication and passive DM-to-RFQ behavior on the actual channel.
- Obtain the responsible person's final Go/No-Go decision after the evidence is complete.

No real Facebook publication, DM delivery or factory fact approval is claimed by this report.
