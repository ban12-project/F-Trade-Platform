"""Synthetic spatial regressions; all identifiers and dimensions are invented."""
import csv
import io
from copy import deepcopy
from pdf_kit_ocr import recover_kit_captions


def line(text, x, y, width=110, confidence=95):
    return dict(text=text, left=x, top=y, width=width, height=10, conf=confidence)


def tsv(lines):
    output = io.StringIO()
    keys = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'left', 'top', 'width', 'height', 'conf', 'text']
    writer = csv.DictWriter(output, fieldnames=keys, delimiter='\t')
    writer.writeheader()
    for index, item in enumerate(lines):
        writer.writerow(dict(level=5, page_num=1, block_num=index + 1, par_num=1, line_num=1, **item))
    return output.getvalue()


fixture = []
for index, y in enumerate([20, 200]):
    fixture.append(line(f'Kit No.: 9999 999 99{index}', 10, y))
    for column, x in enumerate([100, 300]):
        fixture += [line(f'Part No.: SYN-{index}-{column}', x, y + 50),
                    line(f'Type No.: MOCK-{index}-{column}', x, y + 70),
                    line(f'Size: {index + 1}*{column + 1}', x, y + 90)]
text = recover_kit_captions(tsv(fixture))
assert text is not None
blocks = text.split('\n\n')
assert len(blocks) == 2
for index, block in enumerate(blocks):
    assert f'SYN-{index}-0' in block and f'SYN-{index}-1' in block
    assert f'SYN-{1-index}-' not in block
    assert block.count('Component ') == 2
assert recover_kit_captions(tsv(list(reversed(fixture)))) == text
# Missing or damaged kit headings must not transfer a second row to the first kit.
assert recover_kit_captions(tsv([item for i, item in enumerate(fixture) if i != 7])) is None
for mutation in ['label', 'confidence', 'overlap', 'missing_type', 'orphan', 'duplicate', 'mixed_column', 'two_columns']:
    bad = deepcopy(fixture)
    if mutation == 'label': bad[7]['text'] = 'Kit Ne.: 9999 999 991'
    if mutation == 'confidence': bad[3]['conf'] = 0
    if mutation == 'overlap': bad[1]['width'] = 250
    if mutation == 'missing_type': bad.pop(2)
    if mutation == 'orphan': bad.append(line('Type No.: ORPHAN', 900, 100))
    if mutation == 'duplicate': bad[7]['text'] = bad[0]['text']
    if mutation == 'mixed_column': bad[2]['left'] = 300
    if mutation == 'two_columns': bad[7]['left'] = 500
    assert recover_kit_captions(tsv(bad)) is None, mutation
assert recover_kit_captions('not tsv') is None
assert recover_kit_captions(tsv(fixture + [line('Brake Disc', 10, 1)])) is None
print('PASS scanned kit spatial isolation, literal captions, missing-heading and damaged-OCR guards')

# The native PDF CI environment includes Pillow. Exercise crop failure and label
# preservation without relying on OCR confidence from a machine-specific font.
import sys
if '--native-pdf' in sys.argv:
    from PIL import Image
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from pdf_kit_ocr import refine_caption_lines, tsv_lines
    damaged = deepcopy(fixture)
    damaged[1]['height'] = 30  # High confidence, but image-contaminated bounds.
    damaged[1]['text'] = 'Part No.: WRONG-SYNTHETIC'
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'synthetic.png'
        Image.new('RGB', (700, 400), 'white').save(path)
        original = tsv_lines(tsv(damaged))
        failed = refine_caption_lines(original, path, lambda _: 'not tsv')
        assert recover_kit_captions('', lambda _: failed) is None
        changed_label = refine_caption_lines(original, path, lambda _: tsv([line('Type No.: SYN-0-0', 0, 0)]))
        assert recover_kit_captions('', lambda _: changed_label) is None
        repaired = refine_caption_lines(original, path, lambda _: tsv([line('Part No.: SYN-0-0', 0, 0)]))
        result = recover_kit_captions('', lambda _: repaired)
        assert result is not None and 'WRONG-SYNTHETIC' not in result
        assert 'Part No.: SYN-0-0' in result
    print('PASS caption geometry retry, exact-label preservation and failed-retry rejection')

# A label keeps its own word coordinates when sparse OCR attaches image noise.
from pdf_kit_ocr import tsv_lines
out = io.StringIO()
keys = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'left', 'top', 'width', 'height', 'conf', 'text']
writer = csv.DictWriter(out, fieldnames=keys, delimiter='\t')
writer.writeheader()
for token, x, confidence in [('noise', 10, 0), ('Part', 100, 95), ('No.:', 140, 95), ('SYN-001', 180, 95)]:
    writer.writerow(dict(level=5, page_num=1, block_num=1, par_num=1, line_num=1,
                         left=x, top=20, width=30, height=10, conf=confidence, text=token))
parsed = tsv_lines(out.getvalue())
assert len(parsed) == 1 and parsed[0]['text'] == 'Part No.: SYN-001'
assert parsed[0]['left'] == 100 and parsed[0]['confidence'] == 95
