"""Broker security/lifecycle tests; no Docker daemon or real source data required."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

os.environ['FTRADE_RUNTIME_TOKEN'] = 'a' * 64
os.environ['FTRADE_COMPUTE_IMAGE'] = 'sha256:' + 'b' * 64
spec = importlib.util.spec_from_file_location('vps_broker', Path(__file__).parent.parent / 'ops/vps-runtime/server.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class RuntimeTest(unittest.TestCase):
    def tearDown(self):
        broker.SESSIONS.clear()

    def test_paths_fail_closed(self):
        for value in ('/etc/passwd', '/vercel/sandbox/work/../secret', '/vercel/sandbox/work/./x', '/vercel/sandbox/work2/x', '/vercel/sandbox/work/x\n', None):
            with self.subTest(value=value), self.assertRaises(ValueError): broker.path(value)
        self.assertEqual(broker.path('/vercel/sandbox/work/bundle/index.html'), '/vercel/sandbox/work/bundle/index.html')

    def test_worker_filesystem_rejects_symlink_escape(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            destination=Path(outside)/'private'
            destination.write_text('must not disclose')
            (Path(root)/'escape').symlink_to(destination)
            script=broker.FS_SCRIPT.replace('/vercel/sandbox/work',root)
            result=subprocess.run(['python3','-c',script],input=json.dumps({'op':'read','path':root+'/escape','offset':0}),text=True,capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('must not disclose',result.stdout)

    def test_create_is_offline_resource_bounded_and_independent_deadline(self):
        calls=[]
        def checked(args,*unused):
            calls.append(args)
            return b''
        class Pool:
            f_bavail=12*1024**3
            f_frsize=1
        with tempfile.TemporaryDirectory() as pooldir, patch.object(broker,'WORKSPACE_ROOT',Path(pooldir)), patch.object(broker,'workspace_pool_ready',return_value=Pool()), patch.object(broker,'checked',checked):
            result=broker.dispatch({'action':'create'})
        args=calls[-1]
        for flag,value in (('--network','none'),('--memory','2048m'),('--cpus','2'),('--user','65534:65534'),('--entrypoint','sleep')):
            self.assertEqual(args[args.index(flag)+1],value)
        self.assertEqual(args[args.index('--memory-swap')+1], '2048m')
        self.assertIn('--rm',args)
        self.assertIn('--read-only',args)
        self.assertEqual(args[-1],'600')
        self.assertIn(result['id'],broker.SESSIONS)

    def test_ambiguous_create_remains_tracked_if_cleanup_unconfirmed(self):
        class Pool:
            f_bavail=12*1024**3
            f_frsize=1
        def checked(args,*unused):
            if args[0]=='run': raise TimeoutError('ambiguous creation')
            return b''
        with tempfile.TemporaryDirectory() as pooldir, patch.object(broker,'WORKSPACE_ROOT',Path(pooldir)), patch.object(broker,'workspace_pool_ready',return_value=Pool()), patch.object(broker,'checked',checked), patch.object(broker,'remove_container',side_effect=ValueError('unconfirmed')):
            with self.assertRaises(TimeoutError): broker.dispatch({'action':'create'})
            self.assertEqual(len(broker.SESSIONS),1)
            self.assertEqual(len(list(Path(pooldir).glob('job-*'))),1)

    def test_capacity_rejects_existing_container_even_without_local_session(self):
        class Pool:
            f_bavail=12*1024**3
            f_frsize=1
        with patch.object(broker,'workspace_pool_ready',return_value=Pool()), patch.object(broker,'checked',return_value=b'orphaned-container\n'), self.assertRaisesRegex(ValueError,'capacity'):
            broker.dispatch({'action':'create'})

    def test_unknown_session_cannot_execute_or_stop_other_containers(self):
        for action in ('stop','command','fs','download'):
            with self.assertRaisesRegex(ValueError,'unknown_session'):
                broker.dispatch({'action':action,'id':'some-other-container'})

    def test_file_offsets_and_chunks_bounded(self):
        broker.SESSIONS['test']=('owned',broker.time.monotonic()+60,threading.Lock())
        for offset in (-1, 1024**3, True):
            with self.assertRaises(ValueError):
                broker.dispatch({'action':'fs','id':'test','op':'write','path':'/vercel/sandbox/work/a','offset':offset,'data':'YQ=='})
        with self.assertRaises(ValueError):
            broker.dispatch({'action':'fs','id':'test','op':'write','path':'/vercel/sandbox/work/a','offset':broker.MAX_FILE_BYTES,'data':'YQ=='})

    def test_download_rejects_hosts_credentials_redirect_targets_and_private_dns(self):
        host='approved.private.blob.vercel-storage.com'
        with patch.object(broker,'BLOB_HOSTS',frozenset([host])):
            for url in ('http://'+host+'/x','https://evil.example/x','https://user@'+host+'/x','https://'+host+':8443/x','https://'+host+'/x#f'):
                with self.assertRaises(ValueError): broker.download_target(url,host)
            for ip in ('127.0.0.1','169.254.169.254','10.0.0.1','::1'):
                with patch.object(socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443))]), self.assertRaisesRegex(ValueError,'not_public'):
                    broker.download_target('https://'+host+'/x',host)
            with patch.object(socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]):
                parsed,address=broker.download_target('https://'+host+'/x?token=signed',host)
                self.assertEqual(address,'8.8.8.8')
                self.assertEqual(parsed.query,'token=signed')

    def test_download_does_not_follow_redirect(self):
        class Connection:
            def request(self,*args,**kwargs): pass
            def getresponse(self):
                class Response: status=302
                return Response()
            def close(self): pass
        parsed=broker.urlsplit('https://approved.example/x')
        with patch.object(broker,'download_target',return_value=(parsed,'8.8.8.8')),patch.object(broker,'PinnedHTTPS',return_value=Connection()),self.assertRaisesRegex(ValueError,'response_invalid'):
            broker.download('https://approved.example/x','approved.example','/vercel/sandbox/work/a','owned',broker.time.monotonic()+60)

    def test_absent_pool_rejects_admission(self):
        with patch.object(broker.os.path,'ismount',return_value=False), self.assertRaisesRegex(ValueError,'not_mounted'):
            broker.dispatch({'action':'create'})

    def test_uncertain_stop_retains_session(self):
        broker.SESSIONS['test']=('owned',broker.time.monotonic()+60,threading.Lock())
        with patch.object(broker,'docker',return_value=(1,b'',b'failure')), patch.object(broker,'checked',return_value=b'owned\n'), self.assertRaisesRegex(ValueError,'stop_unconfirmed'):
            broker.dispatch({'action':'stop','id':'test'})
        self.assertIn('test',broker.SESSIONS)

    def test_cleanup_handles_untraversable_job_directories_without_following_symlinks(self):
        sid='00000000-0000-4000-8000-000000000001'
        with tempfile.TemporaryDirectory() as pool, tempfile.TemporaryDirectory() as outside:
            root=Path(pool)/('job-'+sid); root.mkdir()
            nested=root/'locked'; nested.mkdir(); (nested/'file').write_text('synthetic')
            (root/'outside').symlink_to(outside,target_is_directory=True)
            saved=Path(outside)/'preserve'; saved.write_text('outside')
            nested.chmod(0); root.chmod(0)
            with patch.object(broker,'WORKSPACE_ROOT',Path(pool)),patch.object(broker,'workspace_pool_ready'):
                broker.remove_workspace(sid)
            self.assertFalse(root.exists()); self.assertEqual(saved.read_text(),'outside')

    def test_http_auth_and_health(self):
        server=broker.BrokerServer(('127.0.0.1',0),broker.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        origin='http://127.0.0.1:'+str(server.server_address[1])
        try:
            with urllib.request.urlopen(origin+'/health') as result: self.assertEqual(result.read(),b'ok')
            for token in ('','wrong'):
                request=urllib.request.Request(origin+'/v1/compute',data=b'{"action":"create"}',headers={'Authorization':token})
                with self.assertRaises(urllib.error.HTTPError) as err: urllib.request.urlopen(request)
                self.assertEqual(err.exception.code,403)
                err.exception.close()
            with patch.object(broker,'dispatch',return_value={'id':'test'}):
                request=urllib.request.Request(origin+'/v1/compute',data=b'{"action":"create"}',headers={'Authorization':'Bearer '+broker.TOKEN})
                with urllib.request.urlopen(request) as result: self.assertEqual(json.load(result),{'result':{'id':'test'}})
        finally:
            server.shutdown(); server.server_close(); thread.join()

if __name__=='__main__': unittest.main()
