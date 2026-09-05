#!/usr/bin/env python3
"""Regression checks for the local OCR configuration guardrails."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "markitdown_preprocess", ROOT / "scripts" / "markitdown_preprocess.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


with patch.dict(os.environ, {"F_TRADE_LOCAL_OCR_LANGUAGE": "eng+chi_sim"}, clear=False):
    assert MODULE.local_ocr_language() == "eng+chi_sim"

with patch.dict(os.environ, {"F_TRADE_LOCAL_OCR_LANGUAGE": "eng;rm"}, clear=False):
    try:
        MODULE.local_ocr_language()
    except ValueError as error:
        assert "language identifiers" in str(error)
    else:
        raise AssertionError("Unsafe local OCR language should be rejected")

with patch.object(MODULE.shutil, "which", return_value=None):
    try:
        MODULE.executable("tesseract")
    except RuntimeError as error:
        assert "tesseract" in str(error)
    else:
        raise AssertionError("Missing local OCR executable should fail closed")

assert MODULE.MAX_LOCAL_OCR_PAGES == 64

with patch.dict(
    os.environ,
    {
        "F_TRADE_OCR_OPENAI_COMPATIBLE_BASE_URL": "https://ocr.example.test/v1",
        "F_TRADE_OCR_OPENAI_COMPATIBLE_API_KEY": "synthetic-ocr-key",
        "F_TRADE_OCR_MODEL": "synthetic-ocr-model",
    },
    clear=True,
):
    assert MODULE.remote_ocr_config() == (
        "https://ocr.example.test/v1",
        "synthetic-ocr-key",
        "synthetic-ocr-model",
    )

with patch.dict(os.environ, {"F_TRADE_OPENAI_COMPATIBLE_BASE_URL": "wrong-boundary"}, clear=True):
    try:
        MODULE.remote_ocr_config()
    except SystemExit as error:
        assert "F_TRADE_OCR_OPENAI_COMPATIBLE_BASE_URL" in str(error)
    else:
        raise AssertionError("Product Agent provider configuration must not satisfy remote OCR")

with tempfile.TemporaryDirectory() as directory:
    image_only_pdf = Path(directory) / "synthetic-image-only.pdf"
    image_only_pdf.write_bytes(b"%PDF-synthetic")
    output = io.StringIO()
    with (
        patch.object(MODULE, "convert_with_markitdown", return_value=""),
        patch.object(sys, "argv", ["markitdown_preprocess.py", str(image_only_pdf)]),
        patch.dict(os.environ, {"F_TRADE_METADATA_PREFLIGHT": "1"}, clear=False),
        redirect_stdout(output),
    ):
        MODULE.main()
    result = json.loads(output.getvalue())
    assert result["source_text"] == ""
    assert result["conversion_status"] == "no_text"
    assert result["filename"] == image_only_pdf.name

print("PASS local OCR preprocessing guards")

# Synthetic subprocess outputs exercise physical page identity, including a blank middle page.
from types import SimpleNamespace

def fake_run(args, **kwargs):
    if args[0] == "pdfinfo":
        return SimpleNamespace(stdout="Pages: 3\n")
    if args[0] == "pdftoppm":
        for number in range(1, 4):
            Path(f"{args[-1]}-{number}.png").touch()
        return SimpleNamespace(stdout="")
    number = int(Path(args[1]).stem.rsplit("-", 1)[1])
    return SimpleNamespace(stdout={1: "SYNTHETIC FIRST", 2: "", 3: "SYNTHETIC THIRD"}[number])

with patch.object(MODULE, "executable", side_effect=lambda name: name), patch.object(MODULE.subprocess, "run", side_effect=fake_run):
    text = MODULE.local_pdf_ocr(Path("synthetic.pdf"))
    assert text == "<!-- f-trade:pdf-page=1 -->\nSYNTHETIC FIRST\n\n<!-- f-trade:pdf-page=2 -->\n\n\n<!-- f-trade:pdf-page=3 -->\nSYNTHETIC THIRD"
    assert MODULE.has_source_text(text)
    assert not MODULE.has_source_text(MODULE.pdf_page_text(2, ""))

with patch.object(MODULE, "executable", side_effect=lambda name: name), patch.object(MODULE, "pdf_page_count", return_value=65):
    try:
        MODULE.local_pdf_ocr(Path("synthetic.pdf"))
    except RuntimeError as error:
        assert "above 64" in str(error)
    else:
        raise AssertionError("Oversized OCR must fail before rendering")

with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "synthetic.pdf"
    path.write_bytes(b"%PDF-synthetic")
    with patch.object(sys, "argv", ["preprocess", str(path)]), patch.dict(os.environ, {"MARKITDOWN_OCR_ENABLED": "1", "F_TRADE_LOCAL_OCR_ENABLED": "1"}, clear=True):
        try:
            MODULE.main()
        except SystemExit as error:
            assert "cannot be enabled together" in str(error)
        else:
            raise AssertionError("Mutually exclusive OCR modes must be rejected")
print("PASS synthetic OCR page provenance and mode/size guards")

# Native PDF regression uses real pdfminer parsing of a minimal synthetic three-page PDF.
# This is generated test input, not factory data or a deliverable document.
def synthetic_pdf():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for value in (b"SYNTHETIC FIRST", b"SYNTHETIC THIRD"):
        content = b"BT /F1 12 Tf 10 100 Td (" + value + b") Tj ET"
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
    data = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(data)
    data += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    data += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    data += f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF".encode()
    return data

if "--native-pdf" in sys.argv:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "synthetic.pdf"
        path.write_bytes(synthetic_pdf())
        text = MODULE.convert_with_markitdown(path, False)
        assert MODULE.PDF_PAGE_MARKER.findall(text) == [
            "<!-- f-trade:pdf-page=1 -->", "<!-- f-trade:pdf-page=2 -->", "<!-- f-trade:pdf-page=3 -->",
        ]
        assert "SYNTHETIC FIRST" in text and "SYNTHETIC THIRD" in text
        middle = text.split("<!-- f-trade:pdf-page=2 -->")[1].split("<!-- f-trade:pdf-page=3 -->")[0]
        assert not middle.strip()
    print("PASS native PDF physical page integration")

# Mixed pages: preserve native text and OCR only pages without text.
native = "\n\n".join(MODULE.pdf_page_text(number, text) for number, text in [(1, "NATIVE FIRST"), (2, ""), (3, "NATIVE THIRD")])
with patch.object(MODULE, "local_pdf_ocr", return_value=MODULE.pdf_page_text(2, "SYNTHETIC SCAN")) as ocr:
    merged = MODULE.complete_local_pdf_text(Path("synthetic.pdf"), native)
    assert MODULE.split_pdf_pages(merged) == [(1, "NATIVE FIRST"), (2, "SYNTHETIC SCAN"), (3, "NATIVE THIRD")]
    ocr.assert_called_once_with(Path("synthetic.pdf"), [2], expected_pages=3)
with patch.object(MODULE, "local_pdf_ocr") as ocr:
    assert MODULE.complete_local_pdf_text(Path("synthetic.pdf"), MODULE.pdf_page_text(1, "NATIVE")) == MODULE.pdf_page_text(1, "NATIVE")
    ocr.assert_not_called()
with patch.object(MODULE, "local_pdf_ocr", return_value=MODULE.pdf_page_text(2, "")):
    assert MODULE.split_pdf_pages(MODULE.complete_local_pdf_text(Path("synthetic.pdf"), native))[1] == (2, "")
for invalid in ["unframed native text", MODULE.pdf_page_text(2, "gap"), MODULE.pdf_page_text(1, "first") + "\n" + MODULE.pdf_page_text(1, "duplicate")]:
    with patch.object(MODULE, "local_pdf_ocr") as ocr:
        try:
            MODULE.complete_local_pdf_text(Path("synthetic.pdf"), invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Invalid native boundaries must fail closed")
        ocr.assert_not_called()
with patch.object(MODULE, "local_pdf_ocr", return_value=MODULE.pdf_page_text(3, "WRONG PAGE")):
    try:
        MODULE.complete_local_pdf_text(Path("synthetic.pdf"), native)
    except RuntimeError as error:
        assert "unexpected physical page" in str(error)
    else:
        raise AssertionError("OCR response must match the requested page")

commands = []
def selected_run(args, **kwargs):
    commands.append(args)
    if args[0] == "pdfinfo":
        return SimpleNamespace(stdout="Pages: 5\n")
    if args[0] == "pdftoppm":
        for number in range(int(args[args.index("-f") + 1]), int(args[args.index("-l") + 1]) + 1):
            Path(f"{args[-1]}-{number}.png").touch()
        return SimpleNamespace(stdout="")
    return SimpleNamespace(stdout="SYNTHETIC SCAN")
with patch.object(MODULE, "executable", side_effect=lambda name: name), patch.object(MODULE.subprocess, "run", side_effect=selected_run):
    text = MODULE.local_pdf_ocr(Path("synthetic.pdf"), [2, 4, 5], expected_pages=5)
    assert [number for number, _ in MODULE.split_pdf_pages(text)] == [2, 4, 5]
    renders = [args for args in commands if args[0] == "pdftoppm"]
    assert [(args[2], args[4]) for args in renders] == [("2", "2"), ("4", "5")]
    assert len([args for args in commands if args[0] == "tesseract"]) == 3
print("PASS mixed native/scanned PDF selective OCR and source preservation")

if "--local-ocr" in sys.argv:
    from PIL import Image, ImageDraw, ImageFont
    from synthetic_pdf_fixture import build_pdf, text_command
    scan = Image.new("L", (1000, 200), 255)
    ImageDraw.Draw(scan).text((50, 60), "SYNTHETIC SCAN", fill=0, font=ImageFont.load_default(size=60))
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "synthetic-mixed.pdf"
        path.write_bytes(build_pdf([
            text_command("SYNTHETIC NATIVE FIRST", 50, 300),
            b"q 500 0 0 100 50 250 cm /Scan Do Q",
            b"",
            text_command("SYNTHETIC NATIVE FOURTH", 50, 300),
        ], (scan.width, scan.height, scan.tobytes())))
        native_text = MODULE.native_pdf_text(path)
        assert [bool(text) for _, text in MODULE.split_pdf_pages(native_text)] == [True, False, False, True]
        with patch.dict(os.environ, {"F_TRADE_LOCAL_OCR_LANGUAGE": "eng"}, clear=False):
            completed = MODULE.complete_local_pdf_text(path, native_text)
        pages = MODULE.split_pdf_pages(completed)
        original = MODULE.split_pdf_pages(native_text)
        assert pages[0] == original[0] and pages[3] == original[3]
        assert "SYNTHETIC SCAN" in pages[1][1]
        assert pages[2] == (3, "")
    print("PASS real Poppler/Tesseract mixed PDF integration with a blank page")
