"""Refresh public GeoIP assets separately from browser images and account data."""
import argparse
import fcntl
import json
import os
import re
import subprocess
import uuid
from admission import host_capacity

VOLUME = 'ftrade-browser-geoip-v1'


def docker(args, **kwargs):
    return subprocess.check_output(['docker', *args], timeout=30, **kwargs)


def selected_image():
    ids = docker(['ps', '-q']).decode().split()
    selected = []
    for container in json.loads(docker(['inspect', *ids])) if ids else []:
        env = dict(v.split('=', 1) for v in container['Config'].get('Env', []) if '=' in v)
        if env.get('BROWSER_IMAGE'):
            selected.append(env['BROWSER_IMAGE'])
    if len(selected) != 1:
        raise RuntimeError('geoip_selected_image_ambiguous')
    return selected[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', help='Explicit immutable candidate for pre-cutover validation')
    parser.add_argument('--mode', choices=['update', 'check', 'rollback'], default='update')
    args = parser.parse_args()
    image = args.image or selected_image()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise RuntimeError('geoip_immutable_image_required')
    info = json.loads(docker(['image', 'inspect', image]))[0]
    if (info['Config'].get('Labels') or {}).get('io.ftrade.official-camoufox') != '1':
        if args.image:
            raise RuntimeError('geoip_official_image_required')
        print(json.dumps({'geoip': 'skipped', 'reason': 'selected_runtime_not_official'}))
        return
    with open('/opt/ftrade-vps/geoip-update/update.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        existing = docker(['volume', 'ls', '-q', '--filter', 'name=^' + VOLUME + '$']).decode().strip()
        if not existing:
            docker(['volume', 'create', '--label', 'io.ftrade.role=browser-geoip', VOLUME])
        volume = json.loads(docker(['volume', 'inspect', VOLUME]))[0]
        if (volume.get('Labels') or {}).get('io.ftrade.role') != 'browser-geoip':
            raise RuntimeError('geoip_volume_ownership_invalid')
        name = 'ftrade-geoip-' + uuid.uuid4().hex
        created = False
        try:
            with host_capacity(docker, 1024, 1):
                docker(['create', '--name', name, '--label', 'io.ftrade.compute=geoip-update',
                        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                        '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '64',
                        '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
                        '--mount', 'type=volume,source=' + VOLUME + ',target=/opt/ftrade/geoip,volume-nocopy',
                        '--entrypoint', 'node', image, '/app/official-runtime/update-geoip.mjs', args.mode])
                created = True
            # No credentials, account mounts, published ports or browser launch.
            result = subprocess.run(['docker', 'start', '--attach', name], capture_output=True, timeout=300)
            state = json.loads(docker(['inspect', name]))[0]['State']
            if result.returncode or state['ExitCode'] or state['OOMKilled']:
                raise RuntimeError('geoip_update_failed_new_browser_admission_denied')
            print(json.dumps({'geoip': args.mode, 'ready': True, 'image': image}))
        finally:
            if created:
                docker(['rm', '-f', name])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Public status never contains upstream response bodies or host config.
        print(json.dumps({'geoip': 'failed', 'reason': type(error).__name__}))
        raise SystemExit(1) from None
