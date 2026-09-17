ARG BROWSER_BASE_IMAGE=ftrade-camofox-base:e5a36f5
FROM ${BROWSER_BASE_IMAGE}
# Proxy-enabled launches require GeoIP before the read-only runtime starts.
RUN node --input-type=module -e "import { downloadMMDB, getGeolocation } from 'camoufox-js/dist/locale.js'; await downloadMMDB(); await getGeolocation('8.8.8.8');"
LABEL io.ftrade.lease-watchdog="1" io.ftrade.login-fill="1"
COPY watchdog.mjs /opt/ftrade/watchdog.mjs
COPY camofox.config.json /app/camofox.config.json
COPY login-plugin/ /app/plugins/ftrade-login/
CMD ["node", "/opt/ftrade/watchdog.mjs"]
