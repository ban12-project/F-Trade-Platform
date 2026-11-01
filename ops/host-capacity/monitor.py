"""Host-only, read-only cgroup v2 sampler; snapshots contain no task payloads."""
import collections
import json
import os
import pathlib
import subprocess
import time

ROOT = pathlib.Path('/opt/ftrade-vps/capacity')
WINDOW = 30


def pressure(resource, kind):
    lines = pathlib.Path('/proc/pressure/' + resource).read_text().splitlines()
    line = next(line for line in lines if line.startswith(kind + ' '))
    return float(dict(field.split('=') for field in line.split()[1:])['avg10'])


def cpu_ticks():
    values = list(map(int, pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(values), values[3] + values[4]


def docker(*args):
    return subprocess.check_output(['docker', *args], timeout=8, stderr=subprocess.DEVNULL)


def collect(previous, history, host_history):
    now = time.time()
    monotonic = time.monotonic()
    mem = {s.split(':')[0]: int(s.split()[1]) / 1024 for s in pathlib.Path('/proc/meminfo').read_text().splitlines()}
    cores = os.cpu_count() or 1
    ticks, idle = cpu_ticks()
    old = previous.get('host')
    busy = cores if old is None or ticks <= old[0] else cores * (1 - (idle - old[1]) / (ticks - old[0]))
    previous['host'] = (ticks, idle)
    host_history.append((monotonic, max(0, busy)))
    while host_history and host_history[0][0] < monotonic - 10:
        host_history.popleft()
    ids = set()
    for label in ['io.ftrade.run', 'io.ftrade.compute']:
        ids.update(docker('ps', '-q', '--filter', 'label=' + label).decode().split())
    containers = json.loads(docker('inspect', *sorted(ids))) if ids else []
    workers = {}
    for c in containers:
        cid, pid = c['Id'], c['State']['Pid']
        if not pid:
            continue
        relative = next(line[3:] for line in pathlib.Path(f'/proc/{pid}/cgroup').read_text().splitlines() if line.startswith('0::'))
        group = pathlib.Path('/sys/fs/cgroup') / relative.lstrip('/')
        stats = dict(line.split() for line in (group / 'memory.stat').read_text().splitlines())
        memory = max(0, int((group / 'memory.current').read_text()) - int(stats.get('inactive_file', 0))) / 1048576
        usage = int(dict(line.split() for line in (group / 'cpu.stat').read_text().splitlines())['usage_usec'])
        prior = previous.get(cid)
        cpu = c['HostConfig']['NanoCpus'] / 1e9 if prior is None else max(0, (usage - prior[1]) / 1e6 / (monotonic - prior[0]))
        previous[cid] = (monotonic, usage)
        samples = history.setdefault(cid, collections.deque())
        samples.append((monotonic, memory, cpu))
        while samples and samples[0][0] < monotonic - WINDOW:
            samples.popleft()
        events = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
        workers[cid] = {'samples': len(samples), 'memoryMb': memory,
                        'memoryPeakMb': max(s[1] for s in samples),
                        'cpuPeakCores': max(s[2] for s in samples),
                        'oomKills': int(events['oom_kill'])}
    for cid in set(history) - set(workers):
        history.pop(cid, None)
        previous.pop(cid, None)
    return {'version': 1, 'observedAt': now, 'healthy': True,
            'host': {'cpuCount': cores, 'totalMb': mem['MemTotal'], 'availableMb': mem['MemAvailable'],
                     'samples': len(host_history), 'cpuPeakCores': max(x[1] for x in host_history),
                     'memorySomeAvg10': pressure('memory', 'some'), 'memoryFullAvg10': pressure('memory', 'full')},
            'workers': workers}


def publish(snapshot):
    # Atomic rename, deliberately separate from the never-replaced lock inode.
    temporary = ROOT / '.telemetry.tmp'
    temporary.write_text(json.dumps(snapshot, allow_nan=False))
    os.chown(temporary, 0, (ROOT / 'admission.lock').stat().st_gid)
    os.chmod(temporary, 0o640)
    os.replace(temporary, ROOT / 'telemetry.json')


def main():
    previous, history, host_history = {}, {}, collections.deque()
    while True:
        try:
            publish(collect(previous, history, host_history))
        except Exception:
            publish({'version': 1, 'observedAt': time.time(), 'healthy': False})
        time.sleep(2)


if __name__ == '__main__':
    main()
