#!/bin/sh
set -eu

model=${HARBOR_MODEL:?Set HARBOR_MODEL to the evaluation provider/model.}

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
case "$model" in
  openai/*)
    : "${HARBOR_OPENAI_API_KEY:?Set HARBOR_OPENAI_API_KEY for this evaluation.}"
    set -- --ae "HARBOR_OPENAI_API_KEY=$HARBOR_OPENAI_API_KEY"
    ;;
  anthropic/*)
    : "${HARBOR_ANTHROPIC_API_KEY:?Set HARBOR_ANTHROPIC_API_KEY for this evaluation.}"
    set -- --ae "HARBOR_ANTHROPIC_API_KEY=$HARBOR_ANTHROPIC_API_KEY"
    ;;
  google/*)
    : "${HARBOR_GOOGLE_GENERATIVE_AI_API_KEY:?Set HARBOR_GOOGLE_GENERATIVE_AI_API_KEY for this evaluation.}"
    set -- --ae "HARBOR_GOOGLE_GENERATIVE_AI_API_KEY=$HARBOR_GOOGLE_GENERATIVE_AI_API_KEY"
    ;;
  openai-compatible/*)
    : "${HARBOR_OPENAI_COMPATIBLE_BASE_URL:?Set HARBOR_OPENAI_COMPATIBLE_BASE_URL for this evaluation.}"
    : "${HARBOR_OPENAI_COMPATIBLE_API_KEY:?Set HARBOR_OPENAI_COMPATIBLE_API_KEY for this evaluation.}"
    set -- \
      --ae "HARBOR_OPENAI_COMPATIBLE_BASE_URL=$HARBOR_OPENAI_COMPATIBLE_BASE_URL" \
      --ae "HARBOR_OPENAI_COMPATIBLE_API_KEY=$HARBOR_OPENAI_COMPATIBLE_API_KEY"
    ;;
  *)
    echo "HARBOR_MODEL must use one supported provider/model identifier." >&2
    exit 1
    ;;
esac

pnpm eval:harbor:prepare
harbor run -p /tmp/f-trade-harbor-product-agent \
  -a evals.harbor.product_agent.f_trade_product_agent:FTradeProductAgent \
  -m "$model" -k 3 --yes \
  --ae "HARBOR_MODEL=$HARBOR_MODEL" \
  "$@"
