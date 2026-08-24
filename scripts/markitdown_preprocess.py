#!/usr/bin/env python3
"""Convert an allowed local document into untrusted Markdown for Product Agent input."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from markitdown import MarkItDown


ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv",
    ".json", ".xml", ".html", ".htm", ".txt", ".md",
}
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit(f"MarkItDown preprocessing failed: {message}")


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
    # convert_local deliberately disallows MarkItDown's permissive URL and stream routing.
    # OCR is opt-in because it may send embedded document images to the configured model.
    enable_ocr = os.environ.get("MARKITDOWN_OCR_ENABLED") == "1"
    if enable_ocr:
        from openai import OpenAI

        base_url = os.environ.get("F_TRADE_OPENAI_COMPATIBLE_BASE_URL")
        api_key = os.environ.get("F_TRADE_OPENAI_COMPATIBLE_API_KEY")
        model = os.environ.get("F_TRADE_OCR_MODEL")
        if not base_url or not api_key or not model:
            fail("OCR requires F_TRADE_OPENAI_COMPATIBLE_BASE_URL, API_KEY, and F_TRADE_OCR_MODEL")
        converter = MarkItDown(
            enable_plugins=True,
            llm_client=OpenAI(base_url=base_url, api_key=api_key),
            llm_model=model,
        )
    else:
        converter = MarkItDown(enable_plugins=False)
    result = converter.convert_local(path)
    source_text = result.text_content.strip()
    if not source_text:
        if path.suffix.lower() == ".pdf" and not enable_ocr:
            fail(
                "conversion produced no text; this PDF may be image-only. "
                "OCR is disabled and requires an approved local or configured OCR path"
            )
        fail("conversion produced no text")

    json.dump(
        {
            "source_text": source_text,
            "document_sha256": digest,
            "filename": path.name,
            "media_type": path.suffix.lower().removeprefix("."),
            "ocr_enabled": enable_ocr,
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
