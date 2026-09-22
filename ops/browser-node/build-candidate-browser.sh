#!/bin/sh
# Build locally for acceptance; never push an image or choose a released fallback.
set -eu
: "${CANDIDATE_DIR:?Sealed artifact directory required}"
: "${CANDIDATE_SHA256:?Expected complete archive SHA256 required}"
: "${CANDIDATE_COMMIT:?Expected browser source commit required}"
candidate_dir=$(cd "$CANDIDATE_DIR" && pwd)
cd "$(dirname "$0")"
sh prepare-upstream.sh
test -f "$candidate_dir/candidate.tar.zst"
test -f "$candidate_dir/candidate-manifest.json"
docker buildx build --load --platform linux/amd64 \
  --build-context "service=$(pwd)/upstream" --build-context "candidate=$candidate_dir" \
  --build-arg "CANDIDATE_SHA256=$CANDIDATE_SHA256" --build-arg "CANDIDATE_COMMIT=$CANDIDATE_COMMIT" \
  -f candidate-base.Dockerfile -t ftrade-camofox-candidate:local .
docker buildx build --load --platform linux/amd64 \
  --build-arg BROWSER_BASE_IMAGE=ftrade-camofox-candidate:local \
  -f browser.Dockerfile -t ftrade-browser-candidate:local .
