#!/usr/bin/env python3
"""Idempotently create repository labels, milestones and seed issues via gh."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / ".github" / "bootstrap"


def run_gh(args: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(
        ["gh", *args],
        cwd=ROOT,
        input=input_text,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"gh {' '.join(args)} failed: {detail}")
    return result.stdout.strip()


def load(name: str):
    with (BOOTSTRAP / name).open(encoding="utf-8") as stream:
        return json.load(stream)


def main() -> int:
    repo_info = json.loads(run_gh(["repo", "view", "--json", "nameWithOwner,isPrivate,hasIssuesEnabled"]))
    repo = repo_info["nameWithOwner"]
    if not repo_info["isPrivate"]:
        raise RuntimeError(f"{repo} is not private; refusing to seed internal materials")
    if not repo_info["hasIssuesEnabled"]:
        run_gh(["api", "--method", "PATCH", f"repos/{repo}", "-F", "has_issues=true"])

    for label in load("labels.json"):
        run_gh([
            "label", "create", label["name"], "--repo", repo,
            "--color", label["color"], "--description", label["description"], "--force",
        ])
        print(f"label ready: {label['name']}")

    existing_milestones = json.loads(run_gh([
        "api", f"repos/{repo}/milestones?state=all&per_page=100",
    ]))
    milestone_numbers = {item["title"]: item["number"] for item in existing_milestones}
    for milestone in load("milestones.json"):
        if milestone["title"] not in milestone_numbers:
            created = json.loads(run_gh([
                "api", "--method", "POST", f"repos/{repo}/milestones",
                "-f", f"title={milestone['title']}",
                "-f", f"description={milestone['description']}",
            ]))
            milestone_numbers[milestone["title"]] = created["number"]
            print(f"milestone created: {milestone['title']}")
        else:
            print(f"milestone exists: {milestone['title']}")

    existing_issues = json.loads(run_gh([
        "issue", "list", "--repo", repo, "--state", "all", "--limit", "100",
        "--json", "title,number,url",
    ]))
    existing_titles = {item["title"]: item for item in existing_issues}
    for issue in load("issues.json"):
        if issue["title"] in existing_titles:
            print(f"issue exists: {issue['title']} ({existing_titles[issue['title']]['url']})")
            continue
        args = [
            "issue", "create", "--repo", repo, "--title", issue["title"],
            "--body", issue["body"], "--milestone", issue["milestone"],
            "--label", ",".join(issue["labels"]),
        ]
        url = run_gh(args)
        print(f"issue created: {url}")

    print(f"Bootstrap complete for {repo}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
