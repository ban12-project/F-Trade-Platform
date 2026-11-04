import assert from "node:assert/strict";
import { readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Serde is a two-symbol interoperability protocol, not a Workflow runtime.
// Exercise the actual importer boundaries without forcing unrelated consumers
// onto a new major. All payloads are synthetic; no SDK network operation is used.
const require = createRequire(import.meta.url);
const workflowRequire = createRequire(require.resolve("workflow/api"));
const corePath = workflowRequire.resolve("@workflow/core/runtime");
const coreRequire = createRequire(corePath);
const load = (path) => import(pathToFileURL(path).href);
// Walk the actual reachable Workflow runtime/build graph, not stale store folders.
const visited = new Set();
async function checkRuntimeGraph(name, importer) {
  let directory;
  let manifest;
  for (const searchPath of importer.resolve.paths(name) ?? []) {
    try {
      const path = await realpath(join(searchPath, name, "package.json"));
      manifest = JSON.parse(await readFile(path, "utf8"));
      directory = dirname(path);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  assert.ok(manifest, `Missing package manifest for ${name}`);
  const key = `${name}@${manifest.version}`;
  if (visited.has(key)) return;
  visited.add(key);
  assert.match(manifest.version, /^5\./, `Mixed Workflow runtime/build graph: ${key}`);
  const parent = createRequire(join(directory, "package.json"));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (dependency.startsWith("@workflow/")) await checkRuntimeGraph(dependency, parent);
  }
}
await checkRuntimeGraph("workflow", require);
const current = await load(coreRequire.resolve("@workflow/serde"));
assert.deepEqual(Object.keys(current).sort(), ["WORKFLOW_DESERIALIZE", "WORKFLOW_SERIALIZE"]);
const { registerSerializationClass } = await load(
  join(dirname(corePath), "class-serialization.js"),
);
const { dehydrateStepReturnValue, hydrateStepReturnValue } = await load(
  join(dirname(corePath), "serialization.js"),
);
const store = new URL("../node_modules/.pnpm/", import.meta.url);
const providers = (await readdir(store)).filter((name) =>
  name.startsWith("@ai-sdk+provider-utils@"),
);
assert.ok(providers.length > 0, "provider-utils importer boundaries must be present");
const boundaries = providers.map((name) =>
  createRequire(new URL(`${name}/node_modules/@ai-sdk/provider-utils/dist/index.js`, store)),
);
boundaries.push(createRequire(require.resolve("@vercel/sandbox")));
for (const boundary of boundaries) {
  const symbols = await load(boundary.resolve("@workflow/serde"));
  assert.deepEqual(Object.keys(symbols).sort(), Object.keys(current).sort());
  for (const name of Object.keys(current)) assert.equal(symbols[name], current[name]);
}
for (const name of providers) {
  const provider = await import(
    new URL(`${name}/node_modules/@ai-sdk/provider-utils/dist/index.js`, store)
  );
  assert.equal(provider.WORKFLOW_SERIALIZE, current.WORKFLOW_SERIALIZE);
  assert.equal(provider.WORKFLOW_DESERIALIZE, current.WORKFLOW_DESERIALIZE);
}

const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error("Synthetic serde test forbids network requests");
};
try {
  const { Sandbox } = await import("@vercel/sandbox");
  const data = {
    routes: [],
    sandboxMetadata: { id: "sbx_SYNTHETIC_serde", name: "SYNTHETIC serde", persistent: false },
    projectId: "prj_SYNTHETIC_serde",
  };
  // Invoke the actual Sandbox beta-serde implementation using v5's symbols.
  const sandbox = Sandbox[current.WORKFLOW_DESERIALIZE](data);
  registerSerializationClass("class//SYNTHETIC-serde//Sandbox", Sandbox);
  const operations = [];
  const wire = await dehydrateStepReturnValue(
    sandbox,
    "wrun_SYNTHETIC_serde",
    undefined,
    operations,
  );
  await Promise.all(operations);
  assert.ok(wire instanceof Uint8Array);
  const restored = await hydrateStepReturnValue(wire, "wrun_SYNTHETIC_serde", undefined);
  assert.ok(restored instanceof Sandbox);
  assert.deepEqual(
    Sandbox[current.WORKFLOW_SERIALIZE](restored),
    Sandbox[current.WORKFLOW_SERIALIZE](sandbox),
  );
  assert.equal(restored.name, data.sandboxMetadata.name);
  assert.equal(requests, 0);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  `Workflow v5 serde ABI and Sandbox serialization passed across ${boundaries.length} importer boundaries (synthetic, no HTTP)`,
);
