# Synthetic receipt observation

This plugin is mounted only into the network-none image test. It intercepts all
browser requests and never contacts Facebook, imports an account, uploads media,
authorizes an external effect, clicks Publish, or writes an application receipt.

The stale-feed case serves a loaded but outdated receipt page. DOM reads cannot
make the new post appear; a subsequent navigation to the same reviewed page does.
The unmodified driver returns `facebook_video_receipt_not_observed` despite every
request succeeding with HTTP 200. The fixed driver finds the unique synthetic
video/Reel after one bounded refresh. This reproduces a code defect; it does not
prove which condition failed during a historical live observation.

Missing post, baseline-only match, wrong actor, missing video and non-Reel link
remain failures with distinct fixed diagnostics. Two refreshes and the existing
20-read bound prevent indefinite polling. The original baseline is preserved.

Run against exact image references from the repository root:

```sh
CONTAINER_ENGINE=podman FTRADE_PODMAN_CONNECTION=podman-machine-default-root \
  bash scripts/test-browser-observation-images.sh AGENT_IMAGE BROWSER_IMAGE
```

The optional third argument `legacy` verifies the pre-fix stale-feed failure
against an unmodified agent image. CI tests the fixed image pair on both native
architectures. Browser heartbeat renewal and cleanup are limited to these local
synthetic test containers.
