import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { containerSpec, dockerClient, stopContainer } from "../ops/browser-node/docker.mjs";
import { createGateway, safeAssetPath } from "../ops/browser-node/gateway.mjs";
import { readPublicationMedia } from "../ops/browser-node/media.mjs";
import {
  createPublicationAuthorizer,
  createPublicationReporter,
} from "../ops/browser-node/publication.mjs";
import { publicationUploadArchive, stagePublicationUpload } from "../ops/browser-node/upload.mjs";

const nodeId = randomUUID();
const accountId = randomUUID();
const run = {
  id: randomUUID(),
  accountId,
  memoryMb: 2048,
  proxy: { host: "proxy.example", port: 3128, username: "u", password: "synthetic" },
};
test("each account gets a stable distinct volume; runs get fresh containers", () => {
  const a = containerSpec(nodeId, run, "sha256:reviewed", Date.now() + 60_000);
  const b = containerSpec(
    nodeId,
    { ...run, id: randomUUID() },
    "sha256:reviewed",
    Date.now() + 60_000,
  );
  const c = containerSpec(
    nodeId,
    { ...run, accountId: randomUUID() },
    "sha256:reviewed",
    Date.now() + 60_000,
  );
  assert.equal(a.volume, b.volume);
  assert.notEqual(a.name, b.name);
  assert.notEqual(a.volume, c.volume);
  assert.notEqual(a.accessKey, b.accessKey);
  assert.notEqual(a.vncPassword, b.vncPassword);
});
test("browser runtime cannot access the host Docker socket or choose a mount", () => {
  const { body } = containerSpec(nodeId, run, "sha256:reviewed", Date.now() + 60_000);
  assert.equal(body.HostConfig.Privileged, undefined);
  assert.deepEqual(body.HostConfig.CapDrop, ["ALL"]);
  assert.equal(body.HostConfig.Mounts.length, 1);
  assert.equal(body.HostConfig.Mounts[0].Type, "volume");
  assert.equal(body.HostConfig.RestartPolicy.Name, "no");
  assert.equal(body.HostConfig.Memory, 2048 * 1024 * 1024);
  assert.equal(JSON.stringify(body).includes("docker.sock"), false);
});
test("all browser ports are loopback only", () => {
  const { body } = containerSpec(nodeId, run, "image", 1234);
  for (const mappings of Object.values(body.HostConfig.PortBindings))
    for (const mapping of mappings) assert.equal(mapping.HostIp, "127.0.0.1");
});
test("missing or malformed proxy fails rather than falling back to direct egress", () => {
  for (const proxy of [
    null,
    { ...run.proxy, host: "http://evil/" },
    { ...run.proxy, port: 0 },
    { ...run.proxy, password: "x\0y" },
  ])
    assert.throws(() => containerSpec(nodeId, { ...run, proxy }, "image", 1234));
});
test("remote payload cannot inject resource names or giant memory allocations", () => {
  assert.throws(() => containerSpec("/../../etc", run, "image", 1234));
  assert.throws(() => containerSpec(nodeId, { ...run, memoryMb: 1e9 }, "image", 1234));
});
test("stopping verifies engine state and never deletes profile volumes", async () => {
  const calls = [];
  let running = true;
  await stopContainer(async (method, path) => {
    calls.push([method, path]);
    if (method === "POST") running = false;
    return { State: { Running: running } };
  }, "runtime-id");
  assert.ok(calls.some(([method, path]) => method === "DELETE" && path.endsWith("?v=false")));
  assert.equal(
    calls.some(([, path]) => path.includes("/volumes/")),
    false,
  );
});
test("unconfirmed stop never releases/removes the container", async () => {
  const calls = [];
  await assert.rejects(
    stopContainer(async (method, path) => {
      calls.push([method, path]);
      return { State: { Running: true } };
    }, "runtime-id"),
  );
  assert.equal(
    calls.some(([method]) => method === "DELETE"),
    false,
  );
});
test("viewer assets reject traversal and non-static endpoints", () => {
  assert.equal(safeAssetPath("/core/rfb.js"), "/core/rfb.js");
  for (const path of [
    "/core/../../etc/passwd.js",
    "/core/%2e%2e/secrets.js",
    "/sessions/foo/storage_state",
    "/websockify",
    "/core/x.js?token=a",
    "/core/%xx.js",
  ])
    assert.throws(() => safeAssetPath(path));
});
test("iframe has exact frame-ancestor policy and unauthorized admission fails", async () => {
  const gateway = createGateway({
    appOrigin: "https://app.example",
    nodeCall: async () => {
      throw new Error("denied");
    },
    slots: new Map(),
    port: 0,
  });
  await once(gateway.server, "listening");
  const port = gateway.server.address().port;
  try {
    const page = await fetch(`http://127.0.0.1:${port}/viewer`);
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors https:\/\/app.example/,
    );
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    await page.text();
    const denied = await fetch(`http://127.0.0.1:${port}/admit`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ ticket: "bad" }),
    });
    assert.equal(denied.status, 403);
    await denied.text();
  } finally {
    gateway.close();
    gateway.server.closeAllConnections();
  }
});

test("publication authorization checks egress before request and reuses one attempt", async () => {
  const events = [];
  const publication = {
    kind: "publish",
    id: randomUUID(),
    leaseId: randomUUID(),
    publicationDigest: "a".repeat(64),
  };
  const authorizationId = randomUUID();
  const authorize = createPublicationAuthorizer({
    run: publication,
    assertActive: () => events.push("active"),
    checkEgress: async () => events.push("egress"),
    request: async (operation, body) => {
      assert.equal(operation, "authorize-publication");
      assert.deepEqual(body, {
        runId: publication.id,
        leaseId: publication.leaseId,
        payloadDigest: publication.publicationDigest,
      });
      events.push("request");
      return {
        serverNow: Date.now(),
        roundTripMs: 10,
        authorization: {
          authorizationId,
          expiresAt: Date.now() + 30000,
          payloadDigest: publication.publicationDigest,
        },
      };
    },
  });
  const [first, second] = await Promise.all([authorize(), authorize()]);
  assert.deepEqual(first, second);
  assert.equal(events.filter((item) => item === "request").length, 1);
  assert.ok(events.indexOf("egress") < events.indexOf("request"));
  assert.ok(first.localExpiresAt < first.expiresAt);
});

test("publication authorization never retries a failed egress check or ambiguous request", async () => {
  for (const failure of ["egress", "request"]) {
    let requests = 0;
    let checks = 0;
    const authorize = createPublicationAuthorizer({
      run: {
        kind: "publish",
        id: randomUUID(),
        leaseId: randomUUID(),
        publicationDigest: "a".repeat(64),
      },
      assertActive() {},
      async checkEgress() {
        checks++;
        if (failure === "egress") throw new Error("egress");
      },
      async request() {
        requests++;
        throw new Error("request");
      },
    });
    await assert.rejects(authorize(), new RegExp(failure));
    await assert.rejects(authorize(), new RegExp(failure));
    assert.equal(checks, 1);
    assert.equal(requests, failure === "egress" ? 0 : 1);
  }
});

test("publication authorization rejects expired responses and revoked local leases", async () => {
  let active = true;
  const authorize = createPublicationAuthorizer({
    run: {
      kind: "publish",
      id: randomUUID(),
      leaseId: randomUUID(),
      publicationDigest: "a".repeat(64),
    },
    assertActive() {
      if (!active) throw new Error("stopped");
    },
    async checkEgress() {},
    async request() {
      return {
        serverNow: Date.now(),
        roundTripMs: 0,
        authorization: {
          authorizationId: randomUUID(),
          expiresAt: Date.now(),
          payloadDigest: "a".repeat(64),
        },
      };
    },
  });
  await assert.rejects(authorize(), /lease_response_expired/);
  active = false;
  const stopped = createPublicationAuthorizer({
    run: { kind: "publish", publicationDigest: "a".repeat(64) },
    assertActive() {
      throw new Error("stopped");
    },
    async checkEgress() {
      assert.fail("must not probe after stop");
    },
    async request() {
      assert.fail("must not request after stop");
    },
  });
  await assert.rejects(stopped(), /stopped/);
});

test("receipt retry preserves the observation and cannot change lease or outcome", async () => {
  const calls = [];
  const assigned = {
    kind: "publish",
    id: randomUUID(),
    leaseId: randomUUID(),
    publicationDigest: "a".repeat(64),
  };
  const report = createPublicationReporter({
    run: assigned,
    async request(operation, body) {
      calls.push({ operation, body });
      if (calls.length === 1) throw new Error("response_lost");
      return { receipt: { outcome: "published", replayed: true } };
    },
  });
  const receipt = {
    authorizationId: randomUUID(),
    outcome: "published",
    externalPublicationRef: "synthetic-post",
    runId: "untrusted-run",
  };
  await assert.rejects(report(receipt), /response_lost/);
  assert.deepEqual(await report(receipt), { outcome: "published", replayed: true });
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].body.runId, assigned.id);
  assert.equal(calls[1].body.leaseId, assigned.leaseId);
  await assert.rejects(
    report({ ...receipt, externalPublicationRef: "conflicting-post" }),
    /publication_receipt_conflict/,
  );
  assert.equal(calls.length, 2);
});

test("media reader releases only manifest-matching bytes and fixes request scope", async () => {
  const bytes = Buffer.from("synthetic-image");
  const media = {
    contentType: "image/png",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const assigned = {
    kind: "publish",
    id: randomUUID(),
    leaseId: randomUUID(),
    publicationDigest: "a".repeat(64),
    publication: { media },
  };
  const result = await readPublicationMedia({
    run: assigned,
    assertActive() {},
    async request(operation, body) {
      assert.equal(operation, "publication-media");
      assert.deepEqual(body, {
        runId: assigned.id,
        leaseId: assigned.leaseId,
        payloadDigest: assigned.publicationDigest,
      });
      return new Response(bytes, {
        headers: { "Content-Type": media.contentType, "Content-Length": String(bytes.length) },
      });
    },
  });
  assert.deepEqual(result.bytes, bytes);
});

test("media reader rejects truncated, oversized, altered and wrong-type bytes", async () => {
  const bytes = Buffer.from("synthetic-image");
  const media = {
    contentType: "image/png",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  for (const [body, type] of [
    [bytes.subarray(1), "image/png"],
    [Buffer.concat([bytes, bytes]), "image/png"],
    [Buffer.alloc(bytes.length), "image/png"],
    [bytes, "text/html"],
  ]) {
    await assert.rejects(
      readPublicationMedia({
        run: { kind: "publish", publicationDigest: "a".repeat(64), publication: { media } },
        assertActive() {},
        async request() {
          return new Response(body, {
            headers: { "Content-Type": type, "Content-Length": String(bytes.length) },
          });
        },
      }),
      /publication_media_/,
    );
  }
});

test("generated upload archive is readable by system tar and contains only the confirmed file", async () => {
  const bytes = Buffer.from("synthetic confirmed image");
  const media = {
    contentType: "image/png",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const upload = publicationUploadArchive({ bytes, media });
  const temporary = await mkdtemp(join(tmpdir(), "ftrade-upload-test-"));
  try {
    const archive = join(temporary, "upload.tar");
    await writeFile(archive, upload.archive);
    const file = upload.path.slice("/tmp/".length);
    assert.equal(
      execFileSync("tar", ["-tf", archive], { encoding: "utf8" }),
      `ftrade-uploads/\n${file}\n`,
    );
    assert.deepEqual(execFileSync("tar", ["-xOf", archive, file]), bytes);
    assert.throws(
      () => publicationUploadArchive({ bytes: Buffer.from("changed"), media }),
      /publication_upload_invalid/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("upload staging verifies container ownership and never accepts task paths", async () => {
  const bytes = Buffer.from("synthetic");
  const media = {
    contentType: "image/png",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const assigned = { kind: "publish", id: randomUUID(), accountId: randomUUID() };
  const assignedNode = randomUUID();
  const containerId = "a".repeat(64);
  const calls = [];
  const docker = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET")
      return {
        State: { Running: true },
        Config: {
          Labels: {
            "io.ftrade.node": assignedNode,
            "io.ftrade.run": assigned.id,
            "io.ftrade.account": assigned.accountId,
          },
        },
      };
    assert.ok(Buffer.isBuffer(body));
  };
  const result = await stagePublicationUpload({
    docker,
    nodeId: assignedNode,
    run: assigned,
    containerId,
    asset: { bytes, media, path: "/etc/passwd" },
    assertActive() {},
  });
  assert.equal(result.path, `/tmp/ftrade-uploads/${media.sha256}.png`);
  assert.equal(
    calls[1].path,
    `/containers/${containerId}/archive?path=%2Ftmp&noOverwriteDirNonDir=1`,
  );
  calls.length = 0;
  await assert.rejects(
    stagePublicationUpload({
      docker,
      nodeId: randomUUID(),
      run: assigned,
      containerId,
      asset: { bytes, media },
      assertActive() {},
    }),
    /publication_container_mismatch/,
  );
  assert.equal(calls.length, 1);
});

test("Docker archive transport sends binary bytes rather than JSON encoding", async () => {
  const directory = await mkdtemp("/tmp/ft-docker-");
  const socket = join(directory, "engine.sock");
  let observed;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      observed = { bytes: Buffer.concat(chunks), type: request.headers["content-type"] };
      response.end("{}");
    });
  });
  try {
    server.listen(socket);
    await once(server, "listening");
    const bytes = Buffer.from([0, 255, 1, 128]);
    await dockerClient(socket)("PUT", "/containers/synthetic/archive?path=%2Ftmp", bytes);
    assert.deepEqual(observed.bytes, bytes);
    assert.equal(observed.type, "application/x-tar");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("inbox reporter binds one lease, checks egress and stops after ambiguous delivery", async () => {
  const { createInboxReporter } = await import("../ops/browser-node/inbox.mjs");
  const { verifyInboxPacket } = await import("../lib/browser-fleet/inbox-protocol.ts");
  const secret = Buffer.alloc(32, 5).toString("base64url");
  const run = { kind: "inbox", id: randomUUID(), leaseId: randomUUID(), inboxSigningKey: secret };
  let egress = 0;
  let calls = 0;
  let fail = false;
  const report = createInboxReporter({
    run,
    assertActive() {},
    async checkEgress() {
      egress++;
    },
    async request(operation, fields) {
      calls++;
      assert.equal(operation, "inbox-messages");
      const packet = verifyInboxPacket(secret, fields.envelope);
      assert.equal(packet.runId, run.id);
      assert.equal(packet.leaseId, run.leaseId);
      if (fail) throw new Error("synthetic_lost_response");
      return { receipt: { accepted: 1, duplicates: 0, replayed: false } };
    },
  });
  const message = {
    conversationRef: "synthetic-conversation",
    messageRef: "synthetic-message",
    direction: "inbound",
    identityQuality: "dom_id",
    body: "SYNTHETIC",
    receivedAt: new Date().toISOString(),
  };
  await report([message], new Date().toISOString());
  fail = true;
  await assert.rejects(report([message], new Date().toISOString()), /synthetic_lost_response/);
  await assert.rejects(report([message], new Date().toISOString()), /inbox_reporter_unavailable/);
  assert.equal(calls, 2);
  assert.equal(egress, 2);
});

test("empty inbox scan requires explicit signed completion and closes the reporter", async () => {
  const { createInboxReporter } = await import("../ops/browser-node/inbox.mjs");
  const { verifyInboxPacket } = await import("../lib/browser-fleet/inbox-protocol.ts");
  const secret = Buffer.alloc(32, 8).toString("base64url");
  const run = { kind: "inbox", id: randomUUID(), leaseId: randomUUID(), inboxSigningKey: secret };
  let calls = 0;
  const reporter = createInboxReporter({
    run,
    assertActive() {},
    async checkEgress() {},
    async request(_, fields) {
      calls++;
      const packet = verifyInboxPacket(secret, fields.envelope);
      assert.equal(packet.completion.messageCount, 0);
      assert.equal(packet.messages.length, 0);
      return { receipt: { accepted: 0, duplicates: 0, replayed: false } };
    },
  });
  const now = new Date().toISOString();
  await assert.rejects(reporter([], now), /inbox_messages_invalid/);
  await reporter([], now, {
    reviewRef: "evidence-synthetic-empty",
    scanStartedAt: now,
    coverage: "visible_inbox",
    conversationCount: 0,
    messageCount: 0,
  });
  await assert.rejects(reporter([], now), /inbox_reporter_unavailable/);
  assert.equal(calls, 1);
});

test("Facebook adapter advertises only explicitly configured inbox accounts", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "synthetic-inbox-profile-"));
  const previousInbox = process.env.FACEBOOK_INBOX_PROFILES_FILE;
  const previousPublishing = process.env.FACEBOOK_DOM_PROFILES_FILE;
  try {
    const selectorKeys = [
      "identity",
      "inboxReady",
      "conversationLink",
      "emptyInbox",
      "threadReady",
      "threadIdentity",
      "message",
      "inbound",
      "outbound",
      "body",
      "time",
      "emptyThread",
      "challenge",
      "loading",
      "moreThreads",
      "moreMessages",
    ];
    const profile = {
      version: 1,
      accountRef: "synthetic-account",
      channelRef: "synthetic-channel",
      reviewRef: "evidence-synthetic-inbox",
      reviewedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      url: "https://www.facebook.com/messages",
      identityHref: "https://www.facebook.com/synthetic-owner",
      selectors: Object.fromEntries(selectorKeys.map((key) => [key, `.${key}`])),
      attributes: { conversationId: "data-thread-id", messageId: "data-message-id" },
    };
    const path = join(directory, "profiles.json");
    await writeFile(path, JSON.stringify([profile]));
    process.env.FACEBOOK_INBOX_PROFILES_FILE = path;
    delete process.env.FACEBOOK_DOM_PROFILES_FILE;
    const adapter = await import(
      `../ops/browser-node/facebook-adapter.mjs?synthetic=${randomUUID()}`
    );
    assert.deepEqual(adapter.capabilities, ["inbox"]);
    assert.deepEqual(adapter.publicationScopes, []);
    assert.deepEqual(adapter.inboxScopes, [
      {
        channelRef: profile.channelRef,
        accountRef: profile.accountRef,
        expiresAt: Date.parse(profile.expiresAt),
      },
    ]);
    assert.equal(
      await adapter.execute({
        run: { kind: "inbox", channelRef: profile.channelRef, accountRef: "different-account" },
      }),
      "failed",
    );
  } finally {
    if (previousInbox === undefined) delete process.env.FACEBOOK_INBOX_PROFILES_FILE;
    else process.env.FACEBOOK_INBOX_PROFILES_FILE = previousInbox;
    if (previousPublishing === undefined) delete process.env.FACEBOOK_DOM_PROFILES_FILE;
    else process.env.FACEBOOK_DOM_PROFILES_FILE = previousPublishing;
    await rm(directory, { recursive: true, force: true });
  }
});
