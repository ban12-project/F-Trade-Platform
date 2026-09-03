FROM ubuntu:24.04

ARG MARKITDOWN_VERSION=0.1.7

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl python3 python3-venv \
  && python3 -m venv /opt/markitdown \
  && /opt/markitdown/bin/pip install --no-cache-dir "markitdown[pdf,xls,xlsx]==${MARKITDOWN_VERSION}" \
  && /opt/markitdown/bin/python3 -c "from markitdown import MarkItDown" \
  && ffmpeg -hide_banner -filters 2>&1 | grep -q subtitles \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q libx264 \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q ' aac ' \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/markitdown_preprocess.py /opt/f-trade/markitdown_preprocess.py

WORKDIR /vercel/sandbox
