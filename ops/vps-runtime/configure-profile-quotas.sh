#!/bin/sh
# Adds a light-job quota class to an existing bounded pool. No resize/remount.
set -eu
pool=${1:-/opt/ftrade-vps/compute/workspaces}
case "$pool" in /opt/ftrade-vps/*) ;; *) exit 1;; esac
mountpoint -q "$pool"
test "$(findmnt -no FSTYPE "$pool")" = ext4
findmnt -no OPTIONS "$pool" | tr ',' '\n' | grep -qx grpquota
test "$(cat "$pool/.ftrade-workspace-pool")" = ftrade-compute-v1
test "$(cat "$pool/.ftrade-quota-v1")" = '20000:20015:5368709120:65536'
test -z "$(find "$pool" -type d -name 'job-*' -print -quit)"
for gid in $(seq 20100 20115); do
  setquota -g "$gid" 0 1310720 0 65536 "$pool"
done
printf '%s\n' 'heavy:20000:20015:5368709120;light:20100:20115:1342177280;inodes:65536' > "$pool/.ftrade-quota-v2"
chmod 644 "$pool/.ftrade-quota-v2"
