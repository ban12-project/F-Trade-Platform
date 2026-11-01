import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { VpsCompute } from "../lib/compute/vps";

async function main() {
  const savedFetch = globalThis.fetch;
  const savedDispatcher = getGlobalDispatcher();
  const savedOrigin = process.env.VPS_RUNTIME_ORIGIN;
  const savedToken = process.env.VPS_RUNTIME_TOKEN;
  let options: RequestInit | undefined;
  process.env.VPS_RUNTIME_ORIGIN = "https://runtime.example.com";
  process.env.VPS_RUNTIME_TOKEN = "a".repeat(64);
  globalThis.fetch = async (_url, init) => {
    options = init;
    return Response.json({ result: { id: "00000000-0000-4000-8000-000000000001" } });
  };
  const shortTransport = new Agent({ headersTimeout: 50 });
  const server = createServer((_request, response) => {
    const timer = setTimeout(() => {
      response.setHeader("Connection", "close");
      response.end('{"result":"synthetic"}');
    }, 1600);
    response.on("close", () => clearTimeout(timer));
  });
  try {
    await VpsCompute.create();
    globalThis.fetch = savedFetch;
    assert.ok(options);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    setGlobalDispatcher(shortTransport);
    await assert.rejects(
      savedFetch(url, { signal: AbortSignal.timeout(5000) }),
      (error: unknown) =>
        error instanceof TypeError &&
        (error.cause as { code?: string })?.code === "UND_ERR_HEADERS_TIMEOUT",
    );
    // Use the actual options produced by VpsCompute, against synthetic localhost.
    // A short global header timeout must not override the compute transport.
    const response = await savedFetch(url, options);
    assert.deepEqual(await response.json(), { result: "synthetic" });
    console.log("PASS compute transport survives a shorter global header deadline");
  } finally {
    globalThis.fetch = savedFetch;
    setGlobalDispatcher(savedDispatcher);
    await shortTransport.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of [
      ["VPS_RUNTIME_ORIGIN", savedOrigin],
      ["VPS_RUNTIME_TOKEN", savedToken],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
