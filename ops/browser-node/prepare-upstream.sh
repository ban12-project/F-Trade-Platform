#!/bin/sh
set -eu
cd "$(dirname "$0")"
PIN=$(tr -d '\r\n' < camofox.ref)
printf '%s\n' "$PIN" | grep -Eq '^[0-9a-f]{40}$' || {
  printf '%s\n' 'camofox.ref must contain exactly one full commit SHA.' >&2
  exit 1
}
if [ ! -d upstream/.git ]; then
  git init upstream
  git -C upstream remote add origin https://github.com/jo-inc/camofox-browser.git
fi
test "$(git -C upstream remote get-url origin)" = https://github.com/jo-inc/camofox-browser.git
if [ -n "$(git -C upstream status --porcelain)" ]; then
  printf '%s\n' 'Upstream working tree is dirty; refusing to overwrite it.' >&2
  exit 1
fi
if ! git -C upstream cat-file -e "$PIN^{commit}" 2>/dev/null; then
  git -C upstream fetch --depth=1 origin "$PIN"
fi
git -C upstream checkout --detach "$PIN"
test "$(git -C upstream rev-parse HEAD)" = "$PIN"
