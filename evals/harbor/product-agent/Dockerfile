FROM docker.io/library/node:24-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY contracts ./contracts
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json
