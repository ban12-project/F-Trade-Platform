import unittest
from admission import check_budget, CapacityUnavailable

JOB = {'HostConfig': {'Memory': 2048 * 1048576, 'NanoCpus': 2_000_000_000}}

class AdmissionTest(unittest.TestCase):
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
