import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const workflowRequire = createRequire(require.resolve("workflow/api"));
const nextRequire = createRequire(workflowRequire.resolve("@workflow/next"));
const { BaseBuilder } = await import(pathToFileURL(nextRequire.resolve("@workflow/builders")));
const runtime = await import(pathToFileURL(workflowRequire.resolve("@workflow/core/runtime")));
const { createWorld } = await import(
  pathToFileURL(workflowRequire.resolve("@workflow/world-local"))
);
const { getQueueTopicPrefix, resolveQueueNamespace } = await import(
  pathToFileURL(workflowRequire.resolve("@workflow/world"))
);

// Compile all four application workflow files unchanged, alongside synthetic steps.
// This uses the same v5 compiler and combined entrypoint as the Next integration,
// in a temporary project, without touching .next or production world data.
class FixtureBuilder extends BaseBuilder {
  async build() {
    return this.createCombinedBundle({
      inputFiles: await this.getInputFiles(),
      tsconfigPath: join(this.config.workingDir, "tsconfig.json"),
      stepsOutfile: join(this.config.workingDir, "output/steps.mjs"),
      flowOutfile: join(this.config.workingDir, "output/flow.mjs"),
      bundleFinalOutput: false,
    });
  }
}

test("fresh v5 compiled runs: Human Gate, sandbox, catalog and video orchestration", {
  timeout: 90_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-v5-synthetic-"));
  const env = {
    WORKFLOW_TARGET_WORLD: process.env.WORKFLOW_TARGET_WORLD,
    VERCEL_URL: process.env.VERCEL_URL,
  };
  const originalFetch = globalThis.fetch;
  const stateKey = Symbol.for("ftrade.workflow.v5.synthetic");
  const priorState = globalThis[stateKey];
  const synthetic = { calls: [], scenarios: {} };
  globalThis[stateKey] = synthetic;
  let world;
  let requests = 0;
  let active = 0;
  try {
    await mkdir(join(directory, "workflows"));
    await mkdir(join(directory, "output"));
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(
      join(directory, "package.json"),
      '{"name":"synthetic-workflow-v5","private":true,"type":"module"}',
    );
    await copyFile(
      join(root, "workflows/human-gate.ts"),
      join(directory, "workflows/human-gate.ts"),
    );
    await copyFile(
      join(root, "tests/fixtures/workflow-v5/runtime.ts.txt"),
      join(directory, "workflows/runtime.ts"),
    );
    for (const name of [
      "browser-sandbox",
      "product-catalog-import",
      "marketing-video-processing",
    ]) {
      await copyFile(join(root, `workflows/${name}.ts`), join(directory, `workflows/${name}.ts`));
    }
    await copyFile(
      join(root, "tests/fixtures/workflow-v5/adapters.js.txt"),
      join(directory, "adapters.js"),
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          paths: {
            "@/*": ["./adapters.js"],
            "@vercel/blob": ["./adapters.js"],
          },
        },
      }),
    );
    process.env.WORKFLOW_TARGET_WORLD = "local";
    delete process.env.VERCEL_URL;
    const builder = new FixtureBuilder({
      buildTarget: "standalone",
      workingDir: directory,
      dirs: ["workflows"],
    });
    const { manifest } = await builder.build();
    const { POST } = await import(pathToFileURL(join(directory, "output/flow.mjs")));
    globalThis.fetch = async () => {
      requests++;
      throw new Error("SYNTHETIC runtime forbids external HTTP");
    };
    world = await createWorld({
      dataDir: join(directory, "world"),
      baseUrl: "http://127.0.0.1:1",
      recoverActiveRuns: false,
    });
    runtime.setWorld(world);
    world.registerHandler(
      getQueueTopicPrefix("workflow", resolveQueueNamespace()),
      async (request) => {
        active++;
        try {
          return await POST(request);
        } finally {
          active--;
        }
      },
    );
    await world.start();
    function workflow(name) {
      const entries = Object.values(manifest.workflows).flatMap((value) => Object.entries(value));
      const found = entries.find(([key]) => key === name);
      assert.ok(found, `compiled workflow ${name} exists: ${JSON.stringify(manifest.workflows)}`);
      return { workflowId: found[1].workflowId };
    }
    async function poll(check, description) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const result = await check();
        if (result) return result;
        await delay(25);
      }
      assert.fail(`Timed out: ${description}`);
    }
    async function terminal(run, status = "completed") {
      await poll(async () => {
        const current = await run.status;
        if (current === "failed" && status !== "failed")
          assert.fail(`Run failed: ${JSON.stringify(await world.runs.get(run.runId))}`);
        return current === status && active === 0;
      }, `${run.runId} reaches ${status}`);
    }
    const input = {
      approvalId: "synthetic-approval-v5",
      aggregateId: "synthetic-product-v5",
      gate: "gate_01_truth",
    };
    const token = `f-trade:human-gate:${input.approvalId}`;
    const owner = await runtime.start(workflow("waitForHumanGate"), [input]);
    await poll(
      async () =>
        (await world.hooks.list({ runId: owner.runId })).data.length === 1 && active === 0,
      "Human Gate waits",
    );
    assert.equal(await owner.status, "running");
    const hook = await runtime.getHookByToken(token);
    assert.equal(hook.runId, owner.runId);
    assert.deepEqual(await hook.metadata, input);
    const duplicate = await runtime.start(workflow("waitForHumanGate"), [input]);
    await terminal(duplicate);
    assert.deepEqual(await duplicate.returnValue, { status: "duplicate", ownerRunId: owner.runId });
    const decision = {
      status: "approved",
      actorType: "human",
      actorId: "synthetic-reviewer",
      evidenceRef: "synthetic-evidence",
      decidedAt: "2026-11-04T00:00:00.000Z",
    };
    await runtime.resumeHook(token, decision);
    await terminal(owner);
    assert.deepEqual(await owner.returnValue, { status: "decided", decision });
    const gateEvents = (await world.events.list({ runId: owner.runId })).data;
    assert.equal(gateEvents.filter((event) => event.eventType === "hook_created").length, 1);
    assert.equal(gateEvents.filter((event) => event.eventType === "hook_received").length, 1);
    assert.equal(gateEvents.filter((event) => event.eventType === "run_completed").length, 1);
    for (const [suffix, payload, expectedStatus] of [
      ["rejected", { ...decision, status: "rejected" }, "completed"],
      ["invalid-actor", { ...decision, actorType: "agent" }, "failed"],
    ]) {
      const approvalId = `synthetic-approval-v5-${suffix}`;
      const run = await runtime.start(workflow("waitForHumanGate"), [{ ...input, approvalId }]);
      await poll(
        async () =>
          (await world.hooks.list({ runId: run.runId })).data.length === 1 && active === 0,
        `${suffix} gate waits`,
      );
      await runtime.resumeHook(`f-trade:human-gate:${approvalId}`, payload);
      await terminal(run, expectedStatus);
      if (expectedStatus === "completed")
        assert.deepEqual(await run.returnValue, { status: "decided", decision: payload });
      else await assert.rejects(run.returnValue, /require a human actor/);
    }
    const lifecycle = await runtime.start(workflow("syntheticLifecycle"), [40]);
    await terminal(lifecycle);
    const result = await lifecycle.returnValue;
    assert.equal(result.first.value, 41);
    assert.equal(result.last.value, 42);
    assert.notEqual(result.first.stepId, result.last.stepId);
    assert.equal(result.attempt, 2);
    const { data: events } = await world.events.list({ runId: lifecycle.runId });
    const types = events.map((event) => event.eventType);
    assert.equal(types.filter((type) => type === "step_completed").length, 3);
    assert.ok(types.includes("wait_created"));
    assert.ok(types.includes("wait_completed"));
    assert.ok(types.includes("step_retrying"));
    assert.equal(types.filter((type) => type === "run_completed").length, 1);
    const failed = await runtime.start(workflow("syntheticFailure"));
    await terminal(failed, "failed");
    await assert.rejects(failed.returnValue, /synthetic terminal failure/);
    // Real application control graphs, with only external/business adapters replaced.
    const calls = (name) => synthetic.calls.filter((entry) => entry.name === name);
    for (const [id, setup, expectedCalls] of [
      ["synthetic-observe", { status: "stopped" }, ["dispatch", "observe", "wake"]],
      ["synthetic-superseded", { status: "superseded" }, ["dispatch", "observe", "wake"]],
      ["synthetic-recovery", { uncertain: true, status: "stopped" }, ["dispatch", "recover"]],
    ]) {
      synthetic.calls = [];
      synthetic.scenarios[id] = setup;
      const sandboxStartedAt = Date.now();
      const run = await runtime.start(workflow("runManualBrowserSandbox"), ["synthetic-node", id]);
      await poll(async () => {
        const events = (await world.events.list({ runId: run.runId })).data;
        return events.some((event) => event.eventType === "wait_created") && active === 0;
      }, "sandbox durable observation sleep");
      if (id !== "synthetic-observe") {
        const wake = await runtime.wakeUpRun(world, run.runId);
        assert.equal(wake.stoppedCount, 1);
      }
      // The first case resumes naturally after the unchanged production 15s
      // sleep. Only the other cases use the SDK's explicit wake API.
      await terminal(run);
      assert.deepEqual(await run.returnValue, { status: setup.status });
      if (id === "synthetic-observe") {
        assert.ok(Date.now() - sandboxStartedAt >= 15_000, "production sleep must actually elapse");
        const events = (await world.events.list({ runId: run.runId })).data;
        const completedWaits = events.filter((event) => event.eventType === "wait_completed");
        assert.equal(completedWaits.length, 1);
        const observedSteps = events.filter(
          (event) =>
            ["step_created", "step_started"].includes(event.eventType) &&
            /\/\/(observe|wake)$/.test(event.eventData?.stepName ?? ""),
        );
        assert.ok(observedSteps.some((event) => event.eventData.stepName.endsWith("//observe")));
        assert.ok(observedSteps.some((event) => event.eventData.stepName.endsWith("//wake")));
        for (const event of observedSteps) {
          assert.ok(
            new Date(event.createdAt) >= new Date(completedWaits[0].createdAt),
            "wait completes before observe and wake steps",
          );
        }
      }
      assert.deepEqual(
        synthetic.calls.map((call) => call.name),
        expectedCalls,
      );
    }
    synthetic.calls = [];
    const modelWork = (source) => ({
      source,
      modelConfigId: "synthetic-config",
      model: "synthetic-model",
    });
    const original = {
      blobPath: "synthetic-pdf",
      contentType: "application/pdf",
      filename: "synthetic.pdf",
      sizeBytes: 14,
      sha256: "synthetic-sha",
    };
    Object.assign(synthetic.scenarios, {
      "catalog-success": { work: modelWork("synthetic-source") },
      "catalog-model-failure": { work: modelWork("synthetic-model-failure") },
      "catalog-rejected": { work: modelWork("synthetic-rejected") },
      "catalog-access": { accessDenied: true },
      "catalog-parse": { work: { importId: "synthetic-import", original } },
      "catalog-missing": { work: { original: { ...original, blobPath: "synthetic-missing" } } },
    });
    const catalogIds = [
      "catalog-success",
      "catalog-model-failure",
      "catalog-rejected",
      "catalog-access",
      "catalog-parse",
      "catalog-missing",
      "catalog-success",
    ];
    const catalog = await runtime.start(workflow("productCatalogImportWorkflow"), [catalogIds]);
    await terminal(catalog);
    assert.equal(calls("catalog.claim").length, 7);
    assert.equal(
      calls("catalog.candidate").length,
      1,
      "duplicate claim must not regenerate candidate",
    );
    assert.equal(calls("catalog.parsed").length, 1);
    assert.deepEqual(
      calls("catalog.failed")
        .map((call) => call.args)
        .sort(),
      [
        ["catalog-access", "ACCESS_REVOKED"],
        ["catalog-missing", "SOURCE_UNAVAILABLE"],
        ["catalog-model-failure", "MODEL_FAILED"],
        ["catalog-rejected", "MODEL_OUTPUT_REJECTED"],
      ],
    );
    for (const [id, workflowName, setup, expectedFailure] of [
      ["video-ai", "generateMarketingVideoAiDraftWorkflow", { retry: true }, undefined],
      [
        "video-ai-stale",
        "generateMarketingVideoAiDraftWorkflow",
        { requestKey: "synthetic-stale" },
        "AI_DRAFT_STALE",
      ],
      ["video-render", "renderMarketingVideoPreviewWorkflow", {}, undefined],
      [
        "video-expired",
        "renderMarketingVideoPreviewWorkflow",
        { expired: true },
        "RETENTION_EXPIRED",
      ],
      [
        "video-render-failed",
        "renderMarketingVideoPreviewWorkflow",
        { project: { editDraft: { platform: "unsupported", clips: [] } } },
        "RENDER_FAILED",
      ],
    ]) {
      synthetic.calls = [];
      synthetic.scenarios[id] = setup;
      const input = { jobId: id, videoId: id, actorId: "synthetic-actor" };
      const run = await runtime.start(workflow(workflowName), [input]);
      await terminal(run);
      if (expectedFailure) {
        assert.deepEqual(
          calls("video.failed").map((call) => call.args),
          [[id, expectedFailure]],
        );
        assert.equal(calls("video.completed").length, 0);
        if (id === "video-render-failed") assert.equal(calls("video.render-failed").length, 1);
        if (id === "video-expired")
          assert.equal(
            calls("video.render-failed").length,
            0,
            "must not restore an expired project",
          );
      } else {
        assert.deepEqual(
          calls("video.completed").map((call) => call.args),
          [[id]],
        );
        assert.equal(calls("video.failed").length, 0);
        if (id === "video-ai") {
          assert.equal(
            calls("video.running").length,
            2,
            "real step retries the transient adapter failure",
          );
          for (const name of ["video.fact-guard", "video.media-guard", "video.apply"])
            assert.equal(calls(name).length, 1);
        } else {
          assert.equal(calls("video.begin-guard").length, 1);
          assert.deepEqual(calls("video.complete-guard")[0].args, [id, `asset-render-${id}`]);
        }
      }
      synthetic.calls = [];
      const duplicate = await runtime.start(workflow(workflowName), [input]);
      await terminal(duplicate);
      assert.deepEqual(
        synthetic.calls.map((call) => call.name),
        ["video.running"],
        "terminal jobs must skip all side effects",
      );
    }
    assert.equal(requests, 0);
  } finally {
    await world?.close();
    runtime.setWorld(undefined);
    globalThis.fetch = originalFetch;
    if (priorState === undefined) delete globalThis[stateKey];
    else globalThis[stateKey] = priorState;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// Contract test only: v5 may resume a hook owned by a pinned v4 deployment,
// but must not replay that run in the new orchestrator. The historical fixture
// remains immutable, and no old run is loaded into the v5 local world.
test("v5 resume producer routes a frozen v4 hook to its original deployment and spec", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../data/fixtures/workflow-nanoid-replay.synthetic.json", import.meta.url),
      "utf8",
    ),
  );
  const records = Object.entries(fixture.worldFiles);
  const oldRun = JSON.parse(records.find(([path]) => path.startsWith("runs/"))[1].contents);
  const oldHook = JSON.parse(
    records.find(
      ([path]) => path.startsWith("hooks/") && path.includes(fixture.pendingHooks[0].hookId),
    )[1].contents,
  );
  oldRun.deploymentId = "dpl_SYNTHETIC_pinned_v4";
  const writes = [];
  const queues = [];
  const keyLookups = [];
  let runReads = 0;
  runtime.setWorld({
    specVersion: 9,
    hooks: {
      getByToken: async (token) => {
        assert.equal(token, oldHook.token);
        return structuredClone(oldHook);
      },
    },
    runs: {
      get: async (id, options) => {
        assert.equal(id, oldRun.runId);
        assert.deepEqual(options, { resolveData: "none" });
        runReads++;
        return structuredClone(oldRun);
      },
    },
    events: {
      create: async (...args) => {
        writes.push(args);
      },
    },
    getEncryptionKeyForRun: async (...args) => {
      keyLookups.push(args);
      return undefined;
    },
    queue: async (...args) => {
      assert.equal(writes.length, 1, "persist hook_received before publishing the wake");
      queues.push(args);
    },
  });
  try {
    const resumed = await runtime.resumeHook(oldHook.token, {
      synthetic: true,
      stage: "first",
      value: 11,
    });
    assert.equal(resumed.runId, oldRun.runId);
    assert.equal(runReads, 1);
    assert.deepEqual(keyLookups, [[oldRun.runId, { deploymentId: oldRun.deploymentId }]]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], oldRun.runId);
    assert.equal(writes[0][1].eventType, "hook_received");
    assert.equal(writes[0][1].correlationId, oldHook.hookId);
    assert.equal(writes[0][1].specVersion, oldRun.specVersion);
    assert.equal(queues.length, 1);
    assert.equal(queues[0][1].runId, oldRun.runId);
    assert.equal(queues[0][1].runSpecVersion, oldRun.specVersion);
    assert.equal(queues[0][2].deploymentId, oldRun.deploymentId);
    assert.equal(queues[0][2].specVersion, oldRun.specVersion);
  } finally {
    runtime.setWorld(undefined);
  }
});
