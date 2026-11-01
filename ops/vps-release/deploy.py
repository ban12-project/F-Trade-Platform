"""Trusted-main release driver. Private configuration/journals never enter Git."""
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path('/opt/ftrade-vps/release')
CAPACITY = pathlib.Path('/opt/ftrade-vps/capacity')
CLI = ['/root/.openship/bin/openship', '--local', '--json']
MONITOR = 'ftrade-capacity-monitor.service'
TERMINAL = {'ready', 'failed', 'rolled_back', 'rollback_failed', 'superseded'}


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp');tmp.write_text(json.dumps(value));tmp.chmod(0o600);os.replace(tmp, path)


def run(args, timeout=60, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, timeout=timeout, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        # Output goes only to the private service log, never the SSH receipt.
        print(result.stdout.decode(errors='replace')[-12000:], flush=True)
        raise RuntimeError('command_failed:' + args[0])
    return result.stdout.decode()


def docker(*args, timeout=60):return run(['docker', *map(str,args)], timeout)

def cli(*args):return json.loads(run(CLI + list(args), 90))

def status(sha, state, reason=None):
    value = {'revision': sha, 'state': state, 'updatedAt': time.time()}
    if reason:value['reason'] = reason
    save(ROOT / 'receipts' / (sha + '.json'), value)
    print(state, flush=True)


@contextlib.contextmanager
def admission_lock():
    fd = os.open(CAPACITY / 'admission.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX);yield
    finally:os.close(fd)


def workers():
    ids=set()
    for label in ['io.ftrade.run','io.ftrade.compute']:
        ids.update(docker('ps','-aq','--filter','label='+label).split())
    return [c for c in json.loads(docker('inspect',*sorted(ids))) if c['State']['Status'] in ['created','running','restarting','paused']] if ids else []


def set_drain(sha):
    with admission_lock():
        path=CAPACITY/'drain.json'
        if path.exists() and json.loads(path.read_text())['revision'] != sha:raise RuntimeError('another_drain_exists')
        save(path,{'revision':sha,'startedAt':time.time()});path.chmod(0o644)


def clear_drain(sha):
    with admission_lock():
        p=CAPACITY/'drain.json'
        if p.exists():
            if json.loads(p.read_text())['revision'] != sha:raise RuntimeError('foreign_drain')
            p.unlink()


def wait_drained(timeout=1200, list_workers=workers, sleep=time.sleep, clock=time.monotonic):
    end=clock()+timeout;empty=0
    while clock()<end:
        empty = empty+1 if not list_workers() else 0
        if empty>=2:return
        sleep(5)
    raise RuntimeError('drain_timeout_no_tasks_killed')


def copied_inputs(dockerfile, context):
    paths={dockerfile}
    text=dockerfile.read_text().replace('\\\n',' ')
    for line in text.splitlines():
        if not line.startswith('COPY '):continue
        parts=shlex.split(line)[1:]
        if parts[0].startswith('--from='):continue
        if any(p.startswith('--') or '[' in p for p in parts):raise RuntimeError('unsupported_copy_manifest')
        for pattern in parts[:-1]:
            for p in context.glob(pattern):
                paths.update(x for x in p.rglob('*') if x.is_file()) if p.is_dir() else paths.add(p)
    return paths


def fingerprints(source):
    browser=source/'ops/browser-node'
    browser_paths=copied_inputs(browser/'browser.Dockerfile',browser)
    browser_paths.update(browser/x for x in ['camofox.ref','prepare-upstream.sh','docker-bake.hcl'])
    compute_paths=copied_inputs(source/'ops/vps-runtime/compute.Dockerfile',source)
    compute_paths.update(copied_inputs(source/'ops/video-sandbox/Dockerfile',source))
    release_paths=set()
    for name in ['ops/browser-node','ops/vps-runtime','ops/host-capacity','ops/vps-release','lib/browser-fleet']:
        # Only tracked files: never hash local Python caches, secrets or upstream clones.
        names=run(['git','ls-files','-z',name],cwd=source).split('\0')
        release_paths.update(source/n for n in names if n)
    release_paths.update(compute_paths)
    if (source/'.dockerignore').exists():release_paths.add(source/'.dockerignore')
    def digest(paths):
        h=hashlib.sha256()
        for p in sorted(paths):h.update(str(p.relative_to(source)).encode()+b'\0'+p.read_bytes()+b'\0')
        return h.hexdigest()
    return {'browserWorker':digest(browser_paths),'computeWorker':digest(compute_paths),'release':digest(release_paths)}


def reserve_build(sha, image, timeout=1200):
    name='ftrade-release-build-'+sha[:12];end=time.monotonic()+timeout
    while time.monotonic()<end:
        with admission_lock():
            m={l.split(':')[0]:int(l.split()[1])/1024 for l in pathlib.Path('/proc/meminfo').read_text().splitlines()}
            active=workers();bounded=all(c['HostConfig']['Memory']>0 for c in active)
            memory=sum(c['HostConfig']['Memory']/1048576 for c in active)
            try:
                metrics=json.loads((CAPACITY/'telemetry.json').read_text())
                cpu_ready=metrics['healthy'] and time.time()-metrics['observedAt']<8 and metrics['host']['cpuPeakCores']+2<=metrics['host']['cpuCount']-.5
            except (OSError,KeyError,ValueError):cpu_ready=False
            if cpu_ready and bounded and memory+2048<=m['MemTotal']-max(2048,m['MemTotal']*.2) and m['MemAvailable']>=3584:
                docker('run','-d','--rm','--name',name,'--label','io.ftrade.compute=release-build','--memory','2g','--memory-swap','2g','--cpus','2','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534','--entrypoint','sleep',image,'7200')
                return name
        time.sleep(5)
    raise RuntimeError('build_capacity_timeout')


def build(source, sha, previous, fp, configs):
    gid=str(pathlib.Path('/var/run/docker.sock').stat().st_gid)
    def image(file, tag, context=source, args=()):
        cmd=['docker','build','--memory','2g','--memory-swap','2g','--cpu-period','100000','--cpu-quota','200000','--label','org.opencontainers.image.revision='+sha,'-q','-t',tag,'-f',str(file)]
        for arg in args:cmd+=['--build-arg',arg]
        run(cmd+[str(context)],2700,env={**os.environ,'DOCKER_BUILDKIT':'0'})
        return docker('image','inspect','--format','{{.Id}}',tag).strip()
    updated=json.loads(json.dumps(configs))
    updated['browser']['image']=image(source/'ops/browser-node/openship.Dockerfile','ftrade-release-agent:'+sha)
    updated['runtime']['image']=image(source/'ops/vps-runtime/openship.Dockerfile','ftrade-release-broker:'+sha,args=['DOCKER_GID='+gid])
    docker('run','--rm','--network','none','--memory','512m','--entrypoint','node',updated['browser']['image'],'ops/browser-node/smoke.mjs',timeout=90)
    docker('run','--rm','--network','none','--memory','256m','-e','FTRADE_RUNTIME_TOKEN='+'a'*64,'-e','FTRADE_COMPUTE_IMAGE=sha256:'+'b'*64,'--entrypoint','python3',updated['runtime']['image'],'-c',"import runpy;m=runpy.run_path('/app/server.py',run_name='smoke');assert m['PROFILES']['light']['memory']==512")
    if previous.get('browserWorker')!=fp['browserWorker']:
        run(['sh','ops/browser-node/prepare-upstream.sh'],180,cwd=source)
        hcl=(source/'ops/browser-node/docker-bake.hcl').read_text()
        args=[key+'='+re.search(key+r'\s*=\s*"([\w.-]+)"',hcl)[1] for key in ['CAMOUFOX_VERSION','CAMOUFOX_RELEASE']]
        base=image(source/'ops/browser-node/upstream/Dockerfile.ci','ftrade-release-camofox:'+sha,source/'ops/browser-node/upstream',args)
        worker=image(source/'ops/browser-node/browser.Dockerfile','ftrade-release-browser:'+sha,source/'ops/browser-node',['BROWSER_BASE_IMAGE='+base])
        updated['browser']['environment']['BROWSER_IMAGE']=worker
        # Run the existing complete offline browser-image acceptance on this exact pair.
        docker('tag',updated['browser']['image'],'ftrade-release-browser-node:'+sha+'-amd64')
        docker('tag',worker,'ftrade-release-browser:'+sha+'-amd64')
        env={**os.environ,'IMAGE_PREFIX':'ftrade-release','BUILD_TAG':sha,'ARCH':'amd64','REVISION':sha}
        run(['bash','scripts/test-browser-images.sh'],600,cwd=source,env=env)
    if previous.get('computeWorker')!=fp['computeWorker']:
        base=image(source/'ops/video-sandbox/Dockerfile','ftrade-release-media:'+sha)
        worker=image(source/'ops/vps-runtime/compute.Dockerfile','ftrade-release-compute:'+sha,args=['MEDIA_BASE='+base])
        updated['runtime']['environment']['FTRADE_COMPUTE_IMAGE']=worker
        docker('run','--rm','--network','none','--memory','2g','-v',str(source/'scripts')+':/test:ro',worker,'/opt/markitdown/bin/python3','/test/test-document-sandbox.py',timeout=180)
        docker('run','--rm','--network','none','--memory','2g',worker,'node','--input-type=module','-e',"import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';execFileSync(readFileSync('/opt/ftrade-remotion/browser-path','utf8'),['--version']);",timeout=60)
    for script in ['scripts/test-vps-compute.py','ops/vps-runtime/test-openship.py','ops/vps-runtime/test-quota-admission.py']:
        run(['python3',script],120,cwd=source)
    run(['python3','-m','unittest','discover','-s','ops/host-capacity','-p','test*.py'],60,cwd=source)
    return updated


def apply(target, config, path):
    save(path,config)
    cli('service','update',target['service'],str(path),'-p',target['project'])
    result=cli('deploy','--project',target['project'],'--refresh')
    return result['deployment_id']


def healthy(target, image, timeout=180, deployment=None):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            if deployment and cli('deployment','get',deployment)['status'] != 'ready':
                time.sleep(3);continue
            c=json.loads(docker('inspect',target['container']))[0]
            if c['Image']==image and c['State']['Status']=='running' and c['State'].get('Health',{}).get('Status')=='healthy':return
        except Exception:pass
        time.sleep(3)
    raise RuntimeError('healthcheck_failed:'+target['service'])


def monitor_restore(backup):
    for filename,dest in [('monitor.py',CAPACITY/'monitor.py'),('monitor.service',pathlib.Path('/etc/systemd/system')/(MONITOR))]:
        shutil.copy2(backup/filename,dest)
    run(['systemctl','daemon-reload'])


def rollback(cfg, journal):
    for dep in journal.get('deployments', []):
        state=cli('deployment','get',dep)['status']
        if state not in ['ready','error','failed','cancelled','canceled']:
            cli('deployment','cancel',dep)
            end=time.monotonic()+60
            while time.monotonic()<end:
                if cli('deployment','get',dep)['status'] in ['ready','error','failed','cancelled','canceled']:break
                time.sleep(2)
            else:raise RuntimeError('pending_deployment_not_cancelled')
    run(['systemctl','stop',MONITOR])
    for name,target in cfg['targets'].items():
        with contextlib.suppress(Exception):cli('service','stop',target['service'],'-p',target['project'])
    monitor_restore(pathlib.Path(journal['backup']))
    for name,target in cfg['targets'].items():
        dep=apply(target,journal['previous'][name],ROOT/'rollback-configs'/(name+'.json'))
        healthy(target,journal['previous'][name]['image'],deployment=dep)
    run(['systemctl','start',MONITOR])
    if 'previousState' in journal:save(ROOT/'state.json',journal['previousState'])


def promote(cfg, previous, updated, source, sha):
    backup=ROOT/'backups'/sha;backup.mkdir(parents=True,exist_ok=True)
    shutil.copy2(CAPACITY/'monitor.py',backup/'monitor.py')
    shutil.copy2(pathlib.Path('/etc/systemd/system')/MONITOR,backup/'monitor.service')
    journal={'revision':sha,'previous':previous,'backup':str(backup),'startedAt':time.time(),'previousState':json.loads((ROOT/'state.json').read_text()),'deployments':[]}
    save(ROOT/'journal.json',journal)
    try:
        for target in cfg['targets'].values():cli('service','stop',target['service'],'-p',target['project'])
        run(['sh',str(source/'ops/host-capacity/install-monitor.sh')])
        for name,target in cfg['targets'].items():
            dep=apply(target,updated[name],ROOT/'candidate-configs'/(name+'.json'))
            journal['deployments'].append(dep);save(ROOT/'journal.json',journal)
            healthy(target,updated[name]['image'],deployment=dep)
        snapshot=json.loads((CAPACITY/'telemetry.json').read_text())
        if not snapshot['healthy'] or time.time()-snapshot['observedAt']>8:raise RuntimeError('monitor_not_healthy')
        # Public edge is intentionally separate from OpenShip-managed services.
        with urllib.request.urlopen(cfg['runtimeHealth'],timeout=10) as r:
            if r.status!=200:raise RuntimeError('edge_health_failed')
    except BaseException:
        try:
            rollback(cfg,journal);(ROOT/'journal.json').unlink();status(sha,'rolled_back','promotion_failed_previous_version_restored')
        except BaseException:
            status(sha,'rollback_failed','drain_retained_recovery_required')
        raise


def main(sha):
    source=pathlib.Path.cwd();cfg=json.loads((ROOT/'config.json').read_text());state=json.loads((ROOT/'state.json').read_text())
    if (ROOT/'journal.json').exists():
        journal=json.loads((ROOT/'journal.json').read_text())
        rollback(cfg,journal);(ROOT/'journal.json').unlink();clear_drain(journal['revision'])
        status(journal['revision'],'rolled_back','interrupted_release_recovered')
        state=json.loads((ROOT/'state.json').read_text())
    elif (CAPACITY/'drain.json').exists():
        orphan=json.loads((CAPACITY/'drain.json').read_text())
        # No journal means no promotion began, or a completed commit was made.
        for name,target in cfg['targets'].items():healthy(target,state['configs'][name]['image'])
        run(['systemctl','start',MONITOR]);clear_drain(orphan['revision'])
        status(orphan['revision'],'ready' if state['revision']==orphan['revision'] else 'failed','interrupted_drain_recovered')
    if json.loads((source/'ops/vps-release/contract.json').read_text())!=cfg['contract']:raise RuntimeError('host_contract_requires_review')
    pool=pathlib.Path(cfg['contract']['poolPath'])
    if not os.path.ismount(pool) or (pool/'.ftrade-quota-v2').read_text().strip()!=cfg['contract']['quotaMarker'] or (pool.parent/'workspace.img').stat().st_size!=cfg['contract']['poolBytes']:raise RuntimeError('host_contract_mismatch')
    fp=fingerprints(source)
    if fp==state['fingerprints']:
        status(sha,'ready','runtime_inputs_unchanged');return
    configs=state['configs']
    worker_build=any(fp[k]!=state['fingerprints'].get(k) for k in ['browserWorker','computeWorker'])
    disk=shutil.disk_usage(ROOT)
    if disk.free < (12 if worker_build else 4)*1024**3:raise RuntimeError('insufficient_build_disk_headroom')
    # Refuse to overwrite edits made independently in OpenShip/the host.
    for name,target in cfg['targets'].items():
        actual=json.loads(docker('inspect',target['container']))[0]
        if actual['Image']!=configs[name]['image']:raise RuntimeError('service_drift_requires_reconciliation')
        resources=configs[name]['advanced']['resources']
        if actual['HostConfig']['Memory']!=resources['memoryMb']*1048576 or actual['HostConfig']['NanoCpus']!=int(resources['cpuCores']*1e9):raise RuntimeError('service_resource_drift')
        expected={}
        for entry in configs[name]['volumes']:
            parts=entry.split(':');expected[parts[1]]={'Source':parts[0],'RW':len(parts)<3 or parts[2]!='ro'}
        mounted={m['Destination']:{'Source':m['Source'],'RW':m['RW']} for m in actual['Mounts']}
        if mounted!=expected:raise RuntimeError('service_mount_drift')
        ports={}
        for entry in configs[name]['ports']:
            address,port,inside=entry.split(':');ports[inside+'/tcp']=[{'HostIp':address,'HostPort':port}]
        if actual['HostConfig']['PortBindings']!=ports:raise RuntimeError('service_port_drift')
        env=dict(v.split('=',1) for v in actual['Config']['Env'])
        if any(env.get(k)!=v for k,v in configs[name]['environment'].items()):raise RuntimeError('service_environment_drift')
    reservation=None;draining=False;legacy=False
    try:
        status(sha,'waiting_for_build_capacity')
        reservation=reserve_build(sha,configs['runtime']['environment']['FTRADE_COMPUTE_IMAGE'])
        status(sha,'building_and_testing')
        updated=build(source,sha,state['fingerprints'],fp,configs)
        docker('rm','-f',reservation);reservation=None
        # Superseded queued builds must not move the production revision backwards.
        head=run(['git','ls-remote','origin','refs/heads/main'],cwd=source).split()[0]
        if head!=sha:status(sha,'superseded');return
        status(sha,'draining');set_drain(sha);draining=True
        legacy=any(json.loads(docker('inspect',t['container']))[0]['Config'].get('Labels',{}).get('io.ftrade.release-drain')!='1' for t in cfg['targets'].values())
        if legacy:
            # One-time bootstrap: existing adaptive controllers fail closed on
            # stale telemetry, while their running tasks keep executing.
            run(['systemctl','stop',MONITOR]);time.sleep(10)
        wait_drained()
        status(sha,'promoting');promote(cfg,configs,updated,source,sha)
        save(ROOT/'state.json',{'revision':sha,'configs':updated,'fingerprints':fp})
        (ROOT/'journal.json').unlink()
        clear_drain(sha);draining=False
        status(sha,'ready')
    except BaseException:
        receipt=json.loads((ROOT/'receipts'/(sha+'.json')).read_text())
        if receipt['state'] not in TERMINAL:status(sha,'failed','release_failed_before_promotion')
        raise
    finally:
        if reservation:
            with contextlib.suppress(Exception):docker('rm','-f',reservation)
        if not (ROOT/'journal.json').exists():
            if legacy:run(['systemctl','start',MONITOR])
            if draining:clear_drain(sha)


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(SystemExit('terminated')))
    if len(sys.argv)!=2 or not re.fullmatch(r'[a-f0-9]{40}',sys.argv[1]):sys.exit(1)
    try:main(sys.argv[1])
    except BaseException as error:
        print(type(error).__name__+': '+str(error),flush=True)
        receipt=ROOT/'receipts'/(sys.argv[1]+'.json')
        if not receipt.exists() or json.loads(receipt.read_text())['state'] not in TERMINAL:
            status(sys.argv[1],'failed','preflight_or_recovery_failed')
        sys.exit(1)
