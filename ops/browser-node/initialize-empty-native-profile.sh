#!/usr/bin/env bash
# Explicit operator maintenance only. Never call this from task startup.
set -euo pipefail
umask 077
test "${1:-}" = --new-empty-profile || exit 2
node_id=${2:?node id required}
account_id=${3:?account id required}
image=${4:?reviewed local browser image id required}
test "$#" = 4
uuid='^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
[[ "$node_id" =~ $uuid && "$account_id" =~ $uuid ]] || exit 2
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
test "$(id -u)" = 0
test -d /var/lib/ftrade-sandbox
exec 9>/var/lib/ftrade-sandbox/start.lock
flock -n -x 9
test "$(docker image inspect --format '{{index .Config.Labels "io.ftrade.native-profile"}}' "$image")" = 1
# Maintenance must precede Agent startup; no browser or Agent may own the node.
test -z "$(docker ps -q --filter "label=io.ftrade.node=$node_id")"
volume="ftbrowser-$node_id-$account_id"
test "$(docker volume inspect --format '{{index .Labels "io.ftrade.node"}}|{{index .Labels "io.ftrade.account"}}' "$volume")" = "$node_id|$account_id"
test -z "$(docker ps -aq --filter "volume=$volume")"
# --mount refuses a missing volume; volume-nocopy prevents image filesystem data
# from populating the account scope before the emptiness check.
docker run --rm --network none --read-only --pull never \
  --mount "type=volume,source=$volume,target=/data,volume-nocopy" \
  --entrypoint node "$image" --input-type=module -e '
import { readdir } from "node:fs/promises";
import { initializeNativeProfile } from "/app/ftrade-native-profile.mjs";
if ((await readdir("/data")).length !== 0)
  throw new Error("native_profile_storage_not_empty");
await initializeNativeProfile({
  nodeId: process.argv[1], accountId: process.argv[2], source: "empty",
});
console.log("native_profile_initialized");
' "$node_id" "$account_id"
