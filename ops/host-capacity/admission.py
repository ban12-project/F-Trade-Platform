"""Atomic host admission shared with the browser Agent's Linux flock."""
import contextlib
import fcntl
import json
import os
import pathlib


class CapacityUnavailable(ValueError):
    pass


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


@contextlib.contextmanager
def host_capacity(checked, memory_mb):
    directory = os.environ.get('FTRADE_HOST_CAPACITY_DIR')
    if not directory:
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
        ids = set()
        for label in ['io.ftrade.run', 'io.ftrade.compute']:
            ids.update(checked(['ps', '-aq', '--filter', 'label=' + label]).decode().split())
        containers = json.loads(checked(['inspect', *sorted(ids)])) if ids else []
        containers = [c for c in containers if c['State']['Status'] in ['created', 'running', 'restarting', 'paused']]
        mem = {line.split(':')[0]: int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        check_budget(containers, memory_mb, mem['MemAvailable'] / 1024, mem['MemTotal'] / 1024, os.cpu_count() or 1)
        yield
    finally:
        os.close(fd)
