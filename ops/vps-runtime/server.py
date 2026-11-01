"""Private control API. Only fixed images, offline containers, no host mounts.
Run behind HTTPS on loopback; never expose Docker's socket over the network.
"""
import base64
import http.client
import ipaddress
import socket
import ssl
import selectors
import signal
from urllib.parse import urlsplit
import hmac
import json
import os
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "host-capacity"))
from admission import host_capacity, CapacityUnavailable
import shutil
import re
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ['FTRADE_RUNTIME_TOKEN']
IMAGE = os.environ['FTRADE_COMPUTE_IMAGE']
BLOB_HOSTS = frozenset(filter(None, os.environ.get('FTRADE_BLOB_HOSTS', '').split(',')))
if not re.fullmatch(r'[A-Za-z0-9_-]{48,256}', TOKEN) or not re.fullmatch(r'sha256:[a-f0-9]{64}', IMAGE):
    raise RuntimeError('invalid runtime configuration')
MEMORY_MB = int(os.environ.get('FTRADE_COMPUTE_MEMORY_MB', '2048'))
if not 1024 <= MEMORY_MB <= 3072:
    raise RuntimeError('invalid compute memory budget')
MAX_RUNNING = int(os.environ.get('FTRADE_COMPUTE_MAX_RUNNING', '1'))
POOL_GIB = int(os.environ.get('FTRADE_WORKSPACE_POOL_GIB', '12'))
QUOTA_ENABLED = os.environ.get('FTRADE_WORKSPACE_QUOTAS', '0') == '1'
JOB_GROUPS = {}
QUOTA_BYTES = 5 * 1024**3
if not 1 <= MAX_RUNNING <= 16 or not 12 <= POOL_GIB <= 1024:
    raise RuntimeError('invalid capacity configuration')
WORKSPACE_ROOT = pathlib.Path(os.environ.get('FTRADE_WORKSPACE_ROOT', '/opt/ftrade-vps/compute/workspaces'))
# These are trusted deployment settings, never values supplied by API clients.
# The mount must use the identical absolute path on the Docker host and broker.
if not re.fullmatch(r'/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*', str(WORKSPACE_ROOT)):
    raise RuntimeError('invalid workspace root')
NAMESPACE = os.environ.get('FTRADE_RUNTIME_NAMESPACE', 'production')
if not re.fullmatch(r'[a-z][a-z0-9-]{0,31}', NAMESPACE):
    raise RuntimeError('invalid runtime namespace')
LABEL_VALUE = '1' if NAMESPACE == 'production' else NAMESPACE
CONTAINER_PREFIX = 'ftrade-compute-' if NAMESPACE == 'production' else 'ftrade-compute-' + NAMESPACE + '-'
MAX_FILE_BYTES = 1024**3 - 1
MAX_DOWNLOAD_BYTES = MAX_FILE_BYTES * 3
DOWNLOAD_BYTES = {}
LABEL = 'io.ftrade.compute'
LOCK = threading.Lock()
SLOTS = threading.BoundedSemaphore(4)
SESSIONS = {}
LIMIT = 12 * 1024 * 1024


def docker(args, data=None, timeout=30):
    # Read output incrementally. Spooling first and checking later lets a noisy
    # command fill the host disk before the output limit is enforced.
    with subprocess.Popen(['docker', *args], stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
        if data is not None:
            # Inputs are bounded to one chunk. communicate would buffer unlimited
            # output; use a writer thread while draining both output pipes.
            def write():
                try:
                    proc.stdin.write(data)
                    proc.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
            writer = threading.Thread(target=write, daemon=True)
            writer.start()
        buffers = [bytearray(), bytearray()]
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ, 0)
        selector.register(proc.stderr, selectors.EVENT_READ, 1)
        deadline = time.monotonic() + timeout
        try:
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise TimeoutError('docker_deadline')
                for key, _ in selector.select(min(0.2, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        buffers[key.data].extend(chunk)
                        if sum(map(len, buffers)) > LIMIT:
                            raise ValueError('output_limit')
            proc.wait(timeout=max(0.1, deadline-time.monotonic()))
            return proc.returncode, bytes(buffers[0]), bytes(buffers[1])
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        finally:
            selector.close()


def checked(args, data=None, timeout=30):
    code, out, _ = docker(args, data, timeout)
    if code:
        raise ValueError('container_operation_failed')
    return out


def path(value):
    if not isinstance(value, str) or len(value) > 512 or not re.fullmatch(r'/vercel/sandbox/work(?:/[a-zA-Z0-9_.-]+)*', value):
        raise ValueError('invalid_path')
    if any(p in ('.', '..') for p in value.split('/')):
        raise ValueError('invalid_path')
    return value


FS_SCRIPT = '''import sys,json,base64,os,shutil
r=json.load(sys.stdin); p=r['path']; op=r['op']
for candidate in (p, r.get('destination', p)):
 resolved=os.path.realpath(candidate)
 if not (resolved=='/vercel/sandbox/work' or resolved.startswith('/vercel/sandbox/work/')): raise ValueError('path_escape')
if op=='mkdir': os.makedirs(p,exist_ok=True); value=None
elif op=='write':
 with open(p, 'wb' if r['offset']==0 else 'r+b') as f:
  f.seek(r['offset']); f.write(base64.b64decode(r['data'],validate=True))
 value=None
elif op=='read':
 with open(p,'rb') as f:
  f.seek(r['offset']); value=base64.b64encode(f.read(4*1024*1024)).decode()
elif op=='rm':
 if os.path.isfile(p): os.unlink(p)
 value=None
elif op=='copy': shutil.copyfile(p,r['destination']); value=None
else: raise ValueError('invalid_operation')
print(json.dumps(value))
'''


def download_target(url, hostname):
    if not isinstance(url, str) or len(url) > 16384 or not isinstance(hostname, str):
        raise ValueError('invalid_source')
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname != hostname or hostname not in BLOB_HOSTS
            or parsed.username or parsed.password or parsed.fragment or parsed.port not in (None,443)
            or any(ord(c) < 32 for c in url)):
        raise ValueError('source_not_allowed')
    addresses = {record[4][0] for record in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError('source_address_not_public')
    return parsed, sorted(addresses)[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, hostname, address, timeout):
        super().__init__(hostname, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def download(url, hostname, destination, name, deadline, budget=MAX_DOWNLOAD_BYTES):
    parsed, address = download_target(url, hostname)
    conn = PinnedHTTPS(hostname, address, min(30, max(1, deadline-time.monotonic())))
    try:
        conn.request('GET', (parsed.path or '/') + ('?' + parsed.query if parsed.query else ''),
                     headers={'Accept-Encoding':'identity'})
        response = conn.getresponse()
        # Never follow redirects: a signed object URL grants access only to that
        # object at that approved origin, not a redirect destination.
        if response.status != 200 or response.getheader('Content-Encoding', 'identity') != 'identity':
            raise ValueError('source_response_invalid')
        length = response.getheader('Content-Length')
        maximum = min(MAX_FILE_BYTES, budget)
        if length is not None and (not length.isdigit() or int(length) > maximum):
            raise ValueError('source_too_large')
        offset = 0
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError('download_deadline')
            chunk = response.read(4 * 1024**2)
            if not chunk:
                if offset == 0:
                    raise ValueError('source_empty')
                break
            if offset + len(chunk) > maximum:
                raise ValueError('source_too_large')
            spec={'op':'write','path':destination,'offset':offset,'data':base64.b64encode(chunk).decode()}
            checked(['exec','--user',job_user(name),'-i',name,'python3','-c',FS_SCRIPT],json.dumps(spec).encode(),min(30,max(1,deadline-time.monotonic())))
            offset += len(chunk)
        if length is not None and offset != int(length):
            raise ValueError('source_truncated')
        return offset
    finally:
        conn.close()


def workspace_pool_ready():
    # A bind mount alone is not proof of the host pool mount: Docker can bind the
    # empty underlying directory after a reboot. Check the expected filesystem
    # size and marker as well, rejecting fallback to the much larger rootfs.
    if not WORKSPACE_ROOT.is_dir() or not os.path.ismount(WORKSPACE_ROOT):
        raise ValueError('workspace_pool_not_mounted')
    resolved = WORKSPACE_ROOT.resolve()
    if resolved != WORKSPACE_ROOT:
        raise ValueError('workspace_pool_symlink')
    capacity = os.statvfs(WORKSPACE_ROOT)
    size = capacity.f_blocks * capacity.f_frsize
    if not (POOL_GIB - 1) * 1024**3 < size <= POOL_GIB * 1024**3:
        raise ValueError('workspace_pool_capacity_invalid')
    if (WORKSPACE_ROOT / '.ftrade-workspace-pool').read_text().strip() != 'ftrade-compute-v1':
        raise ValueError('workspace_pool_identity_invalid')
    # The mount must itself be ext4, not merely a size-compatible directory.
    mounts = pathlib.Path('/proc/self/mountinfo').read_text().splitlines()
    matching = [line for line in mounts if line.split()[4] == str(WORKSPACE_ROOT)]
    if not matching or not all(' - ext4 ' in line for line in matching):
        raise ValueError('workspace_pool_filesystem_invalid')
    if QUOTA_ENABLED:
        if not any('grpquota' in line for line in matching):
            raise ValueError('workspace_group_quota_not_mounted')
        if (WORKSPACE_ROOT / '.ftrade-quota-v1').read_text().strip() != '20000:20015:5368709120:65536':
            raise ValueError('workspace_quota_configuration_invalid')
    return capacity


def remove_container(name):
    code, _, _ = docker(['rm', '-f', name])
    # A failed rm is not evidence of success. Only a successful list with this
    # exact name absent can establish that the independent deadline removed it.
    names = checked(['ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
    if name in names:
        raise ValueError('container_stop_unconfirmed')


def instance_workspace():
    # Never traverse a user-created symlink into another instance's workspaces.
    # Production retains the original paths for compatibility and rollback.
    if NAMESPACE == 'production':
        return WORKSPACE_ROOT
    directory = WORKSPACE_ROOT / ('instance-' + NAMESPACE)
    if directory.is_symlink():
        raise ValueError('workspace_namespace_symlink')
    directory.mkdir(mode=0o700, exist_ok=True)
    return directory


def cleanup_previous_sessions():
    workspace_pool_ready()
    for cid in checked(['ps', '-aq', '--filter', f'label={LABEL}={LABEL_VALUE}']).decode().split():
        checked(['rm', '-f', cid])
    for directory in instance_workspace().glob('job-*'):
        remove_workspace(directory.name.removeprefix('job-'))
    if QUOTA_ENABLED:
        for _, record in quota_records():
            if record['namespace'] == NAMESPACE:
                remove_workspace(record['sid'])


def remove_workspace(sid):
    if not re.fullmatch(r'[a-f0-9-]{36}', sid):
        raise ValueError('invalid_workspace')
    workspace_pool_ready()
    directory = instance_workspace() / ('job-' + sid)
    if directory.exists():
        if directory.is_symlink():
            raise ValueError('workspace_symlink')
        # Only after the container has been confirmed absent. Tools share this
        # UID and may chmod their own directories to 000; restore owner traversal
        # without following symlinks, then use Python's fd-safe rmtree.
        os.chmod(directory, 0o700, follow_symlinks=False)
        for parent, directories, _ in os.walk(directory, topdown=True, followlinks=False):
            for child in directories:
                path = pathlib.Path(parent) / child
                if not path.is_symlink():
                    os.chmod(path, 0o700, follow_symlinks=False)
        shutil.rmtree(directory)
    DOWNLOAD_BYTES.pop(sid, None)
    if QUOTA_ENABLED:
        for file, record in quota_records():
            if record['namespace'] == NAMESPACE and record['sid'] == sid:
                file.unlink(missing_ok=True)
        JOB_GROUPS.pop(CONTAINER_PREFIX + sid, None)


def quota_records():
    root = WORKSPACE_ROOT / '.quota-allocations'
    root.mkdir(mode=0o700, exist_ok=True)
    records = []
    for file in root.glob('*.json'):
        try:
            data = json.loads(file.read_text())
        except FileNotFoundError:
            # A finished worker may release its reservation during this scan.
            continue
        if not re.fullmatch(r'[a-f0-9-]{36}', data.get('sid', '')) or not re.fullmatch(r'[a-z][a-z0-9-]{0,31}', data.get('namespace', '')):
            raise ValueError('quota_record_invalid')
        gid = int(file.stem)
        if not 20000 <= gid <= 20015:
            raise ValueError('quota_group_invalid')
        records.append((file, data))
    return records


def reserve_quota(sid, pool):
    # Kernel group quotas bound each job. The shared pool is not partitioned or
    # preallocated per job; reserve admission headroom for simultaneous peaks.
    records = quota_records()
    slots = min(16, (pool.f_blocks * pool.f_frsize - 1024**3) // QUOTA_BYTES)
    if len(records) >= slots:
        raise CapacityUnavailable('workspace_quota_capacity_busy')
    used = {int(file.stem) for file, _ in records}
    gid = next(g for g in range(20000, 20016) if g not in used)
    root = WORKSPACE_ROOT / '.quota-allocations'
    temporary = root / ('.tmp-' + sid)
    temporary.write_text(json.dumps({'sid': sid, 'namespace': NAMESPACE}))
    os.replace(temporary, root / (str(gid) + '.json'))
    return gid


def job_user(name):
    return '1000:' + str(JOB_GROUPS[name] if QUOTA_ENABLED else 1000)


def dispatch(body):
    action = body.get('action')
    if action == 'create':
        with LOCK, host_capacity(checked, MEMORY_MB):
            # All capacity checks and creation are serialized. Container deadline
            # also runs independently of this API process. Its UID differs from
            # all tools, so a compromised parser cannot signal/freeze sleep/init.
            pool = workspace_pool_ready()
            active = checked(['ps', '-aq', '--filter', f'label={LABEL}']).splitlines()
            if len(active) >= MAX_RUNNING:
                raise CapacityUnavailable('capacity_exhausted')
            required_free = 1024**3 if QUOTA_ENABLED else 10 * 1024**3
            if pool.f_bavail * pool.f_frsize < required_free:
                raise CapacityUnavailable('workspace_pool_capacity_unavailable')
            sid = str(uuid.uuid4())
            name = CONTAINER_PREFIX + sid
            directory = instance_workspace() / ('job-' + sid)
            directory.mkdir(mode=0o700)
            # Register before Docker invocation: an ambiguous timeout can leave a
            # live container. Failed cleanup remains tracked for the reaper.
            DOWNLOAD_BYTES[sid] = 0
            SESSIONS[sid] = (name, time.monotonic() + 600, threading.Lock())
            try:
                if QUOTA_ENABLED:
                    JOB_GROUPS[name] = reserve_quota(sid, pool)
                checked(['run', '-d', '--rm', '--name', name, '--label', f'{LABEL}={LABEL_VALUE}',
                         '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                         '--security-opt', 'no-new-privileges', '--user', '65534:65534',
                         '--memory', f'{MEMORY_MB}m', '--memory-swap', f'{MEMORY_MB}m', '--cpus', '2', '--pids-limit', '256',
                         '--log-driver', 'none', '--init',
                         '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
                         '--mount', f'type=bind,source={directory},target=/vercel/sandbox/work',
                         '--entrypoint', 'sleep', IMAGE, '600'])
                if QUOTA_ENABLED:
                    checked(['exec', '--user', job_user(name), name, 'python3', '-c',
                             f'import os;assert os.getuid()==1000 and os.getgid()=={JOB_GROUPS[name]};assert all(g=={JOB_GROUPS[name]} for g in os.getgroups())'])
            except Exception:
                try:
                    remove_container(name)
                    remove_workspace(sid)
                    SESSIONS.pop(sid, None)
                except Exception:
                    pass
                raise
            return {'id': sid}
    sid = body.get('id')
    if not isinstance(sid, str) or sid not in SESSIONS:
        raise ValueError('unknown_session')
    name, deadline, lock = SESSIONS[sid]
    with lock:
        if action == 'stop':
            remove_container(name)
            remove_workspace(sid)
            SESSIONS.pop(sid, None)
            return None
        remaining = int(deadline - time.monotonic())
        if remaining < 1:
            raise ValueError('session_expired')
        if action == 'download':
            size = download(body.get('url'), body.get('hostname'), path(body.get('path')), name, deadline, MAX_DOWNLOAD_BYTES - DOWNLOAD_BYTES.get(sid, 0))
            DOWNLOAD_BYTES[sid] = DOWNLOAD_BYTES.get(sid, 0) + size
            return None
        if action == 'fs':
            spec = {'op': body.get('op'), 'path': path(body.get('path'))}
            if spec['op'] in ('write', 'read'):
                offset = body.get('offset', 0)
                if type(offset) is not int or not 0 <= offset <= MAX_FILE_BYTES:
                    raise ValueError('invalid_offset')
                spec['offset'] = offset
            if spec['op'] == 'write':
                value = body.get('data')
                if not isinstance(value, str) or len(value) > 6 * 1024 * 1024:
                    raise ValueError('invalid_data')
                decoded = base64.b64decode(value, validate=True)
                if len(decoded) > 4 * 1024**2 or spec['offset'] + len(decoded) > MAX_FILE_BYTES:
                    raise ValueError('file_limit')
                spec['data'] = value
            if spec['op'] == 'copy':
                spec['destination'] = path(body.get('destination'))
            return json.loads(checked(['exec', '--user', job_user(name), '-i', name, 'python3', '-c', FS_SCRIPT], json.dumps(spec).encode(), min(30, remaining)))
        if action == 'command':
            cmd, args, env = body.get('cmd'), body.get('args', []), body.get('env', {})
            if cmd not in ('ffmpeg', 'ffprobe', '/opt/markitdown/bin/python3', 'node'):
                raise ValueError('command_not_allowed')
            if not isinstance(args, list) or len(args) > 256 or any(not isinstance(x,str) or len(x)>4096 for x in args):
                raise ValueError('invalid_arguments')
            allowed = ('F_TRADE_METADATA_PREFLIGHT', 'F_TRADE_LOCAL_OCR_ENABLED', 'F_TRADE_LOCAL_OCR_LANGUAGE')
            if not isinstance(env, dict) or any(k not in allowed or not isinstance(v,str) or len(v)>100 for k,v in env.items()):
                raise ValueError('invalid_environment')
            env_args = [a for k,v in env.items() for a in ('-e', k+'='+v)]
            code, out, err = docker(['exec', '--user', job_user(name), *env_args, '-w', '/vercel/sandbox', name, 'timeout', str(remaining), cmd, *args], timeout=remaining+5)
            return {'exitCode': code, 'stdout': out.decode(errors='replace'), 'stderr': err.decode(errors='replace')}
    raise ValueError('invalid_action')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No request payloads, signed URLs or credentials in logs.

    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Length','2')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(b'ok')

    def do_POST(self):
        if self.path != '/v1/compute' or not hmac.compare_digest(self.headers.get('Authorization','').encode(), ('Bearer '+TOKEN).encode()):
            self.send_error(403)
            return
        try:
            self.connection.settimeout(30)
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= LIMIT:
                raise ValueError('body_limit')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('invalid_request')
            result = dispatch(body)
            payload = json.dumps({'result': result}).encode()
            self.send_response(200)
        except CapacityUnavailable:
            payload = b'{"error":"runtime_capacity_busy"}'
            self.send_response(429)
            self.send_header('Retry-After', '2')
        except Exception:
            payload = b'{"error":"runtime_request_failed"}'
            self.send_response(400)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class BrokerServer(ThreadingHTTPServer):
    daemon_threads = True

    def process_request(self, request, address):
        # Bound threads before parsing requests, including unauthenticated slow
        # clients. The reverse proxy should additionally cap request body size.
        if not SLOTS.acquire(blocking=False):
            try:
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            finally:
                self.shutdown_request(request)
            return
        request.settimeout(30)
        try:
            super().process_request(request, address)
        except BaseException:
            SLOTS.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            SLOTS.release()


def reap():
    while True:
        time.sleep(10)
        with LOCK:
            for sid, (name, deadline, lock) in list(SESSIONS.items()):
                if time.monotonic() > deadline:
                    with lock:
                        try:
                            remove_container(name)
                            remove_workspace(sid)
                        except Exception:
                            # Retain state and retry; never acknowledge uncertain cleanup.
                            continue
                        SESSIONS.pop(sid, None)


if __name__ == '__main__':
    def terminate(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    # After a service restart no previous capability is valid. Remove only this
    # service's ephemeral containers; browser profile volumes are never touched.
    cleanup_previous_sessions()
    threading.Thread(target=reap, daemon=True).start()
    BrokerServer((os.environ.get('FTRADE_RUNTIME_BIND', '127.0.0.1'), 9500), Handler).serve_forever()
