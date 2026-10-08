"""Literal, grid-bounded OCR rows from explicitly headed clutch-disc catalogs.

No text substitutions or engineering interpretation. Original OCR is retained by
its caller; absent/ambiguous grid boundaries reject the row instead of borrowing
an adjacent row's facts. Every recovered value still needs source review.
"""
from __future__ import annotations
import csv
import io
import math
import re

IDENTIFIER = re.compile(r"^\d+(?:XDC|XD|XC)\d+[A-Z]?$")
STARTS = [r"ITEM\.?", r"TQ(?:NO\.?)?", r"OEM(?:NO\.?)?", r"PART(?:NO\.?)?"]


def read_words(tsv):
    words = []
    try:
        for row in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
            if row["level"] != "5" or not row["text"].strip():
                continue
            word = {key: int(row[key]) for key in ("left", "top", "width", "height")}
            word.update(text=row["text"].strip(), confidence=float(row["conf"]))
            if (min(word[key] for key in ("left", "top", "width", "height")) < 0
                    or not math.isfinite(word["confidence"]) or not 0 <= word["confidence"] <= 100):
                return []
            word.update(right=word["left"] + word["width"], bottom=word["top"] + word["height"])
            words.append(word)
            if len(words) > 20_000:
                return []
    except (KeyError, TypeError, ValueError):
        return []
    return words


def groups_above(values, threshold):
    groups = []
    for position, value in enumerate(values):
        if value < threshold:
            continue
        if groups and position == groups[-1][-1] + 1:
            groups[-1].append(position)
        else:
            groups.append([position])
    return groups


def recover_disc_table(tsv, image_path, ocr_crop):
    from PIL import Image
    words = read_words(tsv)
    text = " ".join(w["text"] for w in words)
    if not re.search(r"\bclutch\s+(?:disc|disk)\b", text, re.I) or re.search(r"\bbrake\b|制动|刹车", text, re.I):
        return None
    identifiers = [w for w in words if re.fullmatch(STARTS[1], w["text"], re.I)]
    if len(identifiers) != 1:
        return None
    heading = identifiers[0]
    with Image.open(image_path) as image:
        if image.width * image.height > 30_000_000:
            return None
        if any(w["right"] > image.width or w["bottom"] > image.height for w in words):
            return None
        if heading["confidence"] < 60:
            bounds = (max(0, heading["left"] - 5), max(0, heading["top"] - 5),
                      min(image.width, heading["right"] + 5), min(image.height, heading["bottom"] + 5))
            with image.crop(bounds) as crop:
                with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                    reread = read_words(ocr_crop(enlarged, 7))
            value = " ".join(w["text"] for w in sorted(reread, key=lambda w: w["left"]))
            if not reread or min(w["confidence"] for w in reread) < 60 or not re.fullmatch(r"TQ\s*NO\.?", value, re.I):
                return None
            # A fresh reading of the same region may replace OCR; never a fuzzy repair.
            heading["text"] = value
            heading["confidence"] = min(w["confidence"] for w in reread)
        band = sorted([w for w in words if heading["top"] <= (w["top"] + w["bottom"]) / 2 <= heading["bottom"]
                       and w["text"] != "|"], key=lambda w: w["left"])
        starts = []
        for pattern in STARTS:
            found = [i for i, w in enumerate(band) if re.fullmatch(pattern, w["text"].replace(" ", ""), re.I)]
            if len(found) != 1:
                return None
            starts.append(found[0])
        if starts != sorted(starts):
            return None
        columns = [band[start:starts[i + 1]] for i, start in enumerate(starts[:-1])]
        part_end = starts[-1] + 1
        if part_end < len(band) and re.fullmatch(r"NO\.?", band[part_end]["text"], re.I):
            part_end += 1
        columns.append(band[starts[-1]:part_end])
        for column in columns[:4]:
            if min(w["confidence"] for w in column) >= 60:
                continue
            bounds = (max(0, column[0]["left"] - 5), max(0, min(w["top"] for w in column) - 5),
                      min(image.width, column[-1]["right"] + 5), min(image.height, max(w["bottom"] for w in column) + 5))
            with image.crop(bounds) as crop:
                with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                    reread = read_words(ocr_crop(enlarged, 7))
            value = " ".join(w["text"] for w in sorted(reread, key=lambda w: w["left"]))
            original = " ".join(w["text"] for w in column)
            if (not reread or min(w["confidence"] for w in reread) < 60
                    or re.sub(r"\s", "", value).lower() != re.sub(r"\s", "", original).lower()):
                return None
            for word in column:
                word["confidence"] = min(w["confidence"] for w in reread)
        headers = [" ".join(w["text"] for w in column) for column in columns]
        if (not re.fullmatch(r"TQ\s*NO\.?", headers[1], re.I)
                or not re.fullmatch(r"OEM\s*NO\.?", headers[2], re.I)
                or not re.fullmatch(r"PART\s*NO\.?", headers[3], re.I)):
            return None
        if min(w["confidence"] for column in columns[:4] for w in column) < 60:
            return None
        centers = [(column[0]["left"] + column[-1]["right"]) / 2 for column in columns]
        body_top = max(w["bottom"] for w in band)
        body = [w for w in words if w["top"] > body_top]
        possible_ids = [w for w in body if re.fullmatch(IDENTIFIER.pattern, w["text"], re.I)]
        if not possible_ids:
            return None
        body_bottom = min(image.height, max(w["bottom"] for w in possible_ids) + heading["height"] * 4)
        # Gray ruling differs from black glyphs and white page/background. Pixel
        # projection establishes actual uneven cell widths, not header midpoints.
        mask = image.convert("L").point(lambda value: 255 if 140 <= value <= 235 else 0)
        projected = mask.crop((0, body_top, image.width, body_bottom)).resize((image.width, 1), Image.Resampling.BOX).tobytes()
        edges = {}
        for boundary in (1, 2, 3):
            left, right = int(centers[boundary - 1]), int(centers[boundary])
            peak = max(projected[left:right], default=0)
            if peak < 45:
                return None
            verticals = groups_above(projected[left:right], peak * .75)
            if len(verticals) != 1 or len(verticals[0]) > heading["height"]:
                return None
            edges[boundary] = left + (verticals[0][0] + verticals[0][-1]) / 2
        if (not edges[1] < edges[2] < edges[3]
                or any(not edges[i] < centers[i] < edges[i + 1] for i in (1, 2))):
            return None
        # Whole-page OCR can damage a letter or attach a rule to the identifier.
        # These words select regions only; only a fresh, exact cell reading is evidence.
        candidates = [w for w in body if edges[1] < (w["left"] + w["right"]) / 2 < edges[2]
                      and w["bottom"] < body_bottom]
        if not 2 <= len(candidates) <= 200:
            return None
        rules = {}
        for column in (1, 2):
            left, right = edges[column], edges[column + 1]
            # Exclude vertical rules so they cannot masquerade as horizontal ones.
            region = mask.crop((int(left) + 8, body_top - heading["height"], int(right) - 8, body_bottom))
            horizontal = region.resize((1, region.height), Image.Resampling.BOX).tobytes()
            lines = []
            for group in groups_above(horizontal, 140):
                offset = body_top - heading["height"]
                if len(group) <= heading["height"] / 2:
                    lines.append(offset + (group[0] + group[-1]) / 2)
                else:
                    # A shaded section band contributes boundaries, not a product.
                    lines.extend([offset + group[0], offset + group[-1]])
            rules[column] = lines
        rows, retries, visited = [], 0, set()
        for identifier in sorted(candidates, key=lambda w: w["top"]):
            above = [line for line in rules[1] if line < identifier["top"]]
            below = [line for line in rules[1] if line > identifier["bottom"]]
            if not above or not below:
                continue
            top, bottom = max(above), min(below)
            if (top, bottom) in visited:
                continue
            visited.add((top, bottom))
            values = []
            # Only the reviewed identity/OEM columns become structured evidence.
            # Other literal cells remain in the original OCR, not engineering fields.
            for column in (1, 2):
                left, right = edges[column], edges[column + 1]
                bounds = []
                for target in (top, bottom):
                    matching = [line for line in rules[column] if abs(line - target) <= heading["height"]]
                    if len(matching) != 1:
                        break
                    bounds.append(matching[0])
                if len(bounds) != 2 or bounds[0] >= bounds[1]:
                    break
                if (right - left <= 6 or bounds[1] - bounds[0] <= 6
                        or (right - left) * (bounds[1] - bounds[0]) > 1_000_000):
                    break
                if retries >= 128:
                    break
                retries += 1
                with image.crop((int(left) + 3, int(bounds[0]) + 3, int(right) - 3, int(bounds[1]) - 3)) as crop:
                    with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                        selected = read_words(ocr_crop(enlarged, 7 if column == 1 else 6))
                        valid_id = (len(selected) == 1 and selected[0]["confidence"] >= 60
                                    and IDENTIFIER.fullmatch(selected[0]["text"]))
                        if column == 1 and not valid_id and retries < 128:
                            # A second segmentation of exactly the same cell. Its
                            # literal output must independently pass all checks.
                            retries += 1
                            selected = read_words(ocr_crop(enlarged, 6))
                if not selected or any("|" in w["text"] for w in selected):
                    break
                if column == 1 and (len(selected) != 1 or selected[0]["confidence"] < 60 or not IDENTIFIER.fullmatch(selected[0]["text"])):
                    break
                if column == 2 and min(w["confidence"] for w in selected) < 60:
                    break
                # OCR boxes on the same printed line can have different tops.
                # Group by overlapping baselines before ordering left-to-right.
                lines = []
                for word in sorted(selected, key=lambda w: (w["top"], w["left"])):
                    cy = (word["top"] + word["bottom"]) / 2
                    if lines and abs(cy - lines[-1][0]) <= word["height"] / 2:
                        lines[-1][1].append(word)
                    else:
                        lines.append((cy, [word]))
                value = " ".join(w["text"] for _, line in lines for w in sorted(line, key=lambda w: w["left"]))
                values.append(value)
            if len(values) == 2:
                rows.append(values)
        if not rows:
            return None
        return "\n".join("| " + " | ".join(row) + " |" for row in [headers[1:3], ["---", "---"], *rows])
