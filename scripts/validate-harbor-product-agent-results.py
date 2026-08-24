#!/usr/bin/env python3
"""Fail the release gate unless every synthetic Harbor trial earned reward 1."""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path


EXPECTED_TASKS = 20
EXPECTED_REPETITIONS = 3
EXPECTED_TRIALS = EXPECTED_TASKS * EXPECTED_REPETITIONS
SUMMARY_PATH = Path("harbor-artifacts/product-agent-summary.json")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    model = os.environ.get("F_TRADE_HARBOR_MODEL", "")
    selected_provider = os.environ.get("F_TRADE_HARBOR_PROVIDER", "")
    provider, separator, _ = model.partition("/")
    errors: list[str] = []
    if not separator or not provider:
        errors.append("model must use provider/model format")
    if selected_provider != provider:
        errors.append("selected provider does not match the model identifier")

    trials: list[dict] = []
    for result_path in sorted(Path("jobs").glob("*/*/result.json")):
        result = load_json(result_path)
        artifact_path = result_path.parent / "artifacts/logs/artifacts/product-agent-evaluation.json"
        if not artifact_path.is_file():
            errors.append("a trial is missing its sanitized provenance artifact")
            continue
        artifact = load_json(artifact_path)
        reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward")
        if reward != artifact.get("reward"):
            errors.append("a trial artifact reward differs from Harbor result.json")
        trials.append(
            {
                "synthetic_id": artifact.get("synthetic_id"),
                "reward": reward,
                "prompt_version": artifact.get("prompt_version"),
                "prompt_hash": artifact.get("prompt_hash"),
            }
        )

    trials.sort(key=lambda trial: str(trial["synthetic_id"]))
    repetitions: Counter[str] = Counter()
    for trial in trials:
        synthetic_id = trial.get("synthetic_id")
        if not isinstance(synthetic_id, str) or not synthetic_id:
            errors.append("a trial is missing its synthetic identifier")
            continue
        repetitions[synthetic_id] += 1
        trial["repetition"] = repetitions[synthetic_id]
        if trial.get("reward") != 1.0:
            errors.append(f"{synthetic_id} repetition {trial['repetition']} did not pass")
        if not trial.get("prompt_version") or not trial.get("prompt_hash"):
            errors.append(f"{synthetic_id} repetition {trial['repetition']} lacks prompt provenance")

    if len(trials) != EXPECTED_TRIALS:
        errors.append(f"expected {EXPECTED_TRIALS} trials, found {len(trials)}")
    if len(repetitions) != EXPECTED_TASKS or any(
        count != EXPECTED_REPETITIONS for count in repetitions.values()
    ):
        errors.append("expected exactly three trials for each of 20 synthetic tasks")

    summary = {
        "provider": provider,
        "model": model,
        "expected_trial_count": EXPECTED_TRIALS,
        "completed_trial_count": len(trials),
        "passed_trial_count": sum(trial.get("reward") == 1.0 for trial in trials),
        "trials": trials,
    }
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(f"{json.dumps(summary, indent=2)}\n", encoding="utf-8")
    if errors:
        raise SystemExit("Harbor Product Agent gate failed: " + "; ".join(dict.fromkeys(errors)))

    print(f"Harbor Product Agent gate passed: {EXPECTED_TRIALS}/{EXPECTED_TRIALS} trials")


if __name__ == "__main__":
    main()
