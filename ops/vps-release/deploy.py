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
import stat
import subprocess
import sys
import tempfile
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
    browser_paths.update(browser/x for x in ['docker-bake.hcl','browser.Dockerfile.dockerignore'])
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
    # The resource-limited legacy builder does not populate BuildKit platform ARGs.
    reported=docker('info','--format','{{.Architecture}}').strip()
    arch={'x86_64':'amd64','amd64':'amd64','aarch64':'arm64','arm64':'arm64'}.get(reported)
    if arch is None:raise RuntimeError('unsupported_build_architecture')
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
        worker=image(source/'ops/browser-node/browser.Dockerfile','ftrade-release-browser:'+sha,source/'ops/browser-node',['TARGETARCH='+arch])
        updated['browser']['environment']['BROWSER_IMAGE']=worker
        # Run the existing complete offline browser-image acceptance on this exact pair.
        docker('tag',updated['browser']['image'],'ftrade-release-browser-node:'+sha+'-'+arch)
        docker('tag',worker,'ftrade-release-browser:'+sha+'-'+arch)
        env={**os.environ,'IMAGE_PREFIX':'ftrade-release','BUILD_TAG':sha,'ARCH':arch,'REVISION':sha}
        # The VPS intentionally has no host Node installation. Use the exact
        # Agent image's executable for the test driver, then remove the copy.
        with tempfile.TemporaryDirectory(prefix='ftrade-release-node-') as node_dir:
            container=docker('create',updated['browser']['image']).strip()
            try:docker('cp',container+':/usr/local/bin/node',str(pathlib.Path(node_dir)/'node'))
            finally:docker('rm',container)
            env['PATH']=node_dir+os.pathsep+os.environ.get('PATH','')
            run(['node','--version'],30,env=env)
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


def profile_backup_node_id(config):
    env=config['environment'];key=env.get('BROWSER_NODE_ACCESS_KEY','')
    if env.get('BROWSER_NODE_ACCESS_KEY_FILE'):
        target=pathlib.PurePosixPath(env['BROWSER_NODE_ACCESS_KEY_FILE'])
        if not target.is_absolute() or '..' in target.parts:raise RuntimeError('profile_backup_key_path_invalid')
        mounts=[entry.split(':') for entry in config.get('volumes',[])]
        candidates=[]
        for parts in mounts:
            if len(parts) not in [2,3] or not pathlib.Path(parts[0]).is_absolute():continue
            inside=pathlib.PurePosixPath(parts[1])
            if target==inside or inside in target.parents:
                candidates.append((len(inside.parts),pathlib.Path(parts[0])/str(target.relative_to(inside))))
        if not candidates:raise RuntimeError('profile_backup_key_mount_unavailable')
        path=max(candidates,key=lambda value:value[0])[1]
        with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'r',encoding='ascii') as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size>4096 or info.st_mode & 0o022:
                raise RuntimeError('profile_backup_key_file_invalid')
            key=stream.read(4097).strip()
    match=re.fullmatch(r'fbn_([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.[A-Za-z0-9_-]{43}',key)
    if not match:raise RuntimeError('profile_backup_node_identity_unavailable')
    return match[1]


def backup_profiles_for_official_cutover(previous, updated, source, backup, sha):
    old = previous.get('browser', {}).get('environment', {}).get('BROWSER_IMAGE')
    new = updated.get('browser', {}).get('environment', {}).get('BROWSER_IMAGE')
    if not old or not new or old == new:return None
    def official(image):
        value=json.loads(docker('image','inspect',image))[0]
        return (value['Config'].get('Labels') or {}).get('io.ftrade.official-camoufox')=='1'
    if not official(new) or official(old):return None
    # This one-time transition needs a fresh snapshot after drain, not a potentially
    # stale operator copy made while preparing the release. Never export the key.
    node=profile_backup_node_id(previous['browser'])
    destination=pathlib.Path(tempfile.mkdtemp(prefix='native-profiles-',dir=backup))
    container='ftrade-profile-backup-'+sha[:12];created=False
    with admission_lock():
        drain=json.loads((CAPACITY/'drain.json').read_text())
        if drain['revision']!=sha or workers():raise RuntimeError('profile_backup_requires_owned_drain')
        names=docker('volume','ls','-q','--filter','label=io.ftrade.node='+node).split()
        if not names:raise RuntimeError('profile_backup_owned_volumes_missing')
        volumes=json.loads(docker('volume','inspect',*names))
        for volume in volumes:
            account=(volume.get('Labels') or {}).get('io.ftrade.account','')
            if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',account) or volume['Name']!='ftbrowser-'+node+'-'+account or volume['Labels'].get('io.ftrade.node')!=node:
                raise RuntimeError('profile_backup_volume_owner_mismatch')
        ids=docker('ps','-aq').split()
        containers=json.loads(docker('inspect',*ids)) if ids else []
        for current in containers:
            if current['State']['Status'] in ['created','running','restarting','paused'] and any(m.get('Name') in names for m in current['Mounts']):
                raise RuntimeError('profile_backup_volume_in_use')
        # Admit only this bounded, offline maintenance task while our drain is held.
        # All ordinary work stays refused; use the same adaptive resource checks.
        import runpy
        capacity=runpy.run_path(str(source/'ops/host-capacity/admission.py'))
        for attempt in range(12):
            mem={line.split(':')[0]:int(line.split()[1])/1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
            try:
                capacity['check_adaptive_budget']([],256,1,mem['MemAvailable'],mem['MemTotal'],os.cpu_count() or 1,json.loads((CAPACITY/'telemetry.json').read_text()),time.time())
                break
            except capacity['CapacityUnavailable']:
                if attempt==11:raise
                time.sleep(5)

        size=sum(int(run(['du','-sb',v['Mountpoint']]).split()[0]) for v in volumes)
        if shutil.disk_usage(destination).free<size+1024**3:raise RuntimeError('profile_backup_disk_headroom')
        save(destination/'volumes.json',volumes)
        args=['create','--name',container,'--label','io.ftrade.compute=release-profile-backup','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','32','--mount','type=bind,source='+str(destination)+',target=/backup']
        for volume in volumes:
            args+=['--mount','type=volume,source='+volume['Name']+',target=/profiles/'+volume['Labels']['io.ftrade.account']+',readonly,volume-nocopy']
        args+=['--entrypoint','tar',new,'-I','gzip -1','-cpf','/backup/profiles.tar.gz','-C','/profiles','.']
        try:
            docker(*args);created=True
            docker('start','--attach',container,timeout=900)
            state=json.loads(docker('inspect',container))[0]['State']
            if state['ExitCode'] or state['OOMKilled']:raise RuntimeError('profile_backup_failed')
            archive=destination/'profiles.tar.gz';archive.chmod(0o600)
            run(['gzip','-t',str(archive)],900)
            with archive.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            save(destination/'receipt.json',{'revision':sha,'nodeId':node,'volumes':len(volumes),'sha256':digest,'bytes':archive.stat().st_size,'quiescent':True,'readonlySources':True})
        finally:
            if created:docker('rm','-f',container)
    return str(destination)


def promote(cfg, previous, updated, source, sha):
    backup=ROOT/'backups'/sha;backup.mkdir(parents=True,exist_ok=True)
    shutil.copy2(CAPACITY/'monitor.py',backup/'monitor.py')
    shutil.copy2(pathlib.Path('/etc/systemd/system')/MONITOR,backup/'monitor.service')
    profile_backup=backup_profiles_for_official_cutover(previous,updated,source,backup,sha)
    journal={'revision':sha,'profileBackup':profile_backup,'previous':previous,'backup':str(backup),'startedAt':time.time(),'previousState':json.loads((ROOT/'state.json').read_text()),'deployments':[]}
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
