#!/usr/bin/env python3
"""Regression checks for the local OCR configuration guardrails."""

from __future__ import annotations

import importlib.util
import os
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
print("PASS local OCR preprocessing guards")
