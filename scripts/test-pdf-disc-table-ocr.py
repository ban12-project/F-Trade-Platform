"""Synthetic grid regressions; identifiers/OEs are invented, never factory facts."""
import csv
import io
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont
from pdf_disc_table_ocr import read_words, recover_disc_table, UNRECOVERED
from markitdown_preprocess import local_pdf_ocr, retain_disc_ocr, precise_ocr_data, PRECISE_OCR_DATA


def word(text, x, y, width=100, confidence=95):
    return dict(text=text, left=x, top=y, width=width, height=20, conf=confidence)


def tsv(words):
    output = io.StringIO()
    keys = ['level', 'left', 'top', 'width', 'height', 'conf', 'text']
    writer = csv.DictWriter(output, fieldnames=keys, delimiter='\t', quotechar=None, quoting=csv.QUOTE_NONE, escapechar='\\')
    writer.writeheader()
    for item in words:
        writer.writerow(dict(level=5, **item))
    return output.getvalue()


edges = [30, 100, 350, 600, 850, 1100, 1350, 1600, 1800]
headers = ['ITEM', 'TQNO.', 'OEMNO.', 'PARTNO.', 'LINING(O.D.*I.D.)',
           'SPLINE(NO.-O.D.*I.D.)', 'SPRING', 'VEHICLE']
fixture = [word('Clutch Disc', 30, 10)]
fixture += [word(text if i < 4 else 'UNSUPPORTED-' + text, (left + right) // 2 - (30 if i == 0 else 100) // 2,
                 50, width=30 if i == 0 else 100)
            for i, (text, left, right) in enumerate(zip(headers, edges, edges[1:]))]
fixture += [word('999XD901', 175, 90), word('SYN-OE-A', 380, 90),
            word('999XD902', 175, 170), word('SYN-OE-B', 380, 170)]

with TemporaryDirectory() as directory:
    path = Path(directory) / 'synthetic-grid.png'
    image = Image.new('L', (1850, 320), 255)
    draw = ImageDraw.Draw(image)
    for x in edges:
        draw.line((x, 40, x, 260), fill=180, width=3)
    for y in [70, 140, 220, 260]:
        draw.line((edges[0], y, edges[-1], y), fill=180, width=3)
    image.save(path)
    calls = []
    readings = ['999XD901', 'SYN-OE-A', '999XD902', 'SYN-OE-B']
    def crop_ocr(crop, psm):
        calls.append((crop.size, psm))
        return tsv([word(readings[len(calls) - 1], 5, 5)])
    recovered = recover_disc_table(tsv(fixture), path, crop_ocr)
    assert recovered == ('| TQNO. | OEMNO. |\n| --- | --- |\n'
                         '| 999XD901 | SYN-OE-A |\n| 999XD902 | SYN-OE-B |')
    assert len(calls) == 4 and all(width < 750 for (width, _), _ in calls)
    assert 'PARTNO.' not in recovered and 'LINING' not in recovered
    # Whole-page word boxes can include a nearby rule. They only locate a row;
    # the independently bounded reread must never include the preceding row.
    crossing_rules = [dict(item) for item in fixture]
    crossing_rules[-2].update(top=139, height=50)
    crossing_calls = []
    def bounded_ocr(crop, psm):
        crossing_calls.append((crop.size, psm))
        if crop.height > 240:
            return tsv([word('999XD901', 5, 5), word('999XD902', 5, 80)])
        return tsv([word(readings[len(crossing_calls) - 1], 5, 5)])
    assert recover_disc_table(tsv(crossing_rules), path, bounded_ocr) == recovered
    assert len(crossing_calls) == 4 and all(height <= 240 for (_, height), _ in crossing_calls)
    # A center on a rule is ambiguous even when a fabricated reread would pass.
    on_rules = [dict(item) for item in fixture]
    on_rules[-4].update(top=130, height=20)
    on_rules[-2].update(top=130, height=20)
    assert recover_disc_table(tsv(on_rules), path, lambda *_: tsv([word('999XD901', 5, 5)])) is None
    unsupported_header = [dict(item) for item in fixture]
    unsupported_header[5]['text'] = 'DAMAGED-UNSUPPORTED-HEADER'
    calls.clear()
    assert recover_disc_table(tsv(unsupported_header), path, crop_ocr) == recovered
    # Whole-page text chooses a region; fresh same-cell OCR supplies the value.
    damaged = [dict(item) for item in fixture]
    damaged[-4]['text'] = '999xD9O1'
    calls.clear()
    assert recover_disc_table(tsv(damaged), path, crop_ocr) == recovered
    # Low-confidence OEM and wrong/ambiguous identifiers never become facts.
    assert recover_disc_table(tsv(fixture), path, lambda *_: tsv([word('999xD901', 0, 0)])) is None
    assert recover_disc_table(tsv(fixture), path, lambda *_: tsv([word('999XD901', 0, 0, confidence=20)])) is None
    low_oe = recover_disc_table(tsv(fixture), path, lambda _, psm: tsv([
        word('999XD901' if psm == 7 else 'SYN-OE-A', 0, 0, confidence=95 if psm == 7 else 20)]))
    assert low_oe is not None and 'SYN-OE-A' not in low_oe and low_oe.count(UNRECOVERED) == 2
    # A failed line segmentation gets one independent block-segmentation reading.
    # Neither the malformed first reading nor the neighboring OEM is substituted.
    segmentation_calls = []
    def segmentation_ocr(_, psm):
        segmentation_calls.append(psm)
        return tsv([word('damaged' if psm == 7 else '999XD901', 0, 0)])
    retried = recover_disc_table(tsv(fixture), path, segmentation_ocr)
    assert retried is not None and 'damaged' not in retried
    assert segmentation_calls == [7, 6, 6, 7, 6, 6]
    for mutation in ['brake', 'heading', 'duplicate-heading', 'missing-grid']:
        bad = [dict(item) for item in fixture]
        if mutation == 'brake': bad[0]['text'] = 'Brake Disc'
        if mutation == 'heading': bad[2]['text'] = 'PARTNO.'
        if mutation == 'duplicate-heading': bad.append(word('TQNO.', 100, 20))
        target = path
        if mutation == 'missing-grid':
            target = Path(directory) / 'no-grid.png'
            Image.new('L', image.size, 255).save(target)
        assert recover_disc_table(tsv(bad), target, lambda *_: '') is None, mutation
    # Missing row rules cannot borrow a neighboring OEM cell.
    draw.rectangle((351, 137, 599, 143), fill=255)
    image.save(path)
    broken_oe = recover_disc_table(tsv(fixture), path, lambda _, psm: tsv([
        word('999XD901' if psm == 7 else 'SYN-OE-B', 0, 0)]))
    assert broken_oe is not None and 'SYN-OE-B' not in broken_oe and broken_oe.count(UNRECOVERED) == 2

assert read_words('not tsv') == []
assert read_words('level\tleft\ttop\twidth\theight\tconf\ttext\n5\t0\t0\t10\t10\t95\n') == []
assert [item['text'] for item in read_words(tsv([word('"', 0, 0), word('999XD901', 0, 30)]))] == ['"', '999XD901']
original = 'TQNO. OEMNO.\n999XD901 SYN-OE-A'
kept = retain_disc_ocr(original, recovered)
assert '> 999XD901 SYN-OE-A' in kept and recovered in kept
assert retain_disc_ocr(original, None) == original
independent = original + '\n\nPart No.: RYC-SYN-OTHER'
assert retain_disc_ocr(independent, recovered) == independent
already_labelled = original + '\n\nTQ NO.: 999XD901\nProduct name: Synthetic named disc'
assert retain_disc_ocr(already_labelled, recovered) == already_labelled
print('PASS bounded identity/OEM cells, fresh literal reading, ambiguity and original-record preservation')

# Each synthetic cell has its own marker. The fake OCR derives a value from the
# crop's marker, so borrowing a neighboring rectangle cannot pass this check.
with TemporaryDirectory() as directory:
    path = Path(directory) / 'full-source-grid.png'
    image = Image.new('RGB', (1850, 320), 'white')
    draw = ImageDraw.Draw(image)
    for x in edges:
        draw.line((x, 40, x, 260), fill=(180, 180, 180), width=3)
    # A long gray page border is not a table's outer cell boundary.
    for x in [3, 1847]:
        draw.line((x, 0, x, 319), fill=(180, 180, 180), width=3)
    for y in [70, 140, 220, 260]:
        draw.line((edges[0], y, edges[-1], y), fill=(180, 180, 180), width=3)
    source_rows = [
        ['1', '999XD901', 'SYN-OE-A', 'SYN-PART-A', '1*2', '3-4*5', 'S6(+6)', 'Synthetic A'],
        ['2', '999XD902', 'SYN-OE-B', 'SYN-PART-B', '6*7', '8-9*10', 'S8', 'Synthetic B'],
    ]
    colors = {}
    for row, values in enumerate(source_rows):
        for column, value in enumerate(values):
            color = (30 + column * 20, 35 + row * 90, 40 + column * 10)
            colors[color] = value
            x, y = edges[column] + 15, [100, 180][row]
            draw.rectangle((x, y, x + 8, y + 8), fill=color)
    image.save(path)
    def source_cell_ocr(crop, _):
        pixels = set(crop.get_flattened_data() if hasattr(crop, 'get_flattened_data') else crop.getdata())
        present = [value for color, value in colors.items()
                   if color in pixels]
        assert len(present) == 1, 'A cell reread must contain exactly its own source marker'
        column = next(values.index(present[0]) for values in source_rows if present[0] in values)
        assert crop.width == (edges[column + 1] - edges[column] - 6) * 3
        return tsv([word(present[0], 5, 5)])
    full_fixture = [dict(item) for item in fixture]
    for index, header in enumerate(headers):
        full_fixture[index + 1]['text'] = header
    full_source = recover_disc_table(tsv(full_fixture), path, source_cell_ocr)
    assert full_source == '\n'.join('| ' + ' | '.join(row) + ' |'
                                   for row in [headers, ['---'] * 8, *source_rows])
    assert '| 999XD901 | SYN-OE-B |' not in full_source
    joined_headers = [dict(item) for item in full_fixture]
    joined_headers[7]['text'] = 'SPRINGORRUBBER'
    joined_headers[8]['text'] = 'VEHICLETYPE'
    joined = recover_disc_table(tsv(joined_headers), path, source_cell_ocr)
    assert 'SPRINGORRUBBER | VEHICLETYPE |' in joined and all(value in joined for value in source_rows[0])
    # A whole-page glyph can be confidently wrong. The optional English model
    # rereads only proven part/spring cells; raw results supply the replacements.
    wrong_spring = [*full_fixture, word('$8', edges[6] + 20, 180, width=45),
                   word('SYN-PARTB', edges[3] + 20, 180, width=100)]
    precise_calls = []
    def precise_spring(crop, psm):
        pixels = set(crop.get_flattened_data() if hasattr(crop, 'get_flattened_data') else crop.getdata())
        present = [value for color, value in colors.items() if color in pixels]
        assert len(present) == 1, 'Precision must reread exactly its own source marker'
        column = next(values.index(present[0]) for values in source_rows if present[0] in values)
        assert column in (3, 6)
        assert crop.width == (edges[column + 1] - edges[column] - 6) * (2 if column == 3 else 3)
        value = tsv([word(present[0], 5, 5)])
        precise_calls.append(value)
        return value
    precise = recover_disc_table(tsv(wrong_spring), path, source_cell_ocr,
                                  precise_ocr_crop=precise_spring)
    assert precise == full_source and len(precise_calls) == 4
    assert recover_disc_table(tsv(wrong_spring), path, source_cell_ocr) != full_source
    # Missing/failed optional precision keeps the preexisting literal reading;
    # it never inserts an S, space, dimension symbol, unit or neighboring value.
    def unavailable_precision(*_):
        raise subprocess.TimeoutExpired('synthetic precise OCR', 1)
    fallback_spring = recover_disc_table(tsv(wrong_spring), path, source_cell_ocr,
                                         precise_ocr_crop=unavailable_precision)
    assert '| 8-9*10 | $8 | Synthetic B |' in fallback_spring
    unreadable_precision = recover_disc_table(tsv(wrong_spring), path, source_cell_ocr,
        precise_ocr_crop=lambda *_: tsv([word('SYN-UNREADABLE', 5, 5, confidence=20)]))
    assert unreadable_precision == fallback_spring
    # Repeated dimension retries can exhaust a page's budget. Save already
    # readable cells and complete ITEM/part/spring rereads before those retries.
    exhausted = [False]
    def budgeted_read(crop, psm, precise=False):
        if exhausted[0]:
            raise subprocess.TimeoutExpired('synthetic page budget', 1)
        value = precise_spring(crop, psm) if precise else source_cell_ocr(crop, psm)
        if any(token in value for token in ['1*2', '3-4*5', '6*7', '8-9*10']):
            exhausted[0] = True
            raise subprocess.TimeoutExpired('synthetic dimension retry', 1)
        return value
    budget_fixture = [*full_fixture, word('Synthetic B', edges[7] + 20, 180, width=100)]
    budgeted = recover_disc_table(tsv(budget_fixture), path, budgeted_read,
        precise_ocr_crop=lambda crop, psm: budgeted_read(crop, psm, precise=True))
    assert f'| 1 | 999XD901 | SYN-OE-A | SYN-PART-A | {UNRECOVERED} | {UNRECOVERED} | S6(+6) |' in budgeted
    assert f'| 2 | 999XD902 | SYN-OE-B | SYN-PART-B | {UNRECOVERED} | {UNRECOVERED} | S8 |' in budgeted
    assert '| S8 | Synthetic B |' in budgeted, 'A later readable cell survives earlier retry exhaustion'
    # An unreadable suffix must not discard a separately readable primary label.
    # The damaged TYPE token supplies no header or factory value.
    damaged_suffix = [*full_fixture, word('TYPE', 1755, 50, width=40, confidence=20)]
    def heading_suffix_unreadable(crop, psm):
        pixels = set(crop.get_flattened_data() if hasattr(crop, 'get_flattened_data') else crop.getdata())
        if not any(color in pixels for color in colors):
            return ''
        return source_cell_ocr(crop, psm)
    assert recover_disc_table(tsv(damaged_suffix), path, heading_suffix_unreadable) == full_source
    damaged_primary = [dict(item) for item in damaged_suffix]
    damaged_primary[8]['conf'] = 20
    conservative = recover_disc_table(tsv(damaged_primary), path, heading_suffix_unreadable)
    assert conservative is not None and 'LINING' not in conservative
    # Scan dropout weakens the real outer rules while a distant page border
    # remains solid. Border strength cannot suppress the nearer table boundary.
    weak_path = Path(directory) / 'weak-outer-rules.png'
    weak = image.copy()
    weak_draw = ImageDraw.Draw(weak)
    for x in [edges[0], edges[-1]]:
        for y in range(40, 260, 2):
            weak_draw.line((x - 1, y, x + 1, y), fill='white')
    weak.save(weak_path)
    assert recover_disc_table(tsv(full_fixture), weak_path, source_cell_ocr) == full_source
    # Repeated gray glyph strokes inside a heading's bounds are not outer rules.
    stroke_path = Path(directory) / 'repeated-gray-stroke.png'
    stroke = weak.copy()
    stroke_draw = ImageDraw.Draw(stroke)
    for y in range(70, 260, 5):
        stroke_draw.point((1715, y), fill=(180, 180, 180))
    stroke.save(stroke_path)
    assert recover_disc_table(tsv(full_fixture), stroke_path, source_cell_ocr) == full_source
    # Pale outer ruling is independently visible; internal rules stay unchanged.
    pale_path = Path(directory) / 'pale-outer-rules.png'
    pale = image.copy()
    pale_draw = ImageDraw.Draw(pale)
    for x in [edges[0], edges[-1]]:
        pale_draw.line((x, 40, x, 260), fill=(238, 238, 238), width=3)
    pale.save(pale_path)
    assert recover_disc_table(tsv(full_fixture), pale_path, source_cell_ocr) == full_source
    # Two nearby qualifying outer rules remain ambiguous even when one is faint.
    ambiguous_path = Path(directory) / 'ambiguous-outer-rules.png'
    ambiguous = weak.copy()
    ImageDraw.Draw(ambiguous).line((edges[0] - 8, 40, edges[0] - 8, 260),
                                  fill=(180, 180, 180), width=3)
    ambiguous.save(ambiguous_path)
    core_only = recover_disc_table(tsv(full_fixture), ambiguous_path, source_cell_ocr)
    assert core_only == '\n'.join('| ' + ' | '.join(row) + ' |'
                                 for row in [headers[1:3], ['---'] * 2,
                                             *[values[1:3] for values in source_rows]])
    def unreadable_part(crop, psm):
        if crop.mode == 'L':
            return tsv([word('synthetic-unreadable', 5, 5, confidence=20)])
        result = source_cell_ocr(crop, psm)
        if 'SYN-PART-A' in result:
            return tsv([word('SYN-PART-A', 5, 5, confidence=20)])
        return result
    unreadable = recover_disc_table(tsv(full_fixture), path, unreadable_part)
    assert f'| 1 | 999XD901 | SYN-OE-A | {UNRECOVERED} |' in unreadable
    assert '| 2 | 999XD902 | SYN-OE-B | SYN-PART-B |' in unreadable
    crossed_extra = [*full_fixture, dict(word('SYN-WRONG-NEIGHBOR', edges[3] + 15, 135), height=30)]
    assert recover_disc_table(tsv(crossed_extra), path, source_cell_ocr) == full_source
    missing_oe_calls = []
    def no_own_oe(crop, psm):
        missing_oe_calls.append(1)
        if len(missing_oe_calls) == 4:
            return ''
        return source_cell_ocr(crop, psm)
    partial = recover_disc_table(tsv(full_fixture), path, no_own_oe)
    assert f'| 2 | 999XD902 | {UNRECOVERED} | SYN-PART-B |' in partial
    assert 'SYN-OE-B' not in partial
    timed_reads = []
    def timeout_after_core(crop, psm):
        timed_reads.append(1)
        if len(timed_reads) > 4:
            raise TimeoutError('synthetic optional cell deadline')
        return source_cell_ocr(crop, psm)
    timeout = recover_disc_table(tsv(full_fixture), path, timeout_after_core)
    assert '| 999XD901 | SYN-OE-A |' in timeout and '| 999XD902 | SYN-OE-B |' in timeout
    assert timeout.count(UNRECOVERED) == 12
    # A missing boundary in one optional column cannot borrow the next row's part.
    draw.rectangle((edges[3] + 1, 137, edges[4] - 1, 143), fill='white')
    image.save(path)
    missing_rule = recover_disc_table(tsv(full_fixture), path, source_cell_ocr)
    assert f'| 1 | 999XD901 | SYN-OE-A | {UNRECOVERED} |' in missing_rule
    assert f'| 2 | 999XD902 | SYN-OE-B | {UNRECOVERED} |' in missing_rule
print('PASS all eight explicitly headed columns retain their own literal source cells')

with TemporaryDirectory() as directory:
    data = Path(directory)
    with patch('markitdown_preprocess.PRECISE_OCR_DATA', data):
        assert precise_ocr_data('eng') is None
        (data / 'eng.traineddata').write_bytes(b'\0' * 15_400_601)
        assert precise_ocr_data('eng') is None, 'Correct file size cannot bypass the pinned checksum'
        assert precise_ocr_data('eng+ell') is None
print('PASS missing/corrupt/unconfigured precision models are never used')

if '--local-ocr' in sys.argv:
    with TemporaryDirectory() as directory:
        image = Image.new('RGB', (1800, 550), 'white')
        draw = ImageDraw.Draw(image)
        font_path = os.environ.get('F_TRADE_TEST_FONT', 'DejaVuSans.ttf')
        font = ImageFont.truetype(font_path, 22)
        title = ImageFont.truetype(font_path, 32)
        draw.text((50, 20), 'Clutch Disc', fill='black', font=title)
        actual_edges = [50, 150, 390, 630, 870, 1110, 1350, 1550, 1750]
        for x in actual_edges:
            draw.line((x, 90, x, 450), fill=(180, 180, 180), width=3)
        for y in [90, 160, 280, 400, 450]:
            draw.line((50, y, 1750, y), fill=(180, 180, 180), width=3)
        for i, text in enumerate(['ITEM', 'TQNO.', 'OEMNO.', 'PARTNO.', 'LINING', 'SPLINE', 'SPRING', 'VEHICLE']):
            draw.text((actual_edges[i] + 8, 110), text, fill='black', font=font)
        for y, values in [(200, ['1', '999XD901', 'SYN-OE-A', 'SYN-PART-A', '1*2', '3*4', '8', 'Synthetic A']),
                          (320, ['2', '999XD902', 'SYN-OE-B', 'SYN-PART-B', '5*6', '7*8', '9', 'Synthetic B'])]:
            for i, text in enumerate(values):
                draw.text((actual_edges[i] + 8, y), text, fill='black', font=font)
        path = Path(directory) / 'synthetic-scan.pdf'
        image.save(path, 'PDF', resolution=150)
        os.environ['F_TRADE_LOCAL_OCR_LANGUAGE'] = 'eng'
        # The general repository job has the packaged OCR only; the document
        # image job separately requires the pinned model. Both paths must work.
        has_precision = precise_ocr_data('eng') == PRECISE_OCR_DATA
        original_run = subprocess.run
        precise_reads = []
        def record_precision(args, **kwargs):
            result = original_run(args, **kwargs)
            if '--tessdata-dir' in args:
                assert args[args.index('--tessdata-dir') + 1] == str(PRECISE_OCR_DATA)
                assert result.stdout.startswith('level\t'), 'A standalone model must emit structured raw OCR'
                precise_reads.append(result)
            return result
        with patch('markitdown_preprocess.subprocess.run', side_effect=record_precision):
            text = local_pdf_ocr(path)
        assert len(precise_reads) == (4 if has_precision else 0)
        assert '<!-- f-trade:pdf-page=1 -->' in text
        assert 'Original OCR (unverified):' in text
        assert '| 1 | 999XD901 | SYN-OE-A | SYN-PART-A | 1*2 | 3*4 | 8 | Synthetic A |' in text
        assert '| 2 | 999XD902 | SYN-OE-B | SYN-PART-B | 5*6 | 7*8 | 9 | Synthetic B |' in text
        assert '| 999XD901 | SYN-OE-B |' not in text
        damaged_headings = []
        def damage_initial_heading(args, **kwargs):
            result = original_run(args, **kwargs)
            if ('tesseract' in Path(args[0]).name and 'tsv' not in args
                    and args[args.index('--psm') + 1] == '3'):
                result.stdout, count = re.subn(r'\bTQ\s*NO\.?', 'TQNE.', result.stdout, flags=re.I)
                damaged_headings.append(count)
            return result
        with patch('markitdown_preprocess.subprocess.run', side_effect=damage_initial_heading):
            reread = local_pdf_ocr(path)
        assert damaged_headings == [1] and '> ITEM TQNE.' in reread
        assert '| 999XD901 | SYN-OE-A |' in reread and '| 999XD902 | SYN-OE-B |' in reread
        crossed_boxes = []
        def cross_previous_rule(args, **kwargs):
            result = original_run(args, **kwargs)
            if ('tesseract' in Path(args[0]).name and 'tsv' in args
                    and args[args.index('--psm') + 1] == '3'):
                reader = csv.DictReader(io.StringIO(result.stdout), delimiter='\t', quoting=csv.QUOTE_NONE)
                rows = list(reader)
                for row in rows:
                    if row['text'] == '999XD902':
                        bottom = int(row['top']) + int(row['height'])
                        row.update(top='559', height=str(bottom - 559))
                        crossed_boxes.append(row)
                output = io.StringIO()
                writer = csv.DictWriter(output, fieldnames=reader.fieldnames, delimiter='\t',
                                        quoting=csv.QUOTE_NONE, escapechar='\\')
                writer.writeheader()
                writer.writerows(rows)
                result.stdout = output.getvalue()
            return result
        with patch('markitdown_preprocess.subprocess.run', side_effect=cross_previous_rule):
            crossing = local_pdf_ocr(path)
        assert len(crossed_boxes) == 1
        assert '| 999XD901 | SYN-OE-A |' in crossing
        assert '| 999XD902 | SYN-OE-B |' in crossing
        assert '| 999XD902 | SYN-OE-A |' not in crossing
        failed_passes = []
        def timeout_optional_pass(args, **kwargs):
            if '-r' in args and args[args.index('-r') + 1] == '300':
                failed_passes.append(args)
                raise subprocess.TimeoutExpired(args, 15)
            return original_run(args, **kwargs)
        with patch('markitdown_preprocess.subprocess.run', side_effect=timeout_optional_pass):
            fallback = local_pdf_ocr(path)
        assert len(failed_passes) == 1
        assert 'Recovered source cells' not in fallback
        assert '999XD901' in fallback and '999XD902' in fallback
        assert '<!-- f-trade:pdf-page=1 -->' in fallback
    print('PASS actual offline PDF render + Tesseract + production converter, own-row identity/OEM')
    print('PASS rule-crossing whole-page boxes retain independently bounded own-row OCR')
    print('PASS optional OCR timeout preserves initial readable text and physical provenance')
