#!/usr/bin/env python3
"""Synthetic coordinates prove conservative record isolation, never factory facts."""
from copy import deepcopy
from pdf_catalog_layout import recover_table, horizontal_text


def word(text, x, y, width=45):
    return {"text": text, "x0": x, "x1": x + width, "top": y, "bottom": y + 10}


headers = [word("Part No.", 20, 20), word("OEM No.", 120, 20), word("Fit Model", 220, 20)]
rows = [
    word("RYC-SYN001", 20, 70), word("SYN-OE-A", 120, 70), word("Synthetic A", 220, 70),
    word("RYC-SYN001", 20, 130), word("SYN-OE-B", 120, 130), word("Synthetic B", 220, 130),
]
result = recover_table(headers + rows, 320, 180)
assert result is not None
text, bounds = result
assert text.splitlines() == [
    "| Part No. | OEM No. | Fit Model |", "| --- | --- | --- |",
    "| RYC-SYN001 | SYN-OE-A | Synthetic A |", "| RYC-SYN001 | SYN-OE-B | Synthetic B |",
]
assert text.count("RYC-SYN001") == 2
assert recover_table(rows, 320, 180) is None  # No label, no SKU inference.
assert recover_table(headers + rows + [word("Part No.", 20, 170)], 320, 200) is None
assert recover_table(headers + rows + [word("Brake Disc", 20, 1)], 320, 180) is None
assert recover_table(headers + rows[:3], 320, 180) is None  # Insufficient row bounds.
for ambiguous in [
    word("SYN-CROSS-COLUMN", 85, 70, 40),
    word("SYN-CROSS-ROW", 120, 100, 45),
    word("RYC-SYN002", 20, 72),
    word("SYN|COLUMN", 120, 70),
]:
    assert recover_table(headers + rows + [ambiguous], 320, 180) is None
assert horizontal_text({"object_type": "char", "matrix": (1, 0, 0, 1, 0, 0)})
assert not horizontal_text({"object_type": "char", "matrix": (0.7, 0.7, -0.7, 0.7, 0, 0)})
# Numeric kit identifiers remain scoped to a Kit No. heading, never a component Part No.
kit = deepcopy(headers + rows)
kit[0]["text"] = "Kit No."
kit[3]["text"] = "9999 999 991"
kit[6]["text"] = "9999 999 992"
assert recover_table(kit, 320, 180) is not None
kit[0]["text"] = "Part No."
assert recover_table(kit, 320, 180) is None
print("PASS PDF header/row layout isolation and ambiguity guards")

if __name__ == "__main__":
    import sys
    if "--native-pdf" in sys.argv:
        import tempfile
        from pathlib import Path
        import pdfplumber
        from pdf_catalog_layout import page_catalog_text
        from synthetic_pdf_fixture import build_pdf, text_command
        commands = b"".join(text_command(value, x, y) for y, values in [
            (550, ["Part No.", "OEM No.", "Fit Model"]),
            (440, ["RYC-SYN001", "SYN-OE-A", "Synthetic A"]),
            (340, ["RYC-SYN001", "SYN-OE-B", "Synthetic B"]),
        ] for x, value in zip((30, 230, 430), values))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic-table.pdf"
            path.write_bytes(build_pdf([commands]))
            with pdfplumber.open(path) as pdf:
                recovered = page_catalog_text(pdf.pages[0])
                assert recovered is not None
                assert "| RYC-SYN001 | SYN-OE-A | Synthetic A |" in recovered
                assert "| RYC-SYN001 | SYN-OE-B | Synthetic B |" in recovered
                assert recovered.count("RYC-SYN001") == 2
        print("PASS actual native PDF table header/row recovery")
