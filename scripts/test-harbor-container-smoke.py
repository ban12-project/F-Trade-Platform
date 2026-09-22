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
print("PASS 2/2 Harbor oracle container/artifact smoke trials; no model acceptance claim")
