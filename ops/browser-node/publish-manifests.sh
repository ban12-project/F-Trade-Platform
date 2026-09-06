#!/usr/bin/env bash
set -euo pipefail
# No PR event, arbitrary branch, or fork may promote package tags.
[[ "${GITHUB_REPOSITORY:?}" == ban12-project/F-Trade-Platform ]]
[[ "${GITHUB_REF:?}" == refs/heads/main ]]
[[ "${GITHUB_EVENT_NAME:?}" == push || "$GITHUB_EVENT_NAME" == workflow_dispatch ]]
[[ "${GITHUB_SHA:?}" =~ ^[0-9a-f]{40}$ ]]
: "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}" "${GH_TOKEN:?}"
prefix="ghcr.io/${GITHUB_REPOSITORY,,}"
build="run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
images=("${prefix}-browser-node" "${prefix}-browser")

# Require both architectures for both images before creating release aliases.
for image in "${images[@]}"; do
  for arch in amd64 arm64; do
    docker buildx imagetools inspect "${image}:${build}-${arch}" >/dev/null
  done
done
for image in "${images[@]}"; do
  docker buildx imagetools create --tag "${image}:sha-${GITHUB_SHA}" \
    "${image}:${build}-amd64" "${image}:${build}-arm64"
  docker buildx imagetools inspect "${image}:sha-${GITHUB_SHA}" --raw | python3 -c '
import json, sys
manifest = json.load(sys.stdin)
platforms = {(m.get("platform", {}).get("os"), m.get("platform", {}).get("architecture")) for m in manifest["manifests"]}
assert ("linux", "amd64") in platforms and ("linux", "arm64") in platforms, platforms
'
done

# Do not let reruns of old commits roll main/latest backward.
current=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)
if [[ "$current" == "$GITHUB_SHA" ]]; then
  for image in "${images[@]}"; do
    docker buildx imagetools create --tag "${image}:main" --tag "${image}:latest" \
      "${image}:sha-${GITHUB_SHA}"
  done
  note='main/latest updated. This publishes images only; no VPS is restarted.'
else
  note='main advanced during this run; SHA tags published, main/latest left unchanged.'
fi
{
  printf '## Browser images published\n\n'
  for image in "${images[@]}"; do
    printf -- '- `%s:sha-%s` (linux/amd64, linux/arm64)\n' "$image" "$GITHUB_SHA"
  done
  printf '\n%s\n' "$note"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
