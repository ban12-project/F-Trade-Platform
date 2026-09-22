"""Install only a fully hashed Firefox155 Linux candidate into an empty directory."""
import argparse
import configparser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def install(archive, manifest_path, destination, expected_sha, expected_commit):
    if not re.fullmatch('[a-f0-9]{64}', expected_sha or ''):
        raise ValueError('Explicit candidate SHA256 required')
    if not re.fullmatch('[a-f0-9]{40}', expected_commit or ''):
        raise ValueError('Explicit source commit required')
    manifest = json.loads(manifest_path.read_text())
    if digest(archive) != expected_sha or manifest['candidate_sha256'] != expected_sha:
        raise ValueError('Candidate archive hash mismatch')
    if manifest['target'] != 'linux-x86_64' or manifest['origin']['commit'] != expected_commit:
        raise ValueError('Candidate platform or source commit mismatch')
    if manifest['source']['commit'] != expected_commit or manifest['source']['status'] != 'pass':
        raise ValueError('Candidate source verification missing')
    if manifest['source']['actual_sha512'] != manifest['source']['expected_sha512']:
        raise ValueError('Official source checksum mismatch')
    build = manifest['native_build']
    if build['status'] != 'pass' or build['metrics']['exit_code'] != 0 or build['metrics'].get('from_cache'):
        raise ValueError('Actual successful compilation required')
    files = manifest['installation']['file_sha256']
    required = {'camoufox-bin', 'libxul.so', 'application.ini', 'properties.json', 'version.json', 'camoufox.cfg'}
    if not required.issubset(files) or not any(p.startswith('fontconfig/linux/') for p in files) or not any(p.startswith('fonts/linux/') for p in files):
        raise ValueError('Required candidate resources missing')
    for name, sha in files.items():
        parts = PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts or str(parts) != name or not re.fullmatch('[a-f0-9]{64}', sha):
            raise ValueError('Invalid manifest file entry')
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError('Candidate destination must be empty')
    seen = set()
    proc = subprocess.Popen(['zstd', '-d', '-c', str(archive)], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode='r|') as tar:
            for member in tar:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'bin':
                    raise ValueError('Archive path escapes candidate bin')
                if not (member.isfile() or member.isdir()):
                    raise ValueError('Candidate links and special files forbidden')
                relative = str(PurePosixPath(*name.parts[1:]))
                target = destination.joinpath(*name.parts[1:])
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if relative not in files or relative in seen:
                    raise ValueError('Unlisted or duplicate candidate file')
                seen.add(relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    while block := source.read(1024 * 1024):
                        output.write(block)
                target.chmod(member.mode & 0o777)
                if digest(target) != files[relative]:
                    raise ValueError('Candidate file hash mismatch: ' + relative)
        if proc.wait() != 0:
            raise ValueError('Candidate decompression failed')
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    if seen != set(files):
        raise ValueError('Candidate files missing from archive')
    config = configparser.ConfigParser(interpolation=None)
    config.read(destination / 'application.ini')
    version = config['App']['Version']
    if not version.startswith('155.0.1-') or version != manifest['installation']['application_version']:
        raise ValueError('Firefox155 application identity mismatch')
    if config['App']['BuildID'] != manifest['installation']['build_id']:
        raise ValueError('Candidate BuildID mismatch')
    meta = json.loads((destination / 'version.json').read_text())
    if meta['version'] + '-' + meta['release'] != version:
        raise ValueError('Wrapper identity mismatch')
    for name in ['camoufox-bin', 'libxul.so']:
        if digest(destination / name) != manifest['installation']['binary_hashes'][name]:
            raise ValueError('Candidate binary identity mismatch')
        with (destination / name).open('rb') as binary:
            header = binary.read(20)
        if header[:6] != b'\x7fELF\x02\x01' or header[18:20] != b'\x3e\x00':
            raise ValueError('Candidate binary must be ELF x86_64')
    if not ((destination / 'camoufox-bin').stat().st_mode & 0o111):
        raise ValueError('Candidate browser is not executable')
    return {'candidate_sha256': expected_sha, 'source_commit': expected_commit, 'files': len(seen), 'version': version}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['archive', 'manifest', 'destination']:
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    print(json.dumps(install(args.archive, args.manifest, args.destination, args.sha256, args.commit)))
