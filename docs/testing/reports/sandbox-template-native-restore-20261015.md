# Sandbox template packaging and native restore — 2026-10-15

Related to #529 and #332. The existing configured template is unavailable on current provider readback; this does not establish failure of the separate existing-account resume snapshot. This change repairs the template build/verification path. It does not select a new production template or close #529.

## Verified defects and changes

The old builder's actual Git archive omitted `browser-media`, `browser-inspection`, `browser-observation` and the observation runner now invoked by `test-browser-images.sh`. It now archives all tracked synthetic fixtures and the required runner. No environment export, account profile or untracked local file enters the payload. Full image-smoke deadlines increase from two to six minutes, within the existing twenty-minute VM deadline.

The template restoration test still used an anonymous browser API, an external example page and legacy storage-state semantics despite its deny-all provider policy. It now uses the template's packaged offline native-profile fixture, its synthetic API key and fixed synthetic ownership. It keeps production browser isolation: read-only root, dropped capabilities, no-new-privileges, init, 2 GiB memory/no swap, two CPUs, 512 PIDs and 256 MiB shared memory. The read phase requires the existing synthetic volume and cannot silently initialize a replacement. It verifies use of an IndexedDB non-extractable key after restoration, rejects another account, and preserves the legacy-source digest.

Both opt-in `.mts` scripts now belong to the project TypeScript include set, so ordinary CLI/CI checks cover them. Next.js's default project-local TypeScript 7 CLI and compiler settings remain enabled.

## Podman first

The builder's actual archive expression produced Git tree `fbdb09bdd19713860ae2cb38f3b477b65f27a961`, identical to the runtime test commit `ffb9e54`. The generated restoration commands ran against that extracted payload in the existing explicit rootful Podman connection, using the reviewed local seccomp restriction and immutable browser config `b16bf1e3…7640d`. Host/VM UTC matched before testing.

Offline native-key write and read passed across container replacement, with another-account rejection and session closure in each round. The synthetic container and volume were removed. The first local execution reported a non-running container before its client could execute; the same commands passed on the subsequent run and no cause was established. This is not evidence of a real login failure. Early isolated TypeScript invocations used incomplete CLI options; the corrected dedicated check and the project CLI check both passed.

## Real Sandbox build and whole-VM restoration

The builder ran from committed `ffb9e54`, with pinned upstream `79d425be26743883a06613eaa3be5e38e7ab5409`. Installation, archived source unpacking, cgroup initialization, Agent/base/browser builds, complete image smoke, no-container/no-volume/no-node-key/runtime-env checks and Docker freeze all passed. Full smoke included decoded H.264 pixels, native profile/lease checks, inspection and all six receipt scenarios. The receipt workload recorded memory peak 537,714,688 bytes and PID peak 161/512, with zero memory-limit, OOM or PID-limit events.

A distinct persistent synthetic instance then used the actual `provisionBrowserSandbox` create/resume entry points under deny-all. It ran the packaged initializer and image smoke without uploading replacement runtime files. Native-key and synthetic-volume writes passed; Docker froze and the whole instance stopped. Read-only provider inspection confirmed stopped state and the twenty-minute timeout. Resume returned a different session; both the volume marker and native non-extractable key roundtrip passed, including another-account rejection. The test instance and its orphan snapshots were deleted.

Provider readback after cleanup confirms the credential-free candidate remains `created`, with expiration **2026-10-22 13:46 Beijing time** and reported size **4,306,967,101 bytes**. The temporary builder was deleted. Private artifact IDs and raw logs remain in ignored local evidence; the temporary production environment export was removed. Retaining the candidate for seven days is a review window, not an indefinite provisioning guarantee.

## Remaining production gate

No existing account instance, profile, credentials, broker state, application environment or historical receipt was changed. Production template selection still requires a coordinated check of the template's local image IDs against application configuration and the existing account runtime, deliberate final retention, and production selection/readback. Changing only the template ID can create nodes missing the globally configured images. #529 stays open until that gate is verified. This synthetic result does not establish real password/2FA/PIN recovery, publication receipt, inbound DM, or formal MVP1 business acceptance.
