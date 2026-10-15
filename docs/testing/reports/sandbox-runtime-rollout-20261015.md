# Podman and Sandbox runtime rollout — 2026-10-15

Related to #332 and #383. This report separates exact-image infrastructure verification from production session and publication acceptance. Private account identifiers, content, profile data, credentials and provider resource IDs remain outside the repository.

## Selected release and artifact provenance

Runtime revision `3afb7bc3cf0917d27642d0f73c11c0d48d6199dd` was published by successful image workflow [38682365133](https://github.com/ban12-project/F-Trade-Platform/actions/runs/38682365133). Application and template-builder revision is `0908f60872ddc1dc69f238b1f5f75c55b49fe77e`. The newer published runtime pair supersedes the earlier `a3f4d6e` local candidate; the selected bytes were tested independently.

The downloaded CI artifact ZIP matched its API-reported SHA-256 `3e831d9a4cc49f313813e51e52dc562a05369e6312309589f964a320caf7c7a4`. Its contained archive checksum, OCI config bytes and every root filesystem layer matched the locally pulled release. The image archive SHA-256 is `e3c63437bb03b2d328fabbd407e3b081f11dea9c6d6bf9bb01e4554cd5533c67`. The destination metadata maps Docker archive-manifest IDs to the same verified config and layers; it does not rebuild the images.

| Image | Podman / OCI config ID (SHA-256) | Destination Docker local ID (SHA-256) |
| --- | --- | --- |
| Agent | `fd6578d3c98f0b70d98c2fa2dedef4355dfa7aeab3e76c50dec377816658e352` | `ed8688bbfbe3ab5b444facf90a2184be7942111e930189a8a690c5246c4d39ae` |
| Browser | `910a1533652fd5032d7e3bc1bc821cec2e66398fbfa2df1fcd72f4581ef97831` | `3188fe52ee974a8f4cecd808f159b61189886cc6fe3da897446c3b8bf5eba827` |

## Local Podman proof

The complete current image smoke suite passed using the explicit rootful Podman connection, a restrictive local seccomp policy and network-none test containers. The rootless store was unavailable; it was not reset and no existing account volume was deleted. Host and VM UTC clocks matched before lease tests. A host-only BSD `stat` adapter supplied the GNU permission format expected by the marker fixture; deployed Linux scripts were unchanged.

Passing checks included Agent payload imports, fixed-proxy failure without direct fallback, actual H.264 blue-frame pixel decoding, authenticated browser DOM inspection and negative controls, startup/watchdog behavior, both Compose contracts, native profile reuse across tasks and replacement containers, cross-account refusal and expired-lease shutdown. The six receipt-observation scenarios established stale-feed recovery and distinct missing-post, baseline-only, wrong-author, missing-video and invalid-Reel-link refusals, with zero external effects.

The kernel reported a memory peak of 551,284,736 bytes and a PID peak of 169. Memory limit, OOM and PID limit events were zero. Full local log SHA-256: `3b19f0999f8fe7c223847d1f4b147516ba004b033c4663632bfb219f6f1839d0`.

## Credential-free Sandbox and whole-VM restoration

The committed builder imported the exact archive into a fresh deny-all Sandbox, verified both Docker IDs, architecture, revision and browser native-profile label, and passed its full packaged smoke suite. The corresponding kernel peaks were 559,702,016 bytes and 166 PIDs, with zero limit or OOM events. It verified absent account volumes, node keys and private runtime configuration, froze Docker and created a 30-day template. The builder instance was deleted.

The separate provisioning test then created a new instance through the application provider adapter using that template. It passed image smoke, wrote a synthetic volume marker and a native IndexedDB non-extractable key, stopped the whole VM, resumed a different provider session and read both values successfully. Cross-account access remained refused. The test instance and its temporary snapshots were deleted. These synthetic results establish storage continuity, not a real account login or Messenger history recovery.

## Original-instance staging checks

An independent stopped deny-all rollback fork retains the pre-upgrade account filesystem for seven days. The provider initially returned `stopping`; a later read-only inspection verified the created snapshot instead of repeating the backup operation. The source was not used to build the generic template.

The first image-stage attempt stopped before image import because its private inventory assertion incorrectly expected only the account volume. The committed Compose contract also declares `ftrade-browser-sandbox_node-state`. After recording that failure, the check was corrected to require exactly those two volumes and verify the node-state Compose labels. Fresh stopped-state, policy, lease and reconciliation checks preceded the next attempt. No volumes were removed to satisfy the check.

The next transfer hit the database connection's five-minute idle-in-transaction timeout. The maintenance process exited before image import; a separately checked handle stopped that exact provider session. The script gained a bounded connection-local idle timeout, connection error handling, upload-group liveness checks and hash-verified reuse of existing chunks. The subsequent attempt required the account/configuration fingerprint to match the pre-interruption value. These failed attempts remain in private evidence and are not counted as successful stages.

The existing native-profile marker and owner manifest passed identity, permission and completed-import checks. Startup script hashes already matched the selected runtime release. Existing private publication and login reviews were not renewed implicitly; all three automatic capabilities remained disabled.

The successful stage reused 73 of 86 independently verified chunks, then verified the complete archive checksum, imported both images, matched destination IDs and every root filesystem layer, and passed offline Agent smoke. Both persistent volumes, account files, private Facebook configuration, node key and runtime settings had identical before/after fingerprints, also matching the interrupted attempt's baseline. Docker was frozen; readback confirmed the same captured provider session stopped with a created snapshot. The retained rollback fork and previous images remain available through acceptance.

## Acceptance boundary

At 09:03 UTC, production redeployment of application revision `0908f60` was ready. Fresh configuration readback matched the staged Agent/browser pair and verified template; the deployment was created after the coordinated settings update. The template expires on 2026-11-14 at 08:35:53 UTC. The original instance was stopped with its staged snapshot available before an interactive task was queued through the normal application UI.

At 09:06 UTC, that application-created interactive task was running in the original named Sandbox. Read-only inspection verified both actual container image IDs, the existing native-profile mount and owner identity, exactly the expected persistent volumes, a paused channel and no saved-login credential claim. The Agent's running transition follows its fixed-egress check. The owner viewer connected through the normal HTTPS/noVNC path.

The live site displayed a human-verification checkpoint. This is a failed readiness gate, not evidence of a lost profile or a proven image regression; the triggering cause is unknown. The operator did not submit a challenge or factor, mark the account ready, create another account task, publish, or retry an ambiguous result. The viewer was released through the normal application control, and owner action was requested before further live acceptance. Automatic login/publication/inbox capabilities remain disabled.

The whole-VM template restore, production configuration and interactive transport passes do not close #332 or #383. Authenticated session continuity, fresh observe-only ready-path receipts and newly authorized application publication receipts remain unproven on this release. An owner-delegated browser result check can reconcile an existing ambiguous publication but cannot turn its immutable unknown receipt into an automatic success. It must never cause a second publish click. Independent inbound-message acceptance and formal MVP1 business gates also remain separate.

## Documentation validation

`git diff --check` passed. The repository validator passed its contract, fixture, policy and hygiene checks; its recursive Markdown scan also reached ignored historical template payload copies with intentionally absent documentation. A clean export of tracked files with these two documentation changes passed the same Markdown-link validator. No runtime source changed in this documentation delivery; image/runtime evidence above comes from the actual selected release tests.
