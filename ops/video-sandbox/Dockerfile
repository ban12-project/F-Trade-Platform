FROM ubuntu:24.04

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl \
  && ffmpeg -hide_banner -filters 2>&1 | grep -q subtitles \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q libx264 \
  && ffmpeg -hide_banner -encoders 2>&1 | grep -q ' aac ' \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /vercel/sandbox
