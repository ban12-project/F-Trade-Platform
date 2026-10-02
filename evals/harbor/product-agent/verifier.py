#!/usr/bin/env python3
"""Deterministically grade one synthetic Product Agent output."""

from __future__ import annotations

import json
from pathlib import Path


ARTIFACT_PATH = Path("/logs/artifacts/product-agent-evaluation.json")


def fail(message: str) -> None:
    raise AssertionError(message)


def canonical_product(value: object) -> object:
    if not isinstance(value, dict):
        return value
    product = dict(value)
    oe_numbers = product.get("oe_numbers")
    if isinstance(oe_numbers, list):
        product["oe_numbers"] = sorted(oe_numbers)
    return product


def same_json(actual: object, expected: object) -> bool:
    """Preserve JSON boolean/number types (Python otherwise treats True == 1)."""
    if isinstance(expected, bool):
        return type(actual) is bool and actual == expected
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(
            same_json(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            same_json(a, b) for a, b in zip(actual, expected)
        )
    return not isinstance(actual, bool) and actual == expected


def grade(expected: dict, result: dict) -> dict:
    draft = result.get("draft")
    metadata = result.get("_evaluation")
    if not isinstance(draft, dict) or not isinstance(metadata, dict):
        fail("Product Agent output must contain draft and evaluation metadata")

    allowed_keys = {"record_id", "source_ref", "evidence_refs", "field_evidence",
                    "verification_status", "blocking_missing_fields", "optional_missing_fields",
                    "product", "specifications", "commercial"}
    if set(draft) - allowed_keys:
        fail("Draft contains unsupported fields or approval metadata")
    for field in ("blocking_missing_fields", "optional_missing_fields", "evidence_refs"):
        if not isinstance(draft.get(field), list) or any(not isinstance(value, str) for value in draft[field]):
            fail("Draft lists must contain strings")
    for section in ("product", "specifications", "commercial"):
        if not isinstance(draft.get(section, {}), dict):
            fail("Draft fact sections must be objects")
    source = expected["source"]
    truth = expected["expected"]
    image_inputs = source.get("image_inputs", [])
    if source["image_availability"] == "real_product_image":
        if len(image_inputs) != len(source["image_refs"]) or not image_inputs:
            fail("Image-backed task did not provide actual synthetic image bytes")
        if {item.get("ref") for item in image_inputs} != set(source["image_refs"]):
            fail("Synthetic image bytes do not match supplied image references")
    elif image_inputs:
        fail("No-image task unexpectedly provided image bytes")
    if draft.get("record_id") != source["record_id"] or draft.get("source_ref") != source["source_ref"]:
        fail("record_id and source_ref must be preserved")
    if draft.get("verification_status") != "review_required":
        fail("Product Agent must not verify products")
    if not same_json(canonical_product(draft.get("product")), canonical_product(truth["product"])):
        fail("Product fields differ from supported synthetic truth")
    if not same_json(draft.get("specifications", {}), truth.get("specifications", {})):
        fail("Specification fields differ from supported synthetic truth")
    if not same_json(draft.get("commercial", {}), truth.get("commercial", {})):
        fail("Commercial fields differ from supported synthetic truth")
    if sorted(draft.get("blocking_missing_fields", [])) != sorted(truth["blocking_missing_fields"]):
        fail("Blocking missing fields are incorrect")

    populated = []
    for section in ("product", "specifications", "commercial"):
        for field in (draft.get(section) or {}):
            populated.append(f"{section}.{field}")
    evidence = draft.get("field_evidence", {})
    if not isinstance(evidence, dict) or set(evidence) != set(populated):
        fail("Every populated fact must have exactly one field evidence binding")
    for field, ref in evidence.items():
        if not isinstance(ref, str) or ref not in expected["field_evidence"].get(field, []):
            fail("Field evidence must cite a bounded location supporting that exact fact")
    refs = draft.get("evidence_refs")
    if not isinstance(refs, list) or len(refs) != len(set(refs)) or set(refs) != set(evidence.values()):
        fail("Evidence references must equal the compacted field evidence set")
    for key in ("prompt_version", "prompt_hash", "evidence_mode"):
        if metadata.get(key) != expected[key]:
            fail("Evaluation provenance does not match the frozen expectation")

    return {
        "reward": 1.0,
        "sourced_field_recognition": 1.0,
        "oe_preservation": 1.0,
        "vehicle_fidelity": 1.0,
        "blocking_missing_detection": 1.0,
        "evidence_binding": 1.0,
        "state_boundary": 1.0,
    }

# Harbor and local selection use the same grading and diagnostic implementation.
def normalize_candidate(value):
    import copy
    import re
    if not isinstance(value, dict):
        return value
    candidate = copy.deepcopy(value)
    evidence = candidate.get("field_evidence")
    for section in ("product", "specifications", "commercial"):
        fields = candidate.get(section)
        if not isinstance(fields, dict):
            continue
        for key, field in list(fields.items()):
            if field is None:
                del fields[key]
                if isinstance(evidence, dict):
                    evidence.pop(f"{section}.{key}", None)
    if isinstance(evidence, dict):
        candidate["field_evidence"] = {key: ref for key, ref in evidence.items() if ref is not None}
    commercial = candidate.get("commercial")
    if isinstance(commercial, dict) and isinstance(commercial.get("packaging"), str):
        commercial["packaging"] = re.sub(r"\s+", " ", re.sub(r"[.|]+$", "", commercial["packaging"].strip()).strip()).lower()
    return candidate


def contract_matches(schema, value):
    """Validate the keywords used by the frozen business contract without provider dependencies."""
    import re
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict): return False
        if any(key not in value for key in schema.get("required", [])): return False
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            if "propertyNames" in schema and not contract_matches({"type": "string", **schema["propertyNames"]}, key): return False
            if key in properties:
                if not contract_matches(properties[key], item): return False
            elif additional is False: return False
            elif isinstance(additional, dict) and not contract_matches(additional, item): return False
    elif kind == "array":
        if not isinstance(value, list): return False
        if not all(contract_matches(schema["items"], item) for item in value): return False
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value): return False
    elif kind == "string":
        if not isinstance(value, str): return False
        if len(value) < schema.get("minLength", 0): return False
        if "pattern" in schema and re.search(schema["pattern"], value) is None: return False
    elif kind in ("number", "integer"):
        import math
        if type(value) not in (int, float) or not math.isfinite(value): return False
        if kind == "integer" and int(value) != value: return False
        if "minimum" in schema and value < schema["minimum"]: return False
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]: return False
    elif kind == "boolean" and type(value) is not bool: return False
    if "enum" in schema and not any(same_json(value, allowed) for allowed in schema["enum"]): return False
    return True


def field_values(candidate):
    if not isinstance(candidate, dict): return {}
    return {f"{section}.{key}": value for section in ("product", "specifications", "commercial")
            if isinstance(candidate.get(section), dict) for key, value in candidate[section].items()}


def same_fact(path, actual, expected):
    if path == "product.oe_numbers" and isinstance(actual, list) and all(isinstance(v, str) for v in actual):
        return same_json(sorted(actual), sorted(expected))
    return same_json(actual, expected)


def diagnose(expected, text):
    """Diagnostics are about the model response, before production correction/review.
    An empty prediction has precision 1 but recall 0 when facts are expected.
    No diagnostic score can override the final strict gate.
    """
    try:
        candidate = normalize_candidate(json.loads(text))
    except (TypeError, ValueError):
        candidate = None
    parsed = isinstance(candidate, dict)
    predicted = field_values(candidate)
    truth = field_values(expected["expected"])
    correct = {path for path, value in predicted.items() if path in truth and same_fact(path, value, truth[path])}
    evidence = candidate.get("field_evidence", {}) if parsed else {}
    supported = {path for path in correct if isinstance(evidence, dict) and evidence.get(path) in expected["field_evidence"].get(path, [])}
    return {
        "json_object": int(parsed),
        "contract_valid": int(parsed and contract_matches(expected["output_contract"], candidate)),
        "expected_facts": len(truth), "predicted_facts": len(predicted), "correct_facts": len(correct),
        "supported_correct_facts": len(supported),
        "fact_precision": len(correct) / len(predicted) if predicted else int(parsed),
        "fact_recall": len(correct) / len(truth) if truth else int(parsed),
        "evidence_recall": len(supported) / len(truth) if truth else int(parsed),
        "model_blockers_exact": int(parsed and same_json(sorted(candidate.get("blocking_missing_fields", [])), sorted(expected["expected"]["blocking_missing_fields"]))) if parsed and "blocking_missing_fields" in candidate and isinstance(candidate["blocking_missing_fields"], list) and all(isinstance(x, str) for x in candidate["blocking_missing_fields"]) else 0,
        "model_state_boundary": int(parsed and candidate.get("verification_status") == "review_required" and not any(key in candidate for key in ("approval_ref", "approval", "approved", "verified"))),
    }


def strict_pass(expected, draft, metadata):
    try:
        grade(expected, {"draft": draft, "_evaluation": metadata})
        return 1
    except (AssertionError, TypeError, ValueError):
        return 0


def evaluate(expected, result):
    """Allowlisted report. Never copy response text, errors or unknown model identifiers."""
    if not isinstance(result, dict):
        result = {}
    meta = result.get("_evaluation")
    meta = meta if isinstance(meta, dict) else {}
    diagnostics = result.get("_diagnostics")
    attempts = diagnostics.get("attempts", []) if isinstance(diagnostics, dict) else []
    policy = meta.get("output_policy")
    mode = policy.get("mode") if isinstance(policy, dict) else None
    valid = (
        isinstance(meta, dict) and isinstance(attempts, list) and 1 <= len(attempts) <= 2
        and meta.get("protocol_version") == expected.get("protocol_version") == "model-selection-v2"
        and meta.get("execution_policy") == "production-catalog" and meta.get("total_timeout_ms") == 75000
        and meta.get("max_corrections") == 1 and meta.get("attempt_count") == len(attempts)
        and all(meta.get(key) == expected[key] for key in ("prompt_version", "prompt_hash", "evidence_mode"))
    )
    summaries = []
    for index, attempt in enumerate(attempts if isinstance(attempts, list) else []):
        if not isinstance(attempt, dict):
            valid = False
            continue
        responses = attempt.get("responses", [])
        outcome = attempt.get("outcome")
        valid = valid and attempt.get("number") == index + 1 and attempt.get("correction") is (index == 1) and outcome in ("accepted", "contract_or_source", "timeout", "provider", "runtime")
        if index == 1: valid = valid and isinstance(attempts[0], dict) and attempts[0].get("outcome") == "contract_or_source"
        if not isinstance(responses, list) or len(responses) > 1:
            valid = False
            responses = []
        response = responses[0] if responses and isinstance(responses[0], dict) else {}
        if outcome == "accepted" and not response: valid = False
        if response and response.get("output_mode") != mode: valid = False
        raw = response.get("text")
        usage = response.get("usage")
        usage = usage if isinstance(usage, dict) else {}
        usage_summary = {name: usage.get(key) if type(usage.get(key)) in (int, float) and usage[key] >= 0 else None
                         for name, key in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens"), ("total_tokens", "totalTokens"))}
        summaries.append({
            "number": index + 1, "outcome": outcome if outcome in ("accepted", "contract_or_source", "timeout", "provider", "runtime") else "invalid",
            "duration_ms": attempt.get("duration_ms") if type(attempt.get("duration_ms")) in (int, float) and attempt["duration_ms"] >= 0 else None,
            "model_output_observed": bool(response), "usage": usage_summary,
            "diagnostics": diagnose(expected, raw),
            "strict_pass": strict_pass(expected, attempt.get("draft"), meta) if outcome == "accepted" else 0,
        })
    if summaries and all(isinstance(a, dict) for a in attempts):
        last = attempts[-1]
        valid = valid and meta.get("final_accepted") is (last.get("outcome") == "accepted")
        valid = valid and meta.get("first_attempt_accepted") is (attempts[0].get("outcome") == "accepted")
        valid = valid and (same_json(result.get("draft"), last.get("draft")) if last.get("outcome") == "accepted" else result.get("draft") is None)
        valid = valid and meta.get("failure") == (None if last.get("outcome") == "accepted" else last.get("outcome"))
    valid = valid and mode in ("json_schema", "json", "text")
    reward = int(bool(valid) and strict_pass(expected, result.get("draft"), meta) == 1)
    return {
        "synthetic_id": expected["id"], "protocol_version": "model-selection-v2", "diagnostic_revision": 2,
        "prompt_version": expected["prompt_version"], "prompt_hash": expected["prompt_hash"],
        "expectation_hash": expected["expectation_hash"], "evidence_mode": expected["evidence_mode"],
        "provenance_valid": bool(valid), "output_mode": mode if mode in ("json_schema", "json", "text") else None,
        "reward": reward, "first_attempt_pass": summaries[0]["strict_pass"] if valid and summaries else 0,
        "final_accepted": bool(valid and meta.get("final_accepted")),
        "duration_ms": meta.get("duration_ms") if type(meta.get("duration_ms")) in (int, float) and meta["duration_ms"] >= 0 else None,
        "attempts": summaries,
    }


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=Path, default=Path("/tests/expected.json"))
    parser.add_argument("--result", type=Path, default=Path("/app/output/product-draft.json"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text())
    result = json.loads(args.result.read_text())
    report = evaluate(expected, result)
    if args.report:
        with args.report.open("x") as output:
            output.write(json.dumps(report, indent=2) + "\n")
    else:
        path = Path("/logs/verifier/reward.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        metrics = {"reward": report["reward"], "first_attempt_pass": report["first_attempt_pass"]}
        if report["attempts"]:
            metrics.update({"first_" + key: report["attempts"][0]["diagnostics"][key] for key in ("contract_valid", "fact_precision", "fact_recall", "evidence_recall", "model_state_boundary")})
        path.write_text(json.dumps(metrics))
        ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
        ARTIFACT_PATH.write_text(json.dumps(report))
    # Quality failures are valid measurements, not verifier infrastructure crashes.
    if not report["provenance_valid"]:
        raise SystemExit("Evaluation provenance is invalid")


if __name__ == "__main__":
    main()
