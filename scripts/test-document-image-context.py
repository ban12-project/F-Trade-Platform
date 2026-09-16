"""Prove synthetic secrets and references cannot enter the image build context."""
import importlib.util
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('context_builder', Path(__file__).with_name('prepare-document-image-context.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory) / 'repo'
    root.mkdir()
    for name in module.FILES:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('SYNTHETIC SOURCE')
    dockerfile = root / module.FILES[0]
    dockerfile.write_text('FROM ubuntu:24.04\nRUN true ' + chr(92) + '\n  && true\nCOPY ' + ' '.join(module.FILES[1:]) + ' /opt/f-trade/\n')
    for name in ['.env.local', 'docs/reference/private.pdf', 'node_modules/private.txt', '.git/config']:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('SYNTHETIC DO NOT COPY')
    destination = Path(directory) / 'context'
    module.prepare_context(root, destination)
    assert sorted(str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()) == sorted(module.FILES)
    assert all(p.read_bytes() == (root / p.relative_to(destination)).read_bytes() for p in destination.rglob('*') if p.is_file())
    try:
        module.prepare_context(root, destination)
    except FileExistsError:
        pass
    else:
        raise AssertionError('Must not overwrite an existing context')
    for instruction in ['ADD . /app', 'COPY .env.local /secret']:
        original = dockerfile.read_text()
        dockerfile.write_text(original + instruction + '\n')
        try:
            module.prepare_context(root, Path(directory) / 'rejected')
        except ValueError:
            assert not (Path(directory) / 'rejected').exists()
        else:
            raise AssertionError('Unexpected source must be rejected')
        dockerfile.write_text(original)
    source = root / module.FILES[-1]
    source.unlink()
    source.symlink_to(root / '.env.local')
    try:
        module.prepare_context(root, Path(directory) / 'symlink-rejected')
    except ValueError:
        assert not (Path(directory) / 'symlink-rejected').exists()
    else:
        raise AssertionError('Symlink source must be rejected')
print('PASS isolated image context, secret/reference exclusion, no overwrite and symlink guards')
