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
python3 - "$image_bundle_dir" <<'PY'
import json,os,re,sys
from pathlib import Path
p=Path(sys.argv[1]);rows=(p/'image-metadata.txt').read_text().splitlines();assert len(rows)==2
images={}
for kind,line in zip(['agent','browser'],rows):
 parts=line.split();assert len(parts)==3
 image_id,arch,revision=parts
 assert re.fullmatch(r'sha256:[a-f0-9]{64}',image_id)
 assert arch==os.environ['ARCH'] and revision==os.environ['REVISION']
 images[kind]={'id':image_id,'architecture':arch,'revision':revision}
(p/'manifest.json').write_text(json.dumps({'version':1,'revision':os.environ['REVISION'],'architecture':os.environ['ARCH'],'images':images},sort_keys=True))
PY
docker image save "$agent_ref" "$browser_ref" | gzip -1 > "$image_bundle_dir/tested-images.tar.gz"
(
  cd "$image_bundle_dir"
  sha256sum tested-images.tar.gz manifest.json > checksums.sha256
)
