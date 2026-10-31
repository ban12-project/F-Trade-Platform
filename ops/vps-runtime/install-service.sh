#!/bin/sh
# Deploy compose.yaml/server.py/Dockerfile under /opt/ftrade-vps/compute first.
set -eu
root=/opt/ftrade-vps/compute
unit=$(systemd-escape --path --suffix=mount "$root/workspaces")
test -f "$root/.env"
test -f "/etc/systemd/system/$unit"
cat > /etc/systemd/system/ftrade-compute.service <<EOF
[Unit]
Description=F-Trade isolated compute broker
Requires=docker.service $unit
After=docker.service $unit
BindsTo=$unit

[Service]
Type=simple
WorkingDirectory=$root
ExecStart=/usr/bin/docker compose --env-file $root/.env -f $root/compose.yaml up --no-build --abort-on-container-exit
ExecStop=/usr/bin/docker compose --env-file $root/.env -f $root/compose.yaml stop -t 15
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ftrade-compute.service
