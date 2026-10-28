# Standalone migration image. This is deliberately not the selected production
# target until service, native profile, network and viewer acceptance passes.
FROM node:22-trixie-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libasound2 libx11-xcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libxrandr2 \
    libxrender1 libxss1 libxtst6 libegl1 libgl1-mesa-dri libgbm1 libavcodec61 \
    xvfb x11vnc x11-utils websockify novnc \
    fonts-liberation fonts-noto-color-emoji fontconfig ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/official-runtime
COPY official-runtime/package.json official-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64; digest=2ead498d4765394addd3278d6a663962f3f99b189a99d3f966de56656cefc823 ;; \
      arm64) arch=arm64; digest=8a4dfdd85dfb5212dae716b4aa8e30041634edbbba6f6177a566a3ee6b1efe8c ;; \
      *) exit 1 ;; \
    esac; \
    curl -fSL --retry 3 "https://github.com/daijro/camoufox/releases/download/v158.0-beta.40/camoufox-158.0-beta.40-lin.$arch.zip" -o /tmp/camoufox.zip; \
    echo "$digest  /tmp/camoufox.zip" | sha256sum -c -
# The official extractor supports the archive's differing Unicode local/central names.
RUN set -eu; \
    node --input-type=module -e 'import { unzip, makeExecutable } from "./node_modules/camoufox/dist/pkgman.js"; unzip("/tmp/camoufox.zip", "/root/.cache/camoufox"); makeExecutable("/root/.cache/camoufox");'; \
    echo '{"version":"158.0","release":"beta.40"}' > /root/.cache/camoufox/version.json; \
    rm /tmp/camoufox.zip
COPY official-runtime/prepare-assets.mjs ./
RUN node prepare-assets.mjs
WORKDIR /app
COPY official-runtime/package.json ./package.json
COPY native-profile.mjs ./native-profile.mjs
COPY native-profile.mjs ./ftrade-native-profile.mjs
COPY login-plugin ./login-plugin
COPY diagnostics-plugin ./diagnostics-plugin
COPY official-runtime/*.mjs ./official-runtime/
COPY official-runtime/entry.mjs ./server.js
COPY watchdog.mjs /opt/ftrade/watchdog.mjs
LABEL io.ftrade.lease-watchdog="1" io.ftrade.login-fill="1" io.ftrade.native-profile="1" io.ftrade.official-camoufox="1"
ENV NODE_ENV=production
EXPOSE 9377 6080
CMD ["node", "/opt/ftrade/watchdog.mjs"]
