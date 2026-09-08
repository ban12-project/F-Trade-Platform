/** Real migrated PostgreSQL + the actual production broker, including owner,
 * session, key and lease checks. The no-lock copy is an isolated fault injection,
 * not a runtime option. Barrier forces an adverse interleaving, not its frequency.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { POST as interactiveEndpoint } from "../app/api/social-worker/facebook/interactive/route";
import {
  handleBrowserNodeRequest,
  listBrowserNodes,
  ownerBrowserCommand,
} from "../lib/browser-fleet/store";
import { closeDatabase } from "../lib/db/client";
import * as facebookSchema from "../lib/db/facebook-runtime-schema";
import * as schema from "../lib/db/schema";
import {
  handleFacebookInteractiveEvent,
  openFacebookInteractive,
  readFacebookAccountStatus,
  saveFacebookCredentials,
} from "../lib/social/facebook-account-store";
import { signInteractiveEvent } from "../lib/social/facebook-interactive-protocol";
import { submitFacebookMediaPublication } from "../lib/social/facebook-media-store";

type ClaimResult = {
  run: null | { id: string; leaseId: string; accountId: string };
  serverNow: number;
};
async function main() {
  const output = resolve(process.env.REVIEW_OUTPUT_DIR ?? "artifacts/browser-fleet-review");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const connectionString = process.env.BROWSER_FLEET_TEST_DATABASE_URL;
  assert.ok(connectionString, "Dedicated local test database required");
  const address = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(address.hostname));
  assert.equal(address.pathname, "/browser_fleet_test", "Never run this against production");
  process.env.DATABASE_URL = connectionString;
  process.env.DATABASE_TRANSPORT = "postgres";
  process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID = "synthetic";
  process.env.FACEBOOK_CREDENTIAL_KEYS_JSON = JSON.stringify({
    synthetic: Buffer.alloc(32, 3).toString("base64"),
  });
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  await mkdir(join(root, "tmp"), { recursive: true });
  const temp = await mkdtemp(join(root, "tmp/ftrade-pg-ablation-"));
  const credentials = {
    loginUsername: "",
    loginPassword: "",
    proxyHost: "synthetic-proxy.example.invalid",
    proxyPort: "3128",
    proxyUsername: "",
    proxyPassword: "",
    clearLogin: false,
    clearProxy: false,
  };
  const checks: string[] = [];
  const actor = { id: randomUUID(), sessionId: randomUUID() };
  const outsider = { id: randomUUID(), sessionId: randomUUID() };
  const cases: Array<Record<string, unknown>> = [];

  async function fixture() {
    const created = await ownerBrowserCommand(
      {
        operation: "create",
        value: {
          name: "Synthetic review node",
          gatewayOrigin: "https://synthetic-browser.example.invalid",
          maxBrowsers: 2,
          memoryBudgetMb: 4096,
          browserMemoryMb: 2048,
        },
      },
      actor,
    );
    assert.ok(created.nodeId && created.accessKey);
    const key = created.accessKey;
    const identity = { installationId: randomUUID(), bootId: randomUUID() };
    for (let i = 0; i < 8; i++) {
      await ownerBrowserCommand(
        {
          operation: "grant",
          value: {
            nodeId: created.nodeId,
            channelRef: "synthetic-facebook",
            accountRef: randomUUID(),
            expectedEgressIp: "203.0.113.10",
            pollSeconds: 0,
            credentials,
          },
        },
        actor,
      );
    }
    const node = (await listBrowserNodes(actor.id)).find((n) => n.id === created.nodeId);
    assert.ok(node);
    for (const account of node.accounts) {
      await ownerBrowserCommand(
        { operation: "open", nodeId: created.nodeId, accountId: account.id },
        actor,
      );
    }
    await handleBrowserNodeRequest(key, { ...identity, operation: "sync" });
    await handleBrowserNodeRequest(key, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive"],
    });
    return { key, nodeId: created.nodeId, identity, accounts: node.accounts };
  }

  try {
    // Apply the complete repository history, not just the two broker tables.
    await migrate(db, { migrationsFolder: join(root, "drizzle") });
    for (const table of Object.values(facebookSchema)) {
      const config = getTableConfig(table);
      const actual = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [config.name],
      );
      assert.deepEqual(
        actual.rows.map((r) => r.column_name).sort(),
        config.columns.map((c) => c.name).sort(),
        config.name,
      );
    }
    checks.push("all four legacy Facebook tables match ORM columns after full migrations");
    for (const person of [actor, outsider]) {
      await db.insert(schema.user).values({
        id: person.id,
        name: "Synthetic reviewer",
        email: `${person.id}@example.invalid`,
        role: "admin",
      });
      await db.insert(schema.session).values({
        id: person.sessionId,
        token: randomUUID(),
        userId: person.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    }
    const normal = await fixture();
    assert.deepEqual(await listBrowserNodes(outsider.id), []);
    await assert.rejects(
      ownerBrowserCommand(
        { operation: "open", nodeId: normal.nodeId, accountId: normal.accounts[0].id },
        outsider,
      ),
      /forbidden/,
    );
    await assert.rejects(
      handleBrowserNodeRequest(normal.key, {
        ...normal.identity,
        installationId: randomUUID(),
        operation: "sync",
      }),
      /already_installed/,
    );
    checks.push("another admin and another installation cannot acquire the node");
    const request = {
      ...normal.identity,
      operation: "claim",
      requestId: randomUUID(),
      localSlots: 8,
      availableMemoryMb: 16_384,
    };
    const claimed = (await handleBrowserNodeRequest(normal.key, request)) as ClaimResult;
    assert.ok(claimed.run);
    const replay = (await handleBrowserNodeRequest(normal.key, request)) as ClaimResult;
    assert.equal(replay.run?.id, claimed.run.id);
    assert.equal(replay.run?.leaseId, claimed.run.leaseId);
    const ready = await handleBrowserNodeRequest(normal.key, {
      ...normal.identity,
      operation: "heartbeat",
      runId: claimed.run.id,
      leaseId: claimed.run.leaseId,
      ready: true,
    });
    assert.equal((ready as { active?: boolean }).active, true);
    const ticket = await ownerBrowserCommand(
      { operation: "ticket", nodeId: normal.nodeId, runId: claimed.run.id },
      actor,
    );
    assert.ok(ticket.connection);
    await handleBrowserNodeRequest(normal.key, {
      ...normal.identity,
      operation: "admit",
      ticket: ticket.connection.token,
    });
    await assert.rejects(
      handleBrowserNodeRequest(normal.key, {
        ...normal.identity,
        operation: "admit",
        ticket: ticket.connection.token,
      }),
      /ticket_invalid/,
    );
    checks.push("real broker retries reuse one lease and interactive tickets consume once");
    await ownerBrowserCommand(
      {
        operation: "account",
        nodeId: normal.nodeId,
        accountId: claimed.run.accountId,
        enabled: false,
      },
      actor,
    );
    const revoked = await handleBrowserNodeRequest(normal.key, {
      ...normal.identity,
      operation: "heartbeat",
      runId: claimed.run.id,
      leaseId: claimed.run.leaseId,
      ready: true,
    });
    assert.equal((revoked as { active?: boolean }).active, false);
    checks.push("account revocation fences real broker heartbeats");

    // Use the actual store with just FOR UPDATE removed, forcing all eight SELECTs
    // to finish before any UPDATE. Each trial gets an independent authorized node.
    const original = await readFile(join(root, "lib/browser-fleet/store.ts"), "utf8");
    assert.equal(original.split("WHERE id = ${id} FOR UPDATE").length, 2);
    const withoutLock = original
      .replace("WHERE id = ${id} FOR UPDATE", "WHERE id = ${id}")
      .replace(
        "type NodeRow = {",
        `let arrived = 0;
let release!: () => void;
const barrier = new Promise<void>((resolve) => { release = resolve; });
const barrierTimeout = setTimeout(() => release(), 5000);
barrierTimeout.unref();
type NodeRow = {`,
      )
      .replace(
        "  const row = result.rows[0] as NodeRow | undefined;",
        "  if (++arrived === 8) release();\n  await barrier;\n  const row = result.rows[0] as NodeRow | undefined;",
      )
      .replace(
        /from "\.\/([^"]+)"/g,
        (_match, name: string) => `from "${join(root, `lib/browser-fleet/${name}.ts`)}"`,
      );
    for (let repetition = 1; repetition <= 3; repetition++) {
      for (const locking of [true, false]) {
        const f = await fixture();
        const file = join(temp, `no-lock-${repetition}.ts`);
        if (!locking) await writeFile(file, withoutLock);
        const handler: typeof handleBrowserNodeRequest = locking
          ? handleBrowserNodeRequest
          : (await import(pathToFileURL(file).href)).handleBrowserNodeRequest;
        const replies = await Promise.all(
          Array.from({ length: 8 }, () =>
            handler(f.key, {
              ...f.identity,
              operation: "claim",
              requestId: randomUUID(),
              localSlots: 8,
              availableMemoryMb: 16_384,
            }),
          ),
        );
        const runs = replies
          .map((r) => (r as ClaimResult).run)
          .filter((r): r is NonNullable<ClaimResult["run"]> => !!r);
        assert.equal(runs.length, locking ? 2 : 8);
        const uniqueJobs = new Set(runs.map((r) => r.id)).size;
        assert.equal(uniqueJobs, locking ? 2 : 1);
        const stored = (await listBrowserNodes(actor.id)).find((n) => n.id === f.nodeId);
        assert.ok(stored);
        cases.push({
          repetition,
          variant: locking ? "full" : "without_row_lock",
          simultaneousRequests: 8,
          configuredSlots: 2,
          issuedLeases: runs.length,
          uniqueJobs,
          duplicateJobDeliveries: runs.length - uniqueJobs,
          persistedStartingRuns: stored.runs.filter((r) => r.status === "starting").length,
        });
      }
    }
    // Legacy migration and disable switch are exercised through actual stores.
    process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = actor.id;
    process.env.SOCIAL_WORKER_ID = "synthetic-worker";
    process.env.SOCIAL_WORKER_ACCOUNT_REF = "synthetic-legacy-account";
    process.env.SOCIAL_WORKER_CHANNEL_REF = "synthetic-legacy-channel";
    process.env.FACEBOOK_INTERACTIVE_SIGNING_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.SOCIAL_APP_ORIGIN = "https://synthetic-platform.example.invalid";
    process.env.FACEBOOK_INTERACTIVE_ORIGIN = "https://synthetic-browser.example.invalid";
    await db.insert(schema.socialChannelControl).values({
      id: randomUUID(),
      channelRef: "synthetic-legacy-channel",
      accountRef: "synthetic-legacy-account",
      enabled: true,
      circuitStatus: "active",
      changedBy: actor.id,
      changedAt: new Date(),
    });
    await saveFacebookCredentials(
      {
        ...credentials,
        loginUsername: "synthetic-login",
        loginPassword: "synthetic-password-not-real",
      },
      actor.id,
    );
    const status = await readFacebookAccountStatus();
    assert.equal(status.loginSaved, true);
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "0";
    const disabled = await interactiveEndpoint(
      new Request(
        "https://synthetic-platform.example.invalid/api/social-worker/facebook/interactive",
        {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    assert.equal(disabled.status, 503);
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
    const interactive = await openFacebookInteractive(
      { useSavedLogin: true },
      actor.id,
      actor.sessionId,
    );
    await handleFacebookInteractiveEvent({
      operation: "claim",
      id: interactive.id,
      requestId: randomUUID(),
      at: Date.now(),
    });
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "0";
    const event = signInteractiveEvent(
      { operation: "login", id: interactive.id, requestId: randomUUID(), at: Date.now() },
      process.env.FACEBOOK_INTERACTIVE_SIGNING_KEY,
    );
    const loginRequest = () =>
      new Request(
        "https://synthetic-platform.example.invalid/api/social-worker/facebook/interactive",
        {
          method: "POST",
          body: JSON.stringify(event),
          headers: { "Content-Type": "application/json" },
        },
      );
    const denied = await interactiveEndpoint(loginRequest());
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), { active: false });
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
    const allowed = await interactiveEndpoint(loginRequest());
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).credential.username, "synthetic-login");
    await assert.rejects(submitFacebookMediaPublication({}, outsider.id), /account_owner_required/);
    checks.push(
      "legacy encrypted credential store works after migration; disable switch and owner check deny access",
    );
    await mkdir(output, { recursive: true });
    const report = {
      testedRevision: process.env.REVIEW_REVISION ?? "working-tree",
      nodeVersion: process.version,
      postgresVersion: (await pool.query("SHOW server_version")).rows[0].server_version,
      method:
        "Actual production broker; the no-lock copy changes FOR UPDATE only plus a forced-read-overlap barrier. Not a production failure rate.",
      checks,
      cases,
    };
    await writeFile(join(output, "postgres-ablation.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(
      "PASS: full migrations, actual broker authorization, legacy controls, and forced-concurrency ablation",
    );
  } finally {
    await closeDatabase();
    await pool.end();
    await rm(temp, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
