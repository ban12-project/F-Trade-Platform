#!/usr/bin/env python3
"""Keep versioned GitHub governance artifacts from silently regressing."""

from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
GITHUB = ROOT / ".github"


expected_templates = {"bug.yml", "decision.yml", "feature.yml", "risk.yml", "task.yml"}
actual_templates = {path.name for path in (GITHUB / "ISSUE_TEMPLATE").glob("*.yml") if path.name != "config.yml"}
assert actual_templates == expected_templates, "Issue template set changed unexpectedly"

config = yaml.safe_load((GITHUB / "ISSUE_TEMPLATE" / "config.yml").read_text(encoding="utf-8"))
assert config["blank_issues_enabled"] is False
assert any("security/advisories/new" in item["url"] for item in config["contact_links"])

pr_template = (GITHUB / "PULL_REQUEST_TEMPLATE.md").read_text(encoding="utf-8")
for required in ("Closes #", "Gate 01", "Gate 02", "Gate 03", "真实客户"):
    assert required in pr_template, f"PR template is missing governance prompt: {required}"

repo_configurer = (ROOT / "scripts" / "github" / "configure_repo.py").read_text(encoding="utf-8")
assert "branches/main/protection" not in repo_configurer, "M0 configuration must not require paid branch protection"
assert "allow_squash_merge=true" in repo_configurer, "M0 configuration must retain squash merge"
assert "delete_branch_on_merge=true" in repo_configurer, "M0 configuration must retain branch cleanup"

milestones = json.loads((GITHUB / "bootstrap" / "milestones.json").read_text(encoding="utf-8"))
assert [item["title"] for item in milestones] == [f"M{index} {name}" for index, name in enumerate([
    "基线与治理", "产品数据闭环", "内容发布闭环", "询盘报价闭环", "跟单商机闭环", "集成 Demo 验收",
])]

labels = json.loads((GITHUB / "bootstrap" / "labels.json").read_text(encoding="utf-8"))
label_names = {item["name"] for item in labels}
for required in ("type:risk", "type:decision", "status:blocked", "gate:01-truth", "gate:02-quote", "gate:03-delivery"):
    assert required in label_names, f"Bootstrap labels are missing: {required}"

print("PASS GitHub governance artifacts")
