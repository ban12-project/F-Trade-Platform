#!/usr/bin/env bash
set -euo pipefail
: "${NATIVE_PROFILE_IMAGE:?Set the reviewed browser image}"
name="ftrade-native-profile-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
volume="${name}-data"
fixture="$(cd "$(dirname "$0")/fixtures/native-profile" && pwd)"
security_options=()
if [[ -n "${NATIVE_PROFILE_SECCOMP:-}" ]]; then
  security_options+=(--security-opt "seccomp=$NATIVE_PROFILE_SECCOMP")
fi
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# This is synthetic storage only. Never point this fixture at an account volume.
docker volume create "$volume" >/dev/null
docker run --rm --network none -v "$volume:/data" \
  -v "$fixture:/app/plugins/synthetic-profile:ro" --entrypoint node "$NATIVE_PROFILE_IMAGE" \
  /app/plugins/synthetic-profile/initialize.mjs
start() {
  local deadline=$(( $(date +%s) * 1000 + 90000 ))
  docker run -d --name "$name" --network none --read-only --init \
    --cap-drop ALL --security-opt no-new-privileges:true \
    "${security_options[@]}" \
    --memory 2g --memory-swap 2g --cpus 2 --pids-limit 512 \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
    --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
    --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
    --shm-size 256m \
    -v "$volume:/data" \
    -v "$fixture:/app/plugins/synthetic-profile:ro" \
    -v "$fixture/camofox.config.json:/app/camofox.config.json:ro" \
    -e FTRADE_NATIVE_PROFILE=1 \
    -e FTRADE_PROFILE_ACCOUNT_ID=22222222-2222-4222-8222-222222222222 \
    -e FTRADE_PROFILE_NODE_ID=11111111-1111-4111-8111-111111111111 \
    -e "FTRADE_LEASE_DEADLINE=$deadline" \
    -e CAMOFOX_ACCESS_KEY=synthetic-only-api-probe-414 \
    -e CAMOFOX_DISABLE_DEFAULT_ADDONS=true -e CAMOFOX_CRASH_REPORT_ENABLED=false \
    -e MAX_SESSIONS=1 "$NATIVE_PROFILE_IMAGE" >/dev/null
}
start
docker exec "$name" node /app/plugins/synthetic-profile/client.mjs write
docker exec "$name" node /app/plugins/synthetic-profile/client.mjs read keep-session
# Expiring the lease must terminate the runtime even though its volume survives.
docker exec "$name" node -e 'require("fs").writeFileSync("/tmp/ftrade-lease",String(Date.now()+1000))'
node --input-type=module - "$name" <<'JS'
import { spawnSync } from "node:child_process";
const result = spawnSync("docker", ["wait", process.argv[2]], {
  timeout: 35_000,
  stdio: ["ignore", "ignore", "inherit"],
});
if (result.error || result.status !== 0) throw new Error("lease_shutdown_wait_failed");
JS
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
docker rm "$name" >/dev/null
start
docker exec "$name" node /app/plugins/synthetic-profile/client.mjs read keep-session
docker stop -t 20 "$name" >/dev/null
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
printf 'PASS: native profile API task reuse, container replacement and expired lease shutdown\n'
