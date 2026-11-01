# OpenShip does not preserve Compose init/cap_drop/security_opt fields. Apply
# these process protections before Node starts, including on restart/rollback.
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN printf '{"type":"module"}\n' > package.json
COPY lib/browser-fleet/policy.ts lib/browser-fleet/security.ts lib/browser-fleet/inbox-signature.mjs ./lib/browser-fleet/
COPY ops/browser-node/ ./ops/browser-node/
ENV BROWSER_AGENT_NETWORK_MODE=bridge
LABEL io.ftrade.role="agent"
# UID 0 can read existing root-owned private state and use the Docker socket.
# Docker authority remains intentional; this is a trusted controller, not a job.
ENTRYPOINT ["setpriv", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/tini", "--"]
CMD ["node", "ops/browser-node/agent.mjs"]
