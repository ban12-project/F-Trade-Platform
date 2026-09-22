#!/usr/bin/env python3
"""Fail closed on one immutable Harbor job; emit only allowlisted provenance."""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

AGENT = "f-trade-product-agent"
PROVIDERS = {"openai", "anthropic", "google", "openai-compatible"}


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("expected an object")
    return value


def validate(job: Path, manifest: dict, model: str) -> tuple[dict, list[str]]:
    errors: list[str] = []
    provider, separator, name = model.partition("/")
    if not separator or not name or provider not in PROVIDERS:
        errors.append("unsupported provider/model")
    expected_ids = {f"{cohort}-{n:02d}" for cohort in "abcd" for n in range(1, 6)}
    tasks = manifest.get("tasks", [])
    expected = {item["id"]: item for item in tasks}
    if set(expected) != expected_ids or len(tasks) != 20 or manifest.get("repetitions") != 3:
        raise ValueError("manifest must contain exactly the 20 synthetic tasks, three attempts each")
    if manifest.get("harbor_version") != "0.23.0":
        raise ValueError("manifest Harbor version is not the pinned version")
    if manifest.get("protocol_version") != "model-selection-v2" or manifest.get("total_timeout_ms") != 75000 or manifest.get("max_corrections") != 1:
        raise ValueError("manifest must use the production selection policy")
    for item in tasks:
        if not item.get("prompt_version") or any(
            not re.fullmatch(r"[a-f0-9]{64}", item.get(key, ""))
            for key in ("prompt_hash", "expectation_hash")
        ):
            raise ValueError("invalid frozen provenance")
    try:
        job_result = load_json(job / "result.json")
        if not job_result.get("finished_at"):
            errors.append("job has not finished")
    except (OSError, ValueError):
        errors.append("missing or malformed job result")

    trials = []
    counts: Counter[str] = Counter()
    seen_ids: set[str] = set()
    for directory in sorted(job.iterdir()) if job.is_dir() else []:
        if not directory.is_dir():
            continue
        # Harbor trial directories have config/result files; ignore no other directories.
        try:
            result = load_json(directory / "result.json")
            artifact = load_json(directory / "artifacts/logs/artifacts/product-agent-evaluation.json")
        except (OSError, ValueError):
            errors.append("missing or malformed trial result/provenance artifact")
            continue
        synthetic_id = artifact.get("synthetic_id")
        if not isinstance(synthetic_id, str) or synthetic_id not in expected:
            errors.append("unknown synthetic task")
            continue
        counts[synthetic_id] += 1
        truth = expected[synthetic_id]
        trial_errors = []
        trial_id = result.get("id")
        if not isinstance(trial_id, str) or not trial_id or trial_id in seen_ids:
            trial_errors.append("missing or duplicate trial identity")
        else:
            seen_ids.add(trial_id)
        if result.get("task_name") != f"f-trade/product-agent-{synthetic_id}":
            trial_errors.append("task identity mismatch")
        if result.get("exception_info") or not result.get("finished_at"):
            trial_errors.append("trial failed or unfinished")
        info = result.get("agent_info") or {}
        if info.get("name") != AGENT or info.get("version") != "1.2.0" or info.get("model_info") != {"provider": provider, "name": name}:
            trial_errors.append("agent/model mismatch")
        reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward")
        if type(reward) not in (int, float) or reward != 1 or type(artifact.get("reward")) not in (int, float) or artifact.get("reward") != reward:
            trial_errors.append("reward did not pass or artifact disagrees")
        if any(artifact.get(key) != truth[key] for key in ("prompt_version", "prompt_hash", "expectation_hash")) or artifact.get("evidence_mode") != "bounded_location":
            trial_errors.append("frozen provenance mismatch")
        if artifact.get("protocol_version") != "model-selection-v2" or artifact.get("provenance_valid") is not True:
            trial_errors.append("selection protocol/provenance mismatch")
        errors.extend(trial_errors)
        # Never copy raw artifacts, error messages, endpoint data, or unknown identifiers.
        trials.append({
            "synthetic_id": synthetic_id,
            "repetition": counts[synthetic_id],
            "passed": not trial_errors,
            "prompt_version": truth["prompt_version"],
            "prompt_hash": truth["prompt_hash"],
            "expectation_hash": truth["expectation_hash"],
        })
    if counts != Counter({key: 3 for key in expected}):
        errors.append("expected exactly three trials for each of the 20 frozen tasks")
    return {
        "scope": "synthetic-product-agent-model-evaluation",
        "harbor_version": manifest["harbor_version"],
        "provider": provider,
        "model": model,
        "status": "failed" if errors else "passed",
        "expected_trial_count": 60,
        "completed_trial_count": len(trials),
        "passed_trial_count": sum(trial["passed"] for trial in trials),
        "errors": sorted(set(errors)),
        "trials": trials,
    }, errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary, errors = validate(args.job_dir, load_json(args.manifest), args.model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite previous acceptance evidence.
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(summary, indent=2) + "\n")
    if errors:
        raise SystemExit("Harbor Product Agent gate failed: " + "; ".join(sorted(set(errors))))
    print("Harbor Product Agent gate passed: 60/60 trials")


if __name__ == "__main__":
    main()
