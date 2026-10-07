import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

// Resolve the actual installed shadcn chain, rather than a direct test-only dependency.
const require = createRequire(import.meta.url);
const shadcnRequire = createRequire(require.resolve("shadcn/mcp"));
const fastGlobPath = shadcnRequire.resolve("fast-glob");
const globRequire = createRequire(fastGlobPath);
const micromatchRequire = createRequire(globRequire.resolve("micromatch"));
const bracesPath = micromatchRequire.resolve("braces");
const braces = micromatchRequire("braces");
const fastGlob = shadcnRequire("fast-glob");
const fixture = JSON.parse(
  await readFile(new URL("../data/fixtures/braces-compatibility.synthetic.json", import.meta.url)),
);
assert.equal(fixture.classification, "SYNTHETIC");

function depthRejected(error) {
  assert.ok(error instanceof RangeError);
  assert.equal(error.code, "BRACES_DEPTH_LIMIT");
  assert.match(error.message, /maximum depth \(128\)/);
  return true;
}

test("locked braces retains frozen unpatched outputs, including 128 nested containers", () => {
  assert.equal(fixture.baseline.version, "3.0.3");
  for (const row of fixture.cases) {
    assert.equal(braces.compile(row.pattern, row.options), row.compiled);
    assert.deepEqual(braces.expand(row.pattern, row.options), row.expanded);
    assert.equal(braces.stringify(row.pattern, row.options), row.stringified);
    assert.deepEqual(braces(row.pattern, row.options), row.defaultResult);
    assert.deepEqual(braces(row.pattern, { ...row.options, expand: true }), row.expandedResult);
  }
});

test("actual shadcn fast-glob matches the frozen synthetic files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-braces-matches-"));
  try {
    for (const path of fixture.fastGlob.files) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), "SYNTHETIC\n");
    }
    for (const row of fixture.fastGlob.cases) {
      assert.deepEqual(fastGlob.sync(row.pattern, { cwd: directory }).sort(), row.matches);
      assert.deepEqual((await fastGlob(row.pattern, { cwd: directory })).sort(), row.matches);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parser rejects the 129th container before balanced or unclosed cleanup", () => {
  const patterns = [
    `${"{".repeat(129)}a,b${"}".repeat(129)}`,
    `${"(".repeat(129)}a${")".repeat(129)}`,
    `${"{(".repeat(64)}{a,b}${")}".repeat(64)}`,
    `${"{".repeat(129)}a}*`,
    `${"(".repeat(129)}a)*`,
  ];
  for (const pattern of patterns) {
    for (const operation of [
      braces,
      braces.create,
      braces.parse,
      braces.compile,
      braces.expand,
      braces.stringify,
    ]) {
      assert.throws(() => operation(pattern), depthRejected);
    }
    // No caller option can disable the fixed depth boundary.
    assert.throws(() => braces.compile(pattern, { maxDepth: Infinity }), depthRejected);
  }
  assert.equal(braces.compile("{x,y}"), "(x|y)");
});

test("quotes, escaping, character limits and expansion range limits keep their meanings", () => {
  const literal = "{".repeat(9_000);
  assert.equal(braces.compile(`"${literal}"`), literal);
  assert.equal(braces.stringify(`[${literal}]`), `[${literal}]`);
  assert.equal(braces.stringify("\\{".repeat(300)), "{".repeat(300));
  assert.equal(braces.compile("a".repeat(10_000)), "a".repeat(10_000));
  assert.throws(() => braces.compile("a".repeat(10_001)), SyntaxError);
  assert.throws(() => braces.parse("{x,y}", { maxLength: 4 }), SyntaxError);
  assert.throws(() => braces.expand("{1..1001}"), /range limit/);
  assert.equal(braces.expand("{1..1001}", { rangeLimit: 1001 }).length, 1001);
  assert.throws(() => braces.parse(null), TypeError);
});

test("AST entry points reject deep and cyclic traversal before recursive work or mutation", () => {
  let deep = { type: "text", value: "SYNTHETIC" };
  for (let index = 0; index < 20_000; index++) deep = { type: "root", nodes: [deep] };
  const cyclic = { type: "root", nodes: [] };
  cyclic.nodes.push(cyclic);
  for (const ast of [deep, cyclic]) {
    for (const operation of [braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => operation(ast), depthRejected);
      assert.equal(ast.queue, undefined);
    }
  }
  assert.equal(braces.compile(braces.parse("{x,y}")), "(x|y)");
  assert.deepEqual(braces.expand(braces.parse("{x,y}")), ["x", "y"]);
  assert.equal(braces.stringify(braces.parse("{x,y}")), "{x,y}");
});

test("under-length adversarial patterns settle in the real glob parent under a hard resource bound", () => {
  const source = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const braces = require(${JSON.stringify(bracesPath)});
    const glob = require(${JSON.stringify(fastGlobPath)});
    const patterns = ['{'.repeat(4000)+'a}*', '{'.repeat(9000)+'a}*', '('.repeat(9000)+'a)*'];
    let rejected = 0;
    const check = error => error instanceof RangeError && error.code === 'BRACES_DEPTH_LIMIT';
    for (const pattern of patterns) {
      assert.ok(pattern.length < 10000);
      for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
        assert.throws(() => operation(pattern), check);
        rejected++;
        assert.equal(braces.compile('{x,y}'), '(x|y)');
      }
      // fast-glob invokes brace expansion for curly patterns; parentheses alone
      // follow its other pattern path and cannot prove this dependency boundary.
      if (pattern.startsWith('{')) {
        for (const operation of [glob.generateTasks, glob.sync]) {
          assert.throws(() => operation(pattern), check);
          rejected++;
        }
        await assert.rejects(async () => glob(pattern), check);
        rejected++;
      }
    }
    console.log(JSON.stringify({ classification: 'SYNTHETIC', rejected, healthy: true }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--max-old-space-size=64", "--input-type=module", "--eval", source],
    { timeout: 5_000, encoding: "utf8", maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.deepEqual(JSON.parse(output), {
    classification: "SYNTHETIC",
    rejected: 18,
    healthy: true,
  });
});
