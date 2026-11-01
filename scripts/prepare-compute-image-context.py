#!/usr/bin/env python3
"""Prepare only the reviewed document/media/Remotion sources for a VCR build."""
import importlib.util
from pathlib import Path
import shlex
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
EXTRA = (
    'ops/vps-runtime/compute.Dockerfile',
    'ops/vps-runtime/render.mjs',
    'ops/vps-runtime/render-workspace.mjs',
)


def prepare(destination: Path) -> None:
    for name in EXTRA:
        source = ROOT / name
        if not source.is_file() or source.resolve() != source.absolute():
            raise ValueError('Compute context source must be regular and not symlinked')
    copies = [shlex.split(line) for line in (ROOT / EXTRA[0]).read_text().splitlines()
              if line.split() and line.split()[0].upper() in ('COPY', 'ADD')]
    if copies != [
        ['COPY', '--from=node', '/usr/local/', '/usr/local/'],
        ['COPY', EXTRA[1], '/opt/ftrade-remotion/render.mjs'],
        ['COPY', EXTRA[2], '/opt/ftrade-remotion/render-workspace.mjs'],
    ]:
        raise ValueError('Compute Dockerfile inputs changed; review the allowlist')
    spec = importlib.util.spec_from_file_location('document_context', ROOT / 'scripts/prepare-document-image-context.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare_context(ROOT, destination)
    try:
        for name in EXTRA:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target, follow_symlinks=False)
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: prepare-compute-image-context.py <new-directory>')
    prepare(Path(sys.argv[1]))
    print('Created source-only compute image context')
