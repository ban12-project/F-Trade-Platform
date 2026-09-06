#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE_PREFIX:?}" "${BUILD_TAG:?}" "${ARCH:?}" "${REVISION:?}"
agent="${IMAGE_PREFIX}-browser-node:${BUILD_TAG}-${ARCH}"
browser="${IMAGE_PREFIX}-browser:${BUILD_TAG}-${ARCH}"
case "$ARCH" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) exit 1 ;; esac

for image in "$agent" "$browser"; do
  test "$(docker image inspect --format '{{.Architecture}}' "$image")" = "$ARCH"
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$REVISION"
done
docker run --rm --network none --entrypoint node "$agent" --input-type=module -e '
  import assert from "node:assert/strict";
  import { initialState } from "./lib/browser-fleet/policy.ts";
  import { createAccessKey, accessKeyNodeId } from "./lib/browser-fleet/security.ts";
  assert.equal(process.arch, process.argv[1]);
  assert.equal(initialState({maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048}).runs.length, 0);
  const id = crypto.randomUUID();
  assert.equal(accessKeyNodeId(createAccessKey(id)), id);
' "$node_arch"
test "$(docker image inspect --format '{{index .Config.Labels "io.ftrade.lease-watchdog"}}' "$browser")" = 1
docker run --rm --network none --entrypoint sh "$browser" -ec '
  command -v Xvfb
  command -v x11vnc
  command -v websockify
  test -f /usr/share/novnc/core/rfb.js
  test -x /root/.cache/camoufox/camoufox-bin
  node --check /opt/ftrade/watchdog.mjs
  node --check /app/server.js
  /root/.cache/camoufox/camoufox-bin --version
'

# No Facebook/proxy/account is used. Test server startup and independent lease expiry.
name="ftrade-image-smoke-${ARCH}-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
deadline=$(( $(date +%s) * 1000 + 70000 ))
docker run -d --name "$name" --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --tmpfs /data:rw,nosuid,nodev,size=64m,mode=700 \
  -e "FTRADE_LEASE_DEADLINE=$deadline" \
  -e CAMOFOX_CRASH_REPORT_ENABLED=false -e CAMOFOX_DISABLE_DEFAULT_ADDONS=true \
  -e CAMOFOX_PROFILE_DIR=/data/profiles -e CAMOFOX_UPLOADS_DIR=/data/uploads \
  -e CAMOFOX_COOKIES_DIR=/data/cookies -e CAMOFOX_TRACES_DIR=/data/traces \
  "$browser" >/dev/null
ready=false
for _ in $(seq 1 30); do
  if docker exec "$name" node -e 'fetch("http://127.0.0.1:9377/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=true
    break
  fi
  test "$(docker inspect --format '{{.State.Running}}' "$name")" = true
  sleep 1
done
test "$ready" = true
docker exec "$name" node -e 'require("node:fs").writeFileSync("/tmp/ftrade-lease",String(Date.now()+2000),{mode:0o600})'
timeout 35 docker wait "$name" >/dev/null
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false

# The runtime image is not a persistent Compose browser: the loader only pre-pulls it.
config=$(mktemp)
trap 'rm -f "$config"; docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
FTRADE_URL=https://synthetic.example BROWSER_NODE_ACCESS_KEY=synthetic-key \
  BROWSER_DOMAIN=browser.synthetic.example BROWSER_NODE_IMAGE="$agent" BROWSER_IMAGE="$browser" \
  docker compose -f ops/browser-node/compose.ghcr.yaml config --format json > "$config"
python3 - "$config" "$agent" "$browser" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    services = json.load(handle)["services"]
assert all("build" not in service for service in services.values())
assert services["agent"]["image"] == sys.argv[2]
assert services["agent"]["environment"]["BROWSER_IMAGE"] == sys.argv[3]
assert services["browser-image"]["image"] == sys.argv[3]
assert services["browser-image"]["entrypoint"] == ["/bin/true"]
assert services["agent"]["depends_on"]["browser-image"]["condition"] == "service_completed_successfully"
PY
printf 'PASS: %s image pair, runtime startup, watchdog expiry and pull-only Compose\n' "$ARCH"
