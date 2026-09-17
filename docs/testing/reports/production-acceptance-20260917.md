# Production acceptance follow-up — 2026-09-17

Tracking: #367. This supplements the controlled acceptance report; it does not replace failed attempts or constitute a human Go decision.

## Scope and initial observations

The authenticated production administrator session successfully created an explicitly marked MOCK marketing project. The saved model configuration was visible. No synthetic login or cookie injection was used.

Social MVP1 acceptance is limited to Facebook posting and passive incoming DM follow-up to RFQ. Other social networks and unsolicited outreach are outside this acceptance scope. The later manual publication checkpoint below verifies one private test video post. Automated publishing and passive DM-to-RFQ execution remain separate acceptance requirements.

The initial production upload of an authorized scanned PDF (16,312,857 bytes) completed and created private evidence. The catalog job reported `ready` but returned zero candidates. This is a failed acceptance result: previous controlled runs of the same file recovered catalog candidates. Production had no `F_TRADE_LOCAL_OCR_ENABLED` configuration, so the reviewed OCR image alone did not enable scanning.

## Configuration correction

The deployed source remained the reviewed main commit `1154e53f44826bb36f88f1eb9fd063064e7892d7`. The production configuration correction enables local OCR and the existing managed browser path, and creates a new private credential encryption key because no vault key or browser node existed. No existing key was replaced. Secret values are excluded from this report.

Vercel CLI verified that the configured managed browser template snapshot exists; its remaining lifetime was approximately two days at inspection. This proves availability only, not current Facebook execution capability. The legacy single-account Facebook page is not configured; the existing managed browser control plane is the intended route for further inspection.

## Production OCR repeat

After redeployment, uploading the same 16,312,857-byte PDF through the authenticated production UI returned 72 catalog candidates. The catalog job took approximately 302 seconds from creation to completion. This matches the previous controlled candidate count; it does not establish complete visual ground truth or approve engineering facts. The initial zero-candidate attempt remains recorded separately.

## Saved-model production import and cleanup

One candidate was selected through the production browser and submitted to the saved actual model. The candidate completed without a failure code and produced one `PRODUCT_REVIEW_REQUIRED` record. The browser opened its review detail and displayed the sourced identifier plus three blocking missing fields. No Gate 01 approval, engineering supplementation, publication or sales action was performed. This is a production transport/model/gating smoke test, not a repeat of the earlier twenty-record content-quality cohort.

Both temporary private Blob objects created by this run were deleted after verification. Uncached private reads returned null for each. Database audit and review records were retained, but their temporary source files are no longer available and must not be treated as usable production evidence.

## Initial managed browser checkpoint

The configuration-only redeployment reached READY with the same reviewed Git commit. The authenticated production UI successfully created one managed node. Its runtime has not been started, no account grant exists, and no proxy or Facebook credentials were entered. The user explicitly deferred proxy setup, so real social-channel acceptance is paused.

The managed template defaults to interactive capability. Publishing and inbox execution additionally require reviewed private page contracts and adapter configuration; node creation alone does not validate either capability.

## Resumed Facebook publication acceptance

After the account owner resumed setup, the fixed proxy was tested from Vercel Sandbox through the actual CamoFox browser. The browser-observed exit matched the configured expected address. The reviewed fix in #372 preloads GeoIP for the read-only runtime and replaces the zero browser idle timeout. Production also required `BROWSER_FLEET_ENABLED=1`; without it, the node API returned 503. The subsequent deployment reached READY and the node reported a healthy heartbeat.

The actual Facebook home page showed the expected account identity. A subsequent fresh managed browser run retained the login. The platform login confirmation requires the interactive run to end first; an attempted confirmation during a live run was rejected rather than falsely recorded.

The account owner authorized trying a caption and video publication. A 7.633333-second, 1,892,206-byte H.264/AAC reference-derived test clip carried TEST ONLY and MOCK markings. The caption contained no engineering specifications, certification, availability or quotation claims. Its audience was explicitly set to Only me without changing the account default audience.

The successful attempt used the current visible Facebook composer through the managed browser. Before submission, the visible text, one attached video and Only me audience were checked. Facebook returned `Your Post is successfully shared with SELF`. The profile then displayed the matching text and Only me audience; opening the post produced a Facebook reel URL. The private acceptance record retains the URL, screenshots and asset digest; account identifiers, the private URL, credentials and original media are excluded from GitHub.

The user explicitly defined this publication gate as a Facebook post with a video URL, and excluded browser playback repair from scope. Under that criterion, manual caption-plus-video publication passed. This does not prove the production queue/adapter path: the managed node still declares only `interactive`, and this test did not create an application publication receipt.

## Observed limitations and decisions

- Adding a video opened another composer and reset caption/audience state. The final text and audience were reapplied and verified after attachment. Hidden old composers remained in the DOM, so visibility based only on client rectangles was insufficient; the successful submit excluded `aria-hidden` ancestors.
- The pinned upstream role-reference resolver uses name matching without `exact: true`. A Post reference can match another post-related control. The successful attempt used the exact visible submit control and verified the subsequent Facebook result. This runtime behavior remains relevant to automation acceptance.
- Uploading from the profile selected a photo input and returned `Can't Read Files`; that attempt did not publish. The successful attempt used the home composer. The upstream upload endpoint selects the first file input, so automatic attachment selection is not yet proven against the real page.
- Browser-local H.264 detection returned unsupported and other Facebook videos also failed playback. Per the user's decision, decoder repair was cancelled; the temporary credential-free codec lab was deleted and no production codec change was made. This limitation does not fail the user-defined publication gate.
- Messenger accepted PIN key input and displayed `Verifying your PIN`, but restoration success was not observed. The empty visible chat list during restoration is not evidence of a complete empty inbox. A controlled incoming test message and reviewed real-page inbox contract are still required.

## Pending acceptance

- Verify passive incoming Facebook DM follow-up to RFQ with a controlled real inbound message.
- Install and validate the reviewed inbox adapter/page contract; do not treat the interactive node or manual post as automatic delivery evidence.
- Obtain the responsible person's final Go/No-Go decision after the remaining evidence is complete.

No completed DM-to-RFQ flow, automated publication receipt or factory fact approval is claimed by this report.
