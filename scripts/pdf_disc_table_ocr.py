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
import subprocess

IDENTIFIER = re.compile(r"^\d+(?:XDC|XD|XC)\d+[A-Z]?$")
STARTS = [r"ITEM\.?", r"TQ(?:NO\.?)?", r"OEM(?:NO\.?)?", r"PART(?:NO\.?)?"]
EXTRA_STARTS = [r"_?LINING\b.*", r"SPLINE\b.*", r"SPRING(?:ORRUBBER)?\b.*", r"VEHICLE(?:TYPE)?\b.*"]
EXTRA_LABELS = [r"LINING\b", r"SPLINE\b", r"SPRING(?:\s*OR\s*RUBBER)?\b", r"VEHICLE(?:\s*TYPE)?\b"]
UNRECOVERED = "[OCR unreadable; review original cell]"


def literal_cell(words):
    """Order literal OCR tokens without substitutions or dimension interpretation."""
    if not words or min(w["confidence"] for w in words) < 60 or any("|" in w["text"] for w in words):
        return None
    lines = []
    for word in sorted(words, key=lambda w: (w["top"], w["left"])):
        cy = (word["top"] + word["bottom"]) / 2
        if lines and abs(cy - lines[-1][0]) <= word["height"] / 2:
            lines[-1][1].append(word)
        else:
            lines.append((cy, [word]))
    return " ".join(w["text"] for _, line in lines for w in sorted(line, key=lambda w: w["left"]))


def source_columns(band, image, ocr_crop, centers, projected, heading):
    """Optional eight-column source layout; failure preserves core recovery.

    A damaged whole-page token can only locate a heading. A fresh own-region
    reading must supply its label, with no fuzzy text repair or unit inference.
    """
    starts = []
    for pattern in [*STARTS, *EXTRA_STARTS]:
        found = [i for i, w in enumerate(band) if re.fullmatch(pattern, w["text"].replace(" ", ""), re.I)]
        if len(found) != 1:
            return None
        starts.append(found[0])
    if starts != sorted(starts):
        return None
    columns = [band[start:starts[i + 1] if i + 1 < len(starts) else len(band)]
               for i, start in enumerate(starts)]
    headings = []
    try:
        for index, column in enumerate(columns):
            value = literal_cell(column)
            if value is None:
                bounds = (max(0, column[0]["left"] - 5), max(0, min(w["top"] for w in column) - 5),
                          min(image.width, column[-1]["right"] + 5), min(image.height, max(w["bottom"] for w in column) + 5))
                with image.crop(bounds) as crop:
                    with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                        value = literal_cell(read_words(ocr_crop(enlarged, 7)))
                # Recover the primary label alone when a joined parenthetical
                # remains unreadable. Never invent its dimensions/units suffix.
                if value is None and index in (4, 5):
                    label = ["LINING", "SPLINE"][index - 4]
                    anchor = column[0]
                    if anchor["confidence"] >= 60 and re.fullmatch(label, anchor["text"], re.I):
                        value = anchor["text"]
                    for fraction in (.30, .32, .34, .38, .40, .42, .45, .50, .55):
                        if value is not None:
                            break
                        right = min(image.width, int(anchor["left"] + anchor["width"] * fraction))
                        bounds = (max(0, anchor["left"] - 3), max(0, anchor["top"] - 3), right, min(image.height, anchor["bottom"] + 3))
                        with image.crop(bounds) as crop:
                            with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                                reread = literal_cell(read_words(ocr_crop(enlarged, 7)))
                        if reread and re.fullmatch(label + r"\s*\(?", reread, re.I):
                            value = reread
                            break
            if value is None or (index >= 4 and not re.match(r"^" + EXTRA_LABELS[index - 4], value, re.I)):
                return None
            headings.append(value)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    all_centers = [*centers, *((column[0]["left"] + column[-1]["right"]) / 2 for column in columns[4:])]
    extended_edges = {}
    for boundary in range(9):
        left = int(all_centers[boundary - 1]) if boundary else 0
        right = int(all_centers[boundary]) if boundary < 8 else image.width
        peak = max(projected[left:right], default=0)
        if peak < 45:
            return None
        verticals = groups_above(projected[left:right], peak * .75)
        if boundary in (0, 8) and len(verticals) > 1:
            # Headers may be left-aligned. Select the nearest actual outer rule,
            # not a reflected midpoint or a stronger distant page border.
            nearest = verticals[-1] if boundary == 0 else verticals[0]
            neighbor = verticals[-2] if boundary == 0 else verticals[1]
            if abs((nearest[0] + nearest[-1] - neighbor[0] - neighbor[-1]) / 2) <= heading["height"] / 2:
                return None
            verticals = [nearest]
        if len(verticals) != 1 or len(verticals[0]) > heading["height"]:
            return None
        extended_edges[boundary] = left + (verticals[0][0] + verticals[0][-1]) / 2
    if any(not extended_edges[index] < all_centers[index] < extended_edges[index + 1] for index in range(8)):
        return None
    return headings, extended_edges


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
    except (AttributeError, KeyError, TypeError, ValueError):
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
    from PIL import Image, ImageOps
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
        rows, row_bounds, retries, visited = [], [], 0, set()
        core_timed_out = False
        for identifier in sorted(candidates, key=lambda w: w["top"]):
            if core_timed_out:
                break
            # Whole-page boxes may absorb a row rule. Use their center only to
            # locate a cell; independent cell OCR still supplies every value.
            center = (identifier["top"] + identifier["bottom"]) / 2
            if any(abs(line - center) <= max(3, heading["height"] / 2) for line in rules[1]):
                continue
            above = [line for line in rules[1] if line < center]
            below = [line for line in rules[1] if line > center]
            if not above or not below:
                continue
            top, bottom = max(above), min(below)
            if (top, bottom) in visited:
                continue
            visited.add((top, bottom))
            values = []
            # Recover identity/OEM first; optional source columns cannot erase them.
            for column in (1, 2):
                left, right = edges[column], edges[column + 1]
                bounds = []
                for target in (top, bottom):
                    matching = [line for line in rules[column] if abs(line - target) <= heading["height"]]
                    if len(matching) != 1:
                        break
                    bounds.append(matching[0])
                if len(bounds) != 2 or bounds[0] >= bounds[1]:
                    if column == 2:
                        values.append(UNRECOVERED)
                    break
                if (right - left <= 6 or bounds[1] - bounds[0] <= 6
                        or (right - left) * (bounds[1] - bounds[0]) > 1_000_000):
                    break
                if retries >= 128:
                    break
                retries += 1
                try:
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
                        if column == 1 and (len(selected) != 1 or selected[0]["confidence"] < 60 or not IDENTIFIER.fullmatch(selected[0]["text"])) and retries < 128:
                            retries += 1
                            with crop.convert("L") as monochrome:
                                with monochrome.point(lambda pixel: 0 if pixel < 140 else 255) as filtered:
                                    with filtered.point(lambda pixel: 255 - pixel) as ink:
                                        box = ink.getbbox()
                                    if box:
                                        with filtered.crop(box) as tight:
                                            with ImageOps.expand(tight, border=5, fill=255) as padded:
                                                size = (max(1, round(padded.width * 48 / padded.height)), 48)
                                                with padded.resize(size) as normal:
                                                    selected = read_words(ocr_crop(normal, 7))
                except (OSError, ValueError, subprocess.SubprocessError):
                    core_timed_out = True
                    break
                if column == 2 and (not selected or any("|" in w["text"] for w in selected)):
                    values.append(UNRECOVERED)
                    continue
                if not selected or any("|" in w["text"] for w in selected):
                    break
                if column == 1 and (len(selected) != 1 or selected[0]["confidence"] < 60 or not IDENTIFIER.fullmatch(selected[0]["text"])):
                    break
                if column == 2 and min(w["confidence"] for w in selected) < 60:
                    values.append(UNRECOVERED)
                    continue
                value = literal_cell(selected)
                if value is None:
                    break
                values.append(value)
            if len(values) == 2:
                rows.append(values)
                row_bounds.append((top, bottom))
        if not rows:
            return None
        layout = source_columns(band, image, ocr_crop, centers, projected, heading)
        if layout:
            all_headers, all_edges = layout
            extra_rules = {}
            for column in (0, 3, 4, 5, 6, 7):
                left, right = all_edges[column], all_edges[column + 1]
                region = mask.crop((int(left) + 8, body_top - heading["height"], int(right) - 8, body_bottom))
                horizontal = region.resize((1, region.height), Image.Resampling.BOX).tobytes()
                extra_rules[column] = [body_top - heading["height"] + (group[0] + group[-1]) / 2
                                       for group in groups_above(horizontal, 140) if len(group) <= heading["height"] / 2]
            full_rows = []
            for values, (top, bottom) in zip(rows, row_bounds):
                full = [UNRECOVERED, *values, *([UNRECOVERED] * 5)]
                for column in (0, 3, 4, 5, 6, 7):
                    left, right = all_edges[column], all_edges[column + 1]
                    bounds = [[line for line in extra_rules[column] if abs(line - target) <= heading["height"]]
                              for target in (top, bottom)]
                    if any(len(matches) != 1 for matches in bounds):
                        continue
                    start, end = bounds[0][0], bounds[1][0]
                    if right - left <= 6 or end - start <= 6 or (right - left) * (end - start) > 1_000_000:
                        continue
                    # Whole-page words are usable only when every intersecting
                    # box lies wholly inside this proven cell. Cross-rule boxes
                    # trigger a fresh crop; they never supply neighboring text.
                    intersecting = [w for w in body if w["right"] > left + 3 and w["left"] < right - 3
                                    and w["bottom"] > start + 3 and w["top"] < end - 3]
                    contained = [w for w in intersecting if left + 3 <= w["left"] < w["right"] <= right - 3
                                 and start + 3 <= w["top"] < w["bottom"] <= end - 3]
                    value = literal_cell(contained) if len(contained) == len(intersecting) else None
                    if value is not None:
                        full[column] = value
                        continue
                    if retries >= 512:
                        continue
                    retries += 1
                    try:
                        with image.crop((int(left) + 3, int(start) + 3, int(right) - 3, int(end) - 3)) as crop:
                            with crop.resize((crop.width * 3, crop.height * 3)) as enlarged:
                                value = literal_cell(read_words(ocr_crop(enlarged, 7)))
                                if value is None and retries < 512:
                                    retries += 1
                                    value = literal_cell(read_words(ocr_crop(enlarged, 6)))
                            if value is None and retries < 512:
                                # Remove pale grid/scan noise for a separate raw-line
                                # reading. Only literal OCR output can populate a cell.
                                retries += 1
                                with crop.convert("L") as monochrome:
                                    with monochrome.point(lambda pixel: 0 if pixel < 140 else 255) as filtered:
                                        with filtered.point(lambda pixel: 255 - pixel) as ink:
                                            box = ink.getbbox()
                                        if box:
                                            with filtered.crop(box) as tight:
                                                with ImageOps.expand(tight, border=5, fill=255) as padded:
                                                    size = (max(1, round(padded.width * 48 / padded.height)), 48)
                                                    with padded.resize(size) as enlarged:
                                                        value = literal_cell(read_words(ocr_crop(enlarged, 8 if column == 0 else 7)))
                        if value is not None:
                            full[column] = value
                    except (OSError, ValueError, subprocess.SubprocessError):
                        # Optional extra cells cannot erase already recovered identity/OEM.
                        continue
                full_rows.append(full)
            return "\n".join("| " + " | ".join(row) + " |" for row in [all_headers, ["---"] * 8, *full_rows])
        return "\n".join("| " + " | ".join(row) + " |" for row in [headers[1:3], ["---", "---"], *rows])
