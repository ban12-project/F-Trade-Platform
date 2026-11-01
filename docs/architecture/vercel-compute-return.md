# Compute returns to Vercel Sandbox (#801)

The owner requested moving **only f-trade-runtime compute** back to Vercel
Sandbox on 2026-11-01. Browser Agents, native profiles, leases, gateways and
browser provider retirement remain on VPS. This supersedes the compute-provider
choice in #722; it does not reopen browser provisioning or authorize publication
or DM tests.

## Execution contract

`createComputeRuntime` defaults to `vercel`. Production explicitly sets
`COMPUTE_PROVIDER=vercel` and `COMPUTE_SANDBOX_IMAGE` to a VCR digest. Missing or
mutable image references fail before creating a VM. Invalid providers fail;
provider failures never trigger a cross-provider retry. Explicit `vps` remains
available for an operator-controlled rollback, using its existing credentials.
The idle VPS broker and its release contract remain intact for that purpose.

Each task creates a nonpersistent Sandbox with a ten-minute server-enforced
lifetime: light jobs use one vCPU; heavy jobs use four. All filesystem and
command operations bind to the original SDK `Session`, so a stopped VM cannot
be automatically resumed by a later read or command. Normal completion and
failure delete the named Sandbox and orphan snapshots. If the application dies
before cleanup, the VM deadline still ends execution; nonpersistent mode avoids
retaining the job filesystem as a snapshot.

The single image includes MarkItDown, pinned OCR assets, FFmpeg, Node, the
matching Remotion renderer and its browser. There are no task-time package or
model downloads. The application uploads its own `.remotion` bundle, retaining
bundle size/path checks and the decoder-cache/scratch fixes from #792.

Document parsing runs with `deny-all` egress. Media downloading temporarily
allows one exact private Vercel Blob hostname. The trusted downloader uses only
HTTPS GET, rejects redirects, enforces the existing <1 GiB per-file and <3 GiB
aggregate limits, and never emits signed URLs. Egress returns to `deny-all` before
parsing or rendering; restoration failure aborts and deletes the worker. The
firewall's domain allowlist is not an exact-URL permission: the existing
short-lived signed Blob token supplies the exact-path, GET-only authorization.
Application database, Blob write credentials and platform tokens are never
passed into the worker. File reads/writes retain the <1 GiB application cap.

This is a VM isolation model, not a claim that the old Docker cgroup, read-only
root or ext4 quota implementation is reproduced. Actual large-input capacity
and business acceptance must be reported separately from small synthetic smoke.

## Image publication

Prepare a fresh source-only context; do not upload the repository root or local
reference documents to a builder:

```sh
python3 scripts/prepare-compute-image-context.py /tmp/ftrade-compute-context
cd /tmp/ftrade-compute-context
docker build -f ops/video-sandbox/Dockerfile -t ftrade-media-base .
docker build --build-arg MEDIA_BASE=ftrade-media-base \
  -f ops/vps-runtime/compute.Dockerfile -t ftrade-compute-runtime .
```

Build for `linux/amd64`, authenticate the builder to the project's private VCR
repository with temporary OIDC, and push an immutable release tag. Configure the
resolved digest, not the tag. Remove the builder's temporary registry credentials
after publication. Renderer version changes require publishing and validating a
new compute image as well as the application bundle.

## Verification and rollout

- `pnpm test:vercel-compute`: provider selection, image pinning, session-only
  execution, source validation, cleanup and egress restoration on failure.
- `pnpm test:vps-compute`: retained explicit rollback provider and transport.
- `pnpm test:remotion-workspace`, `pnpm typecheck`, `pnpm build`.
- Explicit live smoke: set `COMPUTE_PROVIDER=vercel`, the pinned image, project
  OIDC and `BLOB_STORE_ID`, then run
  `node --conditions=react-server --import tsx scripts/smoke-vercel-compute.mts`.
  It generates synthetic media and text/PDF documents, tests denied egress,
  document conversion, media probing, sampling and both renderers, and deletes
  its exact temporary private Blob in `finally`. It does not write business DB
  rows. Run output stays in a local temporary directory.

Before production cutover, execute the same functions from an isolated Vercel
Workflow deployment with automatic OIDC and the production environment, then
remove its temporary acceptance route/deployment. After the reviewed PR is
merged, configure Production and Preview, deploy the final revision, verify the
production deployment environment and confirm the old broker has no active
compute containers. Keep browser releases and profiles untouched. Do not treat
an empty broker alone as proof that a new application deployment uses Sandbox.

Official references: [Sandbox images](https://vercel.com/docs/sandbox/concepts/images),
[firewall](https://vercel.com/docs/sandbox/concepts/firewall), and
[SDK reference](https://vercel.com/docs/sandbox/sdk-reference).
