#!/usr/bin/env python3
"""Check real Harbor container/artifact wiring with oracle fixtures, never model quality."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--environment", choices=["docker", "podman"], default="docker")
parser.add_argument("--dataset", type=Path, default=Path("/tmp/f-trade-harbor-product-agent"))
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="f-trade-harbor-oracle-") as temporary:
    root = Path(temporary)
    dataset = root / "dataset"
    # Both a source-complete and a blocking-missing-fields trial use image bytes.
    for task_id in ("a-01", "c-01"):
        task = dataset / task_id
        shutil.copytree(args.dataset / task_id, task)
        expected = json.loads((task / "tests/expected.json").read_text())
        fields = {field: refs[0] for field, refs in expected["field_evidence"].items()}
        result = {
            "draft": {
                "record_id": expected["source"]["record_id"],
                "source_ref": expected["source"]["source_ref"],
                "evidence_refs": list(dict.fromkeys(fields.values())),
                "field_evidence": fields,
                "verification_status": "review_required",
                "optional_missing_fields": [],
                **expected["expected"],
            },
            "_evaluation": {key: expected[key] for key in ("prompt_version", "prompt_hash", "evidence_mode")},
        }
        result["_evaluation"].update(protocol_version="model-selection-v2", execution_policy="production-catalog", total_timeout_ms=75000, max_corrections=1, attempt_count=1, first_attempt_accepted=True, final_accepted=True, failure=None, output_policy={"mode": "text"}, duration_ms=0)
        result["_diagnostics"] = {"attempts": [{"number": 1, "correction": False, "duration_ms": 0, "outcome": "accepted", "draft": result["draft"], "responses": [{"text": json.dumps(result["draft"]), "output_mode": "text", "duration_ms": 0}]}]}
        # Oracle solutions exist only in this disposable smoke copy, never in model tasks.
        (task / "solution").mkdir()
        (task / "solution/solve.sh").write_text(
            "#!/bin/sh\nset -eu\nmkdir -p /app/output\ncat > /app/output/product-draft.json <<'SYNTHETIC_ORACLE'\n"
            + json.dumps(result) + "\nSYNTHETIC_ORACLE\n"
        )
        candidate = dict(result["draft"])
        if task_id == "c-01":
            # Invalid business content must become reward 0, not an adapter exception.
            candidate = json.loads(json.dumps(candidate))
            candidate["product"]["oe_numbers"] = ["SYN-INVENTED"]
        (task / "environment/input/smoke-response.json").write_text(json.dumps(candidate))
    env = {**os.environ, "PYTHONPATH": str(Path.cwd())}
    subprocess.run([
        "harbor", "run", "-p", str(dataset), "-a", "oracle", "-k", "1", "-n", "1",
        "-e", args.environment, "--job-name", "oracle-smoke", "--jobs-dir", str(root / "jobs"), "--yes",
    ], check=True, env=env)
    results = list((root / "jobs/oracle-smoke").glob("*/result.json"))
    assert len(results) == 2, "Missing smoke trials"
    for path in results:
        result = json.loads(path.read_text())
        assert not result.get("exception_info"), "Container smoke failed"
        assert result["verifier_result"]["rewards"]["reward"] == 1
        artifact = json.loads((path.parent / "artifacts/logs/artifacts/product-agent-evaluation.json").read_text())
        assert artifact["reward"] == 1
        assert artifact["evidence_mode"] == "bounded_location"
        assert result["agent_info"]["name"] == "oracle", "Smoke must remain distinguishable from model acceptance"
    # Reuse the disposable dataset after removing oracle solutions. Only the loopback provider
    # knows the synthetic response; the real CLI, SDK, validators and verifier execute.
    for task in dataset.iterdir():
        shutil.rmtree(task / "solution")
    # Harbor scrubs credential values from artifacts; never use a common word
    # such as "synthetic", which would also redact task and agent identities.
    subprocess.run([
        "harbor", "run", "-p", str(dataset),
        "-a", "evals.harbor.product_agent.smoke_agent:SmokeProductAgent",
        "-m", "openai-compatible/synthetic", "-k", "1", "-n", "1",
        "-e", args.environment, "--job-name", "adapter-smoke", "--jobs-dir", str(root / "jobs"), "--yes",
        "--ae", "HARBOR_OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8787/v1",
        "--ae", "HARBOR_OPENAI_COMPATIBLE_API_KEY=fixture-key-do-not-use",
    ], check=True, env=env)
    results = list((root / "jobs/adapter-smoke").glob("*/result.json"))
    assert len(results) == 2, "Missing adapter smoke trials"
    seen = set()
    for path in results:
        result = json.loads(path.read_text())
        assert not result.get("exception_info"), "Adapter/CLI execution failed"
        assert result["agent_info"]["name"] == "f-trade-product-agent-synthetic-smoke"
        artifact = json.loads((path.parent / "artifacts/logs/artifacts/product-agent-evaluation.json").read_text())
        task_id = artifact["synthetic_id"]
        seen.add(task_id)
        expected_reward = int(task_id == "a-01")
        assert artifact["provenance_valid"] is True
        assert artifact["reward"] == result["verifier_result"]["rewards"]["reward"] == expected_reward
        assert len(artifact["attempts"]) == (1 if expected_reward else 2)
        assert all(attempt["model_output_observed"] for attempt in artifact["attempts"])
        assert all(attempt["usage"]["total_tokens"] == 23 for attempt in artifact["attempts"])
        assert artifact["attempts"][-1]["outcome"] == ("accepted" if expected_reward else "contract_or_source")
    assert seen == {"a-01", "c-01"}
print("PASS 2 oracle + 2 real-adapter/CLI synthetic-provider container trials; no model quality claim")
