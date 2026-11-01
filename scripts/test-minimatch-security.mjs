import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function dependency(chain) {
  let require = createRequire(import.meta.url);
  let entry;
  for (const name of chain) {
    entry = require.resolve(name);
    require = createRequire(entry);
  }
  return entry;
}
const entries = {
  10: dependency(["shadcn/mcp", "ts-morph", "@ts-morph/common", "minimatch"]),
  9: dependency(["workflow", "@workflow/nest", "@swc/cli", "minimatch"]),
};
const cases = [
  ["src/a.ts", "src/**/*.ts", {}, true],
  ["src/a.js", "src/**/*.ts", {}, false],
  ["src/nested/a.ts", "src/**/*.ts", {}, true],
  ["src/.hidden.ts", "src/**/*.ts", {}, false],
  ["src/.hidden.ts", "src/**/*.ts", { dot: true }, true],
  ["src/a.ts", "src/*.{ts,tsx}", {}, true],
  ["src/a.tsx", "src/*.{ts,tsx}", {}, true],
  ["src/a.js", "src/*.{ts,tsx}", {}, false],
  ["file1.ts", "file[0-9].ts", {}, true],
  ["filea.ts", "file[0-9].ts", {}, false],
  ["index.ts", "@(index|main).ts", {}, true],
  ["other.ts", "@(index|main).ts", {}, false],
  ["foo.js", "!*.ts", {}, true],
  ["foo.ts", "!*.ts", {}, false],
  ["!foo.ts", "!*.ts", { nonegate: true }, true],
  ["src/A.TS", "src/*.ts", { nocase: true }, true],
  ["src/a.ts", "*.ts", { matchBase: true }, true],
  ["C:/src/a.ts", "c:/src/*.ts", { platform: "win32", nocase: true }, true],
  ["a/{b,c}", "a/{b,c}", { nobrace: true }, true],
  ["src", "src/**/a.ts", { partial: true }, true],
];

for (const [version, commonjs] of Object.entries(entries)) {
  const esm = resolve(dirname(commonjs), "../esm/index.js");
  for (const [format, entry] of Object.entries({ commonjs, esm })) {
    const api = await import(pathToFileURL(entry));
    test(`minimatch ${version} ${format}: frozen file-selection behavior`, () => {
      for (const optimizationLevel of [0, 1, 2]) {
        for (const [file, pattern, options, expected] of cases) {
          assert.equal(
            api.minimatch(file, pattern, { ...options, optimizationLevel }),
            expected,
            JSON.stringify({ file, pattern, options, optimizationLevel }),
          );
        }
      }
      assert.deepEqual(api.match(["a.ts", "b.js", "nested/c.ts"], "**/*.ts"), [
        "a.ts",
        "nested/c.ts",
      ]);
    });
    test(`minimatch ${version} ${format}: expansion and pairwise work stay bounded`, () => {
      const matcher = new api.Minimatch("safe", { optimizationLevel: 2 });
      // A full expansion budget must not grow further. Every entry is distinct.
      const parts = Array.from({ length: 100_000 }, () => ["safe"]);
      parts[parts.length - 1] = ["**", "..", "a", "b"];
      assert.equal(matcher.firstPhasePreProcess(parts).length, 100_000);
      const large = Array.from({ length: 1001 }, (_, i) => [String(i)]);
      matcher.partsMatch = () => {
        throw new Error("quadratic comparison ran above the limit");
      };
      assert.equal(matcher.secondPhasePreProcess(large), large);
    });
    if (version === "10") {
      test(`minimatch 10 ${format}: adversarial compile honors its existing expansion option`, () => {
        const child = spawnSync(
          process.execPath,
          [
            "--max-old-space-size=128",
            "--input-type=module",
            "-e",
            `
          import assert from 'node:assert/strict';
          const { Minimatch } = await import(${JSON.stringify(pathToFileURL(entry).href)});
          const pattern = Array(30).fill('**/../a/b').join('/');
          assert.equal(new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 }).set.length, 64);
        `,
          ],
          { encoding: "utf8", timeout: 3000, maxBuffer: 4096 },
        );
        assert.equal(child.error, undefined, child.error?.message);
        assert.equal(child.status, 0, child.stderr);
      });
    }
  }
}

test("installed ts-morph source filtering retains inclusion and exclusion", () => {
  const require = createRequire(import.meta.url);
  const { Project } = require(dependency(["shadcn/mcp", "ts-morph"]));
  const project = new Project({ useInMemoryFileSystem: true });
  for (const name of ["a.ts", "a.test.ts", "nested/b.ts", "other.js"])
    project.createSourceFile(`/src/${name}`, "export const synthetic = true;");
  assert.deepEqual(
    project
      .getSourceFiles(["/src/**/*.ts", "!/src/**/*.test.ts"])
      .map((file) => file.getFilePath())
      .sort(),
    ["/src/a.ts", "/src/nested/b.ts"],
  );
});

test("installed SWC source collector preserves glob inclusion", async () => {
  const require = createRequire(import.meta.url);
  const cli = dependency(["workflow", "@workflow/nest", "@swc/cli"]);
  const { globSources } = require(join(dirname(cli), "sources.js"));
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-glob-"));
  try {
    for (const name of ["a.ts", "b.js", "c.tsx"])
      await writeFile(join(directory, name), "export const synthetic = true;");
    assert.deepEqual(
      (
        await globSources(
          ["a.ts", "b.js", "c.tsx"].map((name) => join(directory, name)),
          ["**/*.{ts,tsx}"],
          [],
        )
      ).sort(),
      [join(directory, "a.ts"), join(directory, "c.tsx")].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
