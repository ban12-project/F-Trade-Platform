import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const drizzleRequire = createRequire(require.resolve("drizzle-kit"));
const loaderRequire = createRequire(drizzleRequire.resolve("@esbuild-kit/esm-loader"));
const corePath = loaderRequire.resolve("@esbuild-kit/core-utils");
const core = require(corePath);
const esbuild = createRequire(corePath)("esbuild");
const shadcnRequire = createRequire(require.resolve("shadcn/mcp"));
const sdk = async (path) =>
  import(pathToFileURL(shadcnRequire.resolve(`@modelcontextprotocol/sdk/${path}`)));
const { auth, fetchToken } = await sdk("client/auth.js");

test("legacy loader retains TypeScript CJS/ESM execution and source maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-loader-"));
  const source =
    "interface Entry { value: number }; const entry: Entry = { value: 21 }; export const answer = entry.value * 2;";
  const esmSource = "export const answer: number = 42;";
  const checkMap = (value, filename, originalSource) => {
    // source-map-support accepts serialized maps and RawSourceMap objects; cache hits use objects.
    const map = typeof value === "string" ? JSON.parse(value) : value;
    assert.equal(map.version, 3);
    assert.ok(map.mappings.length > 0);
    assert.ok(map.sources.some((name) => name.endsWith(filename)));
    assert.ok(map.sourcesContent.includes(originalSource));
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cjs = core.transformSync(source, join(directory, "tooling.cts"), { format: "cjs" });
      const module = { exports: {} };
      runInNewContext(cjs.code, { module, exports: module.exports });
      assert.equal(module.exports.answer, 42);
      checkMap(cjs.map, "tooling.cts", source);
      const esm = await core.transform(esmSource, join(directory, "tooling.mts"), {
        format: "esm",
      });
      const result = await import(
        `data:text/javascript;base64,${Buffer.from(esm.code).toString("base64")}`
      );
      assert.equal(result.answer, 42);
      checkMap(esm.map, "tooling.mts", esmSource);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the exact loader esbuild does not grant foreign-origin reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-esbuild-"));
  const context = await esbuild.context({
    stdin: { contents: 'console.log("SYNTHETIC served output");', resolveDir: directory },
    outfile: join(directory, "output.js"),
    logLevel: "silent",
  });
  try {
    const { port } = await context.serve({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`http://127.0.0.1:${port}/output.js`, {
      headers: { Origin: "https://foreign.synthetic.invalid" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SYNTHETIC served output/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function provider(issuer) {
  return {
    redirectUrl: undefined,
    clientMetadata: { token_endpoint_auth_method: "client_secret_post" },
    clientInformation: () => ({
      client_id: "SYNTHETIC_client",
      client_secret: "SYNTHETIC_secret",
      issuer,
    }),
    prepareTokenRequest: () => new URLSearchParams({ grant_type: "client_credentials" }),
  };
}

function tokenTransport(issuer) {
  const requests = [];
  return {
    requests,
    metadata: {
      issuer,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    },
    fetchFn: async (url, options) => {
      assert.equal(String(url), `${issuer}/token`);
      assert.equal(options.method, "POST");
      requests.push({ url: String(url), body: String(options.body) });
      return new Response(
        JSON.stringify({ access_token: "SYNTHETIC_access", token_type: "Bearer" }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  };
}

function cachedProvider(issuer, transport) {
  const saved = [];
  return {
    saved,
    provider: {
      ...provider(issuer),
      discoveryState: () => ({
        authorizationServerUrl: transport.metadata.issuer,
        authorizationServerMetadata: transport.metadata,
        resourceMetadata: {
          resource: "https://mcp.synthetic.invalid",
          authorization_servers: [transport.metadata.issuer],
        },
      }),
      saveTokens: (tokens) => saved.push(tokens),
    },
  };
}

test("issuer-tagged MCP client credentials never reach a different issuer", async () => {
  const transport = tokenTransport("https://foreign.synthetic.invalid");
  await assert.rejects(
    fetchToken(provider("https://trusted.synthetic.invalid"), transport.metadata.issuer, transport),
  );
  assert.equal(transport.requests.length, 0);
});

test("cached MCP discovery cannot redirect tagged credentials to another issuer", async () => {
  const transport = tokenTransport("https://foreign.synthetic.invalid");
  const cached = cachedProvider("https://trusted.synthetic.invalid", transport);
  await assert.rejects(
    auth(cached.provider, {
      serverUrl: "https://mcp.synthetic.invalid",
      fetchFn: transport.fetchFn,
    }),
  );
  assert.equal(transport.requests.length, 0);
  assert.equal(cached.saved.length, 0);
});

test("matching MCP issuer remains usable and is preserved at the token storage boundary", async () => {
  const transport = tokenTransport("https://trusted.synthetic.invalid");
  const cached = cachedProvider(transport.metadata.issuer, transport);
  const result = await auth(cached.provider, {
    serverUrl: "https://mcp.synthetic.invalid",
    fetchFn: transport.fetchFn,
  });
  assert.equal(result, "AUTHORIZED");
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0].url, transport.metadata.token_endpoint);
  assert.match(transport.requests[0].body, /client_secret=SYNTHETIC_secret/);
  assert.equal(cached.saved.length, 1);
  assert.equal(cached.saved[0].access_token, "SYNTHETIC_access");
  assert.equal(cached.saved[0].issuer, transport.metadata.issuer);
});

test("installed shadcn MCP server retains tool negotiation and a read-only call", async () => {
  const { Client } = await sdk("client/index.js");
  const { InMemoryTransport } = await sdk("inMemory.js");
  const { server } = await import("shadcn/mcp");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ftrade-synthetic-tooling-compatibility", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of [
      "get_project_registries",
      "get_add_command_for_items",
      "get_audit_checklist",
    ]) {
      assert.ok(names.has(name));
    }
    const result = await client.callTool({ name: "get_audit_checklist", arguments: {} });
    assert.notEqual(result.isError, true);
    assert.ok(result.content.some((item) => item.type === "text" && item.text.length > 0));
  } finally {
    await client.close();
    await server.close();
  }
});
