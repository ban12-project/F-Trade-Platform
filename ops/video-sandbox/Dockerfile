FROM ubuntu:24.04

ARG MARKITDOWN_VERSION=0.1.7

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg poppler-utils tesseract-ocr fonts-dejavu-core ca-certificates curl python3 python3-venv \
  && python3 -m venv /opt/markitdown \
  && /opt/markitdown/bin/pip install --no-cache-dir "markitdown[pdf,xls,xlsx]==${MARKITDOWN_VERSION}" "pdfplumber==0.11.10" \
  && /opt/markitdown/bin/python3 -c "from markitdown import MarkItDown" \
  && ffmpeg -hide_banner -filters 2>&1 | grep -q subtitles \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q libx264 \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q ' aac ' \
  && rm -rf /var/lib/apt/lists/*

ARG TESSDATA_BEST_URL=https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/e12c65a915945e4c28e237a9b52bc4a8f39a0cec/eng.traineddata

# Pin the independently verified English glyph model; never fetch models at
# document-processing time. Whole-page/core/dimension OCR keeps the packaged model.
RUN mkdir -p /opt/f-trade/tessdata-best \
  && curl --fail --location --connect-timeout 15 --max-time 120 --retry 3 \
    "$TESSDATA_BEST_URL" \
    -o /opt/f-trade/tessdata-best/eng.traineddata \
  && cp /usr/share/common-licenses/Apache-2.0 /opt/f-trade/tessdata-best/LICENSE \
  && printf '%s  %s\n' 8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba /opt/f-trade/tessdata-best/eng.traineddata | sha256sum --check

COPY scripts/markitdown_preprocess.py scripts/pdf_catalog_layout.py scripts/pdf_kit_ocr.py scripts/pdf_disc_table_ocr.py /opt/f-trade/

WORKDIR /vercel/sandbox
