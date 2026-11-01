#!/bin/sh
set -eu
cd "$(dirname "$0")"
case "$(docker info --format '{{.Architecture}}')" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo 'unsupported browser build architecture' >&2; exit 1 ;;
esac
docker build --build-arg "TARGETARCH=$arch" -f browser.Dockerfile -t ftrade-browser:lease-v1 .
