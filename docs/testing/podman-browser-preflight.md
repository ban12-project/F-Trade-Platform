# Podman browser preflight

Issue #383. Use Podman for fast diagnosis, then the actual Vercel Sandbox for final consistency acceptance. Local success never constitutes production video or inbound DM acceptance.

Use the exported production image and verify the OCI manifest-to-config digest mapping: Docker and Podman image IDs may refer to different objects. Retain the same account's native profile and fixed proxy. Start with observation; do not create a new profile or submit recovery factors simply because startup or hydration is slow. Stop on CAPTCHA rather than looping login.

## Clock and runtime constraints

Compare host and VM UTC time before issuing the 90-second lease. Reject a skew exceeding ten seconds and correct VM time synchronization before proceeding. A rejected lease is not evidence that the Facebook session expired. Keep production memory, CPU, PID, shared-memory, read-only-root, dropped-capability, and no-new-privileges settings.

## Namespace diagnostic

The tested Podman default profile allowed `clone`, `clone3`, and `unshare` without argument restrictions. With all capabilities dropped, Firefox repeatedly logged `uid_map: EPERM` and child SIGSEGV. A restrictive local filter prevented this startup failure in both rootful and rootless trials. This supports a namespace-creation-path incompatibility; it is not proof of the complete crash mechanism or complete equivalence to Docker's policy.

Export the installed VM policy, then generate a local restriction:

```sh
mkdir -p tmp/podman-preflight
podman machine ssh 'cat /usr/share/containers/seccomp.json' > tmp/podman-preflight/default.json
node scripts/podman-browser-seccomp.mjs tmp/podman-preflight/default.json tmp/podman-preflight/restricted.json
node scripts/test-podman-browser-seccomp.mjs
```

Use the generated absolute path as `--security-opt seccomp=PATH` for the local diagnostic container. The path must be visible inside the Podman VM. The generator refuses an existing output file and unfamiliar namespace rules; inspect changes in the installed policy rather than bypassing refusal. It supports x64/arm64 clone argument layouts. It preserves unrelated rules, rejects an allow-by-default input, excludes `CLONE_NEWUSER` from clone/unshare, and returns ENOSYS for clone3 so callers use filtered clone. It adds no capability or Firefox sandbox override. Do not install this diagnostic policy in production automatically.

The existing synthetic continuity fixture accepts `NATIVE_PROFILE_SECCOMP=/absolute/path/restricted.json`. Its `docker` command must address the intended local engine. By default it retains the Docker engine policy used by CI. Run with `NATIVE_PROFILE_IMAGE` set to the reviewed image; the fixture creates and deletes its own synthetic volume and must never target an account volume. It verifies task reuse, container replacement, and lease shutdown independently from real Messenger.

## Live observation and final gate

Wait within a bounded deadline for matching account identity, the reviewed Messenger ready root and empty/thread marker, and absence of visible checkpoint, factor, dialog and loading states. A fixed sleep followed by an HTTP success or a Chats heading alone is insufficient. Record timeouts as unproven; do not convert them into recovery attempts. Preserve the same profile across sequential task/container checks and confirm the browser's egress each time.

Local real-account observations on 2026-09-25 reached the empty Messenger inbox without submitting password/TOTP/PIN after container replacement using the production browser image and restrictive filter. These were DOM observations, not a new broker-issued ready receipt. The local container HTTP-to-authorized-SOCKS adapter also remains a transport difference from the production HTTP proxy configuration.

After local tests stabilize, verify the candidate in the real Sandbox with its actual Docker policy and approved proxy, then inspect the durable application receipt and credential-claim audit. Keep text publication, video automatic receipt, and real inbound DM acceptance separate. The existing private video has owner confirmation but no automatic receipt acceptance; the account has no independent consenting DM test sender, so empty-inbox observations cannot establish capture, deduplication or RFQ linkage.
