#!/usr/bin/env bash
set -euo pipefail
: "${NATIVE_PROFILE_IMAGE:?Set the reviewed browser image}"
OFFICIAL_RUNTIME_IMAGE="$NATIVE_PROFILE_IMAGE" \
OFFICIAL_TEST_FIRST_USE="${NATIVE_PROFILE_FIRST_USE:-0}" \
OFFICIAL_TEST_SECCOMP="${NATIVE_PROFILE_SECCOMP:-}" \
  node scripts/test-official-runtime-image.mjs
