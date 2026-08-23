#!/usr/bin/env python3
"""Apply repository settings and main-branch protection after the first push."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def gh(args: list[str], payload: dict | None = None) -> str:
    result = subprocess.run(
        ["gh", *args],
        cwd=ROOT,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"gh {' '.join(args)} failed: {detail}")
    return result.stdout.strip()


def main() -> int:
    info = json.loads(gh(["repo", "view", "--json", "nameWithOwner,isPrivate,defaultBranchRef"]))
    repo = info["nameWithOwner"]
    branch = (info.get("defaultBranchRef") or {}).get("name", "main")
    if not info["isPrivate"]:
        raise RuntimeError(f"{repo} is not private; refusing to change repository policy")
    if branch != "main":
        raise RuntimeError(f"Expected default branch main, found {branch}")

    gh([
        "api", "--method", "PATCH", f"repos/{repo}",
        "-F", "has_issues=true", "-F", "has_projects=false", "-F", "has_wiki=false",
        "-F", "allow_squash_merge=true", "-F", "allow_merge_commit=false",
        "-F", "allow_rebase_merge=false", "-F", "allow_auto_merge=false",
        "-F", "delete_branch_on_merge=true",
    ])
    protection = {
        "required_status_checks": {"strict": True, "contexts": ["repository-validate"]},
        "enforce_admins": True,
        "required_pull_request_reviews": {
            "dismiss_stale_reviews": False,
            "require_code_owner_reviews": False,
            "required_approving_review_count": 0,
            "require_last_push_approval": False,
        },
        "restrictions": None,
        "required_linear_history": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "block_creations": False,
        "required_conversation_resolution": True,
        "lock_branch": False,
        "allow_fork_syncing": False,
    }
    gh(["api", "--method", "PUT", f"repos/{repo}/branches/main/protection", "--input", "-"], protection)
    print(f"Repository settings and main protection configured for {repo}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
