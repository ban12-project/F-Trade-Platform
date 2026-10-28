#!/bin/sh
set -eu
cd "$(dirname "$0")"
sh prepare-upstream.sh
# Local builds and CI share camofox.ref; keep the legacy local image names.
docker build --build-arg CAMOUFOX_VERSION=152.0.4 --build-arg CAMOUFOX_RELEASE=beta.30 -f upstream/Dockerfile.ci -t ftrade-camofox-base:152.0.4-beta.30 upstream
docker build -f browser.Dockerfile -t ftrade-browser:lease-v1 .
