import unittest
import json
import copy
import os
from unittest.mock import patch
from pathlib import Path
from admission import check_budget, check_adaptive_budget, host_capacity, CapacityUnavailable

JOB = {'HostConfig': {'Memory': 2048 * 1048576, 'NanoCpus': 2_000_000_000}}

class AdmissionTest(unittest.TestCase):
    def test_shared_adaptive_fixtures(self):
        fixtures = json.loads(Path(__file__).with_name('adaptive-fixtures.json').read_text())
        for scenario in fixtures['cases']:
            f = copy.deepcopy(fixtures['base'])
            for patch in scenario['changes']:
                parent = f
                for key in patch['path'][:-1]: parent = parent[key]
                if patch.get('remove'): del parent[patch['path'][-1]]
                else: parent[patch['path'][-1]] = patch['value']
            f['allowed'] = scenario['allowed']
            with self.subTest(scenario['name']):
                args = [f[k] for k in ['containers', 'memoryMb', 'cpuCores', 'availableMb', 'totalMb', 'cores', 'snapshot', 'now']]
                if f['allowed']:
                    check_adaptive_budget(*args)
                else:
                    with self.assertRaises(CapacityUnavailable): check_adaptive_budget(*args)

    def test_adaptive_requires_lock_directory(self):
        with patch.dict(os.environ, {'FTRADE_HOST_ADAPTIVE': '1'}, clear=True):
            with self.assertRaises(CapacityUnavailable):
                with host_capacity(lambda _: b'', 512): pass

    def test_current_machine(self):
        check_budget([JOB], 2048, 4000, 7424, 4)
        with self.assertRaises(CapacityUnavailable):
            check_budget([JOB, JOB], 2048, 4000, 7424, 4)

    def test_larger_machine(self):
        check_budget([JOB] * 3, 2048, 7000, 16384, 8)
        with self.assertRaises(CapacityUnavailable):
            check_budget([JOB] * 4, 2048, 7000, 16384, 8)

    def test_pressure_and_unknown_limits(self):
        with self.assertRaises(CapacityUnavailable):
            check_budget([], 2048, 3000, 7424, 4)
        with self.assertRaisesRegex(ValueError, 'unbounded'):
            check_budget([{'HostConfig': {}}], 2048, 8000, 16384, 8)

if __name__ == '__main__':
    unittest.main()
