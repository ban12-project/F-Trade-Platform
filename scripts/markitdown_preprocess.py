#!/usr/bin/env python3
"""Convert an allowed local document into untrusted Markdown for Product Agent input."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv",
    ".json", ".xml", ".html", ".htm", ".txt", ".md",
}
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
MAX_LOCAL_OCR_PAGES = 64
LOCAL_OCR_LANGUAGE = re.compile(r"^[A-Za-z0-9_.+-]{1,64}$")


def fail(message: str) -> None:
    raise SystemExit(f"MarkItDown preprocessing failed: {message}")


def enabled(name: str) -> bool:
    return os.environ.get(name) == "1"


def local_ocr_language() -> str:
    language = os.environ.get("F_TRADE_LOCAL_OCR_LANGUAGE", "eng")
    if not LOCAL_OCR_LANGUAGE.fullmatch(language):
        raise ValueError("F_TRADE_LOCAL_OCR_LANGUAGE must contain only Tesseract language identifiers")
    return language


def remote_ocr_config() -> tuple[str, str, str]:
    base_url = os.environ.get("F_TRADE_OCR_OPENAI_COMPATIBLE_BASE_URL")
    api_key = os.environ.get("F_TRADE_OCR_OPENAI_COMPATIBLE_API_KEY")
    model = os.environ.get("F_TRADE_OCR_MODEL")
    if not base_url or not api_key or not model:
        fail(
            "remote OCR requires F_TRADE_OCR_OPENAI_COMPATIBLE_BASE_URL, "
            "F_TRADE_OCR_OPENAI_COMPATIBLE_API_KEY, and F_TRADE_OCR_MODEL"
        )
    return base_url, api_key, model


def executable(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        raise RuntimeError(f"local OCR requires executable: {name}")
    return resolved


def pdf_page_count(pdfinfo: str, path: Path) -> int:
    result = subprocess.run(
        [pdfinfo, str(path)], check=True, capture_output=True, text=True,
    )
    match = re.search(r"^Pages:\s*(\d+)\s*$", result.stdout, re.MULTILINE)
    if not match:
        raise RuntimeError("local OCR could not determine PDF page count")
    return int(match.group(1))


PDF_PAGE_MARKER = re.compile(r"^<!-- f-trade:pdf-page=\d+ -->$", re.MULTILINE)


def pdf_page_text(page: int, text: str) -> str:
    # Reserve page markers for the converter, never allow source text to spoof them.
    text = PDF_PAGE_MARKER.sub("[source page-marker text removed]", text)
    return f"<!-- f-trade:pdf-page={page} -->\n{text.strip()}"


def has_source_text(text: str) -> bool:
    return bool(PDF_PAGE_MARKER.sub("", text).strip())


def native_pdf_text(path: Path, layout_pages: list[int] | None = None) -> str:
    # MarkItDown's PDF dependency, used per physical page so table conversion cannot
    # reorder pages or silently discard blank boundaries.
    from pdfminer.converter import TextConverter
    from pdfminer.layout import LAParams
    from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    from pdfminer.pdfpage import PDFPage

    import pdfplumber
    from pdf_catalog_layout import page_catalog_text

    parts = []
    with path.open("rb") as stream, pdfplumber.open(path) as layout:
        manager = PDFResourceManager()
        for number, page in enumerate(PDFPage.get_pages(stream), start=1):
            layout_page = layout.pages[number - 1]
            recovered = page_catalog_text(layout_page)
            layout_page.close()
            if recovered is not None:
                if layout_pages is not None:
                    layout_pages.append(number)
                parts.append(pdf_page_text(number, recovered))
                continue
            with io.StringIO() as output:
                with TextConverter(manager, output, laparams=LAParams()) as converter:
                    PDFPageInterpreter(manager, converter).process_page(page)
                    parts.append(pdf_page_text(number, output.getvalue()))
    return "\n\n".join(parts)


def local_pdf_ocr(path: Path, page_numbers: list[int] | None = None, expected_pages: int | None = None) -> str:
    pdfinfo = executable("pdfinfo")
    pdftoppm = executable("pdftoppm")
    tesseract = executable("tesseract")
    pages = pdf_page_count(pdfinfo, path)
    if pages > MAX_LOCAL_OCR_PAGES:
        raise RuntimeError(
            f"local OCR refuses PDFs above {MAX_LOCAL_OCR_PAGES} pages; received {pages}"
        )
    if expected_pages is not None and expected_pages != pages:
        raise RuntimeError("local OCR page count disagrees with native PDF extraction")
    selected = list(range(1, pages + 1)) if page_numbers is None else page_numbers
    if any(type(number) is not int or not 1 <= number <= pages for number in selected) or selected != sorted(set(selected)):
        raise ValueError("local OCR requires unique ascending physical page numbers within the PDF")
    if not selected:
        return ""
    language = local_ocr_language()
    with tempfile.TemporaryDirectory(prefix="f-trade-local-ocr-") as directory:
        prefix = Path(directory) / "page"
        # Render only requested contiguous page ranges; native pages are never rasterized.
        ranges = []
        for number in selected:
            if ranges and number == ranges[-1][1] + 1:
                ranges[-1][1] = number
            else:
                ranges.append([number, number])
        for start, end in ranges:
            subprocess.run(
                [pdftoppm, "-f", str(start), "-l", str(end), "-r", "200", "-png", str(path), str(prefix)],
                check=True, capture_output=True, text=True,
            )
        pages_as_images = sorted(
            Path(directory).glob("page-*.png"),
            key=lambda image: int(image.stem.rsplit("-", 1)[1]),
        )
        if [int(image.stem.rsplit("-", 1)[1]) for image in pages_as_images] != selected:
            raise RuntimeError("local OCR rendered an unexpected number of PDF pages")
        text_parts = []
        for image in pages_as_images:
            result = subprocess.run(
                [tesseract, str(image), "stdout", "-l", language, "--psm", "3"],
                check=True, capture_output=True, text=True,
            )
            number = int(image.stem.rsplit("-", 1)[1])
            text_parts.append(pdf_page_text(number, result.stdout))
    return "\n\n".join(text_parts).strip()


def split_pdf_pages(text: str) -> list[tuple[int, str]]:
    markers = list(re.finditer(r"^<!-- f-trade:pdf-page=(\d+) -->$", text, re.MULTILINE))
    if not markers or text[:markers[0].start()].strip():
        raise RuntimeError("PDF conversion must preserve physical page boundaries before OCR")
    return [
        (int(marker.group(1)), text[marker.end():markers[index + 1].start() if index + 1 < len(markers) else len(text)].strip())
        for index, marker in enumerate(markers)
    ]


def complete_local_pdf_text(path: Path, native_text: str) -> str:
    pages = split_pdf_pages(native_text)
    if [number for number, _ in pages] != list(range(1, len(pages) + 1)):
        raise RuntimeError("native PDF page sequence is incomplete or duplicated")
    missing = [number for number, text in pages if not text.strip()]
    if not missing:
        return native_text
    recovered = split_pdf_pages(local_pdf_ocr(path, missing, expected_pages=len(pages)))
    if [number for number, _ in recovered] != missing:
        raise RuntimeError("local OCR returned unexpected physical page boundaries")
    replacements = dict(recovered)
    return "\n\n".join(pdf_page_text(number, replacements.get(number, text)) for number, text in pages)


def convert_with_markitdown(path: Path, remote_ocr: bool, layout_pages: list[int] | None = None):
    if path.suffix.lower() == ".pdf":
        if remote_ocr:
            remote_ocr_config()
        return native_pdf_text(path, layout_pages)

    from markitdown import MarkItDown

    if remote_ocr:
        from openai import OpenAI

        base_url, api_key, model = remote_ocr_config()
        converter = MarkItDown(
            enable_plugins=True,
            llm_client=OpenAI(base_url=base_url, api_key=api_key),
            llm_model=model,
        )
    else:
        # convert_local deliberately disallows MarkItDown's permissive URL and stream routing.
        converter = MarkItDown(enable_plugins=False)
    return converter.convert_local(path).text_content.strip()


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: markitdown_preprocess.py <local-document-path>")

    path = Path(sys.argv[1]).expanduser().resolve(strict=True)
    if not path.is_file():
        fail("input must be a regular local file")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        fail(f"unsupported document type: {path.suffix or '(none)'}")
    if path.stat().st_size > MAX_DOCUMENT_BYTES:
        fail(f"document exceeds {MAX_DOCUMENT_BYTES} byte limit")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    remote_ocr = enabled("MARKITDOWN_OCR_ENABLED")
    local_ocr = enabled("F_TRADE_LOCAL_OCR_ENABLED")
    if remote_ocr and local_ocr:
        fail("remote OCR and local OCR cannot be enabled together")
    layout_pages = []
    try:
        source_text = convert_with_markitdown(path, remote_ocr, layout_pages=layout_pages)
        if local_ocr and path.suffix.lower() == ".pdf":
            source_text = complete_local_pdf_text(path, source_text)
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        fail(str(error))
    if not has_source_text(source_text):
        if enabled("F_TRADE_METADATA_PREFLIGHT"):
            json.dump(
                {
                    "source_text": source_text,
                    "document_sha256": digest,
                    "filename": path.name,
                    "media_type": path.suffix.lower().removeprefix("."),
                    "ocr_enabled": remote_ocr or local_ocr,
                    "layout_recovered_pages": layout_pages,
                    "conversion_status": "no_text",
                },
                sys.stdout,
                ensure_ascii=False,
            )
            return
        if path.suffix.lower() == ".pdf" and not remote_ocr and not local_ocr:
            fail(
                "conversion produced no text; this PDF may be image-only. "
                "OCR is disabled; enable an approved local OCR path or configured remote OCR"
            )
        fail("conversion produced no text")

    json.dump(
        {
            "source_text": source_text,
            "document_sha256": digest,
            "filename": path.name,
            "media_type": path.suffix.lower().removeprefix("."),
            "ocr_enabled": remote_ocr or local_ocr,
            "layout_recovered_pages": layout_pages,
            "conversion_status": "converted",
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
