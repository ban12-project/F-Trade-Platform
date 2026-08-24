#!/usr/bin/env python3
"""Validate repository contracts, fixtures, templates and workflow invariants."""

from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "contracts"
FIXTURE_DIR = ROOT / "data" / "fixtures"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def validate(schema_path: Path, fixture_path: Path) -> None:
    schema = load_json(schema_path)
    instance = load_json(fixture_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
    if errors:
        details = "; ".join(error.message for error in errors)
        raise AssertionError(f"{fixture_path}: {details}")


def assert_invalid(schema_path: Path, fixture_path: Path) -> None:
    schema = load_json(schema_path)
    instance = load_json(fixture_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    if not list(validator.iter_errors(instance)):
        raise AssertionError(f"Expected invalid fixture to fail: {fixture_path}")


def validate_each(schema_path: Path, fixture_path: Path) -> None:
    schema = load_json(schema_path)
    instances = load_json(fixture_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for index, instance in enumerate(instances):
        errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
        if errors:
            details = "; ".join(error.message for error in errors)
            raise AssertionError(f"{fixture_path}[{index}]: {details}")


def check_schemas() -> None:
    for path in sorted(SCHEMA_DIR.rglob("*.schema.json")):
        schema = load_json(path)
        Draft202012Validator.check_schema(schema)

    checks = {
        "product-draft.schema.json": ["product-draft.synthetic.json"],
        "product-ready.schema.json": [
            "product-ready.synthetic.json",
            "product-ready-application.synthetic.json",
        ],
        "content.schema.json": ["content-draft.synthetic.json"],
        "rfq-draft.schema.json": ["rfq-draft.synthetic.json"],
        "rfq-ready.schema.json": ["rfq-ready.synthetic.json"],
        "quotation-handoff.schema.json": [
            "quotation-handoff.synthetic.json",
            "quotation-review-required.synthetic.json",
        ],
        "delivery-confirmation.schema.json": [
            "delivery-confirmation.synthetic.json",
            "delivery-confirmation-pending.synthetic.json",
        ],
        "workflow-event.schema.json": [
            "workflow-event.synthetic.json",
            "workflow-event-revision.synthetic.json",
        ],
        "human-approval.schema.json": [
            "human-approval.synthetic.json",
            "human-approval-pending.synthetic.json",
            "human-approval-rejected.synthetic.json",
        ],
    }
    for schema_name, fixtures in checks.items():
        schema_path = next(SCHEMA_DIR.rglob(schema_name))
        for fixture_name in fixtures:
            validate(schema_path, FIXTURE_DIR / fixture_name)

    assert_invalid(
        SCHEMA_DIR / "sales" / "quotation-handoff.schema.json",
        FIXTURE_DIR / "quotation-agent-invalid.json",
    )
    assert_invalid(
        SCHEMA_DIR / "workflow" / "human-approval.schema.json",
        FIXTURE_DIR / "human-approval-agent-decision-invalid.json",
    )
    assert_invalid(
        SCHEMA_DIR / "sales" / "delivery-confirmation.schema.json",
        FIXTURE_DIR / "delivery-confirmation-agent-invalid.json",
    )
    assert_invalid(
        SCHEMA_DIR / "workflow" / "workflow-event.schema.json",
        FIXTURE_DIR / "workflow-event-cross-aggregate-invalid.json",
    )
    validate_each(
        SCHEMA_DIR / "workflow" / "workflow-event.schema.json",
        FIXTURE_DIR / "workflow-events-matrix.synthetic.json",
    )


def check_csv_template() -> None:
    expected = [
        "product_name", "product_type", "internal_sku", "oe_numbers", "application",
        "vehicle_brand", "vehicle_model", "clutch_diameter_mm", "spline_count",
        "spline_size", "friction_material", "kit_contents", "gross_weight_kg",
        "net_weight_kg", "package_size", "moq", "estimated_lead_time_days", "packaging",
        "supported_customization", "sample_available", "source_ref", "verification_status",
    ]
    with (ROOT / "data/templates/clutch-products.csv").open(newline="", encoding="utf-8") as stream:
        header = next(csv.reader(stream))
    if header != expected:
        raise AssertionError(f"Unexpected CSV header: {header}")


def check_scoring_config() -> None:
    with (ROOT / "config/lead-scoring.yaml").open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    points = sum(rule["points"] for rule in config["rules"])
    if points != 110:
        raise AssertionError(f"Lead scoring source weights changed unexpectedly: {points}")
    if config["score_cap"] != 100:
        raise AssertionError("Lead scoring must cap at 100")
    if "min(100" not in config["normalization"]:
        raise AssertionError("Lead scoring normalization must cap at 100")
    if config["thresholds"] != {"cold_max": 30, "warm_max": 60}:
        raise AssertionError("Lead scoring thresholds changed unexpectedly")


def check_repository_hygiene() -> None:
    forbidden = {".DS_Store", ".env", ".env.local", "id_rsa"}
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()
    bad = [path for path in tracked if Path(path).name in forbidden]
    if bad:
        raise AssertionError(f"Forbidden files are tracked: {bad}")
    pdf = ROOT / "docs/reference/目录总表.pdf"
    if not pdf.exists() or pdf.stat().st_size < 1000:
        raise AssertionError("Reference PDF is missing or unexpectedly small")


def check_local_markdown_links() -> None:
    pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    ignored_directories = {".git", ".next", "node_modules", "playwright-report"}
    missing: list[str] = []
    for markdown in ROOT.rglob("*.md"):
        if ignored_directories.intersection(markdown.parts):
            continue
        for target in pattern.findall(markdown.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            path_target = target.split("#", 1)[0]
            if not path_target:
                continue
            resolved = (markdown.parent / path_target).resolve()
            if not resolved.exists():
                missing.append(f"{markdown}: {target}")
    if missing:
        raise AssertionError("Broken local Markdown links: " + "; ".join(missing))


def main() -> int:
    checks = [
        ("schemas and fixtures", check_schemas),
        ("CSV template", check_csv_template),
        ("lead scoring", check_scoring_config),
        ("repository hygiene", check_repository_hygiene),
        ("local Markdown links", check_local_markdown_links),
    ]
    for name, check in checks:
        check()
        print(f"PASS {name}")
    print("Repository validation passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, json.JSONDecodeError, yaml.YAMLError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1)
