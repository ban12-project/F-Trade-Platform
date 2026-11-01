#!/bin/sh
# Run only after stopping the broker through OpenShip and draining its jobs.
# Keeps the existing 12 GiB shared pool; no resize, reformat or data deletion.
set -eu
root=/opt/ftrade-vps/compute
pool=$root/workspaces
unit=$(systemd-escape --path --suffix=mount "$pool")
command -v setquota >/dev/null
test "$(docker inspect openship-ftrade-runtime-broker --format '{{.State.Running}}')" = false
test -z "$(docker ps -q --filter label=io.ftrade.compute)"
test -z "$(find "$pool" -type d -name 'job-*' -print -quit)"
test "$(cat "$pool/.ftrade-workspace-pool")" = ftrade-compute-v1
test "$(blkid -p -s TYPE -o value "$root/workspace.img")" = ext4
if test ! -e "$root/workspace-mount.before-quota"; then
  cp "/etc/systemd/system/$unit" "$root/workspace-mount.before-quota"
fi
systemctl stop "$unit"
tune2fs -O quota -Q grpquota "$root/workspace.img"
sed -i 's/Options=loop,nodev,nosuid,noexec$/Options=loop,nodev,nosuid,noexec,grpquota/' "/etc/systemd/system/$unit"
systemctl daemon-reload
systemctl start "$unit"
mountpoint -q "$pool"
for gid in $(seq 20000 20015); do
  setquota -g "$gid" 0 5242880 0 65536 "$pool"
done
printf '%s\n' '20000:20015:5368709120:65536' > "$pool/.ftrade-quota-v1"
chmod 644 "$pool/.ftrade-quota-v1"
findmnt -no SOURCE,OPTIONS "$pool"
