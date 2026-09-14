import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { get } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDatabase, type Database, getDatabase } from "../lib/db/client";
import {
  evidence,
  user,
  videoUploadReceipt,
  workspaceProject,
  workspaceProjectEvidence,
  workspaceProjectMember,
} from "../lib/db/schema";
import { MemoryEvidenceStore } from "../lib/evidence/memory-store";
import { persistUploadedEvidence } from "../lib/evidence/persist-upload";
import type { ProductAgentDocumentSource } from "../lib/product/document-source";
import { prepareUploadedProductAgentDocument } from "../lib/product/uploaded-document";
import { claimCompletedVideoUploads } from "../lib/video/upload-receipts";
import { prepareUploadedVideoAssets } from "../lib/video/uploaded-assets";
import { assertAndLinkProjectEvidence, listProjectEvidenceOptions } from "../lib/workspace/access";

const connectionString = process.env.EVIDENCE_UPLOAD_TEST_DATABASE_URL;
if (!connectionString) throw new Error("EVIDENCE_UPLOAD_TEST_DATABASE_URL required");
const address = new URL(connectionString);
if (
  address.hostname !== "127.0.0.1" ||
  !["/f_trade_stream_test", "/evidence_upload_test"].includes(address.pathname)
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connectionString;
process.env.DATABASE_TRANSPORT = "postgres";

void (async () => {
  const db = getDatabase();
  const actors = [randomUUID(), randomUUID()];
  const projects = [randomUUID(), randomUUID()];
  const receiptIds = [randomUUID(), randomUUID()];
  const memory = new MemoryEvidenceStore();
  const store = {
    put: memory.put.bind(memory),
    async delete(path: string) {
      memory.values.delete(path);
    },
  };
  const preprocess = async (): Promise<ProductAgentDocumentSource> => ({
    source: {
      record_id: randomUUID(),
      source_ref: "synthetic",
      evidence_refs: [],
      source_text: "SYNTHETIC",
      image_availability: "none",
      image_refs: [],
    },
    document_sha256: "synthetic",
    filename: "synthetic.csv",
    media_type: "text/csv",
    ocr_enabled: false,
    layout_recovered_pages: [],
    conversion_status: "converted",
  });
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    for (let i = 0; i < 2; i++) {
      await db.insert(user).values({
        id: actors[i],
        name: "SYNTHETIC",
        email: `${actors[i]}@example.invalid`,
        role: "admin",
      });
      await db
        .insert(workspaceProject)
        .values({ id: projects[i], title: "SYNTHETIC", kind: "marketing", createdById: actors[i] });
      await db.insert(workspaceProjectMember).values({
        id: randomUUID(),
        projectId: projects[i],
        userId: actors[i],
        createdById: actors[i],
        role: "owner",
      });
    }
    const bytes = `SYNTHETIC,${randomUUID()}\n`;
    const upload = (actor: string) =>
      prepareUploadedProductAgentDocument(
        new File([bytes], "synthetic.csv", { type: "text/csv" }),
        actor,
        { store, preprocess },
      );
    const beforeConversionFailure = memory.values.size;
    await assert.rejects(
      prepareUploadedProductAgentDocument(
        new File([bytes], "synthetic.csv", { type: "text/csv" }),
        actors[0],
        {
          store,
          preprocess: async () => {
            throw new Error("synthetic conversion failure");
          },
        },
      ),
      /conversion failure/,
    );
    assert.equal(
      memory.values.size,
      beforeConversionFailure,
      "Conversion failure must not store a blob",
    );
    const documents = await Promise.all(actors.map(upload));
    const refs = documents.map((document) => document.source.evidence_refs[0]);
    assert.notEqual(refs[0], refs[1], "Independent uploads must preserve separate provenance");
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        assertAndLinkProjectEvidence(projects[i], [refs[1 - i]], actors[i]),
        /无权/,
      );
      await assertAndLinkProjectEvidence(projects[i], [refs[i]], actors[i]);
      const options = await listProjectEvidenceOptions(projects[i], actors[i]);
      assert.ok(options.some((row) => row.id === refs[i]));
      assert.ok(!options.some((row) => row.id === refs[1 - i]));
      const [row] = await db.select().from(evidence).where(eq(evidence.id, refs[i]));
      assert.equal(row.uploadedById, actors[i]);
      assert.equal(row.classification, "restricted");
      const readback = await memory.get(row.blobKey);
      assert.ok(readback);
      assert.equal(await new Response(readback.body).text(), bytes);
    }
    const repeated = await Promise.all([upload(actors[0]), upload(actors[0])]);
    assert.equal(
      new Set([...refs, ...repeated.map((item) => item.source.evidence_refs[0])]).size,
      4,
    );

    const image = new File([Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3])], "synthetic.jpg", {
      type: "image/jpeg",
    });
    const media = await Promise.all(
      actors.map((actor) =>
        prepareUploadedVideoAssets([image], actor, "synthetic-rights", db, store),
      ),
    );
    assert.notEqual(media[0][0].assetRef, media[1][0].assetRef);
    for (let i = 0; i < 2; i++) {
      await assertAndLinkProjectEvidence(projects[i], [media[i][0].assetRef], actors[i]);
      await assert.rejects(
        assertAndLinkProjectEvidence(projects[i], [media[1 - i][0].assetRef], actors[i]),
        /无权/,
      );
      await db.insert(videoUploadReceipt).values({
        id: receiptIds[i],
        projectId: projects[i],
        ownerId: actors[i],
        blobPath: `synthetic/receipt/${receiptIds[i]}`,
        originalFilename: "synthetic.jpg",
        contentType: "image/jpeg",
        sizeBytes: image.size,
        rightsEvidenceRef: "synthetic-rights",
        status: "uploaded",
        expiresAt: new Date(Date.now() + 60000),
        uploadedAt: new Date(),
      });
    }
    let reads = 0;
    const readBlob: typeof get = async () => {
      reads++;
      return { statusCode: 200, stream: image.stream() } as Awaited<ReturnType<typeof get>>;
    };
    const claim = (i: number) =>
      claimCompletedVideoUploads(
        [receiptIds[i]],
        actors[i],
        projects[i],
        "synthetic-rights",
        db,
        readBlob,
      );
    const claims = await Promise.all([claim(0), claim(0), claim(1)]);
    assert.equal(
      claims[0][0].assetRef,
      claims[1][0].assetRef,
      "Concurrent receipt confirmation must remain idempotent",
    );
    assert.notEqual(claims[0][0].assetRef, claims[2][0].assetRef);
    const readsBeforeRetry = reads;
    assert.equal((await claim(0))[0].assetRef, claims[0][0].assetRef);
    assert.equal(reads, readsBeforeRetry, "A claimed receipt must not read the blob again");
    await assertAndLinkProjectEvidence(projects[0], [claims[0][0].assetRef], actors[0]);
    await assertAndLinkProjectEvidence(projects[1], [claims[2][0].assetRef], actors[1]);
    await assert.rejects(
      assertAndLinkProjectEvidence(projects[1], [claims[0][0].assetRef], actors[1]),
      /无权/,
    );

    const failureInput = {
      actorId: "",
      filename: "synthetic.csv",
      contentType: "text/csv",
      sha256: "synthetic-failure",
      sizeBytes: 1,
      sourceLabel: "synthetic",
      body: new Blob(["x"]),
    };
    const count = memory.values.size;
    await assert.rejects(persistUploadedEvidence(failureInput, db, store));
    assert.equal(memory.values.size, count, "Rejected insert must delete its unreferenced blob");
    const lostAck = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "insert")
          return (table: typeof evidence) => ({
            values: async (value: typeof evidence.$inferInsert) => {
              await target.insert(table).values(value);
              throw new Error("synthetic lost acknowledgement");
            },
          });
        return Reflect.get(target, key, receiver);
      },
    }) as Database;
    await assert.rejects(
      persistUploadedEvidence({ ...failureInput, actorId: actors[0] }, lostAck, store),
      /lost acknowledgement/,
    );
    assert.equal(
      memory.values.size,
      count + 1,
      "A lost acknowledgement must preserve a possibly committed blob",
    );
    console.log(
      "Evidence uploads: independent provenance, cross-project denial, concurrent uploads, receipt idempotency, stored-byte readback and failure cleanup passed (synthetic adapters, real PostgreSQL).",
    );
  } finally {
    await db.delete(videoUploadReceipt).where(inArray(videoUploadReceipt.id, receiptIds));
    await db
      .delete(workspaceProjectEvidence)
      .where(inArray(workspaceProjectEvidence.projectId, projects));
    await db
      .delete(workspaceProjectMember)
      .where(inArray(workspaceProjectMember.projectId, projects));
    await db.delete(workspaceProject).where(inArray(workspaceProject.id, projects));
    await db.delete(evidence).where(inArray(evidence.uploadedById, actors));
    await db.delete(user).where(inArray(user.id, actors));
    await closeDatabase();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
