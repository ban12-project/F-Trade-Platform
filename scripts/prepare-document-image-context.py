#!/usr/bin/env python3
"""Create a fresh, source-only context for the document/media image."""
from pathlib import Path
import shlex
import shutil
import sys

FILES = (
    'ops/video-sandbox/Dockerfile',
    'scripts/markitdown_preprocess.py',
    'scripts/pdf_catalog_layout.py',
    'scripts/pdf_kit_ocr.py',
)


def prepare_context(root: Path, destination: Path) -> None:
    root = root.resolve()
    # Validate all inputs before creating output. Never follow a symlink into
    # credentials, reference materials or another checkout.
    for name in FILES:
        path = root / name
        if not path.is_file() or path.resolve() != path.absolute():
            raise ValueError(f'Expected a regular, non-symlink source: {name}')
    instructions = []
    logical = (root / FILES[0]).read_text().replace(chr(92) + chr(10), ' ')
    for line in logical.splitlines():
        if line.split() and line.split()[0].upper() in ('COPY', 'ADD'):
            instructions.append(shlex.split(line, comments=True))
    expected = [['COPY', *FILES[1:], '/opt/f-trade/']]
    if instructions != expected:
        raise ValueError('Dockerfile COPY/ADD inputs changed; review the context allowlist first')
    destination.mkdir(parents=False, exist_ok=False)
    try:
        for name in FILES:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, target, follow_symlinks=False)
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/prepare-document-image-context.py <new-directory>')
    prepare_context(Path(__file__).resolve().parent.parent, Path(sys.argv[1]))
    print('Created source-only document image context (4 files)')
