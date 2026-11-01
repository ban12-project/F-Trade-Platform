#!/usr/bin/env bash
set -euo pipefail
# The owned service runs the same production drivers against synthetic DOM.
agent=${1:?exact agent image required}
browser=${2:?exact browser image required}
case "${3:-fixed}" in
  fixed|inbox) ;;
  *) echo 'Legacy upstream ablation requires its historical commit and image.' >&2; exit 2 ;;
esac
OFFICIAL_RUNTIME_IMAGE="$browser" OFFICIAL_RUNTIME_AGENT_IMAGE="$agent" \
OFFICIAL_CONTAINER_ENGINE="${CONTAINER_ENGINE:-docker}" \
OFFICIAL_TEST_SECCOMP="${OBSERVATION_SECCOMP:-}" \
  node scripts/test-official-runtime-image.mjs
