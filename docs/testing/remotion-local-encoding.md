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
