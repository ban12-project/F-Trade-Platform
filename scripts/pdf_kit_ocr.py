"""Conservative spatial grouping for scanned, single-row kit component captions.

Input is Tesseract TSV. This does not validate OCR against the original image,
interpret component numbers as OE, or promote component sizes to kit dimensions.
Ambiguous/missing row anchors reject the entire page instead of guessing ownership.
"""
from __future__ import annotations

import csv
import io
import re
from collections import defaultdict

KIT = re.compile(r"^Kit No\.: (\d{4} \d{3} \d{3})$")
PART = re.compile(r"^Part No\.: \S.*$")
TYPE = re.compile(r"^Type No\.: \S.*$")
SIZE = re.compile(r"^Size:(?: .*)?$")


def tsv_lines(tsv):
    groups = defaultdict(list)
    try:
        for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
            if row["level"] != "5" or not row["text"].strip():
                continue
            word = {key: int(row[key]) for key in ("left", "top", "width", "height")}
            word.update(text=row["text"], confidence=float(row["conf"]))
            if min(word[key] for key in ("left", "top", "width", "height")) < 0:
                return []
            groups[tuple(row[key] for key in ("page_num", "block_num", "par_num", "line_num"))].append(word)
    except (KeyError, TypeError, ValueError):
        return []
    lines = []
    for words in groups.values():
        words.sort(key=lambda word: word["left"])
        # Sparse OCR sometimes merges image noise to the left of a caption.
        # Split only at an exact tokenized label, retaining its own coordinates;
        # never repair a label or remove tokens inside its value.
        anchors = [i for i, word in enumerate(words)
                   if (word["text"] in ("Kit", "Part", "Type")
                       and i + 1 < len(words) and words[i + 1]["text"] == "No.:")
                   or word["text"] == "Size:"]
        if len(anchors) == 1:
            words = words[anchors[0]:]
        left, top = min(w["left"] for w in words), min(w["top"] for w in words)
        right = max(w["left"] + w["width"] for w in words)
        bottom = max(w["top"] + w["height"] for w in words)
        lines.append(dict(text=" ".join(w["text"] for w in words), left=left, top=top,
                          right=right, bottom=bottom, confidence=min(w["confidence"] for w in words)))
    return sorted(lines, key=lambda line: (line["top"], line["left"]))


def recover_kit_captions(tsv, refine=None):
    """Return bounded literal component paragraphs, or None; never partial recovery."""
    lines = tsv_lines(tsv)
    if refine is not None:
        lines = refine(lines)
    kits = [line for line in lines if KIT.fullmatch(line["text"])]
    parts = [line for line in lines if PART.fullmatch(line["text"])]
    if not kits or not parts or len(kits) > 30:
        return None
    # A damaged recognized label cannot silently disappear into a neighboring record.
    labelled = [line for line in lines if re.match(r"^(?:Kit|Part|Type|Size)\b", line["text"])]
    if any(not any(pattern.fullmatch(line["text"]) for pattern in (KIT, PART, TYPE, SIZE)) for line in labelled):
        return None
    if any(line["confidence"] < 60 for line in labelled):
        return None
    if len({line["text"] for line in kits}) != len(kits):
        return None
    if any(abs(line["left"] - kits[0]["left"]) > 2 * (kits[0]["bottom"] - kits[0]["top"]) for line in kits):
        return None
    if any(line["top"] < kits[0]["bottom"] for line in parts):
        return None
    blocks = []
    used = set()
    for index, kit in enumerate(kits):
        end = kits[index + 1]["top"] if index + 1 < len(kits) else float("inf")
        row = [line for line in parts if kit["bottom"] <= line["top"] < end]
        if not 1 <= len(row) <= 4:
            return None
        height = max(line["bottom"] - line["top"] for line in row)
        # Two component rows with one missing kit heading must not be merged.
        if max(line["top"] for line in row) - min(line["top"] for line in row) > height:
            return None
        row.sort(key=lambda line: line["left"])
        if any(a["right"] >= b["left"] for a, b in zip(row, row[1:])):
            return None
        captions = []
        for number, part in enumerate(row, start=1):
            matched = []
            for pattern in (TYPE, SIZE):
                candidates = [line for line in lines if pattern.fullmatch(line["text"])
                              and part["bottom"] <= line["top"] < min(end, part["bottom"] + height * 8)
                              and abs(line["left"] - part["left"]) <= height]
                if len(candidates) != 1:
                    return None
                matched.append(candidates[0])
            if matched[0]["bottom"] > matched[1]["top"]:
                return None
            column_end = row[number]["left"] if number < len(row) else float("inf")
            if any(line["right"] >= column_end for line in matched):
                return None
            if any(id(line) in used for line in [part, *matched]):
                return None
            used.update(id(line) for line in [part, *matched])
            bounds = (part["left"], part["top"], max(line["right"] for line in [part, *matched]), matched[-1]["bottom"])
            captions.append(f"Component {number} source [ocr-pixels={','.join(map(str, bounds))}]: "
                            + " / ".join(line["text"] for line in [part, *matched]))
        blocks.append(kit["text"] + "\n" + "\n".join(captions))
    if any(id(line) not in used for line in labelled if not KIT.fullmatch(line["text"])):
        return None
    return "\n\n".join(blocks)


def refine_caption_lines(lines, image_path, ocr_crop):
    """Retry low-confidence caption lines inside their own bounded text regions.

    Neighboring same-label lines can constrain height, never supply text. New
    readings must retain the exact label and meet the original confidence gate.
    No fuzzy label repair and no substitutions from another component are allowed.
    """
    from statistics import median

    labels = (PART, TYPE, SIZE)
    typical = {
        pattern: median(line['bottom'] - line['top'] for line in lines
                        if pattern.fullmatch(line['text']))
        for pattern in labels if any(pattern.fullmatch(line['text']) for line in lines)
    }
    pending = [line for line in lines
               if any(pattern.fullmatch(line['text'])
                      and (line['confidence'] < 60
                           or line['bottom'] - line['top'] > typical[pattern] * 1.5)
                      for pattern in labels)]
    if not pending:
        return lines
    if len(pending) > 20:
        return [{**line, 'confidence': 0} if any(line is item for item in pending) else line for line in lines]
    from PIL import Image

    replacements = {id(line): {**line, 'confidence': 0} for line in pending}
    with Image.open(image_path) as image:
        for line in pending:
            pattern = next(pattern for pattern in labels if pattern.fullmatch(line['text']))
            peers = [other for other in lines if other is not line and other['confidence'] >= 60
                     and pattern.fullmatch(other['text'])]
            if not peers:
                continue
            height = median(other['bottom'] - other['top'] for other in peers)
            neighbors = [other for other in peers if abs(other['top'] - line['top']) <= height]
            top = median(other['top'] for other in neighbors) if neighbors else line['top']
            bounds = (max(0, line['left'] - 5), max(0, int(top - 5)),
                      min(image.width, line['right'] + 10), min(image.height, int(top + height + 6)))
            with image.crop(bounds) as crop:
                # Normalize small caption glyphs for the single-line pass; this
                # never supplies characters or values from another caption.
                with crop.resize((crop.width * 2, crop.height * 2)) as enlarged:
                    readings = tsv_lines(ocr_crop(enlarged))
            if len(readings) != 1 or readings[0]['confidence'] < 60 or not pattern.fullmatch(readings[0]['text']):
                continue
            replacements[id(line)] = {**line, 'text': readings[0]['text'],
                                      'confidence': readings[0]['confidence'],
                                      'top': bounds[1], 'bottom': bounds[3]}
    return [replacements.get(id(line), line) for line in lines]
