"""Verify trusted Docker-save config identities across image stores; never pull."""

import hashlib
import json
import re
import subprocess
import sys
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_identity(archive, bundle):
    with tarfile.open(archive, "r:gz") as source:
        entries = source.getmembers()
        require(len({e.name for e in entries}) == len(entries), "duplicate archive member")
        rows = json.load(source.extractfile("manifest.json"))
        require(len(rows) == 2, "expected exactly two archive images")
        result = {}
        for row in rows:
            member = source.getmember(row["Config"])
            require(member.isfile() and member.size < 5_000_000, "invalid image config")
            raw = source.extractfile(member).read()
            config_id = "sha256:" + hashlib.sha256(raw).hexdigest()
            kinds = [k for k, image in bundle["images"].items() if image["id"] == config_id]
            require(len(kinds) == 1 and kinds[0] not in result, "archive config identity mismatch")
            kind = kinds[0]
            config = json.loads(raw)
            require(config["architecture"] == bundle.get("architecture", "amd64") and config["os"] == "linux", "wrong platform")
            require(config["config"]["Labels"]["org.opencontainers.image.revision"] == bundle["revision"], "wrong revision")
            if kind == "browser":
                require(config["config"]["Labels"].get("io.ftrade.native-profile") == "1", "native profile label missing")
            layers = config["rootfs"]["diff_ids"]
            require(config["rootfs"]["type"] == "layers" and len(layers) == len(row["Layers"]), "invalid layers")
            require(all(re.fullmatch(r"sha256:[a-f0-9]{64}", layer) for layer in layers), "invalid layer digest")
            tags = row["RepoTags"]
            require(tags and all(isinstance(t, str) and re.fullmatch(r"[a-z0-9][a-z0-9./_:-]+", t) for t in tags), "invalid archive tags")
            result[kind] = {"sourceId": config_id, "tags": tags, "config": config}
        require(set(result) == {"agent", "browser"}, "incomplete image pair")
        require(not (set(result["agent"]["tags"]) & set(result["browser"]["tags"])), "ambiguous archive tags")
        return result


def normalized_config(config):
    # Docker 29 omits these empty/default fields; older inspect APIs add them.
    # https://docs.docker.com/engine/deprecated/#emptynil-fields-in-image-config-from-inspect-api
    empty_values = {"Cmd": (None, []), "Entrypoint": (None, []), "Env": (None, []),
                    "Labels": (None, {}), "OnBuild": (None, []), "User": (None, ""),
                    "Volumes": (None, {}), "WorkingDir": (None, "")}
    return {key: value for key, value in config.items()
            if key not in empty_values or value not in empty_values[key]}


def verify_image(expected, actual):
    config = expected["config"]
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", actual["Id"]), "invalid destination ID")
    require(actual["Architecture"] == config["architecture"] and actual["Os"] == config["os"], "destination platform mismatch")
    require(actual["RootFS"]["Type"] == config["rootfs"]["type"] and actual["RootFS"]["Layers"] == config["rootfs"]["diff_ids"], "destination layers mismatch")
    # Labels alone cannot establish identity. Reject changed non-default settings.
    observed, archived = normalized_config(actual["Config"]), normalized_config(config["config"])
    different = sorted(key for key in set(observed) | set(archived)
                       if key not in observed or key not in archived or observed[key] != archived[key])
    require(not different, "destination config mismatch (fields: " + ", ".join(different) + ")")
    return actual["Id"]


def export_manifest(archive, revision, architecture, sources):
    """Bind archive config digests to the fully inspected source images."""
    require(re.fullmatch(r"[a-f0-9]{40}", revision), "invalid revision")
    require(architecture in ("amd64", "arm64"), "invalid architecture")
    require(set(sources) == {"agent", "browser"}, "incomplete source images")
    bundle = {"version": 1, "revision": revision, "architecture": architecture, "images": {}}
    with tarfile.open(archive, "r:gz") as source:
        entries = source.getmembers()
        require(len({e.name for e in entries}) == len(entries), "duplicate archive member")
        rows = json.load(source.extractfile("manifest.json"))
        require(len(rows) == 2, "expected exactly two archive images")
        for row in rows:
            tags = row.get("RepoTags") or []
            kinds = [kind for kind, inspected in sources.items()
                     if set(tags) & set(inspected.get("RepoTags") or [])]
            require(len(kinds) == 1 and kinds[0] not in bundle["images"], "ambiguous source tags")
            kind = kinds[0]
            member = source.getmember(row["Config"])
            require(member.isfile() and member.size < 5_000_000, "invalid image config")
            raw = source.extractfile(member).read()
            verify_image({"config": json.loads(raw)}, sources[kind])
            bundle["images"][kind] = {"id": "sha256:" + hashlib.sha256(raw).hexdigest(),
                                      "architecture": architecture, "revision": revision}
    archive_identity(archive, bundle)
    return bundle


def verify_destination(identity, inspect=None, tag=None):
    if inspect is None:
        def inspect(ref):
            return json.loads(subprocess.check_output(["docker", "image", "inspect", ref], text=True))[0]
    if tag is None:
        def tag(ref, name):
            subprocess.run(["docker", "tag", ref, name], check=True)
    result = {}
    for kind, suffix in [("agent", "browser-node"), ("browser", "browser")]:
        expected = identity[kind]
        ids = {verify_image(expected, inspect(ref)) for ref in expected["tags"]}
        require(len(ids) == 1, "destination tags disagree")
        local_id = ids.pop()
        require(verify_image(expected, inspect(local_id)) == local_id, "destination ID not addressable")
        target = "ftrade-sandbox-" + suffix + ":test-amd64"
        tag(local_id, target)
        require(verify_image(expected, inspect(target)) == local_id, "destination tag changed")
        result[kind] = {"sourceId": expected["sourceId"], "localId": local_id}
    require(result["agent"]["localId"] != result["browser"]["localId"], "destination images collide")
    return result


if __name__ == "__main__":
    if sys.argv[1] == "archive":
        with open(sys.argv[3]) as stream:
            output = archive_identity(sys.argv[2], json.load(stream))
    elif sys.argv[1] == "export":
        with open(sys.argv[5]) as stream:
            sources = json.load(stream)
        require(len(sources) == 2, "expected exactly two inspected images")
        output = export_manifest(sys.argv[2], sys.argv[3], sys.argv[4], dict(zip(["agent", "browser"], sources)))
    elif sys.argv[1] == "destination":
        with open(sys.argv[2]) as stream:
            output = verify_destination(json.load(stream))
    else:
        raise ValueError("invalid verification mode")
    print(json.dumps(output, sort_keys=True))
