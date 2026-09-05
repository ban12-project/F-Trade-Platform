#!/usr/bin/env python3
"""Run inside the built document image with networking disabled and synthetic inputs."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from synthetic_pdf_fixture import build_pdf, text_command

with tempfile.TemporaryDirectory() as directory:
    table = b"".join(text_command(value, x, y) for y, values in [
        (550, ["Part No.", "OEM No.", "Fit Model"]),
        (440, ["RYC-SYN001", "SYN-OE-A", "Synthetic A"]),
        (340, ["RYC-SYN001", "SYN-OE-B", "Synthetic B"]),
    ] for x, value in zip((30, 230, 430), values))
    scan = Image.new("L", (1000, 200), 255)
    ImageDraw.Draw(scan).text((50, 60), "SYNTHETIC SCAN", fill=0, font=ImageFont.load_default(size=60))
    path = Path(directory) / "synthetic-mixed-table.pdf"
    path.write_bytes(build_pdf([table, b"q 500 0 0 100 50 250 cm /Scan Do Q", b""], (scan.width, scan.height, scan.tobytes())))
    result = subprocess.run(
        [sys.executable, "/opt/f-trade/markitdown_preprocess.py", str(path)],
        env={**os.environ, "F_TRADE_LOCAL_OCR_ENABLED": "1", "MARKITDOWN_OCR_ENABLED": "0"},
        text=True, capture_output=True, check=True,
    )
    report = json.loads(result.stdout)
    assert report["layout_recovered_pages"] == [1]
    assert report["conversion_status"] == "converted"
    text = report["source_text"]
    assert text.count("RYC-SYN001") == 2
    assert "| RYC-SYN001 | SYN-OE-A | Synthetic A |" in text
    assert "SYNTHETIC SCAN" in text
    assert text.count("<!-- f-trade:pdf-page=") == 3
    assert text.split("<!-- f-trade:pdf-page=3 -->")[1].strip() == ""
print("PASS built image: offline native table, duplicate records, scanned page and blank page")
