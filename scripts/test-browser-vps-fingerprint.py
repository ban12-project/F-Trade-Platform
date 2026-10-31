import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('fingerprint',Path(__file__).with_name('browser-vps-fingerprint.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Fingerprints(unittest.TestCase):
    def test_restore_content_permissions_symlinks_and_mtime(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'source';source.mkdir()
            (source/'profile.sqlite').write_bytes(b'private-db')
            (source/'profile.sqlite-wal').write_bytes(b'private-wal')
            (source/'cache').mkdir()
            (source/'alias').symlink_to('profile.sqlite')
            target=Path(temp)/'target';shutil.copytree(source,target,symlinks=True)
            self.assertEqual(module.fingerprint(source),module.fingerprint(target))
            os.utime(target/'profile.sqlite',(123,123))
            self.assertEqual(module.fingerprint(source),module.fingerprint(target))
            (target/'profile.sqlite-wal').write_bytes(b'different')
            self.assertNotEqual(module.fingerprint(source),module.fingerprint(target))
            shutil.copy2(source/'profile.sqlite-wal',target/'profile.sqlite-wal')
            (target/'profile.sqlite').chmod(0o600)
            self.assertNotEqual(module.fingerprint(source),module.fingerprint(target))
            shutil.copymode(source/'profile.sqlite',target/'profile.sqlite')
            (target/'alias').unlink();(target/'alias').symlink_to('/nonexistent/secret')
            self.assertNotEqual(module.fingerprint(source),module.fingerprint(target))
    def test_hardlinks_and_xattrs_are_not_lost(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'source';source.mkdir()
            (source/'a').write_bytes(b'same')
            os.link(source/'a',source/'b')
            target=Path(temp)/'target';shutil.copytree(source,target)
            self.assertNotEqual(module.fingerprint(source),module.fingerprint(target))
            before=module.fingerprint(source)
            os.setxattr(source/'a','user.ftrade-test',b'private-attribute')
            self.assertNotEqual(before,module.fingerprint(source))

unittest.main()
