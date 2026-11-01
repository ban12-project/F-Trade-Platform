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
  local result=$?
  if [[ "$result" != 0 ]]; then docker logs --tail 80 "$name" >&2 || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
# This is synthetic storage only. Never point this fixture at an account volume.
docker volume create "$volume" >/dev/null
first_use=${NATIVE_PROFILE_FIRST_USE:-0}
if [[ "$first_use" != 1 ]]; then
  docker run --rm --network none -v "$volume:/data" \
    -v "$fixture:/app/plugins/synthetic-profile:ro" --entrypoint node "$NATIVE_PROFILE_IMAGE" \
    /app/plugins/synthetic-profile/initialize.mjs
fi
start() {
  local deadline=$(( $(date +%s) * 1000 + 90000 ))
  docker run -d --name "$name" --network none --read-only --init \
    --cap-drop ALL --security-opt no-new-privileges:true \
    ${security_options[@]+"${security_options[@]}"} \
    --memory 2g --memory-swap 2g --cpus 2 --pids-limit 512 \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
    --tmpfs /root/.camoufox:rw,nosuid,nodev,size=16m,mode=700 \
    --tmpfs /root/camoufox:rw,nosuid,nodev,size=16m,mode=700 \
    --shm-size 256m \
    -v "$volume:/data" \
    -v "$fixture:/app/plugins/synthetic-profile:ro" \
    -v "$fixture/camofox.config.json:/app/camofox.config.json:ro" \
    -e ENABLE_VNC=1 -e VNC_RESOLUTION=1440x900 -e VNC_BIND=127.0.0.1 -e VNC_PASSWORD=native41 \
    -e FTRADE_NATIVE_PROFILE=1 \
    -e "FTRADE_NATIVE_PROFILE_FIRST_USE=$first_use" \
    -e "SYNTHETIC_NEW_PROFILE=${NATIVE_PROFILE_FIRST_USE:-0}" \
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
python3 - "$name" <<'PY'
import subprocess, sys
subprocess.run(["docker", "wait", sys.argv[1]], timeout=35,
               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, check=True)
PY
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
docker rm "$name" >/dev/null
first_use=0 # later tasks must retain the profile without initialization authority
start
docker exec "$name" node /app/plugins/synthetic-profile/client.mjs read keep-session
# Observe actual X11 geometry as well as Firefox persisted geometry.
docker exec "$name" sh -ec 'for socket in /tmp/.X11-unix/X*; do DISPLAY=":${socket##*X}" xwininfo -root -tree; done'
docker stop -t 20 "$name" >/dev/null
test "$(docker inspect --format '{{.State.Running}}' "$name")" = false
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
# Read only the synthetic window geometry after graceful Firefox shutdown.
docker run --rm --network none -v "$volume:/data:ro" --entrypoint node "$NATIVE_PROFILE_IMAGE" -e '
const fs=require("node:fs"),assert=require("node:assert/strict");
const d=JSON.parse(fs.readFileSync("/data/native-profile-v1/firefox/xulstore.json","utf8"));
const w=d["chrome://browser/content/browser.xhtml"]["main-window"];
console.log("Persisted synthetic window geometry:", JSON.stringify(w));
assert.ok(Number(w.width)>0 && Number(w.width)<=1440, "window exceeds remote desktop width");
assert.ok(Number(w.height)>0 && Number(w.height)<=900, "window exceeds remote desktop height");
console.log("PASS persistent window within bounds; profile cookie and nonextractable key preserved");'
printf 'PASS: native profile API task reuse, container replacement and expired lease shutdown\n'
