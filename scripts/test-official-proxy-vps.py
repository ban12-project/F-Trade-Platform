"""Operator-run actual-proxy acceptance on the existing VPS Docker policy.

Use the shared capacity bind described in ops/browser-geoip/README.md. The input
case contains an authorized proxy and its configured expectedEgressIp. Results
remain in a private directory; stdout contains aggregate verdicts only.
"""
import argparse
import ipaddress
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ops/host-capacity'))
from admission import host_capacity


def docker(args, timeout=30):
    return subprocess.check_output(['docker', *args], timeout=timeout, stderr=subprocess.DEVNULL)


def run(image, case):
    assert os.geteuid() == 0
    assert os.environ.get('FTRADE_HOST_CAPACITY_DIR') == '/run/ftrade-capacity'
    assert os.environ.get('FTRADE_HOST_ADAPTIVE') == '1'
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', image)
    metadata = case.lstat()
    assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and stat.S_IMODE(metadata.st_mode) == 0o600
    config = json.loads(case.read_text())
    assert config['source'] == 'currently_approved_broker_run'
    info = json.loads(docker(['image', 'inspect', image]))[0]
    assert info['Config']['Labels']['io.ftrade.official-camoufox'] == '1'
    output = pathlib.Path(tempfile.mkdtemp(prefix='ftrade677-proxy-'))
    output.chmod(0o700)
    name = output.name
    volume = name + '-data'
    capture = None
    container_created = network_created = volume_created = False
    def wait_marker(marker, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                docker(['exec', name, 'test', '-f', '/tmp/proxy-' + marker])
                return
            except subprocess.CalledProcessError:
                state = json.loads(docker(['inspect', name]))[0]['State']
                if not state['Running']:
                    raise RuntimeError('probe_exited_before_' + marker)
                time.sleep(0.3)
        raise RuntimeError('probe_timeout_' + marker)
    def start_capture(phase, pid):
        ready = output / (phase + '.ready')
        with open(output / (phase + '-capture.log'), 'w') as log:
            proc = subprocess.Popen(['nsenter', '-t', str(pid), '-n', 'python3',
                                     str(ROOT / 'scripts/fixtures/browser-network/capture-metadata.py'),
                                     str(output / (phase + '.json')), str(ready)],
                                    stdout=log, stderr=subprocess.STDOUT)
        for _ in range(50):
            if ready.exists():
                return proc
            if proc.poll() is not None:
                raise RuntimeError('capture_not_ready')
            time.sleep(0.1)
        proc.terminate(); proc.wait(timeout=5)
        raise RuntimeError('capture_start_timeout')
    try:
        docker(['network', 'create', '--driver', 'bridge', name]); network_created = True
        network = json.loads(docker(['network', 'inspect', name]))[0]
        # Match current production's IPv4 bridge, not an invented dual-stack policy.
        assert network['EnableIPv6'] is False and network['Internal'] is False
        docker(['volume', 'create', volume]); volume_created = True
        with host_capacity(docker, 2048, 2):
            docker(['create', '--name', name, '--label', 'io.ftrade.compute=proxy-acceptance',
                    '--network', name, '--read-only', '--init', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges', '--memory', '2g', '--memory-swap', '2g',
                    '--cpus', '2', '--pids-limit', '512', '--shm-size', '256m',
                    '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
                    '--tmpfs', '/root/.camoufox:rw,nosuid,nodev,size=16m,mode=700',
                    '--tmpfs', '/root/camoufox:rw,nosuid,nodev,size=16m,mode=700',
                    '--mount', 'type=volume,source=' + volume + ',target=/data,volume-nocopy',
                    '--mount', 'type=bind,source=' + str(case) + ',target=/run/proxy-case.json,readonly',
                    '--mount', 'type=bind,source=' + str(ROOT / 'scripts/fixtures/browser-network') + ',target=/fixture,readonly',
                    '-e', 'FTRADE_NATIVE_PROFILE=1', '-e', 'FTRADE_NATIVE_PROFILE_FIRST_USE=1',
                    '-e', 'FTRADE_PROFILE_NODE_ID=' + str(uuid.uuid4()),
                    '-e', 'FTRADE_PROFILE_ACCOUNT_ID=' + str(uuid.uuid4()),
                    '-e', 'ENABLE_VNC=1', '-e', 'VNC_PASSWORD=1234abcd',
                    '--entrypoint', 'timeout', image, '240', 'node', '/fixture/observe-official-proxy.mjs'])
            container_created = True
        docker(['start', name])
        wait_marker('ready', 30)
        pid = json.loads(docker(['inspect', name]))[0]['State']['Pid']
        capture = start_capture('control', pid)
        docker(['exec', name, 'touch', '/tmp/proxy-start-control'])
        wait_marker('control-done', 60)
        capture.send_signal(signal.SIGTERM); assert capture.wait(timeout=5) == 0; capture = None
        control = json.loads((output / 'control.json').read_text())
        assert control['dropped'] == 0
        assert any('example.com' in p.get('dnsNames', []) for p in control['packets']), 'dns_capture_control_missing'
        assert any(p.get('stun') for p in control['packets']), 'stun_capture_control_missing'
        capture = start_capture('runtime', pid)
        docker(['exec', name, 'touch', '/tmp/proxy-start-runtime'])
        wait_marker('runtime-done', 140)
        capture.send_signal(signal.SIGTERM); assert capture.wait(timeout=5) == 0; capture = None
        docker(['cp', name + ':/tmp/proxy-result.json', str(output / 'probe.json')])
        docker(['exec', name, 'touch', '/tmp/proxy-capture-stopped'])
        assert docker(['wait', name], timeout=15).decode().strip() == '0'
        state = json.loads(docker(['inspect', name]))[0]['State']
        assert not state['OOMKilled']
        result = json.loads((output / 'probe.json').read_text())
        observed = json.loads((output / 'runtime.json').read_text())
        assert observed['dropped'] == 0
        invalid = [p for p in observed['packets'] if p.get('fragmented') or p.get('invalidIp')]
        dns = [p for p in observed['packets'] if p.get('dnsNames')]
        unexpected_dns = [p for p in dns if any(n != result['proxyHost'].lower().rstrip('.') for n in p['dnsNames'])]
        other_udp = [p for p in observed['packets'] if p.get('protocol') == 17 and not p.get('dnsNames')]
        direct_tcp = [p for p in observed['packets'] if p.get('protocol') == 6
                      and not ipaddress.ip_address(p['target']).is_loopback
                      and (p['target'] not in result['proxyAddresses'] or p.get('targetPort') != result['proxyPort'])]
        verdict = {'actualProxy': True, 'expectedExitMatched': result['browserMatches'] and result['baselineMatches'],
                   'geoipTimezoneMatched': result['timezoneMatches'], 'dnsCaptureControl': True,
                   'stunCaptureControl': True, 'unexpectedDns': len(unexpected_dns),
                   'otherUdp': len(other_udp), 'directTcp': len(direct_tcp), 'unparsedIp': len(invalid),
                   'proxyIpv6Available': result['proxyIpv6Available'], 'hostBridgeIpv6': False,
                   'statsAvailable': result['statsAvailable'], 'defaultDockerPolicy': True,
                   'realAccountProfileMounted': False}
        (output / 'verdict.json').write_text(json.dumps(verdict))
        print(json.dumps(verdict), flush=True)
        assert not (invalid or unexpected_dns or other_udp or direct_tcp), 'observed_egress_requires_review'
    finally:
        if capture:
            capture.terminate()
            try: capture.wait(timeout=5)
            except subprocess.TimeoutExpired:
                capture.kill(); capture.wait(timeout=5)
        if container_created:
            # Logs contain only fixed stage receipts; keep them private anyway.
            try: (output / 'probe.log').write_bytes(subprocess.check_output(['docker', 'logs', name], stderr=subprocess.STDOUT, timeout=30))
            except subprocess.CalledProcessError: pass
            docker(['rm', '-f', name])
        if volume_created: docker(['volume', 'rm', volume])
        if network_created: docker(['network', 'rm', name])
        print(json.dumps({'privateEvidence': str(output), 'temporaryResourcesRemoved': True}), flush=True)


if __name__ == '__main__':
    def terminate(*_):
        raise SystemExit('probe_terminated')
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--case-file', type=pathlib.Path, required=True)
    args = parser.parse_args()
    run(args.image, args.case_file)
