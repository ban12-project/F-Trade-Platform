#!/usr/bin/env python3
"""Offline acceptance tests. No model invocation or Ready/Gate 01 claim."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


verifier = module("verifier", "evals/harbor/product-agent/verifier.py")
gate = module("gate", "scripts/validate-harbor-product-agent-results.py")
fixtures = json.loads(Path(sys.argv.pop(1)).read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


class AcceptanceTests(unittest.TestCase):
    def test_all_current_outputs_pass(self):
        for fixture in fixtures:
            with self.subTest(task=fixture["expected"]["id"]):
                self.assertEqual(verifier.grade(**fixture)["reward"], 1)

    def test_unsafe_mutations_fail(self):
        changes = {
            "whole_document_evidence": lambda d: d["field_evidence"].update({"product.product_name": "synthetic_factory_a_01"}),
            "wrong_field_location": lambda d: d["field_evidence"].update({"product.product_name": d["field_evidence"]["product.internal_sku"]}),
            "unknown_location": lambda d: d["field_evidence"].update({"product.product_name": "evidence-loc-invented"}),
            "missing_evidence": lambda d: d["field_evidence"].pop("product.product_name"),
            "extra_evidence": lambda d: d["evidence_refs"].append("unknown"),
            "duplicate_evidence": lambda d: d["evidence_refs"].append(d["evidence_refs"][0]),
            "invented_oe": lambda d: d["product"].update(oe_numbers=["SYN-INVENTED"]),
            "lost_oe": lambda d: d["product"].pop("oe_numbers"),
            "invented_vehicle": lambda d: d["product"].update(vehicle_model="all vehicles"),
            "invented_spline": lambda d: d["specifications"].update(spline_count=9),
            "missing_fact": lambda d: d["product"].pop("product_name"),
            "verified": lambda d: d.update(verification_status="verified"),
            "approval": lambda d: d.update(approval_ref="synthetic-auto-approval"),
            "candidate_metadata": lambda d: d.update(candidate_identifier="SYN-A-01"),
            "wrong_record": lambda d: d.update(record_id="other-record"),
            "wrong_source": lambda d: d.update(source_ref="other-source"),
            "wrong_blockers": lambda d: d.update(blocking_missing_fields=["made-up"]),
        }
        for name, change in changes.items():
            fixture = copy.deepcopy(fixtures[0])
            change(fixture["result"]["draft"])
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                verifier.grade(**fixture)
        for key in ("prompt_hash", "prompt_version", "evidence_mode"):
            fixture = copy.deepcopy(fixtures[0])
            fixture["result"]["_evaluation"][key] = "stale"
            with self.subTest(provenance=key), self.assertRaises(AssertionError):
                verifier.grade(**fixture)
        for fixture in fixtures:
            if fixture["expected"]["cohort"] in "CD":
                bad = copy.deepcopy(fixture)
                bad["result"]["draft"]["blocking_missing_fields"] = []
                with self.subTest(missing_blocker=fixture["expected"]["id"]), self.assertRaises(AssertionError):
                    verifier.grade(**bad)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name) / "current"
        self.manifest = {"harbor_version": "0.23.0", "repetitions": 3, "tasks": []}
        write(self.job / "result.json", {"finished_at": "2026-09-17T00:00:00Z"})
        for fixture in fixtures:
            expected = fixture["expected"]
            self.manifest["tasks"].append({key: expected[key] for key in ("id", "prompt_version", "prompt_hash", "expectation_hash")})
            for attempt in range(3):
                directory = self.job / f'{expected["id"]}-{attempt}'
                write(directory / "result.json", {
                    "id": f'{expected["id"]}-{attempt}',
                    "task_name": f'f-trade/product-agent-{expected["id"]}',
                    "finished_at": "2026-09-17T00:00:00Z",
                    "exception_info": None,
                    "agent_info": {"name": gate.AGENT, "version": "1.1.0", "model_info": {"provider": "openai", "name": "synthetic"}},
                    "verifier_result": {"rewards": {"reward": 1.0}},
                })
                write(directory / "artifacts/logs/artifacts/product-agent-evaluation.json", {
                    "synthetic_id": expected["id"], "reward": 1.0,
                    "prompt_version": expected["prompt_version"], "prompt_hash": expected["prompt_hash"],
                    "expectation_hash": expected["expectation_hash"], "evidence_mode": "bounded_location",
                    "private_provider_detail": "must-not-escape",
                })

    def check_gate(self):
        return gate.validate(self.job, self.manifest, "openai/synthetic")

    def test_one_complete_job_passes_without_history(self):
        write(self.job.parent / "historical" / "bad" / "result.json", {"private": "must-not-escape"})
        summary, errors = self.check_gate()
        self.assertEqual(errors, [])
        self.assertEqual(summary["passed_trial_count"], 60)
        self.assertNotIn("must-not-escape", json.dumps(summary))

    def test_trial_failures_cannot_be_rescued_by_reward(self):
        path = self.job / "a-01-0/result.json"
        original = json.loads(path.read_text())
        for update in ({"exception_info": {"exception_message": "must-not-escape"}}, {"finished_at": None},
                       {"task_name": "other"}, {"id": "a-01-1"}, {"agent_info": {}},
                       {"verifier_result": {"rewards": {"reward": True}}},
                       {"verifier_result": {"rewards": {"reward": 0}}}):
            write(path, {**original, **update})
            with self.subTest(update=update):
                summary, errors = self.check_gate()
                self.assertTrue(errors)
                self.assertEqual(summary["status"], "failed")
                self.assertNotIn("must-not-escape", json.dumps(summary))

    def test_missing_malformed_and_unknown_trials_fail(self):
        path = self.job / "a-01-0/result.json"
        original = path.read_text()
        path.unlink()
        self.assertTrue(self.check_gate()[1])
        path.write_text("not json")
        self.assertTrue(self.check_gate()[1])
        path.write_text(original)
        artifact = self.job / "a-01-0/artifacts/logs/artifacts/product-agent-evaluation.json"
        data = json.loads(artifact.read_text())
        for key in ("synthetic_id", "prompt_hash", "expectation_hash", "evidence_mode"):
            write(artifact, {**data, key: "must-not-escape"})
            self.assertTrue(self.check_gate()[1])
            self.assertNotIn("must-not-escape", json.dumps(self.check_gate()[0]))

    def test_incomplete_job_and_wrong_model_fail(self):
        write(self.job / "result.json", {"finished_at": None})
        self.assertTrue(self.check_gate()[1])
        self.assertTrue(gate.validate(self.job, self.manifest, "anthropic/wrong")[1])


if __name__ == "__main__":
    unittest.main()
