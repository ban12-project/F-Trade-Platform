"""Reject changed or incomplete candidate artifacts before building an image."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("candidate", Path(__file__).resolve().parents[1] / "ops/browser-node/install-candidate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CandidateInstallTests(unittest.TestCase):
    def fixture(self, root, mutation=None):
        elf = b"\x7fELF\x02\x01" + bytes(12) + b"\x3e\x00" + bytes(40)
        files = {"camoufox-bin": elf, "libxul.so": elf,
                 "application.ini": b"[App]\nVersion=155.0.1-beta.31\nBuildID=20260922071225\n",
                 "version.json": b'{"version":"155.0.1","release":"beta.31"}',
                 "properties.json": b"{}", "camoufox.cfg": b"// fixture",
                 "fontconfig/linux/fonts.conf": b"fixture", "fonts/linux/font.ttf": b"fixture"}
        hashes = {k: hashlib.sha256(v).hexdigest() for k,v in files.items()}
        manifest = {"target":"linux-x86_64", "origin":{"commit":"a"*40},
                    "source":{"commit":"a"*40,"status":"pass","actual_sha512":"b"*128,"expected_sha512":"b"*128},
                    "native_build":{"status":"pass","metrics":{"exit_code":0}},
                    "installation":{"file_sha256":hashes,"application_version":"155.0.1-beta.31",
                                    "build_id":"20260922071225","binary_hashes":{k:hashes[k] for k in ["camoufox-bin","libxul.so"]}}}
        extras = []
        if mutation:
            mutation(files, manifest, extras)
        raw = root / "candidate.tar"
        with tarfile.open(raw, 'w') as tar:
            for name, data in files.items():
                entry = tarfile.TarInfo('bin/' + name)
                entry.size = len(data)
                entry.mode = 0o755 if name == 'camoufox-bin' else 0o644
                tar.addfile(entry, io.BytesIO(data))
            for entry in extras:
                tar.addfile(entry)
        archive = root / "candidate.tar.zst"
        subprocess.run(['zstd','-q',str(raw),'-o',str(archive)],check=True)
        sha = module.digest(archive)
        manifest['candidate_sha256'] = sha
        path = root / "candidate-manifest.json"
        path.write_text(json.dumps(manifest))
        return archive, path, root/'installed', sha, 'a'*40

    def test_complete_install(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.fixture(Path(directory))
            result = module.install(*args)
            self.assertEqual(result['files'], 8)
            self.assertEqual((args[2]/'camoufox-bin').stat().st_mode & 0o777, 0o755)

    def test_mutated_or_missing_files(self):
        for kind in ['changed','missing','extra']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                def mutate(files, manifest, extras):
                    if kind == 'changed': files['libxul.so'] = b'changed'
                    if kind == 'missing': del files['properties.json']
                    if kind == 'extra': files['unlisted'] = b'extra'
                with self.assertRaises(ValueError): module.install(*self.fixture(Path(directory), mutate))

    def test_link_escape_and_duplicate(self):
        for kind in ['link','escape','duplicate']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                def mutate(files, manifest, extras):
                    entry = tarfile.TarInfo('bin/link' if kind=='link' else ('bin/../escape' if kind=='escape' else 'bin/properties.json'))
                    if kind=='link': entry.type=tarfile.SYMTYPE; entry.linkname='/tmp/outside'
                    extras.append(entry)
                with self.assertRaises(ValueError): module.install(*self.fixture(Path(directory), mutate))

    def test_external_identity_and_empty_destination(self):
        for kind in ['sha','commit','destination']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                args=list(self.fixture(Path(directory)))
                if kind=='sha': args[3]='0'*64
                if kind=='commit': args[4]='0'*40
                if kind=='destination': args[2].mkdir(); (args[2]/'existing').write_text('preserve')
                with self.assertRaises(ValueError): module.install(*args)
                if kind=='destination': self.assertEqual((args[2]/'existing').read_text(),'preserve')

    def test_failed_build_platform_and_source(self):
        for kind in ['build','cached','platform','source']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                def mutate(files, manifest, extras):
                    if kind=='build': manifest['native_build']['metrics']['exit_code']=2
                    if kind=='cached': manifest['native_build']['metrics']['from_cache']=True
                    if kind=='platform': manifest['target']='linux-aarch64'
                    if kind=='source': manifest['source']['actual_sha512']='c'*128
                with self.assertRaises(ValueError): module.install(*self.fixture(Path(directory), mutate))

if __name__ == '__main__': unittest.main()
