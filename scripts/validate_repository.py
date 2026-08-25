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
        "mvp-acceptance-summary.schema.json": ["mvp-acceptance-summary.synthetic.json"],
        "channel-inbound-policy.schema.json": ["channel-inbound-policy.synthetic.json"],
        "channel-onboarding.schema.json": ["channel-onboarding.synthetic.json"],
        "official-inbound-webhook.schema.json": ["official-inbound-webhook.synthetic.json"],
        "product-pilot-authorization.schema.json": ["product-pilot-authorization.synthetic.json"],
        "product-catalog-intake.schema.json": ["product-catalog-intake.synthetic.json"],
        "publication-policy.schema.json": ["publication-policy.synthetic.json"],
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
    assert_invalid(
        SCHEMA_DIR / "testing" / "product-catalog-intake.schema.json",
        FIXTURE_DIR / "product-catalog-intake-fact-leak-invalid.json",
    )
    assert_invalid(
        SCHEMA_DIR / "social" / "channel-onboarding.schema.json",
        FIXTURE_DIR / "channel-onboarding-secret-invalid.json",
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


def check_mvp_acceptance_summary() -> None:
    summary = load_json(FIXTURE_DIR / "mvp-acceptance-summary.synthetic.json")
    expected = {
        "product_import", "content_gate", "rfq_completion", "quotation_handoff",
        "follow_up_opportunity", "gate_bypass",
    }
    criteria = summary["criteria"]
    if {item["criterion_id"] for item in criteria} != expected or len(criteria) != len(expected):
        raise AssertionError("MVP acceptance summary must contain each required criterion exactly once")
    metrics = summary["metrics"]
    if metrics["rfq_ready"] > metrics["rfq_total"]:
        raise AssertionError("RFQ Ready count cannot exceed RFQ total")
    if summary["decision"]["status"] == "go":
        if any(item["status"] != "passed" for item in criteria):
            raise AssertionError("Go decision requires every acceptance criterion to pass")
        if metrics["factual_error_count"] or metrics["gate_bypass_count"]:
            raise AssertionError("Go decision requires zero factual errors and gate bypasses")
        if metrics["rfq_ready"] != metrics["rfq_total"]:
            raise AssertionError("Go decision requires every RFQ to be ready")
        if metrics["blocked_external_dependency_count"]:
            raise AssertionError("Go decision requires no blocked external dependencies")
    result = subprocess.run(
        ["pnpm", "test:mvp-acceptance"], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode:
        raise AssertionError(f"MVP acceptance decision tests failed: {result.stderr or result.stdout}")


def check_product_pilot_authorization() -> None:
    manifest = load_json(FIXTURE_DIR / "product-pilot-authorization.synthetic.json")
    slots = manifest["slots"]
    expected_slot_ids = {f"pilot-slot-{index:02d}" for index in range(1, 21)}
    if {item["slot_id"] for item in slots} != expected_slot_ids or len(slots) != 20:
        raise AssertionError("Product pilot authorization must cover each of 20 slots exactly once")
    matrix = {
        "A": ("complete", "real_product_image"),
        "B": ("complete", "none"),
        "C": ("incomplete", "real_product_image"),
        "D": ("incomplete", "none"),
    }
    for cohort, expected in matrix.items():
        matching = [item for item in slots if item["cohort"] == cohort]
        if len(matching) != 5 or any((item["data_completeness"], item["image_availability"]) != expected for item in matching):
            raise AssertionError(f"Product pilot authorization has an invalid {cohort} cohort matrix")
    if manifest["manifest_status"] == "authorized" and any(item["authorization_status"] != "authorized" for item in slots):
        raise AssertionError("Authorized product pilot manifest requires all slots to be authorized")


def check_product_catalog_intake() -> None:
    manifest = load_json(FIXTURE_DIR / "product-catalog-intake.synthetic.json")
    documents = {item["document_ref"]: item for item in manifest["source_documents"]}
    slots = manifest["slots"]
    expected_slot_ids = {f"pilot-slot-{index:02d}" for index in range(1, 21)}
    if {item["slot_id"] for item in slots} != expected_slot_ids or len(slots) != 20:
        raise AssertionError("Product catalog intake must cover each of 20 slots exactly once")
    matrix = {
        "A": ("complete", "real_product_image"),
        "B": ("complete", "none"),
        "C": ("incomplete", "real_product_image"),
        "D": ("incomplete", "none"),
    }
    for cohort, expected in matrix.items():
        matching = [item for item in slots if item["cohort"] == cohort]
        if len(matching) != 5 or any((item["data_completeness"], item["image_availability"]) != expected for item in matching):
            raise AssertionError(f"Product catalog intake has an invalid {cohort} cohort matrix")
    for slot in slots:
        document = documents.get(slot["source_document_ref"])
        if document is None:
            raise AssertionError(f"Catalog intake slot references an unknown document: {slot['slot_id']}")
        if slot["intake_status"] == "ready_for_preflight":
            if document["use_authorization"] != "approved":
                raise AssertionError("Ready catalog intake must use an authorized source document")
            if document["conversion_status"] != "approved_for_extraction":
                raise AssertionError("Ready catalog intake must use an approved conversion")
            if slot["blocker_codes"]:
                raise AssertionError("Ready catalog intake cannot retain blockers")


def check_channel_onboarding() -> None:
    manifest = load_json(FIXTURE_DIR / "channel-onboarding.synthetic.json")
    if manifest["production_readiness"] in {"test_ready", "approved"}:
        required = {
            "ownership_status": "verified",
            "official_oauth_status": "tested",
            "publishing_path": "postiz_official_api",
            "inbound_path": "chatwoot_official_webhook",
            "reply_window_status": "confirmed",
        }
        for field, expected in required.items():
            if manifest[field] != expected:
                raise AssertionError(f"Channel readiness requires {field}={expected}")
    if manifest["browser_automation_production"]:
        raise AssertionError("Browser automation must remain prohibited for production channels")
    if not manifest["inbound_only"] or not manifest["external_effects_require_human_approval"]:
        raise AssertionError("Channel onboarding must preserve inbound-only human-approved operation")


def check_database_baseline() -> None:
    database_client = (ROOT / "lib/db/client.ts").read_text(encoding="utf-8")
    for required in ("drizzle-orm/neon-serverless", "new Pool", "closeDatabase"):
        if required not in database_client:
            raise AssertionError(f"Database client must support transactions: {required}")
    if "drizzle-orm/neon-http" in database_client:
        raise AssertionError("Database client must not use the transactionless neon-http driver")
    auth_source = (ROOT / "lib/auth.ts").read_text(encoding="utf-8")
    for required in (
        'emailAndPassword: { enabled: false }',
        "emailOTP({",
        "disableSignUp: true",
        "sendVerificationOTP: sendEmailOtp",
        "passkey({",
        "rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID",
        "invitationActivationPlugin()",
    ):
        if required not in auth_source:
            raise AssertionError(f"Passwordless Better Auth configuration is missing: {required}")
    proxy_source = (ROOT / "proxy.ts").read_text(encoding="utf-8")
    for required in (
        "auth.api.getSession",
        'session.user.role !== "admin"',
        'matcher: ["/console/:path*"]',
    ):
        if required not in proxy_source:
            raise AssertionError(f"Admin proxy protection is missing: {required}")
    next_config = (ROOT / "next.config.ts").read_text(encoding="utf-8")
    for required in ('source: "/admin/:path*"', 'destination: "/console/:path*"', "permanent: true"):
        if required not in next_config:
            raise AssertionError(f"Console route migration is missing: {required}")
    invitation_actions = (ROOT / "lib/actions/invitations.ts").read_text(encoding="utf-8")
    for required in (
        '"use server"',
        "auth.api.getSession",
        "issueInvitation",
        "provisionInvitedUser",
        "invitationFormSchema.safeParse",
    ):
        if required not in invitation_actions:
            raise AssertionError(f"Invitation Server Action contract is missing: {required}")
    invitation_panel = (ROOT / "app/console/invitations/panel.tsx").read_text(encoding="utf-8")
    for required in ("useForm", "zodResolver", "createInvitationAction", "FieldError"):
        if required not in invitation_panel:
            raise AssertionError(f"Invitation form contract is missing: {required}")
    if 'fetch("/api/invitations"' in invitation_panel:
        raise AssertionError("Invitation UI must use a Server Action instead of an internal API route")

    migrations = sorted((ROOT / "drizzle").glob("*.sql"))
    if not migrations:
        raise AssertionError("At least one Drizzle SQL migration is required")
    migration = "\n".join(path.read_text(encoding="utf-8") for path in migrations)
    required_tables = {
        "user", "session", "account", "verification", "invitation",
        "aggregate_record", "approval", "evidence", "workflow_event", "audit_event", "passkey",
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
    for required in (
        'CREATE TABLE "social_inbound_delivery"',
        'CREATE UNIQUE INDEX "social_inbound_delivery_external_uidx"',
        '"channel_ref","account_ref","message_id"',
    ):
        if required not in migration:
            raise AssertionError(f"Database migration is missing durable inbound delivery control: {required}")
    inbound_store = (ROOT / "lib/social/inbound-delivery-store.ts").read_text(encoding="utf-8")
    for required in ("onConflictDoNothing", "socialInboundDelivery.messageId", "ignore_duplicate"):
        if required not in inbound_store:
            raise AssertionError(f"Inbound delivery store is missing atomic deduplication behavior: {required}")


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


def check_next_security_release_readiness() -> None:
    package = load_json(ROOT / "package.json")
    next_version = package["dependencies"].get("next")
    playwright_version = package["devDependencies"].get("@next/playwright")
    if not isinstance(next_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", next_version):
        raise AssertionError("Next.js must use an exact semantic version")
    if next_version != playwright_version:
        raise AssertionError("next and @next/playwright must be upgraded to the same exact version")
    lockfile = (ROOT / "pnpm-lock.yaml").read_text(encoding="utf-8")
    next_lock = re.search(
        r"^      next:\n        specifier: ([^\n]+)\n        version: ([^\n]+)$",
        lockfile,
        re.MULTILINE,
    )
    playwright_lock = re.search(
        r"^      '@next/playwright':\n        specifier: ([^\n]+)\n        version: ([^\n]+)$",
        lockfile,
        re.MULTILINE,
    )
    if not next_lock or not playwright_lock:
        raise AssertionError("pnpm lockfile is missing Next.js importer entries")
    if next_lock.group(1) != next_version or not next_lock.group(2).startswith(next_version):
        raise AssertionError("pnpm lockfile Next.js version does not match package.json")
    if playwright_lock.group(1) != next_version or not playwright_lock.group(2).startswith(next_version):
        raise AssertionError("pnpm lockfile @next/playwright version does not match package.json")


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


def check_product_catalog_preflight() -> None:
    result = subprocess.run(
        ["pnpm", "test:catalog-preflight"], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode:
        raise AssertionError(f"Product catalog preflight tests failed: {result.stderr or result.stdout}")


def check_local_ocr() -> None:
    result = subprocess.run(["pnpm", "test:local-ocr"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Local OCR guard tests failed: {result.stderr or result.stdout}")


def check_social_inbound_policy() -> None:
    result = subprocess.run(["pnpm", "test:social-inbound"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Social inbound policy tests failed: {result.stderr or result.stdout}")


def check_inbound_delivery_receipts() -> None:
    result = subprocess.run(["pnpm", "test:inbound-delivery"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Inbound delivery receipt tests failed: {result.stderr or result.stdout}")


def check_database_driver() -> None:
    result = subprocess.run(["pnpm", "test:database-driver"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Database transaction driver tests failed: {result.stderr or result.stdout}")


def check_github_governance() -> None:
    result = subprocess.run(["pnpm", "test:github-governance"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"GitHub governance artifact tests failed: {result.stderr or result.stdout}")


def check_main_push_guard() -> None:
    result = subprocess.run(["pnpm", "test:main-push-guard"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Local main push guard tests failed: {result.stderr or result.stdout}")


def check_content_publication_policy() -> None:
    result = subprocess.run(["pnpm", "test:content-publication"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Content publication policy tests failed: {result.stderr or result.stdout}")


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

def check_content_gate() -> None:
    result = subprocess.run(["pnpm", "test:content-gate"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"Content Gate 01 tests failed: {result.stderr or result.stdout}")

def check_content_policy() -> None:
    policy = load_json(ROOT / "config/content-policy.json")
    if {item["id"] for item in policy["types"]} != {"product", "factory_capability", "industry_knowledge"}:
        raise AssertionError("Content policy must include three content types")
    if any(not item["cta"] or not item["english_structure"] for item in policy["types"]):
        raise AssertionError("Every content type requires English structure and CTA")
    forbidden = {"spline_count", "spline_geometry", "bolt_hole_pattern", "dimensions", "friction_material", "part_count"}
    if set(policy["visual_prohibitions"]) != forbidden:
        raise AssertionError("Visual policy must prohibit engineering-fact alteration")


def check_repository_hygiene() -> None:
    forbidden = {".DS_Store", ".env", ".env.local", "id_rsa"}
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()
    bad = [path for path in tracked if Path(path).name in forbidden]
    if bad:
        raise AssertionError(f"Forbidden files are tracked: {bad}")
    browser_state_names = {
        "auth.json", "cookie.json", "cookies.json", "storage-state.json", "storageState.json",
    }
    browser_state_prefixes = ("storage-state", "storageState", "session-state")
    browser_state_directories = {".agent-browser", ".auth", ".browser-profiles", "browser-profiles"}
    browser_state = [
        path for path in tracked
        if (
            Path(path).suffix == ".har"
            or Path(path).name in browser_state_names
            or Path(path).name.startswith(browser_state_prefixes)
            or browser_state_directories.intersection(Path(path).parts)
        )
    ]
    if browser_state:
        raise AssertionError(f"Browser session artifacts must not be tracked: {browser_state}")
    allowed_reference_pdfs = {"docs/reference/目录总表.pdf"}
    tracked_pdfs = {path for path in tracked if Path(path).suffix.lower() == ".pdf"}
    unexpected_pdfs = sorted(tracked_pdfs - allowed_reference_pdfs)
    if unexpected_pdfs:
        raise AssertionError(
            "Raw or unapproved catalog PDFs must not be tracked; use controlled local storage or Private Blob: "
            f"{unexpected_pdfs}"
        )
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
        ("MVP acceptance summary", check_mvp_acceptance_summary),
        ("product pilot authorization", check_product_pilot_authorization),
        ("product catalog intake", check_product_catalog_intake),
        ("channel onboarding", check_channel_onboarding),
        ("database baseline", check_database_baseline),
        ("service adapters", check_service_adapters),
        ("Next.js security release readiness", check_next_security_release_readiness),
        ("workflow orchestrator", check_workflow_orchestrator),
        ("synthetic end-to-end demo", check_synthetic_demo),
        ("product catalog preflight", check_product_catalog_preflight),
        ("local OCR guards", check_local_ocr),
        ("social inbound policy", check_social_inbound_policy),
        ("inbound delivery receipts", check_inbound_delivery_receipts),
        ("database transaction driver", check_database_driver),
        ("GitHub governance artifacts", check_github_governance),
        ("local main push guard", check_main_push_guard),
        ("content publication policy", check_content_publication_policy),
        ("quotation Gate 02", check_quotation_gate),
        ("delivery Gate 03", check_delivery_gate),
        ("RFQ completeness", check_rfq_completeness),
        ("RFQ acceptance matrix", check_rfq_acceptance_matrix),
        ("sales clarification", check_sales_clarification),
        ("lead scoring", check_lead_scoring),
        ("follow-up scenarios", check_follow_up_scenarios),
        ("follow-up cadence", check_follow_up_cadence),
        ("content Gate 01", check_content_gate),
        ("content safety policy", check_content_policy),
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
