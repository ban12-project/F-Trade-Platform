import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import ready from "../data/fixtures/product-ready.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { videoProjectSchema } from "../lib/video/contracts";
import { type MarketingVideoDraft, marketingVideoAiDraftSchema } from "../lib/video/edit-contracts";

const connection = process.env.VIDEO_AI_DRAFT_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
// No provider, private storage or Sandbox request may leave this controlled test.
globalThis.fetch = async () => {
  throw new Error("Remote requests forbidden in synthetic video draft tests");
};

const [owner, editor, viewer, outsider] = Array.from({ length: 4 }, () => randomUUID());
const projectId = randomUUID(),
  productId = randomUUID();
let duringGeneration: (() => Promise<void>) | undefined;
let modelCalls = 0;
const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;
const suggestion = marketingVideoAiDraftSchema.parse({
  clips: [
    {
      shotCandidateId: "shot-001-001",
      durationMs: 3000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "none", text: "", claimRef: "" },
      abcdRoles: ["attention", "branding", "connection", "direction"],
      motionPreset: "cta_hold",
    },
  ],
  ctaText: "Contact our sales team",
});
// Only external execution boundaries are replaced. The actual workflow, candidate
// compiler, product guards, workspace authorization, domain writes and audits run.
mock.module(moduleUrl("../lib/ai/product-agent-model-config.ts"), {
  exports: { resolveProductAgentModelConfig: async () => ({}) },
});
mock.module(moduleUrl("../lib/ai/model-provider.ts"), {
  exports: { createProductAgentModel: () => ({ provider: "synthetic-only" }) },
});
mock.module(moduleUrl("../lib/ai/structured-generator.ts"), {
  exports: {
    AiSdkStructuredGenerator: class {
      async generate() {
        modelCalls++;
        await duringGeneration?.();
        return suggestion;
      }
    },
  },
});
mock.module(moduleUrl("../lib/video/sandbox-sources.ts"), {
  exports: { issueSandboxVideoSources: async () => new Map() },
});
mock.module(moduleUrl("../lib/video/sandbox-media.ts"), {
  exports: {
    extractMarketingVisualSamplesInSandbox: async () => ({
      candidates: [
        {
          id: "shot-001-001",
          assetRef: "evidence-synthetic-ai-version-image",
          mediaType: "image",
          trimStartMs: 0,
          maximumDurationMs: 10000,
        },
      ],
      visualSamples: [],
    }),
    renderMarketingTimelineInSandbox: async () => {
      throw new Error("Rendering forbidden in draft tests");
    },
  },
});
const {
  applyMarketingVideoAiDraft,
  getMarketingVideoEditProject,
  MarketingVideoDraftChangedError,
  updateMarketingVideoEditDraft,
} = await import("../lib/video/store.ts");
const { queueVideoProcessingJob } = await import("../lib/video/processing-jobs.ts");
const { generateMarketingVideoAiDraftWorkflow } = await import(
  "../workflows/marketing-video-processing.ts"
);
const db = getDatabase();
async function createVideo() {
  const id = randomUUID();
  const project = videoProjectSchema.parse({
    id,
    productId,
    status: "draft",
    objective: "MOCK version conflict test",
    targetAudience: "MOCK distributors",
    platforms: ["facebook"],
    factualClaims: [
      {
        field: "product.product_name",
        value: "MOCK video version product",
        evidenceRef: "evidence-synthetic-ai-version-fact",
      },
    ],
    sourceAssets: [
      {
        assetRef: "evidence-synthetic-ai-version-image",
        mediaType: "image",
        rightsEvidenceRef: "evidence-synthetic-ai-version-rights",
      },
    ],
    scenes: [
      {
        sceneId: "scene-synthetic-version",
        prompt: "MOCK",
        durationSeconds: 3,
        claimRefs: [],
        assetRefs: ["evidence-synthetic-ai-version-image"],
      },
    ],
    editDraft: {
      version: 3,
      creativeFramework: "google_abcd",
      platform: "facebook",
      ctaText: "Contact us",
      clips: [
        {
          clipId: "clip-synthetic-version",
          assetRef: "evidence-synthetic-ai-version-image",
          mediaType: "image",
          trimStartMs: 0,
          durationMs: 3000,
          fitMode: "contain",
          audioMode: "muted",
          caption: { kind: "none" },
          abcdRoles: ["attention", "branding", "connection", "direction"],
          motionPreset: "cta_hold",
        },
      ],
    },
  });
  await db.insert(schema.aggregateRecord).values({
    id,
    type: "video",
    state: "VIDEO_DRAFT",
    payload: project,
    createdByType: "human",
    createdById: owner,
  });
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId,
    aggregateId: id,
    role: "marketing_video",
    relation: "owned",
  });
  assert(project.editDraft);
  return { id, draft: project.editDraft };
}
async function record(id: string) {
  return (
    await db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, id))
  )[0];
}
async function job(id: string) {
  return (
    await db.select().from(schema.videoProcessingJob).where(eq(schema.videoProcessingJob.id, id))
  )[0];
}
async function saves(id: string) {
  return db
    .select()
    .from(schema.auditEvent)
    .where(
      and(
        eq(schema.auditEvent.aggregateId, id),
        eq(schema.auditEvent.action, "marketing_video_edit.saved"),
      ),
    );
}

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const id of [owner, editor, viewer, outsider])
    await db
      .insert(schema.user)
      .values({ id, name: "MOCK video draft", email: `${id}@example.invalid`, role: "user" });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "MOCK video draft versions",
    kind: "marketing",
    createdById: owner,
  });
  for (const [userId, role] of [
    [owner, "owner"],
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    await db
      .insert(schema.workspaceProjectMember)
      .values({ id: randomUUID(), projectId, userId, role, createdById: owner });
  await db.insert(schema.aggregateRecord).values({
    id: productId,
    type: "product",
    state: "PRODUCT_READY",
    createdByType: "human",
    createdById: owner,
    payload: {
      ...ready,
      record_id: productId,
      product: { ...ready.product, product_name: "MOCK video version product" },
      evidence_refs: [...ready.evidence_refs, "evidence-synthetic-ai-version-fact"],
      field_evidence: {
        ...ready.field_evidence,
        "product.product_name": "evidence-synthetic-ai-version-fact",
      },
    },
  });
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId,
    aggregateId: productId,
    role: "product_source",
    relation: "owned",
  });

  const normal = await createVideo();
  const normalJob = await queueVideoProcessingJob(normal.id, "ai_draft", editor);
  await generateMarketingVideoAiDraftWorkflow({
    videoId: normal.id,
    jobId: normalJob.job.id,
    actorId: editor,
  });
  assert.equal((await job(normalJob.job.id)).status, "succeeded");
  assert.equal((await record(normal.id)).version, 2);
  assert.equal(
    (await getMarketingVideoEditProject(normal.id)).project.editDraft?.ctaText,
    suggestion.ctaText,
  );
  assert.equal((await saves(normal.id)).length, 1);
  console.log("PASS actual video AI workflow saves an unchanged snapshot");

  const changed = await createVideo();
  let humanDraft: MarketingVideoDraft | undefined;
  duringGeneration = async () => {
    const saved = await updateMarketingVideoEditDraft(
      changed.id,
      {
        ...changed.draft,
        ctaText: "MOCK newer human CTA",
        clips: changed.draft.clips.map((clip) => ({ ...clip, durationMs: 4000 })),
      },
      owner,
    );
    humanDraft = saved.editDraft;
    assert.equal((await record(changed.id)).version, 2);
  };
  const oldJob = await queueVideoProcessingJob(changed.id, "ai_draft", editor);
  await generateMarketingVideoAiDraftWorkflow({
    videoId: changed.id,
    jobId: oldJob.job.id,
    actorId: editor,
  });
  assert.deepEqual(
    (await getMarketingVideoEditProject(changed.id)).project.editDraft,
    humanDraft,
    "Older AI output must preserve the actual newer human save",
  );
  assert.equal((await job(oldJob.job.id)).status, "failed");
  assert.equal((await job(oldJob.job.id)).failureCode, "AI_DRAFT_STALE");
  const staleMessage = (await job(oldJob.job.id)).failureMessage;
  assert(staleMessage);
  assert.match(staleMessage, /已更新.*未保存/);
  assert.equal(
    (await record(changed.id)).version,
    3,
    "Only human save and the terminal failure increment the version",
  );
  assert.equal(
    (await saves(changed.id)).length,
    1,
    "Discarded AI output must not append a save audit",
  );
  duringGeneration = undefined;
  const retry = await queueVideoProcessingJob(changed.id, "ai_draft", editor);
  assert.equal(retry.created, true);
  assert.notEqual(retry.job.id, oldJob.job.id);
  await generateMarketingVideoAiDraftWorkflow({
    videoId: changed.id,
    jobId: retry.job.id,
    actorId: editor,
  });
  assert.equal((await job(retry.job.id)).status, "succeeded");
  assert.equal((await record(changed.id)).version, 4);
  assert.equal((await saves(changed.id)).length, 2);
  console.log(
    "PASS in-flight human CTA and clip edits survive stale AI output; explicit retry succeeds",
  );

  const queued = await createVideo();
  const queuedJob = await queueVideoProcessingJob(queued.id, "ai_draft", editor);
  const queuedHumanSave = await updateMarketingVideoEditDraft(
    queued.id,
    { ...queued.draft, ctaText: "MOCK human save after queue" },
    owner,
  );
  const callsBeforeQueuedJob = modelCalls;
  await generateMarketingVideoAiDraftWorkflow({
    videoId: queued.id,
    jobId: queuedJob.job.id,
    actorId: editor,
  });
  assert.deepEqual(
    (await getMarketingVideoEditProject(queued.id)).project.editDraft,
    queuedHumanSave.editDraft,
  );
  assert.equal((await job(queuedJob.job.id)).status, "failed");
  assert.equal((await job(queuedJob.job.id)).failureCode, "AI_DRAFT_STALE");
  assert.equal(modelCalls, callsBeforeQueuedJob, "A stale queued task must never call the model");
  assert.equal((await record(queued.id)).version, 3);
  assert.equal((await saves(queued.id)).length, 1);
  console.log("PASS human edits after queue invalidate the old request before any model call");

  const concurrent = await createVideo();
  const results = await Promise.allSettled(
    ["MOCK concurrent A", "MOCK concurrent B"].map((ctaText) =>
      applyMarketingVideoAiDraft(concurrent.id, { ...concurrent.draft, ctaText }, editor, 1),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert(
    rejected?.status === "rejected" && rejected.reason instanceof MarketingVideoDraftChangedError,
  );
  assert.equal((await record(concurrent.id)).version, 2);
  assert.equal((await saves(concurrent.id)).length, 1);
  console.log("PASS real concurrent AI writes at one snapshot version commit exactly once");

  const denied = await createVideo();
  const before = await record(denied.id);
  for (const actor of [viewer, outsider])
    await assert.rejects(applyMarketingVideoAiDraft(denied.id, denied.draft, actor, 1), /编辑权限/);
  await db
    .update(schema.workspaceProject)
    .set({ status: "archived" })
    .where(eq(schema.workspaceProject.id, projectId));
  await assert.rejects(applyMarketingVideoAiDraft(denied.id, denied.draft, editor, 1), /已归档/);
  await db
    .update(schema.workspaceProject)
    .set({ status: "active" })
    .where(eq(schema.workspaceProject.id, projectId));
  await assert.rejects(applyMarketingVideoAiDraft(denied.id, denied.draft, editor, 0));
  assert.deepEqual(await record(denied.id), before);
  assert.equal((await saves(denied.id)).length, 0);
  assert.equal(modelCalls, 3);
  console.log(
    "PASS fresh editor authorization, archive barrier and invalid version deny without draft writes or save audits",
  );
  // Retain actual domain writes and their append-only audit trail in this isolated DB.
} finally {
  await closeDatabase();
  mock.restoreAll();
}
