#!/bin/sh
set -eu
cd "$(dirname "$0")"
PIN=e5a36f5cd0332fde6597de474329a308a53a0716
if [ ! -d upstream/.git ]; then
  git init upstream
  git -C upstream remote add origin https://github.com/jo-inc/camofox-browser.git
fi
if [ -n "$(git -C upstream status --porcelain)" ]; then
  printf '%s\n' 'Upstream working tree is dirty; refusing to overwrite it.' >&2
  exit 1
fi
git -C upstream fetch --depth=1 origin "$PIN"
git -C upstream checkout --detach "$PIN"
test "$(git -C upstream rev-parse HEAD)" = "$PIN"
docker build -f upstream/Dockerfile.ci -t ftrade-camofox-base:e5a36f5 upstream
docker build -f browser.Dockerfile -t ftrade-browser:lease-v1 .
