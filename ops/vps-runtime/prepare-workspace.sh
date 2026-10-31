#!/bin/sh
# Run once as root on the dedicated compute host. Never formats an existing pool.
set -eu
root=/opt/ftrade-vps/compute
image=$root/workspace.img
mountpoint=$root/workspaces
mkdir -p "$root" "$mountpoint"
if [ ! -f "$image" ]; then
  available=$(df --output=avail -B1 "$root" | tail -n 1 | tr -d ' ')
  test "$available" -gt 18253611008 || { echo 'Need 17 GiB free for pool + reserve' >&2; exit 1; }
  fallocate -l 12G "$image"
  chmod 600 "$image"
  mkfs.ext4 -F -E nodiscard -m 0 "$image"
fi
# Reusing a pool requires its existing filesystem; never reformat on a retry.
test "$(blkid -p -s TYPE -o value "$image")" = ext4
unit=$(systemd-escape --path --suffix=mount "$mountpoint")
cat > "/etc/systemd/system/$unit" <<EOF
[Unit]
Description=Bounded F-Trade compute workspace
Before=ftrade-compute.service

[Mount]
What=$image
Where=$mountpoint
Type=ext4
Options=loop,nodev,nosuid,noexec

[Install]
WantedBy=local-fs.target
EOF
systemctl daemon-reload
systemctl enable --now "$unit"
mountpoint -q "$mountpoint"
chown 1000:1000 "$mountpoint"
chmod 700 "$mountpoint"
printf '%s\n' ftrade-compute-v1 > "$mountpoint/.ftrade-workspace-pool"
chmod 644 "$mountpoint/.ftrade-workspace-pool"
printf 'Workspace ready: %s\n' "$unit"
