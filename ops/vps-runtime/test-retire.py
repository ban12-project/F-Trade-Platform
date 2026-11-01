import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('retire', Path(__file__).with_name('retire.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

class RetirementTest(unittest.TestCase):
    def test_browser_drift_blocks_retirement(self):
        expected = {'image': 'browser-image', 'environment': {'KEY': 'synthetic'},
                    'volumes': ['/protected/profiles:/profiles:ro'],
                    'advanced': {'resources': {'memoryMb': 512, 'cpuCores': 1}}}
        actual = {'Image': 'browser-image', 'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
                  'Config': {'Env': ['KEY=synthetic']}, 'Mounts': [{'Destination': '/profiles', 'Source': '/protected/profiles', 'RW': False}],
                  'HostConfig': {'Memory': 512 * 1048576, 'NanoCpus': 1000000000}}
        r.verify_browser(actual, expected)
        for field in ['image', 'env', 'mount']:
            changed = copy.deepcopy(actual)
            if field == 'image': changed['Image'] = 'unexpected'
            if field == 'env': changed['Config']['Env'] = ['KEY=different']
            if field == 'mount': changed['Mounts'][0]['RW'] = True
            with self.subTest(field=field), self.assertRaises(AssertionError): r.verify_browser(changed, expected)

    def test_edge_requires_capability_rejection_not_bad_gateway(self):
        for code in [403, 502]:
            error = urllib.error.HTTPError('https://browser.example/health', code, 'synthetic', {}, None)
            with patch.object(r.urllib.request, 'urlopen', side_effect=error):
                if code == 403: r.check_browser_edge('https://browser.example/health')
                else:
                    with self.assertRaises(urllib.error.HTTPError): r.check_browser_edge('https://browser.example/health')

    def test_cleanup_allowlist_excludes_browser_and_platform_images(self):
        for name in ['ftrade-release-browser', 'ftrade-release-agent', 'ftrade-browser-agent', 'postgres', 'node', 'ubuntu', 'ghcr.io/oblien/openship-api']:
            self.assertNotIn(name, r.COMPUTE_REPOS)

if __name__ == '__main__': unittest.main()
