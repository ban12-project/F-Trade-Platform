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
from pdf_disc_table_ocr import read_words, recover_disc_table
from markitdown_preprocess import local_pdf_ocr, retain_disc_ocr


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
fixture += [word(text, (left + right) // 2 - (30 if i == 0 else 100) // 2,
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
    assert recover_disc_table(tsv(fixture), path, lambda _, psm: tsv([
        word('999XD901' if psm == 7 else 'SYN-OE-A', 0, 0, confidence=95 if psm == 7 else 20)])) is None
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
    assert recover_disc_table(tsv(fixture), path, lambda _, psm: tsv([
        word('999XD901' if psm == 7 else 'SYN-OE-B', 0, 0)])) is None

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
        text = local_pdf_ocr(path)
        assert '<!-- f-trade:pdf-page=1 -->' in text
        assert 'Original OCR (unverified):' in text
        assert '| 999XD901 | SYN-OE-A |' in text
        assert '| 999XD902 | SYN-OE-B |' in text
        assert '| 999XD901 | SYN-OE-B |' not in text
        original_run = subprocess.run
        damaged_headings = []
        def damage_initial_heading(args, **kwargs):
            result = original_run(args, **kwargs)
            if 'tesseract' in Path(args[0]).name and 'tsv' not in args:
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
        assert 'Recovered identity/OEM cells' not in fallback
        assert '999XD901' in fallback and '999XD902' in fallback
        assert '<!-- f-trade:pdf-page=1 -->' in fallback
    print('PASS actual offline PDF render + Tesseract + production converter, own-row identity/OEM')
    print('PASS rule-crossing whole-page boxes retain independently bounded own-row OCR')
    print('PASS optional OCR timeout preserves initial readable text and physical provenance')
