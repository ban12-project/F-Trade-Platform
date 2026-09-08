import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  aggregateRecord,
  user,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "../lib/db/schema";
import { videoProjectSchema } from "../lib/video/contracts";
import {
  resolveApprovedVideoAccess,
  resolveApprovedVideoDownload,
} from "../lib/video/download-policy";
import { approveReviewVideoExport, createReviewVideoExport } from "../lib/video/export-artifact";
import { resolveWorkspacePrivateVideoPreview } from "../lib/video/preview-delivery";
import { loadWorkspaceVideoForActor } from "../lib/video/workspace-access";

const connectionString = process.env.VIDEO_ACCESS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("VIDEO_ACCESS_TEST_DATABASE_URL required");
const address = new URL(connectionString);
if (
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_stream_test", "/project_access_test"].includes(address.pathname)
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connectionString;
process.env.DATABASE_TRANSPORT = "postgres";
void (async () => {
  const id = randomUUID(),
    owner = randomUUID(),
    outsider = randomUUID(),
    projectId = randomUUID(),
    copyId = randomUUID(),
    copyProjectId = randomUUID();
  const assetRef = `asset-synthetic-${randomUUID()}`;
  const project = videoProjectSchema.parse({
    id,
    productId: randomUUID(),
    status: "review_required",
    objective: "SYNTHETIC access test",
    targetAudience: "SYNTHETIC",
    platforms: ["facebook"],
    factualClaims: [
      {
        field: "product.product_name",
        value: "SYNTHETIC fixture",
        evidenceRef: "evidence-synthetic-fact",
      },
    ],
    sourceAssets: [
      {
        assetRef: "evidence-synthetic-source",
        mediaType: "image",
        rightsEvidenceRef: "evidence-synthetic-rights",
      },
    ],
    scenes: [
      {
        sceneId: "scene-synthetic",
        prompt: "SYNTHETIC",
        durationSeconds: 3,
        claimRefs: [],
        assetRefs: ["evidence-synthetic-source"],
      },
    ],
    renderedAssetRef: assetRef,
    editDraft: {
      version: 2,
      platform: "facebook",
      ctaText: "",
      clips: [
        {
          clipId: "clip-synthetic",
          assetRef: "evidence-synthetic-source",
          mediaType: "image",
          trimStartMs: 0,
          durationMs: 3000,
          fitMode: "contain",
          audioMode: "muted",
          caption: { kind: "none" },
        },
      ],
    },
  });
  const db = getDatabase();
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  let reads = 0,
    revalidations = 0;
  const store = {
    async getGeneratedVideo() {
      reads++;
      return {
        body: new ReadableStream<Uint8Array>(),
        contentType: "video/mp4",
        sizeBytes: 3,
        responseSizeBytes: 3,
        contentRange: null,
        etag: "synthetic",
      };
    },
  };
  const load = (videoId: string, actorId: string) => loadWorkspaceVideoForActor(videoId, actorId);
  const revalidate = async () => {
    revalidations++;
  };
  try {
    await db.insert(user).values(
      [owner, outsider].map((id) => ({
        id,
        name: "SYNTHETIC video access",
        email: `${id}@example.invalid`,
        role: "user",
      })),
    );
    await db.insert(workspaceProject).values({
      id: projectId,
      kind: "marketing",
      title: "SYNTHETIC isolated media",
      createdById: owner,
    });
    await db
      .insert(workspaceProjectMember)
      .values({ id: randomUUID(), projectId, userId: owner, role: "viewer", createdById: owner });
    const artifact = approveReviewVideoExport(
      createReviewVideoExport({
        videoId: id,
        sourceAssetRef: assetRef,
        platform: "facebook",
        timeline: { durationSeconds: 3 },
        media: {
          container: "mp4",
          videoCodec: "h264",
          audioCodec: "aac",
          width: 1080,
          height: 1920,
          fps: 30,
          durationSeconds: 3,
          subtitleStreamCount: 0,
          encoding: {
            pixelFormat: "yuv420p",
            sampleAspectRatio: "1:1",
            audioSampleRate: 48000,
            audioChannels: 2,
          },
        },
      }),
      "evidence-synthetic-approval",
    );
    const approved = videoProjectSchema.parse({
      ...project,
      status: "approved",
      exportArtifact: artifact,
    });
    await db.insert(aggregateRecord).values({
      id,
      type: "video",
      state: "VIDEO_APPROVED",
      payload: approved,
      createdByType: "human",
      createdById: owner,
    });
    const linkId = randomUUID();
    await db.insert(workspaceProjectItem).values({
      id: linkId,
      projectId,
      aggregateId: id,
      role: "marketing_video",
      relation: "owned",
    });
    const member = { user: { id: owner, role: "user" } },
      stranger = { user: { id: outsider, role: "user" } };
    assert.equal(
      (await resolveWorkspacePrivateVideoPreview(member, assetRef, store)).kind,
      "ready",
    );
    assert.equal((await resolveApprovedVideoAccess(member, id, load, revalidate)).kind, "ready");
    assert.equal(
      (await resolveApprovedVideoDownload(member, id, null, store, load, revalidate)).kind,
      "ready",
    );
    const deny = async (
      session: { user: { id?: string; role: string } },
      expected = "not_found",
    ) => {
      const before = [reads, revalidations];
      assert.equal(
        (await resolveWorkspacePrivateVideoPreview(session, assetRef, store)).kind,
        expected,
      );
      assert.equal(
        (await resolveApprovedVideoAccess(session, id, load, revalidate)).kind,
        expected,
      );
      assert.equal(
        (await resolveApprovedVideoDownload(session, id, null, store, load, revalidate)).kind,
        expected,
      );
      assert.deepEqual(
        [reads, revalidations],
        before,
        "Denied requests must not open private media or inspect product facts",
      );
    };
    await deny(stranger);
    await deny({ user: { id: outsider, role: "admin" } });
    await deny({ user: { id: "", role: "user" } }, "forbidden");
    await deny({ user: { role: "user" } }, "forbidden");
    await db.insert(workspaceProject).values({
      id: copyProjectId,
      kind: "marketing",
      title: "SYNTHETIC independent copy",
      createdById: outsider,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: copyProjectId,
      userId: outsider,
      role: "owner",
      createdById: outsider,
    });
    await db.insert(aggregateRecord).values({
      id: copyId,
      type: "video",
      state: "VIDEO_APPROVED",
      payload: {
        ...approved,
        id: copyId,
        exportArtifact: { ...artifact, id: randomUUID(), videoId: copyId },
      },
      createdByType: "human",
      createdById: outsider,
    });
    await db.insert(workspaceProjectItem).values({
      id: randomUUID(),
      projectId: copyProjectId,
      aggregateId: copyId,
      role: "marketing_video",
      relation: "owned",
    });
    assert.equal(
      (await resolveWorkspacePrivateVideoPreview(stranger, assetRef, store)).kind,
      "ready",
      "An independently owned copy may expose its own render even when another project shares the opaque asset reference",
    );
    assert.equal(
      (await resolveApprovedVideoAccess(stranger, id, load, revalidate)).kind,
      "not_found",
      "Shared asset references do not grant access to another video record",
    );
    await db.delete(workspaceProject).where(eq(workspaceProject.id, copyProjectId));
    await deny(stranger);
    for (const patch of [
      { role: "product_reference", relation: "reference" as const },
      { role: "product_source" },
    ]) {
      await db.update(workspaceProjectItem).set(patch).where(eq(workspaceProjectItem.id, linkId));
      await deny(member);
      await db
        .update(workspaceProjectItem)
        .set({ role: "marketing_video", relation: "owned" })
        .where(eq(workspaceProjectItem.id, linkId));
    }
    await db.update(aggregateRecord).set({ type: "product" }).where(eq(aggregateRecord.id, id));
    await deny(member);
    await db.update(aggregateRecord).set({ type: "video" }).where(eq(aggregateRecord.id, id));
    await db.delete(workspaceProjectMember).where(eq(workspaceProjectMember.projectId, projectId));
    await deny(member);
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: outsider,
      role: "editor",
      createdById: owner,
    });
    assert.equal(
      (await resolveWorkspacePrivateVideoPreview(stranger, assetRef, store)).kind,
      "ready",
    );
    assert.equal((await resolveApprovedVideoAccess(stranger, id, load, revalidate)).kind, "ready");
    await db.delete(workspaceProjectItem).where(eq(workspaceProjectItem.id, linkId));
    await deny(stranger);
    console.log(
      "PASS migrated PostgreSQL video preview/download/manifest membership: member, outsider/admin, missing identity, wrong relation/role, revocation, reassignment and unowned video; denials never read private storage",
    );
  } finally {
    await db
      .delete(workspaceProject)
      .where(inArray(workspaceProject.id, [projectId, copyProjectId]));
    await db.delete(aggregateRecord).where(inArray(aggregateRecord.id, [id, copyId]));
    await db.delete(user).where(inArray(user.id, [owner, outsider]));
    await closeDatabase();
  }
})();
