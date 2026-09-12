FROM node:24-trixie-slim
WORKDIR /app
RUN printf '{"type":"module"}\n' > package.json
COPY lib/browser-fleet/policy.ts lib/browser-fleet/security.ts lib/browser-fleet/inbox-signature.mjs ./lib/browser-fleet/
COPY ops/browser-node/ ./ops/browser-node/
CMD ["node", "ops/browser-node/agent.mjs"]
