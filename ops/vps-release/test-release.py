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

if __name__=='__main__':unittest.main()
