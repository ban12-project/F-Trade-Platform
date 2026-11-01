import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('deploy.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
spec=importlib.util.spec_from_file_location('bootstrap',pathlib.Path(__file__).with_name('bootstrap.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class ReleaseTest(unittest.TestCase):
    def test_native_browser_build_sets_architecture_and_keeps_resource_limits(self):
        from types import SimpleNamespace
        source=pathlib.Path(__file__).resolve().parents[2]
        for reported,expected in [('x86_64','amd64'),('amd64','amd64'),('aarch64','arm64'),('arm64','arm64')]:
            calls=[]
            def command(args, timeout=60, cwd=None, env=None):
                calls.append((args,env));return ''
            def docker(*args,**kwargs):
                if args[:1]==('info',):return reported+'\n'
                if args[:2]==('image','inspect'):return 'sha256:'+'a'*64
                return ''
            with self.subTest(reported=reported),patch.object(pathlib.Path,'stat',return_value=SimpleNamespace(st_gid=999)),patch.object(r,'run',side_effect=command),patch.object(r,'docker',side_effect=docker):
                r.build(source,'a'*40,{},{'browserWorker':'changed'},{'browser':{'environment':{}}})
            base=[(args,env) for args,env in calls if args[:2]==['docker','build'] and any(str(x).endswith('ops/browser-node/browser.Dockerfile') for x in args)]
            self.assertEqual(len(base),1)
            self.assertFalse(any('ops/vps-runtime' in str(args) or 'ops/video-sandbox' in str(args) for args,env in calls))
            self.assertFalse(any('prepare-upstream.sh' in str(args) or 'upstream/Dockerfile.ci' in str(args) for args,env in calls))
            args,env=base[0]
            self.assertIn('TARGETARCH='+expected,args)
            self.assertEqual(args[args.index('--memory')+1],'2g')
            self.assertEqual(args[args.index('--cpu-quota')+1],'200000')
            self.assertEqual(env['DOCKER_BUILDKIT'],'0')
            smoke=[env for args,env in calls if args==['bash','scripts/test-browser-images.sh']]
            self.assertEqual(smoke[0]['ARCH'],expected)
            self.assertIn('ftrade-release-node-',smoke[0]['PATH'].split(':')[0])

    def test_browser_only_contract_accepts_no_compute_pool_and_rejects_old_recovery(self):
        source=pathlib.Path(__file__).resolve().parents[2]
        cfg={'contract':{'version':2,'workloads':['browser']},'targets':{'browser':{}}}
        state={'configs':{'browser':{}}}
        with tempfile.TemporaryDirectory() as t,patch.object(r,'ROOT',pathlib.Path(t)):
            r.validate_host_contract(source,cfg,state)
            with self.assertRaisesRegex(RuntimeError,'requires_review'):
                r.validate_host_contract(source,{**cfg,'contract':{'version':1}},state)
            with self.assertRaisesRegex(RuntimeError,'target_requires_reconciliation'):
                r.validate_host_contract(source,{**cfg,'targets':{'browser':{},'runtime':{}}},state)
            (pathlib.Path(t)/'journal.json').write_text(json.dumps({'previous':{'browser':{},'runtime':{}}}))
            with self.assertRaisesRegex(RuntimeError,'journal_requires_reconciliation'):
                r.validate_host_contract(source,cfg,state)

    def test_unknown_daemon_architecture_refuses_before_any_build(self):
        with patch.object(r,'docker',return_value='unsupported-machine'),patch.object(r,'run') as run:
            with self.assertRaisesRegex(RuntimeError,'unsupported_build_architecture'):
                r.build(pathlib.Path('/unused'),'a'*40,{}, {}, {})
            run.assert_not_called()

    def test_drain_waits_for_two_empty_observations(self):
        tick=[0];answers=iter([[{}],[],[]]);sleeps=[]
        def sleep(n):tick[0]+=n;sleeps.append(n)
        r.wait_drained(20,lambda:next(answers),sleep,lambda:tick[0])
        self.assertEqual(sleeps,[5,5])

    def test_busy_drain_times_out_without_removing_workers(self):
        tick=[0]
        def sleep(n):tick[0]+=n
        with self.assertRaisesRegex(RuntimeError,'no_tasks_killed'):
            r.wait_drained(10,lambda:[{}],sleep,lambda:tick[0])

    def test_bootstrap_rejects_shells_refs_uploads_and_injection(self):
        for cmd in ['bash','release main','scp -t /tmp/x','release '+'a'*40+';id','status ../../secret']:
            with self.subTest(cmd), self.assertRaises(ValueError):b.dispatch(cmd)

    def test_status_exposes_only_saved_receipt(self):
        with tempfile.TemporaryDirectory() as t,patch.object(b,'ROOT',pathlib.Path(t)):
            (pathlib.Path(t)/'receipts').mkdir();b.write_status('a'*40,'ready')
            d=json.loads((pathlib.Path(t)/'receipts'/('a'*40+'.json')).read_text())
            self.assertEqual(set(d),{'revision','state','updatedAt'})

    def test_failed_unit_start_leaves_retryable_receipt(self):
        from subprocess import CompletedProcess
        with tempfile.TemporaryDirectory() as t,patch.object(b,'ROOT',pathlib.Path(t)),patch.object(b.subprocess,'check_output',return_value='a'*40+'\trefs/heads/main'),patch.object(b.subprocess,'run',return_value=CompletedProcess([],1)):
            (pathlib.Path(t)/'receipts').mkdir()
            b.dispatch('release '+'a'*40)
            d=json.loads((pathlib.Path(t)/'receipts'/('a'*40+'.json')).read_text())
            self.assertEqual(d['state'],'failed')
            self.assertEqual(d['reason'],'release_unit_not_started')

    def test_image_copy_manifest_tracks_actual_payload_inputs(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);(root/'payload').mkdir();(root/'payload/a').write_text('a')
            file=root/'Dockerfile';file.write_text('FROM scratch\nCOPY payload/ /app/\nCOPY --from=node /bin/node /bin/node\n')
            self.assertEqual(r.copied_inputs(file,root),{file,root/'payload/a'})
            file.write_text('COPY ["a", "/app/"]\n')
            with self.assertRaises(RuntimeError):r.copied_inputs(file,root)

    def test_failed_promotion_restores_previous_bundle_and_retains_no_journal(self):
        with tempfile.TemporaryDirectory() as t,patch.object(r,'ROOT',pathlib.Path(t)),patch.object(r.shutil,'copy2'),patch.object(r,'run'),patch.object(r,'cli'),patch.object(r,'apply',return_value='new-deployment'),patch.object(r,'healthy',side_effect=RuntimeError('injected unhealthy image')),patch.object(r,'rollback') as rollback:
            root=pathlib.Path(t);previous={'browser':{'image':'old'}};r.save(root/'state.json',{'revision':'old','configs':previous,'fingerprints':{}})
            with self.assertRaises(RuntimeError):r.promote({'targets':{'browser':{'service':'agent','project':'qa'}}},previous,{'browser':{'image':'new'}},root,'a'*40)
            self.assertEqual(rollback.call_args.args[1]['previous'],previous)
            self.assertFalse((root/'journal.json').exists())
            self.assertEqual(json.loads((root/'receipts'/('a'*40+'.json')).read_text())['state'],'rolled_back')

    def test_failed_rollback_keeps_journal_for_recovery(self):
        with tempfile.TemporaryDirectory() as t,patch.object(r,'ROOT',pathlib.Path(t)),patch.object(r.shutil,'copy2'),patch.object(r,'run'),patch.object(r,'cli'),patch.object(r,'apply',side_effect=RuntimeError('new failed')),patch.object(r,'rollback',side_effect=RuntimeError('restore failed')):
            root=pathlib.Path(t);r.save(root/'state.json',{'revision':'old'})
            with self.assertRaises(RuntimeError):r.promote({'targets':{'browser':{'service':'agent','project':'qa'}}},{'browser':{'image':'old'}},{'browser':{'image':'new'}},root,'b'*40)
            self.assertTrue((root/'journal.json').exists())
            self.assertEqual(json.loads((root/'receipts'/('b'*40+'.json')).read_text())['state'],'rollback_failed')

    def test_profile_backup_reads_file_key_with_agent_precedence_and_refuses_symlinks(self):
        node='11111111-1111-4111-8111-111111111111'
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);key=root/'key';key.write_text('fbn_'+node+'.'+'a'*43);key.chmod(0o600)
            config={'environment':{'BROWSER_NODE_ACCESS_KEY':'invalid-inline','BROWSER_NODE_ACCESS_KEY_FILE':'/secret/key'},'volumes':[t+':/secret:ro']}
            self.assertEqual(r.profile_backup_node_id(config),node)
            key.rename(root/'original');key.symlink_to(root/'original')
            with self.assertRaises(OSError):r.profile_backup_node_id(config)
            config['environment']['BROWSER_NODE_ACCESS_KEY_FILE']='/secret/../outside'
            with self.assertRaisesRegex(RuntimeError,'key_path_invalid'):r.profile_backup_node_id(config)

    def test_profile_snapshot_failure_prevents_any_service_change(self):
        with tempfile.TemporaryDirectory() as t,patch.object(r,'ROOT',pathlib.Path(t)),patch.object(r.shutil,'copy2'),patch.object(r,'backup_profiles_for_official_cutover',side_effect=RuntimeError('injected snapshot failure')),patch.object(r,'cli') as cli,patch.object(r,'apply') as apply,patch.object(r,'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError,'snapshot failure'):
                r.promote({'targets':{}},{},{},pathlib.Path(t),'a'*40)
            cli.assert_not_called();apply.assert_not_called();rollback.assert_not_called()
            self.assertFalse((pathlib.Path(t)/'journal.json').exists())

    def test_profile_backup_requires_owned_drain_and_quiescence(self):
        import contextlib
        node='11111111-1111-4111-8111-111111111111'
        previous={'browser':{'environment':{'BROWSER_IMAGE':'old','BROWSER_NODE_ACCESS_KEY':'fbn_'+node+'.'+'a'*43}}}
        updated={'browser':{'environment':{'BROWSER_IMAGE':'new'}}}
        def docker(*args,**kwargs):
            if args[:2]==('image','inspect'):return json.dumps([{'Config':{'Labels':{'io.ftrade.official-camoufox':'1' if args[2]=='new' else '0'}}}])
            self.fail('must refuse before touching any volume or container')
        for foreign,active in [(True,False),(False,True)]:
            with self.subTest(foreign=foreign,active=active),tempfile.TemporaryDirectory() as t,patch.object(r,'CAPACITY',pathlib.Path(t)),patch.object(r,'admission_lock',side_effect=contextlib.nullcontext),patch.object(r,'workers',return_value=[{}] if active else []),patch.object(r,'docker',side_effect=docker):
                root=pathlib.Path(t);(root/'drain.json').write_text(json.dumps({'revision':('b' if foreign else 'a')*40}))
                with self.assertRaisesRegex(RuntimeError,'requires_owned_drain'):
                    r.backup_profiles_for_official_cutover(previous,updated,root,root,'a'*40)

    def test_profile_backup_refuses_foreign_volume_name_before_copy(self):
        import contextlib
        node='11111111-1111-4111-8111-111111111111';account='22222222-2222-4222-8222-222222222222'
        previous={'browser':{'environment':{'BROWSER_IMAGE':'old','BROWSER_NODE_ACCESS_KEY':'fbn_'+node+'.'+'a'*43}}};updated={'browser':{'environment':{'BROWSER_IMAGE':'new'}}}
        def docker(*args,**kwargs):
            if args[:2]==('image','inspect'):return json.dumps([{'Config':{'Labels':{'io.ftrade.official-camoufox':'1' if args[2]=='new' else '0'}}}])
            if args[:2]==('volume','ls'):return 'foreign-volume'
            if args[:2]==('volume','inspect'):return json.dumps([{'Name':'foreign-volume','Labels':{'io.ftrade.node':node,'io.ftrade.account':account}}])
            self.fail('must not copy an unowned volume')
        with tempfile.TemporaryDirectory() as t,patch.object(r,'CAPACITY',pathlib.Path(t)),patch.object(r,'admission_lock',side_effect=contextlib.nullcontext),patch.object(r,'workers',return_value=[]),patch.object(r,'docker',side_effect=docker):
            root=pathlib.Path(t);(root/'drain.json').write_text(json.dumps({'revision':'a'*40}))
            with self.assertRaisesRegex(RuntimeError,'volume_owner_mismatch'):
                r.backup_profiles_for_official_cutover(previous,updated,root,root,'a'*40)

    def test_official_upgrade_does_not_take_another_migration_snapshot(self):
        with patch.object(r,'docker',return_value=json.dumps([{'Config':{'Labels':{'io.ftrade.official-camoufox':'1'}}}])),patch.object(r,'admission_lock') as lock:
            result=r.backup_profiles_for_official_cutover({'browser':{'environment':{'BROWSER_IMAGE':'old'}}},{'browser':{'environment':{'BROWSER_IMAGE':'new'}}},pathlib.Path('/unused'),pathlib.Path('/unused'),'a'*40)
            self.assertIsNone(result);lock.assert_not_called()

    def test_profile_snapshot_is_offline_readonly_private_and_records_archive_digest(self):
        import contextlib
        import hashlib
        import tarfile
        from unittest.mock import Mock
        node='11111111-1111-4111-8111-111111111111';account='22222222-2222-4222-8222-222222222222';name='ftbrowser-'+node+'-'+account
        previous={'browser':{'environment':{'BROWSER_IMAGE':'old','BROWSER_NODE_ACCESS_KEY':'fbn_'+node+'.'+'a'*43}}};updated={'browser':{'environment':{'BROWSER_IMAGE':'new'}}}
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);(root/'drain.json').write_text(json.dumps({'revision':'a'*40}));(root/'telemetry.json').write_text('{}')
            calls=[];created=[];original_read=pathlib.Path.read_text;original_run=r.run
            def read(path,*args,**kwargs):
                return 'MemTotal: 8388608 kB\nMemAvailable: 6291456 kB\n' if str(path)=='/proc/meminfo' else original_read(path,*args,**kwargs)
            def docker(*args,**kwargs):
                calls.append(args)
                if args[:2]==('image','inspect'):return json.dumps([{'Config':{'Labels':{'io.ftrade.official-camoufox':'1' if args[2]=='new' else '0'}}}])
                if args[:2]==('volume','ls'):return name
                if args[:2]==('volume','inspect'):return json.dumps([{'Name':name,'Mountpoint':str(root),'Labels':{'io.ftrade.node':node,'io.ftrade.account':account}}])
                if args[0]=='ps':return ''
                if args[0]=='create':created.append(args);return 'container'
                if args[0]=='start':
                    destination=next(root.glob('native-profiles-*'))
                    with tarfile.open(destination/'profiles.tar.gz','w:gz'):pass
                    return ''
                if args[0]=='inspect':return json.dumps([{'State':{'ExitCode':0,'OOMKilled':False}}])
                if args[0]=='rm':return ''
                self.fail('unexpected docker operation')
            def run(args,*a,**kw):return '128 synthetic' if args[0]=='du' else original_run(args,*a,**kw)
            class CapacityError(Exception):pass
            admission=Mock(side_effect=[CapacityError("recent CPU peak"),None])
            with patch.object(r,'CAPACITY',root),patch.object(r,'admission_lock',side_effect=contextlib.nullcontext),patch.object(r,'workers',return_value=[]),patch.object(r,'docker',side_effect=docker),patch.object(r,'run',side_effect=run),patch.object(pathlib.Path,'read_text',read),patch('runpy.run_path',return_value={'check_adaptive_budget':admission,'CapacityUnavailable':CapacityError}),patch.object(r.time,'sleep') as sleep:
                destination=pathlib.Path(r.backup_profiles_for_official_cutover(previous,updated,root,root,'a'*40))
            self.assertEqual(admission.call_count,2);sleep.assert_called_once_with(5);self.assertEqual(admission.call_args.args[:3],([],256,1))
            args=created[0];self.assertEqual(args[args.index('--network')+1],'none');self.assertIn('type=volume,source='+name+',target=/profiles/'+account+',readonly,volume-nocopy',args)
            receipt=json.loads((destination/'receipt.json').read_text())
            self.assertTrue(receipt['quiescent']);self.assertTrue(receipt['readonlySources']);self.assertEqual(receipt['volumes'],1)
            self.assertEqual(receipt['sha256'],hashlib.sha256((destination/'profiles.tar.gz').read_bytes()).hexdigest())
            self.assertEqual(destination.stat().st_mode&0o777,0o700);self.assertEqual((destination/'profiles.tar.gz').stat().st_mode&0o777,0o600)
            self.assertEqual(calls[-1][0],'rm')

if __name__=='__main__':unittest.main()
