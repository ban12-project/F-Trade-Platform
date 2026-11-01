#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test "$(id -u)" = 0
gid=$(stat -c %g /var/run/docker.sock)
root=/opt/ftrade-vps/capacity
install -d -m 0750 -o root -g "$gid" "$root"
# touch/chmod preserve the inode used by any live flock holders.
touch "$root/admission.lock"
chown root:"$gid" "$root/admission.lock"
chmod 0660 "$root/admission.lock"
install -m 0644 "$here/monitor.py" "$root/monitor.py"
install -m 0644 "$here/ftrade-capacity-monitor.service" /etc/systemd/system/ftrade-capacity-monitor.service
systemctl daemon-reload
systemctl enable --now ftrade-capacity-monitor.service
systemctl restart ftrade-capacity-monitor.service
