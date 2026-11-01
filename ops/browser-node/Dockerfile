FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN printf '{"type":"module"}\n' > package.json
COPY lib/browser-fleet/policy.ts lib/browser-fleet/security.ts lib/browser-fleet/inbox-signature.mjs ./lib/browser-fleet/
COPY ops/browser-node/ ./ops/browser-node/
COPY ops/host-capacity/admission.mjs ./ops/host-capacity/
CMD ["node", "ops/browser-node/agent.mjs"]
