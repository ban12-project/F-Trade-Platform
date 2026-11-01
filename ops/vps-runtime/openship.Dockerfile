# Build an immutable broker image on the destination host, with that host's
# Docker socket GID. The image carries its user/init/nnp settings because the
# OpenShip Compose importer does not preserve the equivalent service fields.
FROM docker:29-cli AS docker
FROM python:3.12-slim-bookworm
ARG DOCKER_GID
RUN test -n "$DOCKER_GID" && case "$DOCKER_GID" in *[!0-9]*) exit 1;; esac \
    && apt-get update && apt-get install -y --no-install-recommends tini util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY ops/vps-runtime/server.py /app/server.py
COPY ops/host-capacity/admission.py /host-capacity/admission.py
ENV PYTHONDONTWRITEBYTECODE=1 FTRADE_RUNTIME_BIND=0.0.0.0
LABEL io.ftrade.release-drain="1"
USER 1000:${DOCKER_GID}
ENTRYPOINT ["setpriv", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/tini", "--"]
CMD ["python3", "/app/server.py"]
