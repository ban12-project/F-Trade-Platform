ARG BROWSER_BASE_IMAGE=ftrade-camofox-base:e5a36f5
FROM ${BROWSER_BASE_IMAGE}
LABEL io.ftrade.lease-watchdog="1" io.ftrade.login-fill="1"
COPY watchdog.mjs /opt/ftrade/watchdog.mjs
COPY camofox.config.json /app/camofox.config.json
COPY login-plugin/ /app/plugins/ftrade-login/
CMD ["node", "/opt/ftrade/watchdog.mjs"]
