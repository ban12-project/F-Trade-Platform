#!/bin/sh
set -eu

model=${1:?Usage: scripts/run-harbor-product-agent-podman.sh openai-compatible/model-name}

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required for local Harbor evaluation." >&2
  exit 1
fi
if ! podman info >/dev/null 2>&1; then
  echo "Podman is not reachable. Start its machine, then export the Docker-compatible DOCKER_HOST socket." >&2
  exit 1
fi
if [ -z "${DOCKER_HOST:-}" ]; then
  echo "Set DOCKER_HOST to Podman's Docker-compatible API socket before running Harbor." >&2
  exit 1
fi
if [ -z "${F_TRADE_OPENAI_COMPATIBLE_BASE_URL:-}" ] || [ -z "${F_TRADE_OPENAI_COMPATIBLE_API_KEY:-}" ]; then
  echo "Set F_TRADE_OPENAI_COMPATIBLE_BASE_URL and F_TRADE_OPENAI_COMPATIBLE_API_KEY locally." >&2
  exit 1
fi

pnpm eval:harbor:prepare
harbor run -p /tmp/f-trade-harbor-product-agent \
  -a evals.harbor.product_agent.f_trade_product_agent:FTradeProductAgent \
  -m "$model" -k 3 --yes \
  --ae "F_TRADE_OPENAI_COMPATIBLE_BASE_URL=$F_TRADE_OPENAI_COMPATIBLE_BASE_URL" \
  --ae "F_TRADE_OPENAI_COMPATIBLE_API_KEY=$F_TRADE_OPENAI_COMPATIBLE_API_KEY"
