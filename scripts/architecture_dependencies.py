"""Print the repository-local dependency graph resolved by the project TypeScript compiler."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def compiler_graph(explanation: str, tracked: set[str]) -> dict[str, set[str]]:
    graph: dict[str, set[str]] = {}
    target = None
    # --explainFiles groups indented reasons beneath each resolved file.
    source_file = re.compile(r" from file '(.+?)'(?: with packageId .*)?$")
    for line in explanation.splitlines():
        if not line.startswith(" "):
            target = line if line in tracked else None
            if target is not None:
                graph.setdefault(target, set())
        elif target is not None:
            source = source_file.search(line)
            if source and source[1] in tracked:
                graph.setdefault(source[1], set()).add(target)
    return graph


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", help="repository-relative file to inspect")
    args = parser.parse_args()
    files = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    result = subprocess.run(
        ["pnpm", "exec", "tsc", "--noEmit", "--incremental", "false", "--pretty", "false",
         "--locale", "en", "--explainFiles"],
        cwd=ROOT, text=True, stdout=subprocess.PIPE,
    )
    if result.returncode:
        diagnostics = [line for line in result.stdout.splitlines() if "error TS" in line]
        print("\n".join(diagnostics) or "TypeScript did not complete", file=sys.stderr)
        return result.returncode

    graph = compiler_graph(result.stdout, set(filter(None, files)))
    if args.file is None:
        output = {name: sorted(targets) for name, targets in sorted(graph.items())}
    else:
        name = Path(args.file).as_posix()
        if name not in graph:
            parser.error(f"{name} is not a tracked file in the TypeScript project")
        output = {
            "file": name,
            "imports": sorted(graph[name]),
            "imported_by": sorted(source for source, targets in graph.items() if name in targets),
        }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
