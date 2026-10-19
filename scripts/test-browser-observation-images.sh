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
[[ "$mode" == fixed || "$mode" == legacy || "$mode" == inbox ]]
security_options=()
if [[ -n ${OBSERVATION_SECCOMP:-} ]]; then
  security_options+=(--security-opt "seccomp=$OBSERVATION_SECCOMP")
fi
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
"${engine[@]}" run -d --name "$name" --network none --read-only --init \
  --cap-drop ALL --security-opt no-new-privileges:true \
  "${security_options[@]}" \
  --memory 2g --memory-swap 2g --cpus 2 --pids-limit 512 --shm-size 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
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
  -e MAX_SESSIONS=1 -e MAX_TABS_PER_SESSION=4 -e MAX_TABS_GLOBAL=4 \
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
if [[ "$mode" != inbox ]]; then
  for scenario in "${cases[@]}"; do
    "${engine[@]}" exec "$name" node --input-type=module -e 'import { writeFileSync } from "node:fs"; writeFileSync("/tmp/ftrade-lease", String(Date.now()+90000));'
    "${engine[@]}" exec "$name" node /fixture/test/verify.mjs "$scenario" "$mode"
  done
fi
if [[ "$mode" != legacy ]]; then
  for scenario in normal missing-id ambiguous-direction wrong-identity; do
    "${engine[@]}" exec "$name" node --input-type=module -e 'import { writeFileSync } from "node:fs"; writeFileSync("/tmp/ftrade-lease", String(Date.now()+90000));'
    "${engine[@]}" exec "$name" node /fixture/test/verify-inbox.mjs "$scenario"
  done
fi
# Check effective kernel isolation and resource events after the real workload.
"${engine[@]}" exec "$name" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const status = readFileSync("/proc/self/status", "utf8");
  assert.match(status, /^CapEff:\s+0+$/m);
  assert.match(status, /^CapBnd:\s+0+$/m);
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  const read = name => readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
  assert.equal(read("memory.max"), "2147483648");
  assert.equal(read("memory.swap.max"), "0");
  assert.equal(read("pids.max"), "512");
  const [quota, period] = read("cpu.max").split(/\s+/).map(Number);
  assert.equal(quota / period, 2);
  const events = name => Object.fromEntries(read(name).split("\n").map(line => line.split(/\s+/).map((v, i) => i ? Number(v) : v)));
  const memory = events("memory.events");
  const pids = events("pids.events");
  assert.equal(memory.max, 0);
  assert.equal(memory.oom, 0);
  assert.equal(memory.oom_kill, 0);
  assert.equal(pids.max, 0);
  console.log(JSON.stringify({ isolationVerified: true, memoryPeak: Number(read("memory.peak")), pidsPeak: Number(read("pids.peak")), memoryEvents: memory, pidsEvents: pids }));
'
