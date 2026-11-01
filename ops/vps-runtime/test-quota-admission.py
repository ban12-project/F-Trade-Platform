import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ['FTRADE_RUNTIME_TOKEN'] = 'a' * 64
os.environ['FTRADE_COMPUTE_IMAGE'] = 'sha256:' + 'b' * 64
spec = importlib.util.spec_from_file_location('broker', Path(__file__).with_name('server.py'))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)

class Pool:
    f_blocks = 12 * 1024**3
    f_frsize = 1

class QuotaTest(unittest.TestCase):
    def test_shared_pool_reservations_are_independent_and_bounded(self):
        with tempfile.TemporaryDirectory() as root, patch.object(broker, 'WORKSPACE_ROOT', Path(root)), patch.object(broker, 'QUOTA_ENABLED', True), patch.object(broker, 'workspace_pool_ready', return_value=Pool()):
            first, second, third = ['00000000-0000-4000-8000-00000000000' + str(n) for n in (1, 2, 3)]
            self.assertEqual(broker.reserve_quota(first, Pool()), 20000)
            self.assertEqual(broker.reserve_quota(second, Pool()), 20001)
            with self.assertRaises(broker.CapacityUnavailable): broker.reserve_quota(third, Pool())
            broker.remove_workspace(first)
            self.assertEqual(broker.reserve_quota(third, Pool()), 20000)
            self.assertEqual(len(broker.quota_records()), 2)

    def test_foreign_namespace_reservation_is_not_released(self):
        with tempfile.TemporaryDirectory() as root, patch.object(broker, 'WORKSPACE_ROOT', Path(root)), patch.object(broker, 'QUOTA_ENABLED', True), patch.object(broker, 'workspace_pool_ready', return_value=Pool()):
            sid = '00000000-0000-4000-8000-000000000001'
            with patch.object(broker, 'NAMESPACE', 'foreign'): broker.reserve_quota(sid, Pool())
            broker.remove_workspace(sid)
            self.assertEqual(len(broker.quota_records()), 1)

if __name__ == '__main__': unittest.main()
