#!/usr/bin/env bash
# Run inside a disposable Linux Docker test environment with a reviewed image.
set -euo pipefail
image=${1:?reviewed local browser image required}
helper=${2:-ops/browser-node/initialize-empty-native-profile.sh}
node_id=$(cat /proc/sys/kernel/random/uuid)
account_id=$(cat /proc/sys/kernel/random/uuid)
volume="ftbrowser-$node_id-$account_id"
cleanup() { docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
refuse() {
  if bash "$helper" --new-empty-profile "$node_id" "$account_id" "$image" >/dev/null 2>&1; then
    echo 'unexpected initialization success' >&2
    exit 1
  fi
}
refuse
if docker volume inspect "$volume" >/dev/null 2>&1; then exit 1; fi
docker volume create --label "io.ftrade.node=$node_id" \
  --label "io.ftrade.account=$account_id" "$volume" >/dev/null
docker run --rm --network none --read-only --pull never \
  --mount "type=volume,source=$volume,target=/data,volume-nocopy" \
  --entrypoint node "$image" -e 'require("fs").writeFileSync("/data/existing", "synthetic")'
refuse
docker run --rm --network none --read-only --pull never \
  --mount "type=volume,source=$volume,target=/data,volume-nocopy" \
  --entrypoint node "$image" -e '
const fs = require("fs");
if (fs.readFileSync("/data/existing", "utf8") !== "synthetic") process.exit(1);
fs.unlinkSync("/data/existing");'
bash "$helper" --new-empty-profile "$node_id" "$account_id" "$image"
refuse
docker run --rm --network none --read-only --pull never \
  --mount "type=volume,source=$volume,target=/data,readonly,volume-nocopy" \
  --entrypoint node "$image" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync("/data/native-profile-v1/owner.json", "utf8"));
if (m.nodeId !== process.argv[1] || m.accountId !== process.argv[2] ||
    m.source !== "empty" || !m.imported || m.legacyDigest !== null ||
    fs.readdirSync("/data/native-profile-v1/firefox").length !== 0) process.exit(1);
' "$node_id" "$account_id"
echo 'PASS explicit empty native-profile initialization and refusal controls'
