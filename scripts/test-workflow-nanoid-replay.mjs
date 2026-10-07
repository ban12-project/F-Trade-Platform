import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const workflowRequire = createRequire(require.resolve("workflow/api"));
const coreRequire = createRequire(workflowRequire.resolve("@workflow/core"));
const runtime = await import(pathToFileURL(workflowRequire.resolve("@workflow/core/runtime")));
const { createLocalWorld } = await import(
  pathToFileURL(workflowRequire.resolve("@workflow/world-local"))
);
const { getQueueTopicPrefix, resolveQueueNamespace } = await import(
  pathToFileURL(workflowRequire.resolve("@workflow/world"))
);
const fixture = JSON.parse(
  await readFile(
    new URL("../data/fixtures/workflow-nanoid-replay.synthetic.json", import.meta.url),
    "utf8",
  ),
);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("actual SDK resumes the frozen old-nanoid run with identical tokens, RNG and ULIDs", {
  timeout: 30_000,
}, async () => {
  assert.match(fixture.classification, /^SYNTHETIC ONLY/);
  assert.equal(fixture.provenance.nanoid, "5.1.6");
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-nanoid-"));
  const originalFetch = globalThis.fetch;
  const originalTarget = process.env.WORKFLOW_TARGET_WORLD;
  const originalVercelUrl = process.env.VERCEL_URL;
  let requests = 0;
  let active = 0;
  let world;
  try {
    // Restore byte-for-byte SDK output; never regenerate old IDs, events or hooks.
    for (const [path, file] of Object.entries(fixture.worldFiles)) {
      assert.match(path, /^(runs|events|hooks)\/[a-zA-Z0-9_./-]+\.json$|^version\.txt$/);
      assert.equal(path.includes(".."), false);
      assert.equal(sha256(file.contents), file.sha256);
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents);
      assert.equal(sha256(await readFile(target)), file.sha256);
    }
    process.env.WORKFLOW_TARGET_WORLD = "local";
    delete process.env.VERCEL_URL;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("SYNTHETIC SDK replay forbids HTTP requests");
    };
    world = createLocalWorld({
      dataDir: directory,
      baseUrl: "http://127.0.0.1:1",
      recoverActiveRuns: false,
    });
    runtime.setWorld(world);
    const handler = runtime.workflowEntrypoint(fixture.workflowCode);
    world.registerHandler(
      getQueueTopicPrefix("workflow", resolveQueueNamespace()),
      async (request) => {
        active++;
        try {
          return await handler(request);
        } finally {
          active--;
        }
      },
    );
    await world.start();
    const run = runtime.getRun(fixture.runId);
    assert.equal(await run.status, "running");
    for (const old of fixture.pendingHooks) {
      const hook = await runtime.getHookByToken(old.token);
      assert.equal(hook.runId, fixture.runId);
      assert.equal(hook.hookId, old.hookId);
      assert.deepEqual(hook.metadata, old.metadata);
    }
    async function poll(predicate, description) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const result = await predicate();
        if (result) return result;
        assert.notEqual(await run.status, "failed", `SDK replay failed: ${description}`);
        await delay(25);
      }
      assert.fail(`SDK replay timed out: ${description}`);
    }
    await runtime.resumeHook(fixture.pendingHooks[0].token, {
      synthetic: true,
      stage: "first",
      value: 11,
    });
    const third = await poll(async () => {
      const { data } = await world.hooks.list({ runId: fixture.runId });
      return active === 0 && data.length === 3
        ? data.find((hook) => !fixture.pendingHooks.some((old) => old.hookId === hook.hookId))
        : undefined;
    }, "third implicit hook");
    assert.equal(third.token, fixture.expectedOutput.tokens[2]);
    const thirdMetadata = await runtime.getHookByToken(third.token);
    assert.deepEqual(thirdMetadata.metadata, {
      synthetic: true,
      stage: "third",
      continued: fixture.expectedOutput.continued,
      laterUlid: fixture.expectedOutput.laterUlid,
    });
    await runtime.resumeHook(fixture.pendingHooks[1].token, {
      synthetic: true,
      stage: "second",
      value: 22,
    });
    await runtime.resumeHook(third.token, { synthetic: true, stage: "third", value: 33 });
    await poll(async () => (await run.status) === "completed" && active === 0, "completion");
    assert.deepEqual(await run.returnValue, fixture.expectedOutput);
    const { data: events } = await world.events.list({ runId: fixture.runId });
    assert.equal(events.filter((event) => event.eventType === "hook_created").length, 3);
    assert.equal(events.filter((event) => event.eventType === "hook_received").length, 3);
    assert.equal(events.filter((event) => event.eventType === "run_completed").length, 1);
    assert.equal(
      events.some((event) => event.eventType === "run_failed"),
      false,
    );
    for (const [path, file] of Object.entries(fixture.worldFiles)) {
      if (path.startsWith("events/"))
        assert.equal(sha256(await readFile(join(directory, path))), file.sha256);
    }
    assert.equal(requests, 0);
  } finally {
    await world?.close();
    runtime.setWorld(undefined);
    globalThis.fetch = originalFetch;
    if (originalTarget === undefined) delete process.env.WORKFLOW_TARGET_WORLD;
    else process.env.WORKFLOW_TARGET_WORLD = originalTarget;
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("patched nanoid retains overflow recovery and bounded non-secure negative sizes", {
  timeout: 10_000,
}, () => {
  // A separate process bounds a regression to the published infinite-loop case.
  const secure = pathToFileURL(coreRequire.resolve("nanoid")).href;
  const nonSecure = pathToFileURL(coreRequire.resolve("nanoid/non-secure")).href;
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from 'node:assert/strict';
    import {nanoid,random} from ${JSON.stringify(secure)};
    import {nanoid as nonSecure,customAlphabet} from ${JSON.stringify(nonSecure)};
    nanoid();
    for(const size of [-1, -2147483648, 2147483648]) {
      assert.throws(()=>nanoid(size),RangeError);
      assert.equal(nonSecure(size),'');
      assert.equal(customAlphabet('abc',size)(),'');
      assert.equal(customAlphabet('abc',21)(size),'');
    }
    assert.throws(()=>random(4096), {name:'QuotaExceededError'});
    const ids=Array.from({length:8},()=>nanoid());
    for(const id of ids) { assert.match(id,/^[A-Za-z0-9_-]{21}$/); assert.notEqual(id,'u'.repeat(21)); }
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(random(32).length,32);
    assert.equal(nonSecure().length,21);
    assert.equal(customAlphabet('abc',9)().length,9);
    console.log('SYNTHETIC security regressions passed');
  `,
    ],
    { timeout: 5_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.match(result, /security regressions passed/);
});
