# Production-compatible Sandbox template preflight — 2026-10-15

Related to #529 and #332. This work replaces the credential-free template used for new-node provisioning while preserving the production account's currently selected browser runtime. It is not an upgrade of that runtime to current main and does not establish real publication, login recovery or inbound-message acceptance.

## Exact artifact identity

Read-only provider inspection confirmed the existing account instance was stopped with its selected recovery snapshot available. An isolated deny-all inspection copy exposed only image metadata; no account container was started. The copy and its orphan snapshots were deleted, and the original instance's stopped state and selected snapshot were unchanged. No account volume, private profile, node key or broker receipt entered the image bundle or template.

The selected images carry source revision `d0fc71b762358810d78c2d11d3b12037e0ee7e3f`, from successful release run [38404394057](https://github.com/ban12-project/F-Trade-Platform/actions/runs/38404394057). They are not the newer `a3f4d6e` pair tested in the preceding receipt-observation report. Docker's imported local manifest IDs are distinct from registry index IDs and Podman's config IDs; attempts to pull those local manifest IDs from GHCR returned `manifest unknown`.

| Image | Selected Docker manifest | Verified config |
| --- | --- | --- |
| Agent | `09b1e867086609a235367b7f674dab1e962718f92a0a6f772c6b0cf4097c344d` | `2c67d1191020e37dfeb221d1158aa1247434c8b4c28d3f6ec61005a98948dd8b` |
| Browser | `eb813453dab6c89d07f0df8a417ad6740794fe3bd2ba9f781860bf4c84e72e14` | `0a47c2fb8cfba4431ca6aafb4102dc9776e7571c1d3d9fcdcf406da18a8c7202` |

Both exact manifests were reproduced from the local released images, preserving the original config bytes and checking every uncompressed layer's SHA-256 and size (9 Agent layers and 28 browser layers). The resulting image-only OCI bundle has SHA-256 `400f15394b80a256690ccf9d39448b95dac63587879a7d40d31bd91ee4509088`. No account filesystem was used to construct it. Podman's multi-image archive loader refused the combined OCI index; selecting each image in the verified OCI layout through the Podman VM imported both with unchanged config identity.

## Builder and local verification

The builder accepts the existing image-bundle manifest/checksum contract, validates amd64 and matching source revisions before provider creation, and packages runtime scripts and smoke fixtures from that image revision. It retains the builder revision separately. After bounded chunk transfer it checks the archive again, requires exactly the declared image pair with the expected local IDs, removes transfer files, runs smoke under deny-all and checks for absent account volumes and node credentials. Template retention is 1–30 days; this candidate uses 30 days. The temporary bundle builder has a separate 40-minute bound for slow local uploads. Account provisioning remains two CPUs with a 20-minute limit.

Project TypeScript CLI and Biome passed. Corrupt archive bytes, mixed source revisions and unbounded retention were each rejected before provider creation.

Local Podman verification used the production-equivalent image configs, network-none containers and the reviewed restricted seccomp policy. Agent payload, proxy-down/no-direct-traffic, H.264 pixel decoding, browser startup, authenticated full-DOM inspection and its negative controls, watchdog shutdown, and both Compose contracts passed. The host initially lacked Compose; the official Docker Compose binary was checked against its release checksum. The Linux marker permission checks were run inside the Podman Linux container after macOS BSD `stat` rejected the Linux invocation. Bash 3's empty-array behavior was avoided by explicitly passing the same seccomp policy. These host preparation failures were retained, not counted as passes.

Native IndexedDB non-extractable-key write/read, cross-account refusal and legacy-source digest preservation passed across container replacement under production browser isolation. The packaged native runtime fixture also passed task reuse, container replacement and expired-lease shutdown. Test containers and synthetic volumes were removed.

## Remaining acceptance at this checkpoint

This report records the local checkpoint at 14:43 China Standard Time. The isolated provider build is uploading the verified bundle. It has not yet established the imported IDs, complete Sandbox smoke, native-profile restoration after whole-VM stop/resume, final production selection or deployed configuration readback. These subsequent results and cleanup are tracked in [PR #614](https://github.com/ban12-project/F-Trade-Platform/pull/614) and [Issue #529](https://github.com/ban12-project/F-Trade-Platform/issues/529).

Existing-account network-policy comparison remains unknown from the locally exported redacted settings; this work does not treat it as a pass or change that policy. The template builder and synthetic provisioning tests use their own explicit deny-all policy. Existing account profiles, broker jobs and historical unknown publication outcomes are preserved. Formal MVP1 business acceptance remains pending.
