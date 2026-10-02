from __future__ import annotations

from harbor.agents.installed.base import BaseInstalledAgent


class FTradeProductAgent(BaseInstalledAgent):
    """Harbor adapter for the containerized F-Trade Product Agent CLI."""

    @staticmethod
    def name() -> str:
        return "f-trade-product-agent"

    def version(self) -> str | None:
        return "1.2.0"

    async def install(self, environment) -> None:
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
        try:
            await self.exec_as_agent(environment, command=command, env=env, timeout_sec=90)
        except RuntimeError:
            # Harbor's private debug logs may retain diagnostics; public exceptions must not.
            raise RuntimeError("Product Agent execution failed") from None
