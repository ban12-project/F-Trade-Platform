import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const cli = createRequire(require.resolve("@remotion/cli"));
const server = createRequire(cli.resolve("@remotion/studio-server"));
const cjsPath = server.resolve("@remotion/studio-protocol");
const implementations = [
  ["CJS", require(cjsPath)],
  ["ESM", await import(pathToFileURL(join(dirname(cjsPath), "esm/index.mjs")))],
];
const input = {
  dependencies: [],
  dimensions: null,
  displayName: "Synthetic",
  durationInFrames: 30,
  slug: "synthetic-element",
  sourceCode: "export const SyntheticElement = () => null;",
};

for (const [format, library] of implementations) {
  const api = library.StudioProtocolInternals;
  const payload = library.createElementPayload(input);
  const drag = api.makeDragData({ type: "element", ...input });
  for (const entry of ["payload", "drag"]) {
    test(`${format} ${entry}: oversized dependency list is rejected before any element read`, () => {
      let reads = 0;
      const counted = (values) =>
        new Proxy(values, {
          get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver);
          },
        });
      const oversized = {
        ...payload,
        element: { ...payload.element, dependencies: Array(101).fill(0) },
      };
      const raw = JSON.stringify(oversized);
      const originalParse = JSON.parse;
      let result;
      try {
        // Instrument only synchronous parser execution, restoring the global before assertions.
        // This observes the real shipped module without replacing its validator.
        JSON.parse = (...args) => {
          const value = originalParse(...args);
          if (Array.isArray(value?.element?.dependencies))
            value.element.dependencies = counted(value.element.dependencies);
          return value;
        };
        result =
          entry === "payload"
            ? api.parseStudioElementPayload({
                ...oversized,
                element: {
                  ...oversized.element,
                  dependencies: counted(oversized.element.dependencies),
                },
              })
            : api.parseDragData({ mimeType: drag.mimeType, payload: raw });
      } finally {
        JSON.parse = originalParse;
      }
      assert.equal(result, null);
      assert.equal(
        reads,
        0,
        "embedded parser/serialization must not walk an already-oversized list",
      );
    });
  }
  test(`${format}: valid 0/100 dependencies, malformed input and existing validation are preserved`, () => {
    for (const size of [0, 100]) {
      const dependencies = Array.from({ length: size }, (_, i) => ({
        name: `synthetic-package-${i}`,
        version: "1.0.0",
      }));
      const valid = library.createElementPayload({ ...input, dependencies });
      assert.deepEqual(api.parseStudioElementPayload(valid), valid);
      const validDrag = api.makeDragData({ type: "element", ...input, dependencies });
      assert.equal(api.parseDragData(validDrag).data.element.dependencies.length, size);
    }
    assert.equal(api.parseStudioElementPayload(null), null);
    assert.equal(api.parseDragData({ mimeType: drag.mimeType, payload: "{" }), null);
    assert.equal(
      api.parseStudioElementPayload({
        ...payload,
        element: { ...payload.element, dependencies: [{ name: "react", version: "1.0.0" }] },
      }),
      null,
    );
    assert.equal(
      api.parseStudioElementPayload({
        ...payload,
        element: { ...payload.element, dependencies: "invalid" },
      }),
      null,
    );
  });
}
