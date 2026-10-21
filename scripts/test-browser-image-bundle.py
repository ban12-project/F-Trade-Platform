import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("verifier", Path(__file__).with_name("verify-browser-image-bundle.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ImageBundleIdentity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "images.tar.gz"
        self.revision = "a" * 40
        self.bundle = {"revision": self.revision, "images": {}}
        self.rows = []
        self.contents = {}
        self.actual = {}
        for kind, digit in [("agent", "1"), ("browser", "2")]:
            config = {"architecture": "amd64", "os": "linux", "config": {
                "Labels": {"org.opencontainers.image.revision": self.revision, "io.ftrade.native-profile": "1"},
                "Entrypoint": ["node"], "Env": ["SAFE=1"],
            }, "rootfs": {"type": "layers", "diff_ids": ["sha256:" + digit * 64]}}
            raw = json.dumps(config).encode()
            config_id = "sha256:" + hashlib.sha256(raw).hexdigest()
            name = kind + ".json"
            ref = "example/" + kind + ":release"
            self.contents[name] = raw
            self.rows.append({"Config": name, "RepoTags": [ref], "Layers": [kind + "/layer.tar"]})
            self.bundle["images"][kind] = {"id": config_id}
            # Docker 29 destination ID differs from the archived config ID.
            local_id = "sha256:" + digit * 64
            actual = {"Id": local_id, "Config": config["config"], "Architecture": "amd64", "Os": "linux",
                      "RootFS": {"Type": "layers", "Layers": config["rootfs"]["diff_ids"]}}
            self.actual[ref] = actual
            self.actual[local_id] = actual

    def archive(self):
        with tarfile.open(self.path, "w:gz") as target:
            for name, raw in {"manifest.json": json.dumps(self.rows).encode(), **self.contents}.items():
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                target.addfile(member, io.BytesIO(raw))
        return verifier.archive_identity(self.path, self.bundle)

    def verify(self):
        return verifier.verify_destination(self.archive(), lambda ref: self.actual[ref],
            lambda ref, target: self.actual.__setitem__(target, copy.deepcopy(self.actual[ref])))

    def test_changed_local_ids_are_verified_and_recorded(self):
        result = self.verify()
        self.assertEqual(result["agent"]["sourceId"], self.bundle["images"]["agent"]["id"])
        self.assertEqual(result["agent"]["localId"], "sha256:" + "1" * 64)
        self.assertNotEqual(result["agent"]["localId"], result["agent"]["sourceId"])

    def test_changed_layer_refused(self):
        self.actual["example/agent:release"]["RootFS"]["Layers"] = ["sha256:" + "3" * 64]
        with self.assertRaisesRegex(ValueError, "layers mismatch"):
            self.verify()

    def test_added_or_changed_config_refused(self):
        for field, value in [("Env", ["SAFE=0"]), ("User", "root")]:
            with self.subTest(field=field):
                actual = self.actual["example/agent:release"]
                before = copy.deepcopy(actual["Config"])
                actual["Config"][field] = value
                with self.assertRaisesRegex(ValueError, "config mismatch"):
                    self.verify()
                actual["Config"] = before

    def test_source_config_digest_refused(self):
        self.contents["agent.json"] += b" "
        with self.assertRaisesRegex(ValueError, "config identity mismatch"):
            self.archive()

    def test_platform_refused(self):
        self.actual["example/agent:release"]["Architecture"] = "arm64"
        with self.assertRaisesRegex(ValueError, "platform mismatch"):
            self.verify()

    def test_extra_image_refused(self):
        self.rows.append(copy.deepcopy(self.rows[0]))
        with self.assertRaisesRegex(ValueError, "exactly two"):
            self.archive()

    def test_ambiguous_tags_refused(self):
        self.rows[1]["RepoTags"] = self.rows[0]["RepoTags"]
        with self.assertRaisesRegex(ValueError, "ambiguous archive tags"):
            self.archive()

    def test_unaddressable_local_id_refused(self):
        del self.actual["sha256:" + "1" * 64]
        with self.assertRaises(KeyError):
            self.verify()

    def test_retagged_content_refused(self):
        with self.assertRaisesRegex(ValueError, "config mismatch"):
            verifier.verify_destination(self.archive(), lambda ref: self.actual[ref],
                lambda ref, target: self.actual.__setitem__(target, {**copy.deepcopy(self.actual[ref]), "Config": {}}))


if __name__ == "__main__":
    unittest.main()
