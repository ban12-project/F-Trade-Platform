"""Explicit dedicated-host synthetic smoke. No account or production DB access.
Run on the VPS as root after the five application paths, with no other compute job.
--deadline stops only the broker and verifies the actual 600s independent deadline.
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

root=Path('/opt/ftrade-vps/compute')
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line)
token=values['FTRADE_RUNTIME_TOKEN']
origin='http://127.0.0.1:9500'

def run(*args): return subprocess.check_output(args,text=True).strip()
def api(body, auth=token):
    request=urllib.request.Request(origin+'/v1/compute',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+auth})
    with urllib.request.urlopen(request,timeout=40) as result: return json.load(result)['result']
def rejected(body, code=400, auth=token):
    try: api(body,auth)
    except urllib.error.HTTPError as error:
        assert error.code==code,(error.code,code)
        error.close()
    else: raise AssertionError('request unexpectedly accepted')
def ready():
    for _ in range(30):
        try:
            with urllib.request.urlopen(origin+'/health',timeout=2) as result:
                if result.status==200:return
        except (OSError,urllib.error.URLError): pass
        time.sleep(1)
    raise AssertionError('broker not ready')
def names(): return run('docker','ps','-a','--format','{{.Names}}').splitlines()

ready()
rejected({'action':'create'},403,'invalid')
sid=api({'action':'create'})['id']; name='ftrade-compute-'+sid
try:
    rejected({'action':'create'})
    spec=json.loads(run('docker','inspect',name))[0]
    host=spec['HostConfig']
    assert host['Memory']==2048*1024**2 and host['MemorySwap']==host['Memory']
    assert host['NanoCpus']==2_000_000_000 and host['PidsLimit']==256
    assert host['NetworkMode']=='none' and host['ReadonlyRootfs']
    assert host['CapDrop']==['ALL'] and 'no-new-privileges' in host['SecurityOpt']
    assert spec['Config']['User']=='65534:65534'
    mounts=[m for m in spec['Mounts'] if m['Destination']=='/vercel/sandbox/work']
    assert len(mounts)==1 and mounts[0]['Source']==str(root/'workspaces'/('job-'+sid))
    code="""import os,json,socket,pathlib
assert os.getuid()==1000
try: os.kill(1,19)
except PermissionError: pass
else: raise AssertionError('can freeze deadline')
try: socket.create_connection(('1.1.1.1',443),timeout=1)
except OSError: pass
else: raise AssertionError('network allowed')
try: pathlib.Path('/etc/ftrade-write-proof').write_text('x')
except OSError: pass
else: raise AssertionError('rootfs writable')
p=pathlib.Path('/vercel/sandbox/work/locked');p.mkdir();(p/'test').write_text('synthetic');p.chmod(0)
print(json.dumps({'uid':os.getuid(),'networkDenied':True,'rootReadonly':True,'deadlineSignalDenied':True}))
"""
    command=api({'action':'command','id':sid,'cmd':'/opt/markitdown/bin/python3','args':['-c',code]})
    assert command['exitCode']==0,command
    proof=json.loads(command['stdout'])
    rejected({'action':'fs','id':sid,'op':'read','path':'/etc/passwd'})
    rejected({'action':'download','id':sid,'url':'https://127.0.0.1/','hostname':'127.0.0.1','path':'/vercel/sandbox/work/private'})
finally:
    api({'action':'stop','id':sid})
assert name not in names()
assert not (root/'workspaces'/('job-'+sid)).exists()
# Restart must remove a live orphan and its files, and invalidate the capability.
sid=api({'action':'create'})['id']
api({'action':'fs','id':sid,'op':'write','path':'/vercel/sandbox/work/restart-proof','offset':0,'data':'c3ludGhldGlj'})
subprocess.run(['systemctl','restart','ftrade-compute.service'],check=True)
ready()
assert 'ftrade-compute-'+sid not in names()
assert not (root/'workspaces'/('job-'+sid)).exists()
rejected({'action':'command','id':sid,'cmd':'ffprobe','args':['-version']})
result={'security':proof,'memoryBytes':host['Memory'],'memorySwapBytes':host['MemorySwap'],'nanoCpus':host['NanoCpus'],'pidsLimit':host['PidsLimit'],'networkMode':host['NetworkMode'],'readonlyRootfs':host['ReadonlyRootfs'],'capDrop':host['CapDrop'],'securityOpt':host['SecurityOpt'],'workspaceMount':mounts[0],'restartCleanup':True,'stopCleanup':True}
(root/'smoke-security.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
if '--deadline' in sys.argv:
    sid=api({'action':'create'})['id']; name='ftrade-compute-'+sid
    started=time.monotonic()
    subprocess.run(['systemctl','stop','ftrade-compute.service'],check=True)
    try:
        while name in names() and time.monotonic()-started<635:
            time.sleep(15)
        elapsed=time.monotonic()-started
        assert name not in names(),'independent deadline failed'
        assert elapsed>=570,'deadline ended unexpectedly early'
    finally:
        subprocess.run(['systemctl','start','ftrade-compute.service'],check=True)
        ready()
    assert not (root/'workspaces'/('job-'+sid)).exists()
    result['independentDeadline']={'brokerStopped':True,'elapsedSeconds':round(elapsed,2),'jobRemoved':True,'workspaceRemovedAfterRestart':True}
    (root/'smoke-security.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result['independentDeadline']),flush=True)
