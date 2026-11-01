#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test "$(id -u)" = 0
test -f /opt/ftrade-vps/capacity/admission.lock
root=/opt/ftrade-vps/geoip-update
install -d -m 0700 "$root"
install -m 0600 "$here/update.py" "$root/update.py"
install -m 0600 "$here/../host-capacity/admission.py" "$root/admission.py"
install -m 0644 "$here/ftrade-geoip-update.service" /etc/systemd/system/
install -m 0644 "$here/ftrade-geoip-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ftrade-geoip-update.timer
