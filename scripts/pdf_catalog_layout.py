"""Recover conservative header/row-aligned tables from native PDF coordinates.

Only horizontal text under an explicit identifier header is considered. Ambiguous
column crossings, overlapping row anchors and nested tables remain unstructured.
No product labels, values or engineering units are inferred or renamed.
"""
from __future__ import annotations

import re

IDENTIFIER_LABEL = re.compile(r"^(?:internal\s+sku|kit\s+no\.?|part\s+no\.?|type\s+no\.?|编号)$", re.I)
IDENTIFIER = re.compile(r"^(?:(?:RYC|RYD|RY)[A-Z0-9.-]{2,}|[0-9]+(?:XDC|XD|XC)[0-9]+[A-Z]?)$")
NON_CLUTCH = re.compile(r"\bbrake(?:\s*(?:disc|disk|pad|rotor)s?)?\b|制动盘|刹车片|刹车盘", re.I)


def normalize(text):
    return " ".join(text.split())


def candidate_value(label, text):
    value = normalize(text)
    return bool(IDENTIFIER.fullmatch(value) or (
        re.fullmatch(r"kit\s+no\.?", label, re.I)
        and re.fullmatch(r"\d{4} \d{3} \d{3}", value)
    ))


def recover_table(words, width, height):
    """Return (Markdown, bounds), or None if the page is not an unambiguous table."""
    words = [{**word, "text": normalize(word["text"])} for word in words if word["text"].strip()]
    if NON_CLUTCH.search(" ".join(word["text"] for word in words)):
        return None
    identifiers = [word for word in words if IDENTIFIER_LABEL.fullmatch(word["text"])]
    if len(identifiers) != 1:
        return None
    identifier_header = identifiers[0]
    headers = sorted(
        [word for word in words if abs(word["top"] - identifier_header["top"]) <= 2],
        key=lambda word: word["x0"],
    )
    if not 3 <= len(headers) <= 12 or any("|" in word["text"] for word in headers):
        return None
    centers = [(word["x0"] + word["x1"]) / 2 for word in headers]
    edges = [0] + [(a + b) / 2 for a, b in zip(centers, centers[1:])] + [width]
    if any(word["x0"] < edges[i] or word["x1"] > edges[i + 1] for i, word in enumerate(headers)):
        return None
    column = headers.index(identifier_header)
    header_bottom = max(word["bottom"] for word in headers)
    anchors = sorted([
        word for word in words
        if word["top"] > header_bottom
        and word["x0"] >= edges[column] and word["x1"] <= edges[column + 1]
        and candidate_value(identifier_header["text"], word["text"])
    ], key=lambda word: word["top"])
    if not 2 <= len(anchors) <= 100:
        return None
    if any(left["bottom"] >= right["top"] for left, right in zip(anchors, anchors[1:])):
        return None
    row_centers = [(word["top"] + word["bottom"]) / 2 for word in anchors]
    row_edges = [header_bottom] + [(a + b) / 2 for a, b in zip(row_centers, row_centers[1:])]
    row_edges.append(min(height, row_centers[-1] + (row_centers[-1] - row_centers[-2]) / 2))
    rows = []
    for row_index, anchor in enumerate(anchors):
        cells = [[] for _ in headers]
        for word in words:
            cy = (word["top"] + word["bottom"]) / 2
            if not row_edges[row_index] <= cy < row_edges[row_index + 1]:
                continue
            if word["top"] < row_edges[row_index] or word["bottom"] > row_edges[row_index + 1] or "|" in word["text"]:
                return None
            cx = (word["x0"] + word["x1"]) / 2
            slots = [i for i in range(len(headers)) if edges[i] <= cx < edges[i + 1]]
            if len(slots) != 1:
                return None
            slot = slots[0]
            if word["x0"] < edges[slot] or word["x1"] > edges[slot + 1]:
                return None
            cells[slot].append(word)
        values = [" ".join(word["text"] for word in sorted(cell, key=lambda w: (w["top"], w["x0"]))) for cell in cells]
        if values[column] != anchor["text"]:
            return None
        rows.append(values)
    def markdown_row(values):
        return "| " + " | ".join(values) + " |"
    markdown = "\n".join([markdown_row([word["text"] for word in headers]), markdown_row(["---"] * len(headers))] + [markdown_row(row) for row in rows])
    return markdown, (0, min(word["top"] for word in headers), width, row_edges[-1])


def horizontal_text(obj):
    if obj.get("object_type") != "char":
        return True
    matrix = obj.get("matrix", (1, 0, 0, 1, 0, 0))
    return abs(matrix[1]) < 0.001 and abs(matrix[2]) < 0.001


def page_catalog_text(page):
    horizontal = page.filter(horizontal_text)
    recovered = recover_table(horizontal.extract_words(keep_blank_chars=True), page.width, page.height)
    if recovered is None:
        return None
    markdown, bounds = recovered
    # Keep non-table text without repeating the body as spurious extra records.
    outside = page.filter(lambda obj: not (
        obj.get("object_type") == "char" and bounds[1] <= obj["top"] and obj["bottom"] <= bounds[3]
    )).extract_text() or ""
    return outside.strip() + "\n\n" + markdown
