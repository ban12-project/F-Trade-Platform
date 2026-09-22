"""Disposable synthetic provider setup; execution is the real Product Agent adapter."""
from evals.harbor.product_agent.f_trade_product_agent import FTradeProductAgent


class SmokeProductAgent(FTradeProductAgent):
    @staticmethod
    def name() -> str:
        # Never masquerade as a real model acceptance run.
        return "f-trade-product-agent-synthetic-smoke"

    async def install(self, environment) -> None:
        result = await environment.exec(command=(
            "python3 /app/scripts/harbor-smoke-provider.py >/tmp/smoke-provider.log 2>&1 &\n"
            "python3 - <<'PY'\n"
            "import time, urllib.request\n"
            "for attempt in range(50):\n"
            "    try:\n"
            "        urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=1).close()\n"
            "        break\n"
            "    except OSError:\n"
            "        time.sleep(0.1)\n"
            "else:\n"
            "    raise SystemExit('Synthetic provider did not start')\n"
            "PY\n"
        ), timeout_sec=15)
        if result.return_code != 0:
            raise RuntimeError("Synthetic provider setup failed")
