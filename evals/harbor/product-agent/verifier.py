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


def write_evaluation_artifact(expected: dict, metadata: object, reward: float) -> None:
    provenance = metadata if isinstance(metadata, dict) else {}
    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(
        json.dumps(
            {
                "synthetic_id": expected.get("id"),
                "reward": reward,
                "prompt_version": provenance.get("prompt_version"),
                "prompt_hash": provenance.get("prompt_hash"),
                "expectation_hash": expected.get("expectation_hash"),
                "evidence_mode": provenance.get("evidence_mode"),
            }
        ),
        encoding="utf-8",
    )


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

def main() -> None:
    expected = json.loads(Path("/tests/expected.json").read_text(encoding="utf-8"))
    result = json.loads(Path("/app/output/product-draft.json").read_text(encoding="utf-8"))
    metrics = grade(expected, result)
    Path("/logs/verifier").mkdir(parents=True, exist_ok=True)
    Path("/logs/verifier/reward.json").write_text(json.dumps(metrics), encoding="utf-8")
    metadata = result["_evaluation"]
    write_evaluation_artifact(expected, metadata, 1.0)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        Path("/logs/verifier").mkdir(parents=True, exist_ok=True)
        Path("/logs/verifier/reward.json").write_text(json.dumps({"reward": 0.0}), encoding="utf-8")
        try:
            expected = json.loads(Path("/tests/expected.json").read_text(encoding="utf-8"))
            result = json.loads(Path("/app/output/product-draft.json").read_text(encoding="utf-8"))
            write_evaluation_artifact(expected, result.get("_evaluation"), 0.0)
        except Exception:
            pass
        raise SystemExit(f"Product Agent verifier failed: {error}")
