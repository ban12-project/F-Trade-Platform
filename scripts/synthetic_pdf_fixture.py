"""Minimal, generated PDF test input; never a source of product facts."""
import zlib


def build_pdf(page_commands, image=None):
    count = len(page_commands)
    font_id = count + 3
    image_id = 2 * count + 4
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{n + 3} 0 R' for n in range(count))}] /Count {count} >>".encode(),
    ]
    for index in range(count):
        images = f"/XObject << /Scan {image_id} 0 R >>" if image else ""
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /Font << /F1 {font_id} 0 R >> {images} >> /Contents {font_id + 1 + index} 0 R >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for commands in page_commands:
        objects.append(f"<< /Length {len(commands)} >>\nstream\n".encode() + commands + b"\nendstream")
    if image:
        width, height, pixels = image
        data = zlib.compress(pixels)
        objects.append(f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")
    result = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(result)
    result += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    result += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return result + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()


def text_command(text, x, y):
    return f"BT /F1 12 Tf {x} {y} Td ({text}) Tj ET\n".encode()
