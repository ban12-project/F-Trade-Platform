"""Check the dependency report against the installed compiler, including .mts entry points."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from architecture_dependencies import ROOT, compiler_graph


class CompilerGraphTests(unittest.TestCase):
    def test_resolved_repository_edges(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            sources = {
                "app.mts": 'import type { Name } from "@/types.mts";\n'
                           'import "./untracked.mts";\n'
                           'export const load = (name: Name) => import("./lazy file.mts");\n',
                "types.mts": "export type Name = string;",
                "lazy file.mts": "export const value = 1;",
                "untracked.mts": "export {};",
                "isolated.mts": "export {};",
            }
            for name, content in sources.items():
                (fixture / name).write_text(content, encoding="utf-8")
            (fixture / "tsconfig.json").write_text(json.dumps({"compilerOptions": {
                "module": "nodenext", "noEmit": True, "allowImportingTsExtensions": True,
                "types": [], "paths": {"@/*": ["./*"]},
            }}), encoding="utf-8")
            output = subprocess.check_output(
                [str(ROOT / "node_modules/.bin/tsc"), "--locale", "en", "--explainFiles"],
                cwd=fixture, text=True,
            )
            graph = compiler_graph(output, set(sources) - {"untracked.mts"})
            self.assertEqual(graph, {
                "app.mts": {"types.mts", "lazy file.mts"}, "types.mts": set(),
                "lazy file.mts": set(), "isolated.mts": set(),
            })


if __name__ == "__main__":
    unittest.main()
