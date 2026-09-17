#!/usr/bin/env python3
"""Run with the pinned Harbor interpreter after eval:harbor:prepare."""
import asyncio
from importlib.metadata import version
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from harbor.environments.base import ExecResult
from harbor.models.agent.context import AgentContext
from harbor.models.task.task import Task
from evals.harbor.product_agent.f_trade_product_agent import FTradeProductAgent

assert version("harbor") == "0.23.0"
root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/f-trade-harbor-product-agent")
count = 0
for config in sorted(root.glob("*/task.toml")):
    task = Task(config.parent)
    assert task.config.schema_version == "1.4"
    assert (config.parent / "environment/input/source.json").is_file()
    assert not (config.parent / "environment/tests").exists()
    assert not (config.parent / "environment/input/expected.json").exists()
    count += 1
assert count == 20


class Environment:
    def __init__(self, return_code=0):
        self.calls = []
        self.return_code = return_code

    async def exec(self, **kwargs):
        self.calls.append(kwargs)
        return ExecResult(return_code=self.return_code, stdout="private-output", stderr="private-error")


async def check():
    with tempfile.TemporaryDirectory() as directory:
        for provider, keys in {
            "openai": {"HARBOR_OPENAI_API_KEY": "synthetic"},
            "anthropic": {"HARBOR_ANTHROPIC_API_KEY": "synthetic"},
            "google": {"HARBOR_GOOGLE_GENERATIVE_AI_API_KEY": "synthetic"},
            "openai-compatible": {"HARBOR_OPENAI_COMPATIBLE_API_KEY": "synthetic", "HARBOR_OPENAI_COMPATIBLE_BASE_URL": "https://example.test/v1"},
        }.items():
            agent = FTradeProductAgent(Path(directory), model_name=f"{provider}/synthetic", extra_env={**keys, "DATABASE_URL": "must-not-forward", "UNRELATED_SECRET": "must-not-forward"})
            environment = Environment()
            await agent.setup(environment)
            await agent.run("synthetic", environment, AgentContext())
            assert environment.calls[0]["env"] == {**keys, "HARBOR_MODEL": f"{provider}/synthetic"}
            assert "synthetic" not in environment.calls[0]["command"]
            try:
                await agent.run("synthetic", Environment(23), AgentContext())
                raise AssertionError("nonzero exit passed")
            except RuntimeError as error:
                assert str(error) == "Product Agent exited with code 23"
        for model in (None, "openai/", "unknown/model", "openai/synthetic"):
            agent = FTradeProductAgent(Path(directory), model_name=model)
            environment = Environment()
            try:
                await agent.run("synthetic", environment, AgentContext())
                raise AssertionError("invalid configuration passed")
            except ValueError:
                assert not environment.calls


asyncio.run(check())
print("PASS Harbor 0.23.0: 20 Task schemas, custom adapter, four providers, missing credentials and nonzero exits")
