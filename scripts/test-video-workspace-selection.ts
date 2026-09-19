import assert from "node:assert/strict";
import { resolveVideoSelection as resolve } from "../lib/video/workspace-selection";
import { workspaceCreateHref, workspaceRecordHref } from "../lib/workspace/navigation";

const a = "00000000-0000-4000-8000-000000000401",
  b = "00000000-0000-4000-8000-000000000402",
  product = "00000000-0000-4000-8000-000000000301";
assert.deepEqual(resolve({}, [a, b], [product]), { mode: "collection" });
assert.deepEqual(resolve({ new: "1" }, [a, b], [product]), { mode: "create" });
assert.deepEqual(resolve({ item: b }, [a, b], [product]), { mode: "record", id: b });
assert.deepEqual(resolve({ product }, [a, b], [product]), { mode: "create", productId: product });
for (const query of [
  { item: "" },
  { item: "oops" },
  { item: [a, b] },
  { item: a, new: "1" },
  { item: a, product },
  { new: "" },
  { new: "true" },
  { product: "nope" },
])
  assert.equal(resolve(query, [a, b], [product]).mode, "unavailable");
assert.equal(resolve({ item: b }, [a], [product]).mode, "unavailable");
assert.equal(resolve({ product }, [a], []).mode, "unavailable");
console.log("Synthetic video selection: explicit new/source/record and no fallback passed.");

assert.equal(workspaceCreateHref(a, "video"), `/workspace/${a}/video?new=1`);
assert.equal(
  workspaceCreateHref(a, "video", { kind: "product", id: product }),
  `/workspace/${a}/video?new=1&product=${product}`,
);
assert.equal(workspaceRecordHref(a, "video", b), `/workspace/${a}/video?item=${b}`);
