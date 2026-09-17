#!/bin/sh
set -eu

export PYTHONPATH="$PWD${PYTHONPATH:+:$PYTHONPATH}"

model=${HARBOR_MODEL:?Set HARBOR_MODEL to the evaluation provider/model.}

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required for local Harbor evaluation." >&2
  exit 1
fi
if ! podman info >/dev/null 2>&1; then
  echo "Podman is not reachable. Start its machine." >&2
  exit 1
fi
# Harbor 0.23.0 has a native Podman environment; no Docker socket shim is required.
python_version=$(harbor --version)
case "$python_version" in
  0.23.0) ;;
  *) echo "Install the pinned Harbor version from evals/harbor/requirements.txt." >&2; exit 1 ;;
esac
job_name="product-agent-$(date -u +%Y%m%dT%H%M%SZ)-$$"
dataset=${HARBOR_DATASET_DIR:-/tmp/f-trade-harbor-product-agent}
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

podman build --ignorefile evals/harbor/product-agent/Dockerfile.dockerignore -f evals/harbor/product-agent/Dockerfile -t f-trade-product-agent-eval:latest .
pnpm eval:harbor:prepare
status=0
harbor run -p "$dataset" -e podman --job-name "$job_name" \
  -a evals.harbor.product_agent.f_trade_product_agent:FTradeProductAgent \
  -m "$model" -k 3 --yes \
  --ae "HARBOR_MODEL=$HARBOR_MODEL" \
  "$@" || status=$?
python3 scripts/validate-harbor-product-agent-results.py \
  --job-dir "jobs/$job_name" --manifest "$dataset/acceptance-manifest.json" \
  --model "$model" --output "harbor-artifacts/$job_name.json"
exit "$status"
