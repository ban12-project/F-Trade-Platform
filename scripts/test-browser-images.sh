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
  test -x /root/.cache/camoufox/camoufox-bin
  test -s /root/.cache/camoufox/GeoLite2-City.mmdb
  node --input-type=module -e '"'"'import { getGeolocation } from "camoufox-js/dist/locale.js"; await getGeolocation("8.8.8.8");'"'"'
  node --check /opt/ftrade/watchdog.mjs
  node --check /app/server.js
  node --check /app/plugins/ftrade-diagnostics/index.js
  test ! -e /app/plugins/ftrade-compatibility/index.js
  node --input-type=module -e '"'"'import { register } from "/app/plugins/ftrade-login/index.js"; delete process.env.FTRADE_LOGIN_PROFILE_JSON; register({ get() { throw new Error("login_default_must_be_off"); }, post() { throw new Error("login_default_must_be_off"); } }, { enabled: true }, {});'"'"'
  /root/.cache/camoufox/camoufox-bin --version
'
timeout 180 docker run --rm --network none --read-only --init --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 2g --cpus 2 --pids-limit 512 --shm-size 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  -v "$PWD/scripts/fixtures/login-fill/native.mjs:/app/ftrade-native-fill-test.mjs:ro" \
  --entrypoint node "$browser" /app/ftrade-native-fill-test.mjs
docker run --rm --network none --add-host target.browser.test:127.0.0.1 \
  -v "$PWD/scripts/fixtures/native-profile/proxy-fail-closed.mjs:/app/proxy-fail-closed.mjs:ro" \
  --entrypoint node "$browser" /app/proxy-fail-closed.mjs
docker run --rm --network none \
  -v "$PWD/scripts/fixtures/native-profile/geoip-fallback.mjs:/app/geoip-fallback.mjs:ro" \
  --entrypoint node "$browser" /app/geoip-fallback.mjs

# Decode a generated H.264 frame, not merely a canPlayType/metadata claim.
docker run --rm --network none --read-only --init \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 2g --memory-swap 2g --cpus 2 --pids-limit 512 --shm-size 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  -v "$PWD/scripts/fixtures/browser-media:/fixture:ro" \
  --entrypoint node "$browser" /fixture/verify-h264.mjs

# No Facebook/proxy/account is used. Test server startup and independent lease expiry.
name="ftrade-image-smoke-${ARCH}-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
inspection_config=$(mktemp)
trap 'rm -f "$inspection_config"; docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const config = JSON.parse(readFileSync("ops/browser-node/camofox.config.json", "utf8"));
  config.plugins["ftrade-inspection-fixture"] = { enabled: true };
  writeFileSync(process.argv[1], JSON.stringify(config));
' "$inspection_config"
deadline=$(( $(date +%s) * 1000 + 90000 ))
docker run -d --name "$name" --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
  --tmpfs /data:rw,nosuid,nodev,size=64m,mode=700 \
  -v "$PWD/ops/browser-node/publication-inspection-page.js:/fixture/publication-inspection-page.js:ro" \
  -v "$PWD/ops/browser-node/publication-inspection.mjs:/fixture/publication-inspection.mjs:ro" \
  -v "$PWD/ops/browser-node/facebook-publication-page.js:/fixture/facebook-publication-page.js:ro" \
  -v "$inspection_config:/app/camofox.config.json:ro" \
  -v "$PWD/scripts/fixtures/browser-inspection:/app/plugins/ftrade-inspection-fixture:ro" \
  -e "FTRADE_LEASE_DEADLINE=$deadline" \
  -e CAMOFOX_ACCESS_KEY=SYNTHETIC-image-smoke-key \
  -e BROWSER_IDLE_TIMEOUT_MS=900000 \
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
# HTTP health can pass before Firefox starts. Create a real page without external traffic.
docker exec "$name" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readdirSync, readFileSync } from "node:fs";
  import { createPublicationPageInspector, PublicationInspectionFailure } from "/fixture/publication-inspection.mjs";
  const response = await fetch("http://127.0.0.1:9377/tabs", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer SYNTHETIC-image-smoke-key" },
    body: JSON.stringify({ userId: "synthetic-image-smoke", sessionKey: "startup", trace: false }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  const { tabId } = await response.json();
  assert.ok(tabId);
  const program = readFileSync("/fixture/publication-inspection-page.js", "utf8");
  const evaluate = (authorized, expression) => fetch(`http://127.0.0.1:9377/tabs/${encodeURIComponent(tabId)}/evaluate`, {
    method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer SYNTHETIC-image-smoke-key" } : {}) },
    body: JSON.stringify({ userId: "synthetic-image-smoke", expression }),
    signal: AbortSignal.timeout(5000),
  });
  const unauthorized = await evaluate(false, `typeof (${program})`);
  assert.equal(unauthorized.status, 401);
  await unauthorized.body?.cancel();
  const compiled = await evaluate(true, `typeof (${program})`);
  assert.equal(compiled.status, 200);
  assert.deepEqual(await compiled.json(), { ok: true, result: "function" });
  // The unchanged program must reject a blank page, without external navigation.
  const inspector = createPublicationPageInspector({
    directory: "SYNTHETIC-unused", assertActive() {},
    candidate: async () => ({ profile: {}, candidateHash: "a".repeat(64), candidateExpiresAt: "2000-01-01T00:00:00Z" }),
    browserRequest: async (_slot, path, body) => {
      assert.equal(path, `/tabs/${encodeURIComponent(tabId)}/evaluate`);
      assert.equal(body.userId, "synthetic-image-smoke");
      return evaluate(true, body.expression);
    },
  });
  await assert.rejects(inspector({ run: { kind: "interactive", accountId: "synthetic-image-smoke" }, interactiveTabId: tabId }), error => error instanceof PublicationInspectionFailure && error.stage === "tab");
  const health = await (await fetch("http://127.0.0.1:9377/health")).json();
  assert.equal(health.browserConnected, true);
  assert.equal(health.activeTabs, 1);
  // Check the launched Firefox profile, not just plugin source/config presence.
  const profile = readdirSync("/tmp").find(name => name.startsWith("playwright_firefoxdev_profile-"));
  assert.ok(profile, "pinned Playwright Firefox profile must exist");
  const prefs = readFileSync(`/tmp/${profile}/prefs.js`, "utf8");
  assert.doesNotMatch(prefs, /user_pref\("network\.http\.http2\.websockets", false\);/);
  assert.doesNotMatch(prefs, /user_pref\("media\.peerconnection\.enabled", false\);/);
'
docker exec "$name" node /app/plugins/ftrade-inspection-fixture/verify.mjs
docker exec "$name" node -e 'require("node:fs").writeFileSync("/tmp/ftrade-lease",String(Date.now()+2000),{mode:0o600})'
timeout 35 docker wait "$name" >/dev/null
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false

# The runtime image is not a persistent Compose browser: the loader only pre-pulls it.
config=$(mktemp)
trap 'rm -f "$config" "$inspection_config"; docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
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

NATIVE_PROFILE_IMAGE="$browser" bash scripts/test-native-profile-runtime.sh
bash scripts/test-browser-observation-images.sh "$agent" "$browser"
