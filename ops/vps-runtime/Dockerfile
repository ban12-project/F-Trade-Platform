FROM docker:29-cli AS docker
FROM python:3.12-slim-bookworm
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY ops/vps-runtime/server.py /app/server.py
COPY ops/host-capacity/admission.py /host-capacity/admission.py
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["python3", "/app/server.py"]
