"""Namespace isolation regression tests; no Docker daemon or production data."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

with patch.dict(os.environ, {'FTRADE_RUNTIME_TOKEN': 'a' * 64,
                            'FTRADE_COMPUTE_IMAGE': 'sha256:' + 'b' * 64,
                            'FTRADE_RUNTIME_NAMESPACE': 'openship-test'}):
    spec = importlib.util.spec_from_file_location('broker_test', Path(__file__).with_name('server.py'))
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)

SID = '00000000-0000-4000-8000-000000000001'

class NamespaceTest(unittest.TestCase):
    def tearDown(self):
        broker.SESSIONS.clear()
        broker.DOWNLOAD_BYTES.clear()

    def test_startup_only_cleans_own_label_and_namespace(self):
        with tempfile.TemporaryDirectory() as pool:
            root = Path(pool)
            production = root / ('job-' + SID)
            production.mkdir(); (production / 'preserve').write_text('synthetic')
            test = root / 'instance-openship-test' / ('job-' + SID)
            test.mkdir(parents=True); (test / 'remove').write_text('synthetic')
            calls = []
            def checked(args):
                calls.append(args)
                return b'test-container\n' if args[0] == 'ps' else b''
            with patch.object(broker, 'WORKSPACE_ROOT', root), patch.object(broker, 'workspace_pool_ready'), patch.object(broker, 'checked', checked):
                broker.cleanup_previous_sessions()
            self.assertTrue((production / 'preserve').exists())
            self.assertFalse(test.exists())
            self.assertEqual(calls, [['ps', '-aq', '--filter', 'label=io.ftrade.compute=openship-test'], ['rm', '-f', 'test-container']])

    def test_namespace_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as pool, tempfile.TemporaryDirectory() as outside:
            (Path(pool) / 'instance-openship-test').symlink_to(outside, target_is_directory=True)
            with patch.object(broker, 'WORKSPACE_ROOT', Path(pool)), self.assertRaisesRegex(ValueError, 'namespace_symlink'):
                broker.instance_workspace()

    def test_worker_keeps_security_and_matching_host_path(self):
        class Pool:
            f_bavail = 12 * 1024**3
            f_frsize = 1
        calls = []
        def checked(args):
            calls.append(args)
            return b''
        with tempfile.TemporaryDirectory() as pool, patch.object(broker, 'WORKSPACE_ROOT', Path(pool)), patch.object(broker, 'workspace_pool_ready', return_value=Pool()), patch.object(broker, 'checked', checked):
            result = broker.dispatch({'action': 'create'})
            args = calls[-1]
            self.assertEqual(calls[0], ['ps', '-q', '--filter', 'label=io.ftrade.compute'])
            self.assertEqual(args[args.index('--label') + 1], 'io.ftrade.compute=openship-test')
            self.assertEqual(args[args.index('--name') + 1], 'ftrade-compute-openship-test-' + result['id'])
            self.assertEqual(args[args.index('--mount') + 1], f"type=bind,source={pool}/instance-openship-test/job-{result['id']},target=/vercel/sandbox/work")
            for flag, value in (('--network', 'none'), ('--cap-drop', 'ALL'), ('--security-opt', 'no-new-privileges'), ('--pids-limit', '256')):
                self.assertEqual(args[args.index(flag) + 1], value)
            self.assertIn('--read-only', args)
            self.assertEqual(args[-1], '600')

    def test_mount_failure_prevents_cleanup(self):
        with patch.object(broker, 'workspace_pool_ready', side_effect=ValueError('workspace_pool_not_mounted')), patch.object(broker, 'checked') as checked:
            with self.assertRaisesRegex(ValueError, 'not_mounted'):
                broker.cleanup_previous_sessions()
            checked.assert_not_called()

if __name__ == '__main__':
    unittest.main()
