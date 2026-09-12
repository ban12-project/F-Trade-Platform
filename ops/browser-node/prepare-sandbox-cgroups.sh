#!/usr/bin/env bash
# Dedicated VM only, before its first Docker container. Based on Moby's cgroup
# nesting setup: https://github.com/moby/moby/blob/master/hack/dind
set -euo pipefail
test "$(id -u)" = 0
root=/sys/fs/cgroup
test -f "$root/cgroup.controllers"
if grep -qw memory "$root/cgroup.subtree_control"; then exit 0; fi
test "$(cat "$root/cgroup.type")" = domain
mkdir -p "$root/ftrade-init"
# Keep VM processes in a child domain so Docker may delegate memory to siblings.
# Do not remove limits or modify a parent outside the VM's cgroup namespace.
for attempt in 1 2 3 4 5; do
  while read -r pid; do
    printf '%s\n' "$pid" > "$root/ftrade-init/cgroup.procs" 2>/dev/null || true
  done < "$root/cgroup.procs"
  if printf '+memory +pids +cpu +cpuset\n' > "$root/cgroup.subtree_control"; then
    grep -qw memory "$root/cgroup.subtree_control"
    exit 0
  fi
  # Resume may still be moving/creating VM processes. Immediate retries exhaust
  # the entire allowance before the transient root population can settle.
  if test "$attempt" -lt 5; then sleep 1; fi
done
for state in cgroup.type cgroup.controllers cgroup.subtree_control cgroup.procs; do
  printf 'sandbox_cgroup_%s=' "$state" >&2
  cat "$root/$state" >&2
done
printf 'sandbox_memory_controller_unavailable\n' >&2
exit 1
