#!/usr/bin/env python3
"""Read-only, relocation-independent profile fingerprints; never print paths/data.

Usage: python3 browser-vps-fingerprint.py --root account=/private/volume/_data
Repeat --root for node-state/private-config. Run only on stopped storage. Hashes
include relative paths, types, mode, numeric ownership, symlink targets, hardlink
relationships, xattr names/values and file contents. mtime is excluded from the
receipt but checked while reading to refuse a concurrently changing source.
"""
import argparse
import hashlib
import json
import os
import stat
import sys


def fingerprint(root):
    if not hasattr(os, "listxattr") or not hasattr(os, "getxattr"):
        raise RuntimeError("linux_xattr_support_required")
    root = os.path.abspath(root)
    digest = hashlib.sha256()
    hardlinks = {}

    def field(value):
        if isinstance(value, str):
            value = value.encode('utf-8', errors='surrogateescape')
        elif isinstance(value, int):
            value = str(value).encode('ascii')
        digest.update(len(value).to_bytes(8, 'big'))
        digest.update(value)

    def stable(s):
        return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns,
                s.st_uid, s.st_gid, s.st_mode, s.st_nlink)

    def visit(path, relative):
        before = os.lstat(path)
        field(relative)
        field(stat.S_IFMT(before.st_mode))
        field(stat.S_IMODE(before.st_mode))
        field(before.st_uid)
        field(before.st_gid)
        # Unsupported/denied xattr access is not silently interpreted as empty.
        names = sorted(os.listxattr(path, follow_symlinks=False), key=os.fsencode)
        field(len(names))
        for name in names:
            field(name)
            field(os.getxattr(path, name, follow_symlinks=False))
        if stat.S_ISLNK(before.st_mode):
            field(os.readlink(path))
        elif stat.S_ISDIR(before.st_mode):
            children = sorted(os.listdir(path), key=os.fsencode)
            field(len(children))
            for child in children:
                visit(os.path.join(path, child), os.path.join(relative, child))
            if children != sorted(os.listdir(path), key=os.fsencode):
                raise RuntimeError('source_changed')
        elif stat.S_ISREG(before.st_mode):
            identity = (before.st_dev, before.st_ino)
            if before.st_nlink > 1 and identity in hardlinks:
                field('hardlink')
                field(hardlinks[identity])
            else:
                if before.st_nlink > 1:
                    hardlinks[identity] = relative
                field('file')
                body = hashlib.sha256()
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as handle:
                    if stable(os.fstat(handle.fileno())) != stable(before):
                        raise RuntimeError('source_changed')
                    for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                        body.update(chunk)
                    if stable(os.fstat(handle.fileno())) != stable(before):
                        raise RuntimeError('source_changed')
                field(body.digest())
        else:
            # Sockets/FIFOs/devices are not silently skipped from a profile.
            raise RuntimeError('unsupported_profile_entry')
        if stable(os.lstat(path)) != stable(before):
            raise RuntimeError('source_changed')

    visit(root, '.')
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', action='append', required=True, metavar='LABEL=PATH')
    args = parser.parse_args()
    result = {}
    for item in args.root:
        label, separator, root = item.partition('=')
        if not separator or not label or not all(c.isalnum() or c in '-_.' for c in label) or label in result:
            raise ValueError('invalid_fingerprint_label')
        result[label] = fingerprint(root)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('fingerprint_failed_no_private_details', file=sys.stderr)
        sys.exit(1)
