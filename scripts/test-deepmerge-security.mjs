import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const shadcn = createRequire(require.resolve("shadcn/mcp"));
const entry = shadcn.resolve("deepmerge");
const implementations = {
  installed: shadcn("deepmerge"),
  umd: require(join(dirname(entry), "umd.js")),
};

for (const [name, merge] of Object.entries(implementations)) {
  test(`${name}: untrusted keys cannot alter merged result prototypes`, () => {
    const payload = () => JSON.parse('{"__proto__":{"syntheticAdmin":true},"safe":1}');
    const cases = [
      merge(Object.create(null), payload()),
      merge(payload(), {}),
      merge({ session: null }, { session: payload() }).session,
      merge({ session: 0 }, { session: payload() }).session,
      merge({}, { nested: payload() }).nested,
      merge.all([payload(), { other: 2 }]),
      merge([], [payload()])[0],
    ];
    for (const result of cases) {
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.syntheticAdmin, undefined);
      assert.equal(Object.hasOwn(result, "__proto__"), false);
      assert.equal(result.safe, 1);
    }
    assert.equal({}.syntheticAdmin, undefined);
    assert.equal(merge(Object.create(null), payload(), { clone: false }).syntheticAdmin, undefined);
  });

  test(`${name}: registry-style merges retain arrays, symbols and custom behavior`, () => {
    const marker = Symbol("synthetic");
    const date = new Date("2026-01-01T00:00:00Z");
    const first = { cssVars: { light: { color: "red" } }, files: ["a"], [marker]: "kept", date };
    const second = { cssVars: { light: { background: "white" } }, files: ["b"] };
    const result = merge(first, second);
    assert.deepEqual(result.cssVars.light, { color: "red", background: "white" });
    assert.deepEqual(result.files, ["a", "b"]);
    assert.equal(result[marker], "kept");
    assert.equal(result.date, date);
    assert.notEqual(result.cssVars, first.cssVars);
    assert.deepEqual(first.files, ["a"]);
    assert.deepEqual(merge(first, second, { arrayMerge: (_, source) => source }).files, ["b"]);
    assert.deepEqual(
      merge(
        { cssVars: { a: 1 } },
        { cssVars: { b: 2 } },
        {
          customMerge: (key) => (key === "cssVars" ? (_, source) => source : undefined),
        },
      ).cssVars,
      { b: 2 },
    );
    assert.equal(merge({ constructor: "synthetic" }, {}).constructor, "synthetic");
    assert.equal(merge({ prototype: "synthetic" }, {}).prototype, "synthetic");
  });
}
