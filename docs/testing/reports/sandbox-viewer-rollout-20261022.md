# Sandbox viewer rollout — 2026-10-22

Engineering checkpoint; observations use UTC. This report does not establish full MVP1 acceptance or a real customer inquiry.

## Corrected failures

[PR #628](https://github.com/ban12-project/F-Trade-Platform/pull/628) fixes two observed problems. The viewer could miss its single-use admission ticket when iframe loading and React hydration occurred in the opposite order. The parent now delivers the same ticket after subscribing and on frame load; the viewer announces readiness until admission and reports bounded connection states. Separately, Firefox retained a window wider than the 1440 × 900 remote desktop. Interactive startup now fits the window without resetting or editing the saved profile.

The isolated native-browser proof began with oversized saved geometry. The observed fitted outer window was 1440 × 867, with a 1360 × 760 content viewport; actual noVNC keyboard input and a mouse click reached the visible form. Four viewer state cases, eight native-profile cases and three production-build browser cases passed. The final image release passed both architecture checks.

[PR #632](https://github.com/ban12-project/F-Trade-Platform/pull/632) fixes the subsequent template-import refusal. Docker 29 exposes destination-local image IDs that differ from the archived config IDs. The builder now binds each source ID to the hashed archive config, checks the complete destination config, platform and ordered RootFS digests, and confirms the destination ID is addressable. It records both identities; matching tags or revision labels alone cannot pass. Nine identity/refusal cases and all required PR checks passed.

[PR #629](https://github.com/ban12-project/F-Trade-Platform/pull/629) separately repairs existing authorization-test fixtures: unordered snapshots now use stable ID ordering, and expiry expectations share the same clock sample as the write. The ordering regression failed against the old implementation. The corrected isolated PostgreSQL suites passed 111 intake and 194 social scenarios without weakening assertions or changing production logic.

## Release and template evidence

Runtime source: `aa9f83ace705c098c125f6e6c94b8bb23418aa82`. The successful [image workflow 39622958613](https://github.com/ban12-project/F-Trade-Platform/actions/runs/39622958613) produced the reviewed amd64 archive. The downloaded artifact ZIP digest matched `57000eb70affe6a86bc29798f01713d909acbda4422461498ac5cf8663ca5185`; the image archive digest matched `2e8a52464201f4fbdf28906bec8146e015fc5ea9510dc99bd2d370648068a088`. Config bytes, source labels and every RootFS layer matched the local Podman images. Exact-release smoke and resource/isolation observation passed locally.

| Image | Source config ID | Verified template Docker local ID |
| --- | --- | --- |
| Agent | `sha256:b29aee7ff92d60b7e7ab4fe9f4d80b5788b214df869221d44819be1bf52213be` | `sha256:cc0cf236a9c84743867e9e3e1530a3198b04ae2718c55d5a7d1dc5d23e922e18` |
| Browser | `sha256:41979e493d5eb690cb5b947d313b0b545ecc86c36fe0bdd3c848141c185800ff` | `sha256:3dfbfffd0c8278a14f0c256865f50cc76dd05789083e771d919929e787d1e0ed` |

The credential-free builder used helper revision `70102417425ae46ba3062fe4f66a9b822d6d0f88`; its verification helper is identical to merged revision `454262b798631ced57d89cf8f5ec1c439ce68b8a`. It packaged runtime files from the image source revision. Full cloud image smoke, absent account volumes/node credentials and builder deletion were verified. A separate instance created through the application provider stopped and resumed into a different session: the synthetic volume and native IndexedDB non-extractable key roundtrip passed, and the instance and its snapshots were deleted.

The first restore attempt lost its SDK log connection and was cleaned up. The fresh isolated attempt passed; the failed record remains. The template expires **2026-10-28 16:02:38 UTC**. Replacement must precede expiry; this is not an indefinite new-node creation guarantee.

## Original instance and production observation

The original named instance was stopped with no queued or live task. Maintenance held the node and Sandbox dispatch locks, kept a bounded database heartbeat, and rechecked the existing restricted provider policy. A separate account-bearing rollback fork was verified stopped under deny-all with no exposed ports; it expires **2026-10-22 16:14:48 UTC** and is never a generic template.

A private script initially treated command metadata as a completion result and reached its bounded deadline before image import. The captured instance was stopped with a created recovery snapshot. Inspection confirmed the preparation command had actually exited successfully. The continuation used the same backup, verified the empty transfer directory and used bounded `Command.wait()` reads for each single launched command. The failed attempt remains separate.

The successful stage preserved all five existing account volumes and the node-state volume. The three enabled profiles passed owner identity and permissions checks; node-state Compose labels and node-key permissions also passed. Protected volume contents, node key and private Facebook configuration had identical before/after digests. The exact archive was imported, both destination IDs matched the verified template, and committed startup files passed hash checks. Only the two image selections changed in the private runtime environment. Existing images and the protected backup were retained; no profile was reset or reinitialized.

At **16:34 UTC**, independent readback verified the original instance stopped with a created, unexpired recovery snapshot, unchanged restricted policy and two vCPUs. The three production image/template settings were updated and read back. The production application deployment reached READY at source `454262b798631ced57d89cf8f5ec1c439ce68b8a`; Vercel deployment metadata independently confirmed that commit. The clean deployment worktree contained no private materials or local environment files. The later independent-window application deployment reached READY at `b32879b8d4b3444e49999e3675f76761ecfd5df9`, again confirmed by Vercel metadata. Actual account-continuity observation remains unverified.

## Embedded navigation and independent-window delivery

Two actual interactive starts used the selected Agent/browser images and the bound account volume. The gateway returned HTTP 200 with the expected `frame-ancestors` origin. The Chrome control channel retained a paused iframe document response; admission tickets remained unused and both runs were automatically reclaimed. A later 502 occurred after reclamation, so it does not establish a gateway-listener defect. Account readiness was not inferred from these runs.

A subsequent guarded, read-only inspection of the stopped profile observed saved Firefox geometry **1360 × 817**, within the **1440 × 900** remote desktop. No account profile was modified by inspection. The protected independent-window option in [PR #635](https://github.com/ban12-project/F-Trade-Platform/pull/635) retains the embedded option, existing one-use gateway protocol and iframe sandbox. Its page requires `settings:manage`; a same-origin, exact-window handshake uses a fragment binding identifier before transferring the ticket in memory. The identifier cannot authorize gateway access. No ticket enters URL or storage, and closing/blocking a window cannot trigger automatic reauthorization.

Eight local production-build browser cases passed, including parent data-refresh continuity, blocked/closed windows, spoofed messages and authorization refusals. All required PR checks passed and the application was deployed. Live observation then verified platform authorization and the window handshake, but the nested remote document still remained paused before admission. This is not a completed noVNC or login gate.

A fresh credential-free provider instance compared four combinations: original markup with an iframe sandbox, complete HTML with that sandbox, complete HTML without the attribute, and a CSP sandbox. Every child document returned HTTP 200 and remained in the control channel's `Fetch.requestPaused` stage. Thus neither malformed markup nor this application's iframe sandbox attribute explains the observed delivery block. The instance was deleted. No account data was copied to it, and no protection was relaxed to force a result.

[Issue #634 remains open](https://github.com/ban12-project/F-Trade-Platform/issues/634#issuecomment-6323059207) for the unresolved live control-layer boundary. The shipped window option and passing isolated transport tests do not close that acceptance gate. All observed unconnected account runs were reclaimed; no publication or controlled DM was sent in this repair batch.

## Acceptance boundary

The user resumed controlled account acceptance and authorized a specific three-account message sequence. Those messages remain controlled acceptance, not genuine customer RFQs. Current business material must come from `docs/reference/`; archived synthetic provenance and append-only audit remain intact.

Current-session identity, fixed egress, Messenger readiness, task/container continuity and whole-instance continuity need separately observed evidence. Publication, video delivery, inbound capture/deduplication, RFQ association and the final business Go/No-Go retain their own gates. A functional viewer or a preserved synthetic key cannot establish them.


## Later top-level viewer rollout (2026-10-22 UTC)

PR #637 moved the remote viewer into a top-level document while retaining its CSP sandbox, exact source-window/origin/nonce binding and single-use ticket. Runtime source `589bec1a045ed3b8b3c58579e3f8d59bf5d04ba0` passed image workflow 39733123064. The downloaded image archive SHA-256 was `27862a9a458eaee17cbbe4c2cd509d106b183cc695a85b3c4c76a6a2a9c1a208`.

The source Agent config ID was `sha256:7c0ae40f5278734e97942aeba74267ff4a6cd165eefbc7877677359d796d1e99`; the source browser config ID was `sha256:32f196cb5b5661ae5b562f0a05f5a2b04debb75731687997068ca126fb90a470`. Verified Docker destination IDs were respectively `sha256:9a292e7df5768698ebbc33571c99d22bce864d0f4e9b73ec354602797e0623eb` and `sha256:8fe307145fb62465a6766748bd2283fe6d756de59e3e158af3efc0bbd375fc39`.

The first local smoke invocation encountered a Bash 3 empty-array error in native-profile and resource-observation stages; its shell exit status did not establish success. Both stages were rerun with the existing restricted seccomp policy explicitly supplied and passed, including native key continuity and negative isolation cases. Full credential-free cloud smoke and a separate provider stop/resume verification passed. The replacement generic template expires **2026-11-21 07:04:37 UTC**.

The first original-instance import failed with insufficient disk space. A protected rollback and complete private backup were retained. Cleanup removed only verified uploaded chunks and redundant runtime image exports: every exported config/layer was matched to retained image content. Account volumes, node credentials, existing images and protected backups were not pruned. The continuation held dispatch locks, verified protected file sets and hashes against the pre-failure backup, imported the exact release and preserved all five profiles. The failed staging record remains separate from the successful continuation. The replacement account-bearing rollback is stopped under deny-all without ports and has a 24-hour expiry from approximately **2026-10-22 07:08 UTC**. Remaining original-instance disk headroom is limited and requires monitoring before another large image import.

Production metadata confirmed application source `589bec1a045ed3b8b3c58579e3f8d59bf5d04ba0`. A real top-level viewer admitted successfully and displayed Firefox; mouse and keyboard input reached its address bar. This proves one actual transport connection, not identity, Messenger readiness or reliable repeated admission. Another two independent-window attempts expired before ticket admission. A human-verification checkpoint prevented further account acceptance in the connected session; the user chose another account. No controlled DM was sent.

PR #638 removes the remaining platform receiver navigation from the independent-window opening path. It retains server authorization and only transfers the ticket to the configured gateway after exact popup and nonce matching. Nine local production-build viewer cases passed, including delayed server authorization and navigation with the old receiver route deliberately blocked. This follow-up still needs CI, deployment and repeated real-browser evidence. Issue #634 remains open; MVP1 is not passed.
