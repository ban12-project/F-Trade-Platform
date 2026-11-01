# Vercel compute return — 2026-11-01

Scope: #801, compute only. Browser nodes, profiles and gateway lifecycle remain
on VPS. This report does not establish publication, DM or engineering-fact
acceptance.

## Image and execution evidence

Built the source-only document/media and compute Dockerfiles for amd64, retaining
#792's Remotion scratch/cache fixes. Published a private VCR image:
`f-trade-runtime@sha256:9eefc2a578f69c729bb590bb5e7d6092b998dad5e28c84d27d25db422a960ab4`.
The temporary builder registry credentials were removed after push.

Real Sandbox smoke from the local application modules passed with synthetic
private Blob media: text conversion, 320×568 / 30 fps / 3 s source probing,
three visual samples, and both FFmpeg and Remotion outputs at 1080×1920 / 30 fps,
H.264/AAC/yuv420p, stereo 48 kHz. FFmpeg duration was 3.033333 s; Remotion was
3.050667 s. Internet access was denied before source downloading. The smoke
removed its exact temporary Blob; the subsequent running Sandbox list was empty.

A separate real Sandbox with a five-second deadline rejected commands through
its original Session after expiry; it did not resume a replacement VM. That
Sandbox was then deleted. Normal task configuration uses ten minutes, light
one-vCPU and heavy four-vCPU instances, with persistence disabled.

The isolated production-environment deployment completed its real Workflow
step with automatic OIDC. Text and synthetic PDF conversion, private media
probe, three samples, FFmpeg and Remotion all passed. See the
[synthetic results](vercel-compute-return-20261101.results.json).
No business database rows were written. Final production cutover follows this gate. The temporary acceptance route is excluded from the final
source tree. Its first build failed on a `.mjs`/`.mts` import mismatch in the
harness, corrected by using an ordinary TypeScript helper; no production alias
was assigned to that failed build.

## Local checks

- Provider, pinning, session binding, failed-download egress restoration and
  failed-setup cleanup regression passed.
- Retained VPS client and header-timeout transport regressions passed.
- Remotion scratch/child-process placement and safe video failure summaries passed.
- Document and compute source-only image context tests passed.
- TypeScript and the final production build passed after removing the temporary
  deployment harness. The final build preserves Cache Components, Turbopack and
  Rust React Compiler.
- Repository validation passed using the project `.venv` Python. System Python
  lacked PyYAML and was not used to claim a pass.
- Full Biome CI check passed with existing warnings/informational findings;
  changed-file checking also passed (four existing-style warnings).

CLI upload exclusions now cover all `docs/reference/*`, local evaluation jobs
and Harbor artifacts, matching the existing confidentiality boundary. The old
rule excluded only reference PDFs. The first pre-deployment upload attempt was
interrupted; the acceptance deployment used the corrected exclusions.

## Limits

The synthetic smoke does not prove near-1 GiB individual / near-3 GiB aggregate
media, production customer documents, or end-user video approval. Source limits
remain enforced; image provenance, synthetic smoke, and successful deployment
must not be described as business acceptance. Explicit VPS rollback is retained;
there is no automatic fallback when Sandbox fails.
