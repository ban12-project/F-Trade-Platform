#!/usr/bin/env bash
set -euo pipefail
# Synthetic DOM only, no account, proxy, credentials, upload or external traffic.
engine=("${CONTAINER_ENGINE:-docker}")
if [[ ${CONTAINER_ENGINE:-docker} == podman && -n ${FTRADE_PODMAN_CONNECTION:-} ]]; then
  engine+=(--connection "$FTRADE_PODMAN_CONNECTION")
fi
agent=${1:?exact agent image required}
browser=${2:?exact browser image required}
mode=${3:-fixed}
[[ "$mode" == fixed || "$mode" == legacy ]]
directory=$(mktemp -d)
name="ftrade-observation-fixture-$$"
source="${name}-source"
trap '"${engine[@]}" rm -f "$name" "$source" >/dev/null 2>&1 || true; rm -rf "$directory"' EXIT
"${engine[@]}" create --name "$source" --network none "$agent" >/dev/null
"${engine[@]}" cp "$source:/app/ops/browser-node" "$directory/runtime"
"${engine[@]}" rm "$source" >/dev/null
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const config = JSON.parse(readFileSync("ops/browser-node/camofox.config.json", "utf8"));
  config.plugins["ftrade-observation-fixture"] = { enabled: true };
  config.plugins.vnc.enabled = false;
  writeFileSync(process.argv[1], JSON.stringify(config));
' "$directory/config.json"
deadline=$(( $(date +%s) * 1000 + 90000 ))
"${engine[@]}" run -d --name "$name" --network none --read-only \
  --memory 2g --cpus 2 --pids-limit 512 --shm-size 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /data:rw,nosuid,nodev,size=64m,mode=700 \
  -v "$directory/runtime:/fixture/runtime:ro" \
  -v "$PWD/scripts/fixtures/browser-observation:/fixture/test:ro" \
  -v "$PWD/scripts/fixtures/browser-observation:/app/plugins/ftrade-observation-fixture:ro" \
  -v "$directory/config.json:/app/camofox.config.json:ro" \
  -e "FTRADE_LEASE_DEADLINE=$deadline" \
  -e CAMOFOX_ACCESS_KEY=SYNTHETIC-observation-fixture-key \
  -e CAMOFOX_CRASH_REPORT_ENABLED=false -e CAMOFOX_DISABLE_DEFAULT_ADDONS=true \
  -e CAMOFOX_PROFILE_DIR=/data/profiles -e CAMOFOX_UPLOADS_DIR=/data/uploads \
  -e CAMOFOX_COOKIES_DIR=/data/cookies -e CAMOFOX_TRACES_DIR=/data/traces \
  "$browser" >/dev/null
ready=false
for _ in $(seq 1 30); do
  if "${engine[@]}" exec "$name" node -e 'fetch("http://127.0.0.1:9377/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]]
cases=(synthetic-stale)
if [[ "$mode" == fixed ]]; then
  cases+=(synthetic-missing synthetic-baseline synthetic-wrong-author synthetic-no-video synthetic-wrong-link)
fi
for scenario in "${cases[@]}"; do
  "${engine[@]}" exec "$name" node --input-type=module -e 'import { writeFileSync } from "node:fs"; writeFileSync("/tmp/ftrade-lease", String(Date.now()+90000));'
  "${engine[@]}" exec "$name" node /fixture/test/verify.mjs "$scenario" "$mode"
done
