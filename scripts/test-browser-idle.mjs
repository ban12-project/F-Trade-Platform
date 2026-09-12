import assert from "node:assert/strict";
import test from "node:test";
import { createIdleExitPolicy } from "../ops/browser-node/idle.mjs";

test("VPS mode never exits just because the queue is empty", () => {
  const policy = createIdleExitPolicy({});
  assert.equal(policy.observe(true, 0), false);
  assert.equal(policy.observe(true, 3600000), false);
});
test("on-demand mode requires consecutive confirmed empty claims", () => {
  const policy = createIdleExitPolicy({ BROWSER_NODE_ON_DEMAND: "1" });
  assert.equal(policy.observe(true, 0), false);
  assert.equal(policy.observe(true, 29999), false);
  assert.equal(policy.observe(true, 30000), true);
});
test("a task or ambiguous claim resets the idle interval", () => {
  const policy = createIdleExitPolicy({ BROWSER_NODE_ON_DEMAND: "1" });
  policy.observe(true, 0);
  assert.equal(policy.observe(false, 29999), false);
  assert.equal(policy.observe(true, 60000), false);
  assert.equal(policy.observe(true, 89999), false);
  assert.equal(policy.observe(true, 90000), true);
});
test("invalid deployment settings fail instead of silently staying resident", () => {
  for (const value of ["true", "yes", "2"])
    assert.throws(() => createIdleExitPolicy({ BROWSER_NODE_ON_DEMAND: value }), /invalid/);
  for (const value of ["0", "NaN", "Infinity", "60001", "1.5"])
    assert.throws(
      () => createIdleExitPolicy({ BROWSER_NODE_ON_DEMAND: "1", BROWSER_NODE_IDLE_MS: value }),
      /invalid/,
    );
});

test("actual Agent exits after an empty queue in on-demand mode", { timeout: 30000 }, async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync, spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const http = await import("node:http");
  const https = await import("node:https");
  const { randomUUID } = await import("node:crypto");
  const { createAccessKey } = await import("../lib/browser-fleet/security.ts");
  const dir = await mkdtemp(join(tmpdir(), "ft-idle-"));
  const nodeId = randomUUID();
  const key = createAccessKey(nodeId);
  const operations = [];
  let browserRecoverySeen = false;
  let child, broker, docker;
  try {
    const config = join(dir, "cert.cnf");
    await writeFile(
      config,
      "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n",
      { mode: 0o600 },
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-config",
        config,
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    broker = https.createServer(
      { key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) },
      async (req, res) => {
        assert.equal(req.headers.authorization, `Bearer ${key}`);
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        operations.push(body.operation);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            body.operation === "sync"
              ? { nodeId, gatewayOrigin: "https://browser.example", runs: [] }
              : body.operation === "claim"
                ? { run: null }
                : {},
          ),
        );
      },
    );
    broker.listen(0, "127.0.0.1");
    await once(broker, "listening");
    const socketPath = join(dir, "docker.sock");
    docker = http.createServer((req, res) => {
      if (req.url.startsWith("/containers/json")) {
        const filters = JSON.parse(
          new URL(req.url, "http://docker.invalid").searchParams.get("filters"),
        );
        assert.deepEqual(filters.label, [`io.ftrade.node=${nodeId}`, "io.ftrade.run"]);
        browserRecoverySeen = true;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.startsWith("/images/")
            ? { Id: "sha256:synthetic", Config: { Labels: { "io.ftrade.lease-watchdog": "1" } } }
            : [],
        ),
      );
    });
    docker.listen(socketPath);
    await once(docker, "listening");
    child = spawn(process.execPath, ["ops/browser-node/agent.mjs"], {
      env: {
        PATH: process.env.PATH,
        NODE_EXTRA_CA_CERTS: join(dir, "cert.pem"),
        FTRADE_URL: `https://127.0.0.1:${broker.address().port}`,
        BROWSER_NODE_ACCESS_KEY: key,
        NODE_STATE_DIR: join(dir, "state"),
        DOCKER_SOCKET: socketPath,
        GATEWAY_PORT: "0",
        BROWSER_NODE_ON_DEMAND: "1",
        BROWSER_NODE_IDLE_MS: "1000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const [code] = await once(child, "exit", { signal: AbortSignal.timeout(25000) });
    assert.equal(code, 0, output);
    assert.match(output, /browser_node_ready/);
    assert.equal(
      browserRecoverySeen,
      true,
      "Agent recovery excludes the controller's own container",
    );
    assert.match(output, /browser_node_idle_exit/);
    assert.deepEqual(operations, ["sync", "recover", "claim", "claim"]);
    assert.equal(output.includes(key), false);
  } finally {
    child?.kill("SIGKILL");
    broker?.closeAllConnections();
    docker?.closeAllConnections();
    await Promise.all(
      [broker, docker]
        .filter(Boolean)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
