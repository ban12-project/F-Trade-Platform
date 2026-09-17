from __future__ import annotations

from harbor.agents.base import BaseAgent


class FTradeProductAgent(BaseAgent):
    """Harbor adapter for the containerized F-Trade Product Agent CLI."""

    @staticmethod
    def name() -> str:
        return "f-trade-product-agent"

    def version(self) -> str | None:
        return "1.1.0"

    async def setup(self, environment) -> None:
        return None

    async def run(self, instruction: str, environment, context) -> None:
        if not self.model_name:
            raise ValueError("Harbor must be invoked with -m provider/model")
        command = (
            "cd /app && pnpm exec tsx scripts/run-harbor-product-agent.ts "
            "--input /app/input/source.json --output /app/output/product-draft.json"
        )
        provider, separator, model = self.model_name.partition("/")
        keys = {
            "openai": ("HARBOR_OPENAI_API_KEY",),
            "anthropic": ("HARBOR_ANTHROPIC_API_KEY",),
            "google": ("HARBOR_GOOGLE_GENERATIVE_AI_API_KEY",),
            "openai-compatible": (
                "HARBOR_OPENAI_COMPATIBLE_BASE_URL", "HARBOR_OPENAI_COMPATIBLE_API_KEY",
            ),
        }
        if not separator or not model or provider not in keys:
            raise ValueError("Unsupported Harbor provider/model")
        injected = self.extra_env
        env = {"HARBOR_MODEL": self.model_name}
        for key in keys[provider]:
            if not injected.get(key):
                raise ValueError(f"Missing selected evaluation credential: {key}")
            env[key] = injected[key]
        result = await environment.exec(command=command, env=env)
        if result.return_code != 0:
            # Provider output may contain private endpoint details; do not echo it.
            raise RuntimeError(f"Product Agent exited with code {result.return_code}")
