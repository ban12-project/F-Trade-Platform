import assert from "node:assert/strict";
import {
  updateWorkspaceLibraryFilter,
  workspaceLibraryEmptyState,
  workspaceLibraryFilterOptions,
} from "../lib/workspace/library-filters";
import {
  deriveWorkspaceLibrary,
  matchesWorkspaceLibrarySearch,
} from "../lib/workspace/library-model";
import { parseLibrarySearch } from "../lib/workspace/library-search";
import { libraryIds, librarySnapshot } from "../tests/fixtures/workspace-library";

const before = JSON.stringify(librarySnapshot);
const rows = deriveWorkspaceLibrary(librarySnapshot);
const product = rows.find((row) => row.id === libraryIds.product);
assert.ok(product);
for (const query of [
  "syn-clutch-001",
  "SYNCLUTCH001",
  "synoe1002",
  "ＳＹＮ-ＯＥ-１００１",
  "clutch kit",
  "  SYN-clutch  project  ",
]) {
  assert.equal(matchesWorkspaceLibrarySearch(product, query), true, query);
}
assert.equal(matchesWorkspaceLibrarySearch(product, "bearing"), false);
assert.equal(matchesWorkspaceLibrarySearch(product, ""), true);
assert.equal(matchesWorkspaceLibrarySearch(product, "excluded-source-note"), false);
for (const row of rows.filter(
  (row) => row.collection === "customers" && row.projectId === libraryIds.first,
)) {
  assert.equal(matchesWorkspaceLibrarySearch(row, "alice"), true, row.kind);
  assert.equal(matchesWorkspaceLibrarySearch(row, "example parts"), true, row.kind);
  assert.equal(matchesWorkspaceLibrarySearch(row, "synoe1001"), true, row.kind);
  assert.equal(matchesWorkspaceLibrarySearch(row, "excluded-contact"), false, row.kind);
}
for (const row of rows.filter((row) => row.collection === "content")) {
  assert.equal(matchesWorkspaceLibrarySearch(row, "synclutch001"), true, row.kind);
}
const isolated = deriveWorkspaceLibrary({
  ...librarySnapshot,
  projects: librarySnapshot.projects.filter((project) => project.id === libraryIds.second),
  records: [
    ...librarySnapshot.records,
    {
      ...librarySnapshot.records[2],
      projectId: libraryIds.second,
      payload: { rfq_ref: libraryIds.rfq },
    },
  ],
});
assert.equal(
  isolated.some((row) => matchesWorkspaceLibrarySearch(row, "alice")),
  false,
);
assert.equal(
  isolated.some((row) => row.id === libraryIds.product),
  false,
);
const missing = deriveWorkspaceLibrary({
  ...librarySnapshot,
  records: [
    { ...librarySnapshot.records[0], payload: { product: { oe_numbers: [null, 123, {}] } } },
  ],
})[0];
assert.deepEqual(missing.identifiers, []);
assert.equal(matchesWorkspaceLibrarySearch(missing, "undefined"), false);
assert.equal(JSON.stringify(rows).includes("excluded-"), false);
assert.equal(JSON.stringify(rows).includes("unit_price"), false);
assert.equal(JSON.stringify(librarySnapshot), before);
assert.equal(parseLibrarySearch("  Alice  "), "Alice");
assert.equal(parseLibrarySearch(["Alice"]), "");
assert.equal(parseLibrarySearch("x".repeat(201)), "");
console.log("Workspace library search and safe business projection checks passed.");

const current = new URLSearchParams({
  project: libraryIds.first,
  type: "quotation",
  state: "QUOTE_DRAFT",
  q: "alice",
});
const incompatible = updateWorkspaceLibraryFilter(
  rows,
  "customers",
  current,
  "project",
  libraryIds.second,
);
assert.equal(incompatible.get("project"), libraryIds.second);
assert.equal(incompatible.has("type"), false);
assert.equal(incompatible.has("state"), false);
assert.equal(incompatible.get("q"), "alice");
assert.equal(current.get("type"), "quotation", "Updates do not mutate the active URL");
const compatibleType = updateWorkspaceLibraryFilter(
  rows,
  "customers",
  new URLSearchParams({ project: libraryIds.first, type: "rfq", state: "RFQ_COLLECTING" }),
  "project",
  libraryIds.second,
);
assert.equal(compatibleType.get("type"), "rfq");
assert.equal(compatibleType.has("state"), false);
const compatible = updateWorkspaceLibraryFilter(
  rows,
  "products",
  new URLSearchParams({ type: "product", state: "PRODUCT_READY" }),
  "project",
  libraryIds.first,
);
assert.equal(compatible.get("type"), "product");
assert.equal(compatible.get("state"), "PRODUCT_READY");
const changedType = updateWorkspaceLibraryFilter(rows, "customers", current, "type", "rfq");
assert.equal(changedType.get("type"), "rfq");
assert.equal(changedType.has("state"), false);
assert.equal(updateWorkspaceLibraryFilter(rows, "customers", current, "q", "").has("q"), false);
assert.equal(
  updateWorkspaceLibraryFilter(rows, "customers", current, "q", "new search").get("state"),
  "QUOTE_DRAFT",
);
const broadened = updateWorkspaceLibraryFilter(rows, "customers", current, "project", "");
assert.equal(broadened.get("state"), "QUOTE_DRAFT");
assert.deepEqual(
  workspaceLibraryFilterOptions(
    rows,
    "customers",
    new URLSearchParams({ project: libraryIds.second }),
  ).types,
  ["rfq"],
);
assert.deepEqual(
  workspaceLibraryFilterOptions(
    rows,
    "customers",
    new URLSearchParams({ project: libraryIds.first, type: "quotation" }),
  ).states,
  ["QUOTE_DRAFT"],
);
assert.deepEqual(
  workspaceLibraryFilterOptions(
    rows,
    "customers",
    new URLSearchParams({ project: "inaccessible" }),
  ),
  { types: [], states: [] },
);
assert.equal(workspaceLibraryEmptyState(false, new URLSearchParams()), "empty");
assert.equal(
  workspaceLibraryEmptyState(false, new URLSearchParams({ q: "missing" })),
  "no_matches",
);
assert.equal(
  workspaceLibraryEmptyState(true, new URLSearchParams({ project: "inaccessible" })),
  "unavailable",
);
console.log("Workspace library dependent filter, preservation and empty-state checks passed.");
