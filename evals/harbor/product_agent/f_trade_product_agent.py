from __future__ import annotations

import shlex

from harbor.agents.base import BaseAgent


class FTradeProductAgent(BaseAgent):
    """Harbor adapter for the containerized F-Trade Product Agent CLI."""

    @staticmethod
    def name() -> str:
        return "f-trade-product-agent"

    def version(self) -> str | None:
        return "1.0.0"

    async def setup(self, environment) -> None:
        return None

    async def run(self, instruction: str, environment, context) -> None:
        if not self.model_name:
            raise ValueError("Harbor must be invoked with -m provider/model")
        command = (
            "cd /app && pnpm exec tsx scripts/run-product-agent.ts "
            "--input /app/input/source.json --output /app/output/product-draft.json "
            f"--model {shlex.quote(self.model_name)}"
        )
        await environment.exec(command=command)
