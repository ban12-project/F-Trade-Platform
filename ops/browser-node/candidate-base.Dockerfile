# syntax=docker/dockerfile:1
# Named contexts: service = exact camofox.ref checkout; candidate = sealed CI artifact.
FROM node:22-trixie-slim
ARG TARGETARCH
ARG CANDIDATE_SHA256
ARG CANDIDATE_COMMIT
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a
RUN test "$TARGETARCH" = amd64
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libasound2 libx11-xcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
    libxtst6 libegl1 libgl1-mesa-dri libgbm1 xvfb fonts-liberation \
    fonts-noto-color-emoji fontconfig ca-certificates curl unzip zstd \
    build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY install-candidate.py /opt/ftrade/install-candidate.py
RUN --mount=from=candidate,target=/candidate,ro \
    python3 /opt/ftrade/install-candidate.py --archive /candidate/candidate.tar.zst \
      --manifest /candidate/candidate-manifest.json --destination /root/.cache/camoufox \
      --sha256 "$CANDIDATE_SHA256" --commit "$CANDIDATE_COMMIT" \
    && cp /candidate/candidate-manifest.json /opt/ftrade/candidate-manifest.json
LABEL io.ftrade.candidate.sha256=$CANDIDATE_SHA256 io.ftrade.candidate.commit=$CANDIDATE_COMMIT
WORKDIR /app
COPY --from=service /package.json /package-lock.json ./
COPY --from=service /scripts/ ./scripts/
ENV CAMOFOX_SKIP_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CAMOUFOX_EXECUTABLE=/root/.cache/camoufox/camoufox-bin
RUN npm ci --omit=dev && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY --from=service /server.js /camofox.config.json ./
COPY --from=service /lib/ ./lib/
COPY --from=service /mcp/ ./mcp/
COPY --from=service /plugins/ ./plugins/
# Keep all pinned service plugin dependencies, including the verified yt-dlp hook.
RUN YT_DLP_ASSET=yt-dlp_linux sh scripts/install-plugin-deps.sh
ENV NODE_ENV=production CAMOFOX_PORT=9377
EXPOSE 9377
CMD ["node", "server.js"]
