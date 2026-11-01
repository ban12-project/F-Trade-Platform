import importlib.util
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('compute_context', ROOT / 'scripts/prepare-compute-image-context.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temporary:
    destination = Path(temporary) / 'context'
    module.prepare(destination)
    files = {str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()}
    assert len(files) == 9, files
    assert set(module.EXTRA) <= files
    assert not any('.env' in p or 'reference/' in p or 'node_modules/' in p for p in files)
    try:
        module.prepare(destination)
    except FileExistsError:
        pass
    else:
        raise AssertionError('Existing context must never be overwritten')
print('PASS source-only compute context and no-overwrite guard')
