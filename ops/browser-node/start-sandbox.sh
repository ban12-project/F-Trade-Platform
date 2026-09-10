#!/usr/bin/env bash
# Called only inside an already-authorized running VM by its platform operation.
set -euo pipefail
umask 077
node_id=${1:?node id required}
operation_id=${2:?operation id required}
staged=${3:-}
uuid='^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
[[ "$node_id" =~ $uuid && "$operation_id" =~ $uuid ]] || exit 2
if test -n "$staged"; then
  [[ "$staged" =~ ^/tmp/ftrade-runtime-[a-f0-9-]{36}$ ]] || exit 2
fi
test "$(id -u)" = 0
runtime=/var/lib/ftrade-sandbox
install -d -m 700 "$runtime"
exec 9>"$runtime/start.lock"
flock -x 9
env_file="$runtime/runtime.env"
key_file="$runtime/node-key"
if test -n "$staged"; then env_file="$staged.env"; key_file="$staged.key"; fi
for file in "$env_file" "$key_file"; do
  test -f "$file"
  test ! -L "$file"
  test "$(stat -c '%a' "$file")" = '600'
  if test -z "$staged"; then test "$(stat -c '%u' "$file")" = 0; fi
done
compose="$(cd -- "$(dirname -- "$0")" && pwd)/compose.sandbox.yaml"
config=$(mktemp "$runtime/config.XXXXXX")
trap 'rm -f "$config"; if test -n "$staged"; then rm -f "$staged.env" "$staged.key"; fi' EXIT
docker compose --env-file "$env_file" -f "$compose" config --format json >"$config"
python3 - "$config" "$node_id" "$operation_id" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    agent = json.load(handle)["services"]["agent"]
assert agent["labels"]["io.ftrade.node"] == sys.argv[2]
assert agent["labels"]["io.ftrade.operation"] == sys.argv[3]
assert agent["restart"] == "no"
assert agent["environment"]["BROWSER_NODE_ON_DEMAND"] == "1"
assert "BROWSER_NODE_ACCESS_KEY" not in agent["environment"]
for image in (agent["image"], agent["environment"]["BROWSER_IMAGE"]):
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", image), "immutable local image required"
PY
if ! docker info >/dev/null 2>&1; then
  bash "$(dirname -- "$compose")/prepare-sandbox-cgroups.sh"
  # Never let dockerd inherit the startup lock or a waiter cannot recover.
  nohup dockerd >"$runtime/dockerd.log" 2>&1 </dev/null 9>&- &
  ready=false
  for i in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  test "$ready" = true
fi
existing=$(docker ps -aq --filter 'name=^/ftrade-browser-agent$')
if test -n "$existing"; then
  identity=$(docker inspect --format '{{index .Config.Labels "io.ftrade.node"}}|{{index .Config.Labels "io.ftrade.operation"}}|{{.State.Status}}' "$existing")
  case "$identity" in
    "$node_id|$operation_id|running") printf 'already-running\n'; exit 0 ;;
    "$node_id|$operation_id|exited") printf 'already-exited\n'; exit 0 ;;
    "$node_id|"*'|exited') docker rm "$existing" >/dev/null ;;
    *) printf 'sandbox_agent_requires_reconciliation\n' >&2; exit 3 ;;
  esac
fi
if test -n "$staged"; then
  install -m 600 "$key_file" "$runtime/node-key"
  install -m 600 "$env_file" "$runtime/runtime.env"
fi
# No down -v, volume prune, forced recreation, image pull, or restart policy.
docker compose -f "$config" up -d --no-deps --no-build --pull never agent >/dev/null
printf 'started\n'
