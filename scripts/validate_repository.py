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
        "product-cohort.schema.json": ["product-cohort.synthetic.json"],
        "product-acceptance-result.schema.json": [
            "product-acceptance-passed.synthetic.json",
            "product-acceptance-failed.synthetic.json",
        ],
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

    validate(
        SCHEMA_DIR / "data" / "product-draft.schema.json",
        FIXTURE_DIR / "product-draft-complete.synthetic.json",
    )

    cohort = load_json(FIXTURE_DIR / "product-cohort.synthetic.json")
    expected_combinations = {
        "A": ("complete", "real_product_image"),
        "B": ("complete", "none"),
        "C": ("incomplete", "real_product_image"),
        "D": ("incomplete", "none"),
    }
    actual_combinations = {
        item["cohort_id"]: (item["data_completeness"], item["image_availability"])
        for item in cohort["cohorts"]
    }
    if actual_combinations != expected_combinations:
        raise AssertionError(f"Unexpected Product A-D cohort matrix: {actual_combinations}")
    for item in cohort["cohorts"]:
        product_fixture = ROOT / item["product_fixture"]
        if not product_fixture.is_file():
            raise AssertionError(f"Missing cohort product fixture: {product_fixture}")
        if item["image_availability"] == "none" and item["image_refs"]:
            raise AssertionError(f"No-image cohort {item['cohort_id']} has image refs")

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
    assert_invalid(
        SCHEMA_DIR / "testing" / "product-acceptance-result.schema.json",
        FIXTURE_DIR / "product-acceptance-false-pass-invalid.json",
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


def check_product_acceptance_config() -> None:
    with (ROOT / "config/product-acceptance.yaml").open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    cases = config["cases"]
    if config["cohort_size"] != 20 or len(cases) != 20:
        raise AssertionError("Product acceptance plan must contain exactly 20 slots")
    expected_ids = {f"pilot-slot-{index:02d}" for index in range(1, 21)}
    if {case["slot_id"] for case in cases} != expected_ids:
        raise AssertionError("Product acceptance slot IDs must cover 01 through 20")
    cohort_counts = {
        cohort: sum(case["cohort"] == cohort for case in cases)
        for cohort in ("A", "B", "C", "D")
    }
    if cohort_counts != {"A": 5, "B": 5, "C": 5, "D": 5}:
        raise AssertionError(f"Product acceptance cohorts must be balanced: {cohort_counts}")
    if any(case["status"] != "planned" for case in cases):
        raise AssertionError("Unexecuted acceptance slots must remain planned")
    criteria = config["criteria"]
    for name in (
        "sourced_field_recognition",
        "oe_preservation",
        "vehicle_fidelity",
        "blocking_missing_detection",
    ):
        if criteria[name]["pass_threshold"] != 1.0:
            raise AssertionError(f"{name} must require 100%")
    if criteria["review_elapsed_seconds"]["pass_threshold"] is not None:
        raise AssertionError("Review time must remain baseline-only before the real cohort")
    if not criteria["failure_record"]["requires_new_github_issue"]:
        raise AssertionError("Failed acceptance runs must require a new GitHub issue")
    if criteria["failure_record"]["overwrite_previous_run"]:
        raise AssertionError("Failed acceptance runs must remain immutable")


def check_database_baseline() -> None:
    auth_source = (ROOT / "lib/auth.ts").read_text(encoding="utf-8")
    if "disableSignUp: true" not in auth_source:
        raise AssertionError("Public Better Auth sign-up must remain disabled")
    if "minPasswordLength: 12" not in auth_source:
        raise AssertionError("Internal passwords must require at least 12 characters")

    migrations = sorted((ROOT / "drizzle").glob("*.sql"))
    if not migrations:
        raise AssertionError("At least one Drizzle SQL migration is required")
    migration = "\n".join(path.read_text(encoding="utf-8") for path in migrations)
    required_tables = {
        "user", "session", "account", "verification", "invitation",
        "aggregate_record", "approval", "evidence", "workflow_event", "audit_event",
    }
    missing_tables = [
        table for table in sorted(required_tables)
        if f'CREATE TABLE "{table}"' not in migration
    ]
    if missing_tables:
        raise AssertionError(f"Database migration is missing tables: {missing_tables}")
    for trigger in ("audit_event_append_only", "workflow_event_append_only"):
        if f'CREATE TRIGGER "{trigger}"' not in migration:
            raise AssertionError(f"Database migration is missing trigger: {trigger}")
    if "decided_by_type\" = 'human'" not in migration:
        raise AssertionError("Approval decisions must be constrained to a human actor")


def check_service_adapters() -> None:
    package = load_json(ROOT / "package.json")
    expected = {
        "workflow": "4.8.4",
        "@vercel/blob": "2.8.0",
        "ai": "7.0.77",
    }
    for name, version in expected.items():
        if package["dependencies"].get(name) != version:
            raise AssertionError(f"{name} must remain pinned to {version}")

    next_config = (ROOT / "next.config.ts").read_text(encoding="utf-8")
    if "withWorkflow(nextConfig)" not in next_config:
        raise AssertionError("Next.js config must register Workflow SDK")

    workflow = (ROOT / "workflows/human-gate.ts").read_text(encoding="utf-8")
    for required in ('"use workflow"', "approvalId", 'actorType: "human"'):
        if required not in workflow:
            raise AssertionError(f"Human Gate workflow is missing: {required}")

    blob = (ROOT / "lib/evidence/vercel-private-blob.ts").read_text(encoding="utf-8")
    if blob.count('access: "private"') < 2 or 'access: "public"' in blob:
        raise AssertionError("Evidence Blob adapter must enforce private read and write access")
    if "result.url" in blob or "result.downloadUrl" in blob:
        raise AssertionError("Evidence adapter must not expose private Blob URLs")

    generator = (ROOT / "lib/ai/structured-generator.ts").read_text(encoding="utf-8")
    for required in ("model: LanguageModel", "assertSchemaValidates", "verifiedFacts"):
        if required not in generator:
            raise AssertionError(f"Structured generator is missing: {required}")


def check_workflow_orchestrator() -> None:
    orchestrator = (ROOT / "lib/workflow/orchestrator.ts").read_text(encoding="utf-8")
    for required in ("database.transaction", "workflowEvent", "auditEvent", "for(\"update\")"):
        if required not in orchestrator:
            raise AssertionError(f"Workflow orchestrator is missing: {required}")
    result = subprocess.run(
        ["pnpm", "test:workflow"], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode:
        raise AssertionError(f"Workflow transition tests failed: {result.stderr or result.stdout}")


def check_synthetic_demo() -> None:
    result = subprocess.run(
        ["pnpm", "test:demo"], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode:
        raise AssertionError(f"Synthetic demo tests failed: {result.stderr or result.stdout}")


def check_quotation_gate() -> None:
    result = subprocess.run(["pnpm", "test:quotation"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Quotation Gate 02 tests failed: {result.stderr or result.stdout}")


def check_delivery_gate() -> None:
    result = subprocess.run(["pnpm", "test:delivery"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Delivery Gate 03 tests failed: {result.stderr or result.stdout}")


def check_rfq_completeness() -> None:
    result = subprocess.run(["pnpm", "test:rfq"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"RFQ completeness tests failed: {result.stderr or result.stdout}")

def check_rfq_acceptance_matrix() -> None:
    cases = load_json(FIXTURE_DIR / "rfq-acceptance-matrix.synthetic.json")
    expected = {"complete", "incomplete", "ambiguous_vehicle", "missing_oe", "missing_quantity", "missing_destination", "refuses_clarification"}
    if {case["id"] for case in cases} != expected:
        raise AssertionError("RFQ acceptance matrix must cover all required scenarios")
    for case in cases:
        if set(case) != {"id", "input", "expected_state", "next_question", "prohibited_action"}:
            raise AssertionError(f"RFQ acceptance matrix has invalid fields: {case['id']}")
        if case["expected_state"] == "RFQ_READY" and case["next_question"] is not None:
            raise AssertionError("Ready RFQ scenarios cannot have a next question")
        if case["expected_state"] != "RFQ_READY" and not case["next_question"]:
            raise AssertionError("Collecting RFQ scenarios require a next question")

def check_sales_clarification() -> None:
    result = subprocess.run(["pnpm", "test:sales"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Sales clarification tests failed: {result.stderr or result.stdout}")

def check_lead_scoring() -> None:
    result = subprocess.run(["pnpm", "test:scoring"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Lead scoring tests failed: {result.stderr or result.stdout}")

def check_follow_up_scenarios() -> None:
    cases = load_json(FIXTURE_DIR / "follow-up-scenarios.synthetic.json")
    if {case["id"] for case in cases} != {"unread", "read_no_reply", "price_high", "purchase_later", "sample_or_lead_time"}:
        raise AssertionError("Follow-up scenarios must cover the five required cases")
    if any(not case["next_action"] or not case["prohibited_action"] for case in cases):
        raise AssertionError("Every follow-up scenario requires an action and prohibited action")

def check_follow_up_cadence() -> None:
    result = subprocess.run(["pnpm", "test:cadence"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Follow-up cadence tests failed: {result.stderr or result.stdout}")


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
        ("product acceptance", check_product_acceptance_config),
        ("database baseline", check_database_baseline),
        ("service adapters", check_service_adapters),
        ("workflow orchestrator", check_workflow_orchestrator),
        ("synthetic end-to-end demo", check_synthetic_demo),
        ("quotation Gate 02", check_quotation_gate),
        ("delivery Gate 03", check_delivery_gate),
        ("RFQ completeness", check_rfq_completeness),
        ("RFQ acceptance matrix", check_rfq_acceptance_matrix),
        ("sales clarification", check_sales_clarification),
        ("lead scoring", check_lead_scoring),
        ("follow-up scenarios", check_follow_up_scenarios),
        ("follow-up cadence", check_follow_up_cadence),
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
