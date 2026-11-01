#!/usr/bin/env python3
"""Owner-authorized, compute-only host retirement. Dry-run unless --apply.
Run under the release lock; never deletes Docker volumes or browser backups.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/ftrade-vps/release')
POOL = Path('/opt/ftrade-vps/compute')
CAPACITY = Path('/opt/ftrade-vps/capacity')
CLI = ['/root/.openship/bin/openship', '--local', '--json']
CONTRACT = {'version': 2, 'workloads': ['browser']}
COMPUTE_REPOS = {
    'ftrade-compute-broker', 'ftrade-compute-broker-openship',
    'ftrade-compute-runtime', 'ftrade-media-base', 'ftrade-release-broker',
    'ftrade-release-compute', 'ftrade-release-media', 'ftrade-801-compute',
    'ftrade-801-media', 'vcr.vercel.com/ban12/f-trade-platform/f-trade-runtime',
}


def check_browser_edge(url):
    # The browser gateway requires a capability, including for /health.
    # TLS validation plus an explicit unauthorized response proves the edge;
    # Docker's separate health check proves the Agent process is ready.
    try:
        with urllib.request.urlopen(url, timeout=15):
            raise RuntimeError('browser_gateway_unexpected_public_access')
    except urllib.error.HTTPError as error:
        error.close()
        if error.code != 403: raise


def run(*args):
    # Keep detailed service replies in private operator logs, never print envs.
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    tmp = path.with_suffix('.retiring')
    tmp.write_text(json.dumps(value, indent=2) + '\n'); tmp.chmod(0o600)
    os.replace(tmp, path)


def verify_browser(actual, expected):
    assert actual['State']['Status'] == 'running'
    assert actual['State']['Health']['Status'] == 'healthy'
    assert actual['Image'] == expected['image'], 'browser image drift'
    env = dict(v.split('=', 1) for v in actual['Config']['Env'])
    assert all(env.get(k) == v for k, v in expected['environment'].items()), 'browser env drift'
    mounts = {m['Destination']: (m['Source'], m['RW']) for m in actual['Mounts']}
    expected_mounts = {}
    for v in expected['volumes']:
        parts = v.split(':'); expected_mounts[parts[1]] = (parts[0], len(parts) < 3 or parts[2] != 'ro')
    assert mounts == expected_mounts, 'browser mount drift'
    assert actual['HostConfig']['Memory'] == expected['advanced']['resources']['memoryMb'] * 1048576
    assert actual['HostConfig']['NanoCpus'] == int(expected['advanced']['resources']['cpuCores'] * 1e9)


def main(apply):
    with (ROOT / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cfg, state = read(ROOT / 'config.json'), read(ROOT / 'state.json')
        assert set(cfg['targets']) == {'browser', 'runtime'}, 'already retired or unexpected targets'
        target = cfg['targets']['runtime']
        assert target['project'] != cfg['targets']['browser']['project']
        assert target['container'] == 'openship-ftrade-runtime-broker'
        services = json.loads(run(*CLI, 'service', 'list', '-p', target['project']))
        assert isinstance(services, list) and len(services) == 1, 'unexpected project services'
        assert POOL.resolve() == POOL and (POOL / 'workspace.img').is_file()
        assert (POOL / 'workspace.img').stat().st_size == cfg['contract']['poolBytes']
        assert os.path.ismount(POOL / 'workspaces')
        mounts = json.loads(run('findmnt', '--json', '--submounts', str(POOL / 'workspaces')))['filesystems']
        assert len(mounts) == 1 and not mounts[0].get('children'), 'unexpected nested mounts'
        if (ROOT / 'journal.json').exists():
            assert read(ROOT / 'journal.json')['previous']['browser'] == state['configs']['browser']
        ids = run('docker', 'ps', '-aq').split()
        containers = json.loads(run('docker', 'inspect', *ids)) if ids else []
        for c in containers:
            labels = c['Config'].get('Labels') or {}
            assert not (c['State']['Status'] in ['created', 'running', 'paused', 'restarting'] and
                        ('io.ftrade.compute' in labels or 'io.ftrade.run' in labels)), 'active worker'
            if c['Name'].lstrip('/') != target['container']:
                assert not any(m['Source'].startswith(str(POOL) + '/') for m in c['Mounts']), 'foreign pool mount'
        browser = next(c for c in containers if c['Name'].lstrip('/') == cfg['targets']['browser']['container'])
        verify_browser(browser, state['configs']['browser'])
        site = Path('/var/lib/openship/edge/sites-enabled/ftrade-native-browser.conf')
        domains = set(re.findall(r'server_name\s+([a-z0-9.-]+);', site.read_text()))
        assert len(domains) == 1
        health = 'https://' + domains.pop() + '/health'
        check_browser_edge(health)
        images = [json.loads(line) for line in run('docker', 'images', '--format', '{{json .}}').splitlines()]
        tags = sorted({i['Repository'] + ':' + i['Tag'] for i in images if i['Repository'] in COMPUTE_REPOS and i['Tag'] != '<none>'})
        before = shutil.disk_usage('/')
        print(json.dumps({'apply': apply, 'rootUsedBefore': before.used, 'rootFreeBefore': before.free,
                          'workspaceBytes': (POOL / 'workspace.img').stat().st_size, 'computeImageTags': tags}))
        if not apply: return
        archive = ROOT / 'retired-compute' / str(int(time.time()))
        archive.mkdir(parents=True, mode=0o700)
        (ROOT / 'retired-compute').chmod(0o700)
        for name in ['config.json', 'state.json', 'journal.json']:
            if (ROOT / name).exists(): shutil.copy2(ROOT / name, archive / name)
        # Make any concurrent/old driver fail closed before removing dependencies.
        cfg['targets'].pop('runtime'); cfg.pop('runtimeHealth', None)
        cfg['browserHealth'] = health; cfg['contract'] = CONTRACT
        state['configs'].pop('runtime'); state['fingerprints'].pop('computeWorker', None)
        save(ROOT / 'config.json', cfg); save(ROOT / 'state.json', state)
        journal = ROOT / 'journal.json'
        drain = CAPACITY / 'drain.json'
        if journal.exists():
            old = read(journal)
            if drain.exists(): assert read(drain)['revision'] == old['revision'], 'foreign drain'
            journal.unlink()
            receipt = ROOT / 'receipts' / (old['revision'] + '.json')
            save(receipt, {'revision': old['revision'], 'state': 'superseded', 'updatedAt': time.time(),
                           'reason': 'browser_verified_restored_compute_retired_by_owner'})
        elif drain.exists(): raise RuntimeError('unexpected_drain_requires_review')
        # Dedicated project only; never --wipe-volumes, --force or --force-orphan.
        run(*CLI, 'project', 'delete', target['project'], '--yes')
        run('systemctl', 'disable', '--now', 'ftrade-compute.service')
        unit = run('systemd-escape', '--path', '--suffix=mount', str(POOL / 'workspaces'))
        run('systemctl', 'disable', '--now', unit)
        assert not os.path.ismount(POOL / 'workspaces'), 'pool still mounted'
        for name in ['ftrade-compute.service', unit]:
            path = Path('/etc/systemd/system') / name
            if path.exists(): shutil.copy2(path, archive / name); path.unlink()
        run('systemctl', 'daemon-reload')
        edge = Path('/var/lib/openship/edge/sites-enabled/ftrade-native-runtime.conf')
        if edge.exists():
            shutil.copy2(edge, archive / edge.name); edge.unlink()
            try: run('docker', 'exec', 'openship-edge', 'openresty', '-t')
            except Exception:
                shutil.copy2(archive / edge.name, edge); raise
            run('docker', 'exec', 'openship-edge', 'openresty', '-s', 'reload')
        # No lazy/forced unmount: if busy, the operation above fails before deletion.
        shutil.rmtree(POOL)
        for tag in tags: run('docker', 'image', 'rm', tag)
        for path in [Path('/root/ftrade-801-image'), Path('/tmp/ftrade-801-image.tar')]:
            assert not path.is_symlink()
            if path.is_dir(): shutil.rmtree(path)
            elif path.exists(): path.unlink()
        run('systemctl', 'start', 'ftrade-capacity-monitor.service')
        time.sleep(3)
        assert read(CAPACITY / 'telemetry.json')['healthy']
        actual = json.loads(run('docker', 'inspect', cfg['targets']['browser']['container']))[0]
        verify_browser(actual, state['configs']['browser'])
        check_browser_edge(health)
        if drain.exists():
            with (CAPACITY / 'admission.lock').open('a') as admission:
                fcntl.flock(admission, fcntl.LOCK_EX); drain.unlink()
        after = shutil.disk_usage('/')
        receipt = {'rootUsedBefore': before.used, 'rootUsedAfter': after.used,
                   'reclaimedBytes': before.used - after.used, 'rootFreeAfter': after.free,
                   'browserHealthy': True, 'browserVolumesDeleted': 0, 'computeRetired': True}
        save(archive / 'receipt.json', receipt)
        print(json.dumps(receipt))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--apply', action='store_true')
    main(parser.parse_args().apply)
