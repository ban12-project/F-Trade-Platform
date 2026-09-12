# Remotion local encoding evidence

Issue #246, PR #330; measured 2026-09-08. This is development evidence, not final acceptance or platform acceptance.

The existing Remotion 4.0.520 composition was rendered locally with Node 24 and the installed Chromium headless shell, using only `data/fixtures/remotion-smoke.synthetic.json`. The fixture embeds an SVG with a synthetic label and makes no product engineering claims. No source upload, account operation or Vercel Sandbox was used.

With H.264, AAC, requested yuv420p and enforced audio, the default color-space run produced `yuvj420p`. The application's `inspectVideoFile` and `validateProbedVideoExport('facebook', ...)` rejected it. Keeping the same source and settings while explicitly selecting `bt709` produced:

- MP4; H.264 / AAC; 1080 × 1920; 30 fps.
- yuv420p; square pixels; BT.709, limited range.
- 48000 Hz stereo audio; 4.053333 seconds.
- Application project-preset validation passed.

Four sampled frames were inspected locally: the synthetic asset label, branding, connection caption and direction CTA were visible without clipping. This does not prove every frame, color accuracy on target devices, external Sandbox compatibility, private transfer or human rights authorization.

Reproduce with the pinned dependencies and an installed browser:

```sh
pnpm exec remotion render remotion/index.ts AbcdIndustrialVertical tmp/remotion-local.mp4 \
  --props=data/fixtures/remotion-smoke.synthetic.json \
  --browser-executable="$TEST_CHROMIUM" \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p \
  --color-space=bt709 --enforce-audio-track --concurrency=2
```

Remove only `--color-space=bt709` for the baseline comparison. Probe both outputs; do not infer actual pixel format from render options. Local binaries and media remain outside Git. The application Sandbox renderer and Sandbox smoke now explicitly pass `colorSpace: 'bt709'`; a remote run remains required to prove that environment.

## Multi-clip timeline verification

The workflow uses the sum of approved clip durations when creating its export artifact and rejects drift above 0.1 seconds. The composition previously subtracted eight frames per transition (0.2667 seconds at 30 fps), so even two clips could fail that gate. The composition now preserves the sum and adds the overlap as a frozen final frame on each outgoing clip. The next clip starts at its approved boundary; the outgoing source does not intentionally advance into unapproved footage.

A real local render of two four-second synthetic image clips produced 240 frames, measured 8.042667 seconds, and successfully created a review-required export artifact against the eight-second approved timeline. Six frames around the transition were visually inspected without blank frames. This validates the image composition and timing path; source-video/audio trim behavior and external Sandbox remain unverified.

## Source-video/audio trim verification

A three-second synthetic source contains red frames in [0, 0.5) and [2.5, 3), green frames between them, a 440 Hz tone before 2.5 seconds and a 1760 Hz tail marker. The composition selects source frames 15..74 at 30 fps, followed by a two-second image clip.

The frozen transition kept the sampled center pixel free of red across 120 output frames, but the original combined OffthreadVideo audio leaked the excluded high tone into the output interval 2.0..2.25 seconds. Its normalized single-frequency amplitude was 0.0187169. Adding trimAfter alone did not change that result.

The source video is now muted, with source audio in a separate Sequence bounded to the approved clip duration, outside Freeze. Both streams receive explicit trimBefore/trimAfter. Re-rendering the same fixture preserved the included 440 Hz amplitude at 0.1408629, reduced the excluded tone to 0.0001269 (below the 0.002 regression threshold), and retained zero red marker frames. Audio is measured after AAC decode; the criterion is bounded residual, not mathematically zero energy.

The final real MP4 also passes the application export-artifact duration/encoding checks for a four-second timeline. Local typecheck, Biome and ABCD regression pass. This is a synthetic trim control, not proof for all media, network sources or remote Sandbox behavior. The local fixture HTTP server was stopped after testing.

## Full build verification

At source commit `9ad6b99`, full `pnpm build` completed: Remotion bundle, workflow compilation, default Turbopack production build and TypeScript checks. Cache Components and both React Compiler flags remain enabled. The workflow step/flow/webhook trace manifests respectively include 55/36/36 existing Remotion files; no referenced Remotion file was missing. The repository production-boundary test passed, confirming synthetic fixtures return 404 and anonymous workspace requests redirect to authentication. The build reports 228 lint warnings. This verifies local packaging/startup, not remote CI, deployment or Sandbox execution.

## Remote execution prerequisite

On 2026-09-08, the linked local project configuration was inspected without printing secrets. Its existing Vercel OIDC token expired at 2026-09-02 01:40:11 UTC. No Vercel CLI was available on PATH or in the inspected local npx cache to refresh it. The isolated test worktree has no remote credentials. No remote Sandbox request was made with the expired token. Refresh authorized Vercel credentials before attempting remote rendering; this is an authentication prerequisite, not a render failure. Token contents and project identifiers are not recorded here.

## OIDC-only smoke credentials

The private-source smoke now lets the installed Blob SDK resolve credentials for
upload, signing and deletion, as the application does. `BLOB_STORE_ID` with a
valid `VERCEL_OIDC_TOKEN` is supported; a legacy `BLOB_READ_WRITE_TOKEN` is not a
mandatory precondition. The uploaded object is always scheduled for deletion,
even when no legacy token exists or signing fails.

The extended synthetic regression fails against the previous script at its
legacy-token guard and passes with the fix, including successful cleanup and
cleanup after signing failure. This uses mocked storage/Sandbox boundaries and
does not prove live OIDC authorization or a remote render. On 2026-09-08, the
previous PR head `be4a078` passed all Actions after quota restoration; the local
workspace OIDC token was still expired, so live private-source validation remains
pending refreshed credentials. A Vercel check labelled “Canceled by Ignored Build
Step” does not establish a new preview deployment.

## Live private-source Sandbox verification

2026-09-08: with refreshed OIDC from the workspace `.env.local` overriding `.env`,
the actual smoke script completed private Blob upload, exact-path signed source
access, Vercel Sandbox rendering, in-Sandbox ffprobe validation, local output
write, Sandbox stop and Blob deletion. PASS was emitted after both cleanup calls
resolved. The smoke copy now explicitly labels the result SYNTHETIC DEMO instead
of asserting a product identifier.

The source was the existing, entirely synthetic local contact sheet. Independent
local ffprobe measured 1080×1920, 30/1 FPS, H.264/yuv420p, AAC 48 kHz stereo,
4.053333 seconds and 1,046,724 bytes. A frame at 2 seconds was inspected: the
private source contact sheet and synthetic labels were visible. This proves the
real private-source transport/render/encoding path; the contact-sheet layout is
not a creative-quality acceptance, an authorized real-product preview, a deployed
workflow test or platform publishing acceptance. Media and logs remain in the
ignored `tmp/remotion-local/` directory; no signed URL or credential is committed.
