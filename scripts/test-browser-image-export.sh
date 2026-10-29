#!/usr/bin/env bash
set -euo pipefail
: "${ARCH:?}" "${REVISION:?}"
export_fixture_dir=$(mktemp -d)
export_fixture_prefix=ftrade-export-fixture
cleanup() {
  docker image rm "$export_fixture_prefix-browser-node:test-$ARCH" "$export_fixture_prefix-browser:test-$ARCH" >/dev/null 2>&1 || true
  rm -rf "$export_fixture_dir"
}
trap cleanup EXIT
for kind in browser-node browser; do
  docker build --label "org.opencontainers.image.revision=$REVISION" --label io.ftrade.native-profile=1 \
    -t "$export_fixture_prefix-$kind:test-$ARCH" -f - "$export_fixture_dir" <<EOF
FROM scratch
ENV SYNTHETIC_KIND=$kind
CMD ["synthetic-only"]
EOF
done
IMAGE_PREFIX=$export_fixture_prefix BUILD_TAG=test bash scripts/export-browser-image-pair.sh "$export_fixture_dir/bundle"
python3 scripts/verify-browser-image-bundle.py archive "$export_fixture_dir/bundle/tested-images.tar.gz" "$export_fixture_dir/bundle/manifest.json" >/dev/null
