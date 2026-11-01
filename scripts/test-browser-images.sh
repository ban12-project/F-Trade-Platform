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
docker run --rm --network none --entrypoint node "$agent" ops/browser-node/smoke.mjs "$node_arch"
test "$(docker image inspect --format '{{index .Config.Labels "io.ftrade.lease-watchdog"}}' "$browser")" = 1
docker run --rm --network none --entrypoint sh "$browser" -ec '
  command -v Xvfb
  command -v x11vnc
  command -v websockify
  test -f /usr/share/novnc/core/rfb.js
  test -x /root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin
  test ! -d /app/official-runtime/node_modules/camoufox-js
  node --check /opt/ftrade/watchdog.mjs
  node --check /app/official-runtime/server.mjs
'
OFFICIAL_RUNTIME_IMAGE="$browser" OFFICIAL_RUNTIME_AGENT_IMAGE="$agent" \
  node scripts/test-official-runtime-image.mjs
OFFICIAL_RUNTIME_IMAGE="$browser" OFFICIAL_RUNTIME_AGENT_IMAGE="$agent" \
OFFICIAL_TEST_FIRST_USE=1 node scripts/test-official-runtime-image.mjs

# The runtime image is not a persistent Compose browser: the loader only pre-pulls it.
config=$(mktemp)
trap 'rm -f "$config"' EXIT
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
FTRADE_URL=https://synthetic.example BROWSER_NODE_ID=11111111-1111-4111-8111-111111111111 \
  BROWSER_SANDBOX_OPERATION_ID=22222222-2222-4222-8222-222222222222 \
  BROWSER_AGENT_IMAGE="$agent" BROWSER_IMAGE="$browser" \
  docker compose -f ops/browser-node/compose.sandbox.yaml config --format json > "$config"
python3 - "$config" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    services = json.load(handle)["services"]
assert list(services) == ["agent"]
agent = services["agent"]
assert agent["restart"] == "no"
assert agent["pull_policy"] == "never"
assert agent["container_name"] == "ftrade-browser-agent"
assert agent["labels"]["io.ftrade.role"] == "agent"
assert agent["environment"]["BROWSER_NODE_ON_DEMAND"] == "1"
assert agent["environment"]["BROWSER_NATIVE_PROFILES"] == "0"
assert agent["environment"]["BROWSER_NODE_IDLE_MS"] == "30000"
assert agent["environment"]["BROWSER_MANAGED_FACEBOOK_CONFIG_DIR"] == "/run/facebook-config"
facebook = next(v for v in agent["volumes"] if v["target"] == "/run/facebook-config")
assert facebook["source"] == "/var/lib/ftrade-sandbox/facebook"
assert facebook["read_only"] and not facebook.get("bind", {}).get("create_host_path", False)
assert "BROWSER_NODE_ACCESS_KEY" not in agent["environment"]
key = next(v for v in agent["volumes"] if v["target"] == "/run/secrets/node-key")
assert key["read_only"] and not key.get("bind", {}).get("create_host_path", False)
PY
mode_dir=$(mktemp -d)
marker="$mode_dir/native-profile.enabled"
test "$(bash ops/browser-node/native-profile-mode.sh "$mode_dir")" = 0
printf '1\n' > "$marker"
chmod 600 "$marker"
test "$(bash ops/browser-node/native-profile-mode.sh "$mode_dir")" = 1
chmod 644 "$marker"
if bash ops/browser-node/native-profile-mode.sh "$mode_dir" >/dev/null; then exit 1; fi
chmod 600 "$marker"
rm "$marker"
ln -s /dev/null "$marker"
if bash ops/browser-node/native-profile-mode.sh "$mode_dir" >/dev/null; then exit 1; fi
rm "$marker"
rmdir "$mode_dir"
printf 'PASS: %s image pair, runtime startup, watchdog expiry and pull-only Compose\n' "$ARCH"
