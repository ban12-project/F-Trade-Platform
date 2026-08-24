FROM node:24-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/markitdown \
  && /opt/markitdown/bin/pip install --no-cache-dir 'markitdown[pdf]' markitdown-ocr openai
ENV MARKITDOWN_PYTHON=/opt/markitdown/bin/python
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY contracts ./contracts
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json
