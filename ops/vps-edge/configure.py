"""Native edge configuration for workloads Openship cannot safely redeploy.
Run on the VPS after DNS propagation. Never imports the hardened workloads
through Openship's lossy Compose model. Persists in the edge host bind mount.
"""
import argparse
import os
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--browser-domain', required=True)
parser.add_argument('--runtime-domain', required=True)
parser.add_argument('--email', required=True)
args = parser.parse_args()
for domain in (args.browser_domain, args.runtime_domain):
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', domain):
        raise SystemExit('invalid domain')
if args.browser_domain == args.runtime_domain:
    raise SystemExit('distinct domains required')
if not re.fullmatch(r'[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', args.email):
    raise SystemExit('invalid email')
root = pathlib.Path('/var/lib/openship/edge/sites-enabled')
if not root.is_dir():
    raise SystemExit('Openship edge must already be installed')

def edge(*argv):
    subprocess.run(['docker', 'exec', 'openship-edge', *argv], check=True)

def apply_configs(configs):
    previous = {p: p.read_bytes() if p.exists() else None for p in configs}
    try:
        for path, config in configs.items():
            temp = path.with_suffix('.pending')
            temp.write_text(config)
            os.replace(temp, path)
        edge('openresty', '-t')
        edge('openresty', '-s', 'reload')
    except Exception:
        for path, value in previous.items():
            if value is None:
                path.unlink(missing_ok=True)
            else:
                temp = path.with_suffix('.rollback')
                temp.write_bytes(value)
                os.replace(temp, path)
        edge('openresty', '-t')
        edge('openresty', '-s', 'reload')
        raise


def http(domain):
    return f'''server {{
    listen 80;
    server_name {domain};
    access_log off;
    error_log /dev/null;
    location ^~ /.well-known/acme-challenge/ {{ root /var/www/acme; }}
    location / {{ return 308 https://$host$request_uri; }}
}}
'''

entries = [('browser', args.browser_domain, 9400), ('runtime', args.runtime_domain, 9500)]
initial = {}
for name, domain, port in entries:
    path = root / f'ftrade-native-{name}.conf'
    # Existing TLS remains served while certbot checks/reuses its certificate.
    if not path.exists():
        initial[path] = http(domain)
apply_configs(initial)
secured = {}
for name, domain, port in entries:
    edge('certbot', 'certonly', '--webroot', '-w', '/var/www/acme',
         '--cert-name', domain, '-d', domain, '--email', args.email,
         '--agree-tos', '--non-interactive', '--keep-until-expiring')
    config = http(domain) + f'''server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    # Viewer capabilities and signed media URLs must never enter edge logs.
    access_log off;
    error_log /dev/null;
    client_max_body_size 12m;
    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 620s;
        proxy_send_timeout 620s;
        proxy_buffering off;
        proxy_request_buffering off;
    }}
}}
'''
    secured[root / f'ftrade-native-{name}.conf'] = config
apply_configs(secured)
# These domains are deliberately outside Openship's application model; renew
# them explicitly instead of assuming the platform's registered-domain job does.
unit = pathlib.Path('/etc/systemd/system')
renew = '\n'.join(f'ExecStart=/usr/bin/docker exec openship-edge certbot renew --cert-name {domain} --quiet' for _, domain, _ in entries)
(unit / 'ftrade-edge-renew.service').write_text(f'''[Unit]
Description=Renew F-Trade native runtime certificates
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
{renew}
ExecStart=/usr/bin/docker exec openship-edge openresty -s reload
''')
(unit / 'ftrade-edge-renew.timer').write_text('''[Unit]
Description=Check F-Trade runtime certificate renewal twice daily
[Timer]
OnCalendar=*-*-* 03,15:00:00
RandomizedDelaySec=3600
Persistent=true
[Install]
WantedBy=timers.target
''')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'ftrade-edge-renew.timer'], check=True)
print('Native routes and certificate renewal configured; verify upstreams separately.')
