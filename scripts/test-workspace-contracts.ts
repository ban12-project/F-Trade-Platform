import assert from "node:assert/strict";

import { createWorkspaceProjectSchema, workspaceCanvasDocumentSchema } from "../lib/workspace/contracts";

assert.equal(createWorkspaceProjectSchema.parse({ kind: "marketing", title: "Synthetic marketing project" }).kind, "marketing");
assert.throws(() => createWorkspaceProjectSchema.parse({ kind: "invalid", title: "x" }));

const document = {
  version: 1,
  nodes: [
    { id: "product", kind: "product", label: "Product", locked: true, position: { x: 0, y: 0 } },
    { id: "review", kind: "approval", label: "Review", locked: true, position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "product-review", source: "product", target: "review", kind: "requires_review" }],
};
assert.equal(workspaceCanvasDocumentSchema.parse(document).nodes.length, 2);
assert.throws(() => workspaceCanvasDocumentSchema.parse({ ...document, nodes: [...document.nodes, { ...document.nodes[0], position: { x: 1, y: 1 } }] }), /不能重复/);
assert.throws(() => workspaceCanvasDocumentSchema.parse({ ...document, edges: [{ id: "broken", source: "product", target: "missing", kind: "depends_on" }] }), /现有节点/);
assert.throws(() => workspaceCanvasDocumentSchema.parse({ ...document, nodes: [{ ...document.nodes[0], aggregateId: "00000000-0000-4000-8000-000000000001" }, document.nodes[1]] }), /同时包含/);

console.log("PASS workspace project canvas contracts");
