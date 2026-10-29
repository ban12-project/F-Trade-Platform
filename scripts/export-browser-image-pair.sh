#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE_PREFIX:?}" "${BUILD_TAG:?}" "${ARCH:?}" "${REVISION:?}"
case "$ARCH" in amd64|arm64) ;; *) exit 1 ;; esac
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]]
image_bundle_dir=${1:?bundle output directory required}
mkdir -p "$image_bundle_dir"
agent_ref="${IMAGE_PREFIX}-browser-node:${BUILD_TAG}-${ARCH}"
browser_ref="${IMAGE_PREFIX}-browser:${BUILD_TAG}-${ARCH}"
docker image inspect --format '{{.Id}} {{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$agent_ref" "$browser_ref" > "$image_bundle_dir/image-metadata.txt"
docker image inspect "$agent_ref" "$browser_ref" > "$image_bundle_dir/source-images.json"
docker image save "$agent_ref" "$browser_ref" | gzip -1 > "$image_bundle_dir/tested-images.tar.gz"
image_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 "$image_script_dir/verify-browser-image-bundle.py" export \
  "$image_bundle_dir/tested-images.tar.gz" "$REVISION" "$ARCH" \
  "$image_bundle_dir/source-images.json" > "$image_bundle_dir/manifest.json"

(
  cd "$image_bundle_dir"
  sha256sum tested-images.tar.gz manifest.json > checksums.sha256
)
