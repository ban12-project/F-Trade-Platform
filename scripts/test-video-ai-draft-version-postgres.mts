import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import ready from "../data/fixtures/product-ready.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productMediaAsset } from "../lib/db/product-media-schema";
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
const ownerSessionId = randomUUID(),
  editorSessionId = randomUUID();
const projectId = randomUUID(),
  productId = randomUUID();
let duringGeneration: (() => Promise<void>) | undefined;
let modelCalls = 0;
const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;
let suggestion = marketingVideoAiDraftSchema.parse({
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
    extractMarketingVisualSamplesInSandbox: async (assets: Array<{ assetRef: string }>) => ({
      candidates: [
        {
          id: "shot-001-001",
          assetRef: assets[0].assetRef,
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
const { registerProductMediaAsset, reviewProductMediaAsset } = await import(
  "../lib/product/media-store.ts"
);
const db = getDatabase();
type MediaBinding = { id: string; evidenceRef: string; rightsEvidenceRef: string };
async function createVideo(media?: MediaBinding) {
  const id = randomUUID();
  const assetRef = media?.evidenceRef ?? "evidence-synthetic-ai-version-image";
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
        assetRef,
        mediaType: "image",
        rightsEvidenceRef: media?.rightsEvidenceRef ?? "evidence-synthetic-ai-version-rights",
        ...(media ? { productMediaId: media.id } : {}),
      },
    ],
    scenes: [
      {
        sceneId: "scene-synthetic-version",
        prompt: "MOCK",
        durationSeconds: 3,
        claimRefs: [],
        assetRefs: [assetRef],
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
          assetRef,
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

async function createEvidence(label: string) {
  const id = `evidence-synthetic-ai-${label}-${randomUUID()}`;
  await db.insert(schema.evidence).values({
    id,
    classification: "internal",
    blobKey: `synthetic/${id}`,
    contentType: label === "image" ? "image/png" : "application/json",
    sha256: createHash("sha256").update(id).digest("hex"),
    sizeBytes: 1,
    sourceLabel: "MOCK AI source guard",
    uploadedByType: "human",
    uploadedById: owner,
  });
  return id;
}

async function createApprovedMedia(expiresAt: string | null = null): Promise<MediaBinding> {
  const evidenceRef = await createEvidence("image");
  const rightsEvidenceRef = await createEvidence("rights");
  const media = await registerProductMediaAsset(
    {
      productId,
      evidenceRef,
      origin: "user_upload",
      semantic: {
        role: "product_hero",
        description: "MOCK approved image",
        tags: [],
        productVisible: true,
        logoVisible: false,
        textPresent: false,
      },
      rights: {
        rightsEvidenceRef,
        editingAllowed: true,
        publicDistributionAllowed: true,
        paidAdvertisingAllowed: false,
        imageToVideoAllowed: false,
        referenceToVideoAllowed: false,
        expiresAt,
      },
    },
    {
      mediaType: "image",
      technical: {
        contentType: "image/png",
        width: 100,
        height: 100,
        durationMs: null,
        fps: null,
        hasAudio: false,
      },
    },
    { actorId: owner, sessionId: ownerSessionId, projectId },
  );
  await reviewProductMediaAsset(
    {
      assetId: media.id,
      decision: "approved",
      evidenceRef: await createEvidence("review"),
      notes: "MOCK controlled approval",
    },
    { actorId: owner, sessionId: ownerSessionId, projectId },
  );
  return { id: media.id, evidenceRef, rightsEvidenceRef };
}

async function runDraft(videoId: string) {
  const queued = await queueVideoProcessingJob(videoId, "ai_draft", {
    actorId: editor,
    sessionId: editorSessionId,
    projectId,
  });
  await generateMarketingVideoAiDraftWorkflow({ videoId, jobId: queued.job.id, actorId: editor });
  return job(queued.job.id);
}

const sourceResults: Array<{ label: string; protected: boolean }> = [];
async function recordSourceResult(
  label: string,
  video: Awaited<ReturnType<typeof createVideo>>,
  completed: Awaited<ReturnType<typeof job>>,
) {
  const current = await record(video.id);
  const protectedResult =
    completed.status === "failed" &&
    completed.failureCode === "AI_DRAFT_SOURCE_INVALID" &&
    completed.failureMessage === "无法确认产品事实或素材授权，AI 初稿未保存。请核对来源后重试。" &&
    JSON.stringify(video.draft) ===
      JSON.stringify(videoProjectSchema.parse(current.payload).editDraft) &&
    (await saves(video.id)).length === 0 &&
    current.version === 2;
  sourceResults.push({ label, protected: protectedResult });
  console.log(
    `${protectedResult ? "PASS" : "FAIL"} current source ${label}: ${completed.status}/${completed.failureCode}; draft and save audit protection=${protectedResult}`,
  );
}

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const id of [owner, editor, viewer, outsider])
    await db.insert(schema.user).values({
      id,
      name: "MOCK video draft",
      email: `${id}@example.invalid`,
      role: id === owner ? "admin" : "user",
    });
  await db.insert(schema.session).values([
    {
      id: ownerSessionId,
      userId: owner,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
    {
      id: editorSessionId,
      userId: editor,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  ]);
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
  const normalJob = await queueVideoProcessingJob(normal.id, "ai_draft", {
    actorId: editor,
    sessionId: editorSessionId,
    projectId,
  });
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
      { actorId: owner, sessionId: ownerSessionId, projectId },
    );
    humanDraft = saved.editDraft;
    assert.equal((await record(changed.id)).version, 2);
  };
  const oldJob = await queueVideoProcessingJob(changed.id, "ai_draft", {
    actorId: editor,
    sessionId: editorSessionId,
    projectId,
  });
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
  const retry = await queueVideoProcessingJob(changed.id, "ai_draft", {
    actorId: editor,
    sessionId: editorSessionId,
    projectId,
  });
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
  const queuedJob = await queueVideoProcessingJob(queued.id, "ai_draft", {
    actorId: editor,
    sessionId: editorSessionId,
    projectId,
  });
  const queuedHumanSave = await updateMarketingVideoEditDraft(
    queued.id,
    { ...queued.draft, ctaText: "MOCK human save after queue" },
    { actorId: owner, sessionId: ownerSessionId, projectId },
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

  // Actual media registration/review uses a controlled reviewer; generation stays
  // an ordinary project editor. All sources, facts and evidence are synthetic.
  await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, owner));
  suggestion = marketingVideoAiDraftSchema.parse({
    ...suggestion,
    clips: suggestion.clips.map((clip) => ({
      ...clip,
      caption: { kind: "verified_fact", text: "", claimRef: "product.product_name" },
    })),
  });
  const media = await createApprovedMedia();
  const approved = await createVideo(media);
  assert.equal((await runDraft(approved.id)).status, "succeeded");
  assert.equal((await saves(approved.id)).length, 1);
  assert.deepEqual(
    videoProjectSchema.parse((await record(approved.id)).payload).editDraft?.clips[0].caption,
    { kind: "verified_fact", claimRef: "product.product_name" },
  );
  console.log("PASS actual approved media baseline saves a verified factual caption");

  const productBefore = await record(productId);
  const currentProduct = productBefore.payload as typeof ready;
  for (const [label, change] of [
    ["product state changed", { state: "PRODUCT_DRAFT" }],
    [
      "product fact changed",
      {
        payload: {
          ...currentProduct,
          product: { ...currentProduct.product, product_name: "MOCK changed product" },
        },
      },
    ],
    [
      "product evidence changed",
      {
        payload: {
          ...currentProduct,
          evidence_refs: [
            ...currentProduct.evidence_refs,
            "evidence-synthetic-ai-replacement-fact",
          ],
          field_evidence: {
            ...currentProduct.field_evidence,
            "product.product_name": "evidence-synthetic-ai-replacement-fact",
          },
        },
      },
    ],
  ] as const) {
    const video = await createVideo(media);
    duringGeneration = async () => {
      await db
        .update(schema.aggregateRecord)
        .set(change)
        .where(eq(schema.aggregateRecord.id, productId));
    };
    try {
      await recordSourceResult(label, video, await runDraft(video.id));
    } finally {
      await db
        .update(schema.aggregateRecord)
        .set({ state: productBefore.state, payload: productBefore.payload })
        .where(eq(schema.aggregateRecord.id, productId));
      duringGeneration = undefined;
    }
    if (label === "product fact changed" && sourceResults.at(-1)?.protected) {
      assert.equal((await runDraft(video.id)).status, "succeeded");
      assert.equal((await saves(video.id)).length, 1);
      console.log("PASS explicit retry after source restoration uses a fresh version and succeeds");
    }
  }

  // Controlled row changes cover current rights/binding states; revocation below
  // additionally exercises the actual review domain function and its audit.
  for (const [label, change] of [
    ["editing permission removed", { editingAllowed: false }],
    ["distribution permission removed", { publicDistributionAllowed: false }],
    [
      "rights evidence binding changed",
      { rightsEvidenceRef: await createEvidence("replacement-rights") },
    ],
  ] as const) {
    const changedMedia = await createApprovedMedia();
    const video = await createVideo(changedMedia);
    duringGeneration = async () => {
      await db
        .update(productMediaAsset)
        .set(change)
        .where(eq(productMediaAsset.id, changedMedia.id));
    };
    try {
      await recordSourceResult(label, video, await runDraft(video.id));
    } finally {
      duringGeneration = undefined;
    }
  }

  const revokedMedia = await createApprovedMedia();
  const revoked = await createVideo(revokedMedia);
  duringGeneration = async () => {
    await reviewProductMediaAsset(
      {
        assetId: revokedMedia.id,
        decision: "rejected",
        evidenceRef: await createEvidence("revoke"),
        notes: "MOCK revoke during model generation",
      },
      { actorId: owner, sessionId: ownerSessionId, projectId },
    );
  };
  await recordSourceResult("actual media review revocation", revoked, await runDraft(revoked.id));
  duringGeneration = undefined;
  const repaired = await updateMarketingVideoEditDraft(
    revoked.id,
    { ...revoked.draft, ctaText: "MOCK manual source repair" },
    { actorId: editor, sessionId: editorSessionId, projectId },
  );
  assert.equal(repaired.editDraft?.ctaText, "MOCK manual source repair");
  assert.equal((await saves(revoked.id)).length, 1);
  console.log("PASS manual draft repair remains available after actual source revocation");

  // Date alone is controlled; database locks and async work remain real.
  const clockStart = Date.now();
  mock.timers.enable({ apis: ["Date"], now: clockStart });
  try {
    const expiring = await createApprovedMedia(new Date(clockStart + 60_000).toISOString());
    const video = await createVideo(expiring);
    duringGeneration = async () => {
      mock.timers.setTime(clockStart + 60_000);
    };
    await recordSourceResult("rights expire during generation", video, await runDraft(video.id));
    duringGeneration = undefined;
    mock.timers.setTime(clockStart);

    const waitingMedia = await createApprovedMedia(new Date(clockStart + 60_000).toISOString());
    const waiting = await createVideo(waitingMedia);
    const lockPool = new Pool({ connectionString: connection });
    const blocker = await lockPool.connect();
    let pending: ReturnType<typeof runDraft> | undefined;
    try {
      await blocker.query("BEGIN");
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("SELECT id FROM product_media_asset WHERE id = $1 FOR UPDATE", [
        waitingMedia.id,
      ]);
      const callsBeforeWait = modelCalls;
      pending = runDraft(waiting.id);
      const deadline = performance.now() + 5_000;
      let observedBlocked = false;
      do {
        const {
          rows: [result],
        } = await lockPool.query<{ blocked: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
          [backend.pid],
        );
        observedBlocked = result.blocked;
        if (observedBlocked) break;
        await delay(10);
      } while (performance.now() < deadline);
      assert(observedBlocked, "Observe an actual database lock wait before advancing expiry");
      assert.equal(
        modelCalls,
        callsBeforeWait + 1,
        "Generation has completed before the observed write lock wait",
      );
      mock.timers.setTime(clockStart + 60_000);
      await blocker.query("COMMIT");
      await recordSourceResult(
        "rights expire during observed media row lock wait",
        waiting,
        await pending,
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      try {
        await pending;
      } finally {
        await lockPool.end();
      }
    }
  } finally {
    duringGeneration = undefined;
    mock.timers.reset();
  }
  assert.equal(sourceResults.length, 9);
  assert(
    sourceResults.every((result) => result.protected),
    JSON.stringify(sourceResults),
  );
  console.log(
    "PASS all 9 current-source changes preserve the draft without an AI save audit; no remote requests",
  );
  // Retain actual domain writes and their append-only audit trail in this isolated DB.
} finally {
  await closeDatabase();
  mock.restoreAll();
}
