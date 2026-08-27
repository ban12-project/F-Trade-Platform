#!/usr/bin/env python3
"""Convert an allowed local document into untrusted Markdown for Product Agent input."""

from __future__ import annotations

import hashlib
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


def local_pdf_ocr(path: Path) -> str:
    pdfinfo = executable("pdfinfo")
    pdftoppm = executable("pdftoppm")
    tesseract = executable("tesseract")
    pages = pdf_page_count(pdfinfo, path)
    if pages > MAX_LOCAL_OCR_PAGES:
        raise RuntimeError(
            f"local OCR refuses PDFs above {MAX_LOCAL_OCR_PAGES} pages; received {pages}"
        )
    language = local_ocr_language()
    with tempfile.TemporaryDirectory(prefix="f-trade-local-ocr-") as directory:
        prefix = Path(directory) / "page"
        subprocess.run(
            [pdftoppm, "-r", "200", "-png", str(path), str(prefix)],
            check=True, capture_output=True, text=True,
        )
        pages_as_images = sorted(
            Path(directory).glob("page-*.png"),
            key=lambda image: int(image.stem.rsplit("-", 1)[1]),
        )
        if len(pages_as_images) != pages:
            raise RuntimeError("local OCR rendered an unexpected number of PDF pages")
        text_parts = []
        for image in pages_as_images:
            result = subprocess.run(
                [tesseract, str(image), "stdout", "-l", language, "--psm", "3"],
                check=True, capture_output=True, text=True,
            )
            if result.stdout.strip():
                text_parts.append(result.stdout.strip())
    return "\n\n".join(text_parts).strip()


def convert_with_markitdown(path: Path, remote_ocr: bool):
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
    try:
        source_text = convert_with_markitdown(path, remote_ocr)
        if not source_text and local_ocr and path.suffix.lower() == ".pdf":
            source_text = local_pdf_ocr(path)
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        fail(str(error))
    if not source_text:
        if enabled("F_TRADE_METADATA_PREFLIGHT"):
            json.dump(
                {
                    "source_text": "",
                    "document_sha256": digest,
                    "filename": path.name,
                    "media_type": path.suffix.lower().removeprefix("."),
                    "ocr_enabled": remote_ocr or local_ocr,
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
            "conversion_status": "converted",
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
