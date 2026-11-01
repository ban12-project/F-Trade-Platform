"""Atomic host admission shared with the browser Agent's Linux flock."""
import contextlib
import datetime
import fcntl
import json
import math
import time
import os
import pathlib


class CapacityUnavailable(ValueError):
    pass


def assert_not_draining(directory):
    try:
        pathlib.Path(directory, 'drain.json').lstat()
    except FileNotFoundError:
        return
    raise CapacityUnavailable('host_capacity_draining')


def check_budget(containers, memory_mb, available_mb, total_mb, cores):
    memory = cpu = 0
    for container in containers:
        host = container['HostConfig']
        if host.get('Memory', 0) <= 0 or host.get('NanoCpus', 0) <= 0:
            raise ValueError('host_capacity_unbounded_worker')
        memory += host['Memory'] / 1048576
        cpu += host['NanoCpus'] / 1e9
    budget = total_mb - max(2048, total_mb * 0.2)
    reserve = max(1536, total_mb * 0.1)
    if len(containers) >= 16 or memory + memory_mb > budget or cpu + 2 > cores or available_mb < memory_mb + reserve:
        raise CapacityUnavailable('host_capacity_exhausted')


def check_adaptive_budget(containers, memory_mb, cpu_cores, available_mb, total_mb, cores, snapshot, now):
    # Hard memory envelopes remain non-overcommitted. CPU bursts can be shared
    # when measured use is low; each container retains its individual CPU cap.
    memory = 0
    demand = 0
    footprint = 0
    def number(value):
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    try:
        if snapshot['version'] != 1 or snapshot['healthy'] is not True or not number(snapshot['observedAt']) or not 0 <= now - snapshot['observedAt'] <= 8:
            raise KeyError('stale')
        host = snapshot['host']
        if not all(number(host[k]) for k in ['cpuCount', 'totalMb', 'availableMb', 'samples', 'cpuPeakCores', 'memorySomeAvg10', 'memoryFullAvg10']):
            raise KeyError('host')
        if host['samples'] < 3 or host['cpuCount'] != cores or abs(host['totalMb'] - total_mb) > 2:
            raise KeyError('host warming')
        for c in containers:
            h = c['HostConfig']
            if h.get('Memory', 0) <= 0 or h.get('NanoCpus', 0) <= 0:
                raise KeyError('unbounded')
            memory += h['Memory'] / 1048576
            w = snapshot['workers'].get(c['Id'])
            if w is None:
                state = c.get('State', {})
                if state.get('Status') != 'created':
                    started = datetime.datetime.fromisoformat(state['StartedAt'].replace('Z', '+00:00')).timestamp()
                    if not 0 <= now - started <= 8: raise KeyError('worker missing')
                demand += h['NanoCpus'] / 1e9
                footprint += h['Memory'] / 1048576
                continue
            if not all(number(w[k]) for k in ['samples', 'memoryMb', 'memoryPeakMb', 'cpuPeakCores', 'oomKills']) or w['oomKills']:
                raise KeyError('worker invalid or OOM')
            if w['samples'] < 3:
                demand += h['NanoCpus'] / 1e9
                footprint += h['Memory'] / 1048576
                continue
            demand += max(min(0.25, h['NanoCpus'] / 1e9), w['cpuPeakCores'] * 1.25)
            footprint += max(w['memoryMb'] * 1.25, w['memoryPeakMb'] * 1.1)
    except (KeyError, TypeError, ValueError, OverflowError):
        raise CapacityUnavailable('host_capacity_telemetry_unavailable') from None
    budget = total_mb - max(2048, total_mb * 0.2)
    reserve = max(1536, total_mb * 0.1)
    cpu_budget = cores - max(0.5, cores * 0.1)
    if (len(containers) >= 16 or memory + memory_mb > budget or footprint + memory_mb > budget
        or min(available_mb, host['availableMb']) < memory_mb + reserve
        or demand + cpu_cores > cpu_budget or host['cpuPeakCores'] + cpu_cores > cpu_budget
        or host['memorySomeAvg10'] > 5 or host['memoryFullAvg10'] > 1):
        raise CapacityUnavailable('host_capacity_exhausted')


@contextlib.contextmanager
def host_capacity(checked, memory_mb, cpu_cores=2):
    directory = os.environ.get('FTRADE_HOST_CAPACITY_DIR')
    if not directory:
        if os.environ.get('FTRADE_HOST_ADAPTIVE') == '1':
            raise CapacityUnavailable('host_capacity_directory_invalid')
        yield
        return
    if directory != '/run/ftrade-capacity':
        raise ValueError('host_capacity_directory_invalid')
    fd = os.open(directory + '/admission.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CapacityUnavailable('host_capacity_busy') from None
        assert_not_draining(directory)
        ids = set()
        for label in ['io.ftrade.run', 'io.ftrade.compute']:
            ids.update(checked(['ps', '-aq', '--filter', 'label=' + label]).decode().split())
        containers = json.loads(checked(['inspect', *sorted(ids)])) if ids else []
        containers = [c for c in containers if c['State']['Status'] in ['created', 'running', 'restarting', 'paused']]
        mem = {line.split(':')[0]: int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        if os.environ.get('FTRADE_HOST_ADAPTIVE') == '1':
            try:
                snapshot = json.loads(pathlib.Path(directory, 'telemetry.json').read_text())
            except (OSError, ValueError):
                raise CapacityUnavailable('host_capacity_telemetry_unavailable') from None
            check_adaptive_budget(containers, memory_mb, cpu_cores, mem['MemAvailable'] / 1024, mem['MemTotal'] / 1024, os.cpu_count() or 1, snapshot, time.time())
        else:
            check_budget(containers, memory_mb, mem['MemAvailable'] / 1024, mem['MemTotal'] / 1024, os.cpu_count() or 1)
        yield
    finally:
        os.close(fd)
