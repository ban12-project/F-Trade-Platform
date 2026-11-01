# Build ops/video-sandbox/Dockerfile as ftrade-media-base first, or override with
# its reviewed image digest. Both targets use the same committed source tree.
ARG MEDIA_BASE=ftrade-media-base
FROM node:24-bookworm-slim AS node
FROM ${MEDIA_BASE}
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libcups2 libdrm2 fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/ftrade-remotion
RUN npm install --omit=dev --no-audit --no-fund --save-exact @remotion/renderer@4.0.520 \
    && node --input-type=module -e 'import {ensureBrowser} from "@remotion/renderer"; import {writeFileSync} from "node:fs"; const browser=await ensureBrowser(); if(!browser.path) throw new Error("browser_not_installed"); writeFileSync("browser-path",browser.path)' \
    && chmod -R a+rX /opt/ftrade-remotion
COPY ops/vps-runtime/render.mjs /opt/ftrade-remotion/render.mjs
ENV HOME=/tmp
WORKDIR /vercel/sandbox
CMD ["sleep", "600"]
