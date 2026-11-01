#!/usr/bin/python3
"""Fixed SSH entrypoint: only request/status for the current public main SHA."""
import fcntl
import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path('/opt/ftrade-vps/release')
REPO = 'https://github.com/ban12-project/F-Trade-Platform.git'
SHA = re.compile(r'^[a-f0-9]{40}$')


def write_status(sha, state, reason=None):
    d = {'revision': sha, 'state': state, 'updatedAt': time.time()}
    if reason: d['reason'] = reason
    path = ROOT / 'receipts' / (sha + '.json')
    temp = path.with_suffix('.tmp');temp.write_text(json.dumps(d));os.replace(temp, path)


def checkout(sha):
    source = ROOT / 'source'
    if not (source / '.git').is_dir():
        subprocess.run(['git', 'clone', '--no-checkout', '--depth=1', REPO, str(source)], check=True)
    remote = subprocess.check_output(['git', '-C', str(source), 'remote', 'get-url', 'origin'], text=True).strip()
    if remote != REPO: raise RuntimeError('unexpected_repository')
    subprocess.run(['git', '-C', str(source), 'fetch', '--depth=1', 'origin', 'main'], check=True)
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'FETCH_HEAD'], text=True).strip()
    if head != sha:
        write_status(sha, 'superseded');return None
    subprocess.run(['git', '-C', str(source), 'reset', '--hard', sha], check=True)
    return source


def execute(sha):
    # The service owns this lock even if the SSH client or CI job disappears.
    with (ROOT / 'release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        write_status(sha, 'fetching')
        try:
            source = checkout(sha)
            if source is None:return
            with (ROOT / 'logs' / (sha + '.log')).open('a') as log:
                result = subprocess.run(['/usr/bin/python3', str(source / 'ops/vps-release/deploy.py'), sha], cwd=source, stdout=log, stderr=log)
            if result.returncode:
                receipt = json.loads((ROOT / 'receipts' / (sha + '.json')).read_text())
                if receipt['state'] not in ['rolled_back', 'rollback_failed', 'failed']:
                    write_status(sha, 'failed', 'release_process_failed')
        except Exception:
            write_status(sha, 'failed', 'source_or_release_failed')
            raise


def dispatch(command):
    match = re.fullmatch(r'(release|status) ([a-f0-9]{40})', command)
    if not match:raise ValueError('only_release_or_status_allowed')
    action, sha = match.groups()
    path = ROOT / 'receipts' / (sha + '.json')
    if action == 'status':
        print(path.read_text() if path.exists() else json.dumps({'revision':sha,'state':'unknown'}));return
    if path.exists():
        state = json.loads(path.read_text())['state']
        if state not in ['failed', 'rolled_back', 'superseded']:
            print(path.read_text());return
    head=subprocess.check_output(['git','ls-remote',REPO,'refs/heads/main'],timeout=30,text=True).split()[0]
    if head!=sha:
        write_status(sha,'superseded');print(path.read_text());return
    write_status(sha, 'queued')
    # No uploaded scripts, shell interpolation, arbitrary refs or shell access.
    result = subprocess.run(['systemd-run', '--quiet', '--collect', '--unit=ftrade-release-' + sha,
                    '--property=Type=exec', '--property=TimeoutStopSec=300', '--property=RuntimeMaxSec=5400',
                    '/usr/bin/python3', str(ROOT / 'bootstrap.py'), 'execute', sha])
    if result.returncode:
        write_status(sha, 'failed', 'release_unit_not_started')
    print(path.read_text())


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'execute' and SHA.fullmatch(sys.argv[2]):
        execute(sys.argv[2])
    elif len(sys.argv) == 1:
        try:
            with (ROOT/'queue.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX)
                dispatch(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        except Exception:
            print('{"state":"rejected","reason":"invalid_or_unavailable_release_request"}');sys.exit(1)
    else:sys.exit(1)
