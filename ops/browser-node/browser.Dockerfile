ARG BROWSER_BASE_IMAGE=ftrade-camofox-base:e5a36f5
FROM ${BROWSER_BASE_IMAGE}
# Proxy-enabled launches require GeoIP before the read-only runtime starts.
# The pinned downloader does not await file-stream writes. Let its process drain
# pending filesystem work before a separate process validates the finished file.
RUN node --input-type=module -e "import { downloadMMDB } from 'camoufox-js/dist/locale.js'; await downloadMMDB();" \
    && node --input-type=module -e "import { getGeolocation } from 'camoufox-js/dist/locale.js'; await getGeolocation('8.8.8.8');"
LABEL io.ftrade.lease-watchdog="1" io.ftrade.login-fill="1"
COPY watchdog.mjs /opt/ftrade/watchdog.mjs
COPY camofox.config.json /app/camofox.config.json
COPY login-plugin/ /app/plugins/ftrade-login/
CMD ["node", "/opt/ftrade/watchdog.mjs"]
