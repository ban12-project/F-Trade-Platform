import assert from "node:assert/strict";

import { createWorkspaceProjectSchema, createWorkspaceTemplate, normalizeLegacyWorkspaceTemplate, workspaceCanvasDocumentSchema } from "../lib/workspace/contracts";

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
const legacyAggregateDocument = workspaceCanvasDocumentSchema.parse({ ...document, nodes: [{ ...document.nodes[0], aggregateId: "00000000-0000-4000-8000-000000000001", aggregateType: "product" }, document.nodes[1]] });
assert.equal("aggregateId" in legacyAggregateDocument.nodes[0]!, false);
assert.equal("aggregateType" in legacyAggregateDocument.nodes[0]!, false);

const marketing = createWorkspaceTemplate("marketing");
assert.deepEqual(marketing.nodes.map((node) => node.kind), ["product", "content", "video"]);
assert.deepEqual(marketing.nodes.map((node) => node.label), ["产品资料", "营销内容", "营销视频"]);
assert.equal(marketing.nodes.some((node) => node.kind === "approval"), false);

const sales = createWorkspaceTemplate("sales");
assert.deepEqual(sales.nodes.map((node) => node.kind), ["rfq", "product", "quotation"]);
assert.deepEqual(sales.nodes.map((node) => node.label), ["客户询盘", "产品引用", "报价交接"]);
assert.equal(sales.nodes.some((node) => node.kind === "approval"), false);

const legacyMarketing = workspaceCanvasDocumentSchema.parse({ version: 1, nodes: [
  { id: "product", kind: "product", label: "产品资料", locked: true, position: { x: 12, y: 24 } },
  { id: "approval", kind: "approval", label: "人工事实审核", locked: true, position: { x: 260, y: 140 } },
  { id: "content", kind: "content", label: "营销内容", locked: true, position: { x: 520, y: 40 } },
  { id: "video", kind: "video", label: "营销视频", locked: true, position: { x: 780, y: 140 } },
], edges: [] });
const normalized = normalizeLegacyWorkspaceTemplate("marketing", legacyMarketing);
assert.deepEqual(normalized.nodes.map((node) => node.kind), ["product", "content", "video"]);
assert.deepEqual(normalized.nodes[0]?.position, { x: 12, y: 24 });

const customized = workspaceCanvasDocumentSchema.parse({ ...legacyMarketing, nodes: [...legacyMarketing.nodes, { id: "note", kind: "note", label: "说明", locked: false, position: { x: 900, y: 100 } }] });
assert.equal(normalizeLegacyWorkspaceTemplate("marketing", customized), customized);

console.log("PASS workspace project canvas contracts");
