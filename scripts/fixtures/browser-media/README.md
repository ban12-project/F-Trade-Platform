# Synthetic H.264 fixture

`h264-blue.mp4` is a self-generated one-second blue frame sequence, 128 × 72, baseline H.264 in MP4. It contains no account data or third-party media. Regenerate with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=128x72:r=10 -t 1 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -movflags +faststart h264-blue.mp4
```

`verify-h264.mjs` runs in the browser image with network disabled and reads an actual decoded pixel. It fails on the previous codec-free image. This proves local H.264 decoding, not Facebook playback, AAC decoding, video publication, or receipt acceptance.
