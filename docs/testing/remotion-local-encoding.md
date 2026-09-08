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
