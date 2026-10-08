import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productCatalogCandidate, productCatalogImport } from "../lib/db/product-catalog-schema";
import * as schema from "../lib/db/schema";
import { discoverCatalogCandidates } from "../lib/product/catalog-candidates";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import {
  claimDocumentUpload,
  issueDocumentUploadReceipt,
} from "../lib/product/document-upload-receipts";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { listProductEvidencePreviews, readProductEvidence } from "../lib/product/evidence-preview";

void (async () => {
  const connection = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
  if (
    !connection ||
    new URL(connection).hostname !== "127.0.0.1" ||
    new URL(connection).pathname !== "/f_trade_stream_test"
  )
    throw new Error("Dedicated synthetic local database required");
  process.env.DATABASE_URL = connection;
  process.env.DATABASE_TRANSPORT = "postgres";
  process.env.VERCEL = "0";
  process.env.PRODUCT_DOCUMENT_SANDBOX_IMAGE = "";
  process.env.MARKITDOWN_OCR_ENABLED = "0";
  process.env.F_TRADE_LOCAL_OCR_ENABLED = "0";
  const directory = await mkdtemp(join(tmpdir(), "f-trade-evidence-location-"));
  const [owner, viewer, outsider, project] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const uploadIdentity = { actorId: owner, sessionId: randomUUID(), projectId: project };
  const db = getDatabase();
  let reads = 0;
  function reader(bytes: Buffer, contentType: string): typeof get {
    return (async () => {
      reads++;
      return {
        statusCode: 200,
        stream: new Blob([new Uint8Array(bytes)]).stream(),
        blob: { contentType },
      };
    }) as unknown as typeof get;
  }
  async function fixture(filename: string, contentType: string) {
    const path = join(directory, filename);
    const bytes = await readFile(path);
    const document = await preprocessProductAgentDocument({
      documentPath: path,
      recordId: randomUUID(),
      imageAvailability: "none",
      imageRefs: [],
    });
    const issued = await issueDocumentUploadReceipt(
      {
        receiptId: randomUUID(),
        projectId: project,
        purpose: "agent",
        originalFilename: filename,
        contentType,
        sizeBytes: bytes.length,
      },
      uploadIdentity,
      db,
    );
    const claimed = await claimDocumentUpload(
      { receiptId: issued.id, projectId: project, purpose: "agent" },
      uploadIdentity,
      db,
      reader(bytes, contentType),
    );
    assert.equal(document.document_sha256, claimed.sha256);
    const found = discoverCatalogCandidates({
      ...document.source,
      source_ref: `source-${claimed.sha256}`,
      evidence_refs: [claimed.evidenceId],
    });
    assert.equal(found.length, 1);
    const source = { ...found[0].source, record_id: randomUUID() };
    const base = source.evidence_refs[0];
    const recordLine = Number(/record-line=(\d+)/.exec(base)?.[1]);
    const physicalPage = /(?:#|&)pdf-page=(\d+)/.exec(base)?.[1];
    const located = prepareProductAgentEvidenceSource(source).evidence_locations;
    const location = located.find(
      (item) =>
        item.text.includes("MOCK third-page product") || item.text.includes("MOCK CSV product"),
    );
    assert.ok(location);
    const productId = randomUUID();
    const payload = {
      source_ref: source.source_ref,
      field_evidence: {
        "product.product_name": location.ref,
        "product.internal_sku": claimed.evidenceId,
        "commercial.moq": "evidence-loc-row-page-999-unmatched",
      },
    };
    await db.insert(schema.aggregateRecord).values({
      id: productId,
      type: "product",
      state: "PRODUCT_REVIEW_REQUIRED",
      payload,
      createdByType: "human",
      createdById: owner,
    });
    await db.insert(schema.workspaceProjectItem).values({
      id: randomUUID(),
      projectId: project,
      aggregateId: productId,
      role: "product_source",
    });
    const importId = randomUUID();
    await db.insert(productCatalogImport).values({
      id: importId,
      projectId: project,
      actorId: owner,
      receiptId: issued.id,
      evidenceId: claimed.evidenceId,
      status: "ready",
    });
    const candidateId = randomUUID();
    await db.insert(productCatalogCandidate).values({
      id: candidateId,
      importId,
      ordinal: 0,
      identifier: found[0].identifier,
      source,
      physicalPage: physicalPage ? Number(physicalPage) : null,
      recordLine,
      reviewStatus: found[0].review_status,
      status: "completed",
      productId,
    });
    return {
      productId,
      candidateId,
      importId,
      claimed,
      source,
      location,
      recordLine,
      bytes,
      payload,
    };
  }
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    for (const id of [owner, viewer, outsider])
      await db
        .insert(schema.user)
        .values({ id, name: "MOCK source location", email: `${id}@example.invalid`, role: "user" });
    await db.insert(schema.session).values({
      id: uploadIdentity.sessionId,
      userId: owner,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.insert(schema.workspaceProject).values({
      id: project,
      title: "MOCK source location",
      kind: "marketing",
      createdById: owner,
    });
    for (const [userId, role] of [
      [owner, "owner"],
      [viewer, "viewer"],
    ] as const)
      await db
        .insert(schema.workspaceProjectMember)
        .values({ id: randomUUID(), projectId: project, userId, role, createdById: owner });
    execFileSync(process.env.MARKITDOWN_PYTHON ?? "python3", [
      "-c",
      "import sys; from pathlib import Path; sys.path.insert(0, 'scripts'); from synthetic_pdf_fixture import build_pdf, text_command; Path(sys.argv[1]).write_bytes(build_pdf([text_command('MOCK first page',30,550), b'', text_command('Product name: MOCK third-page product',30,550)+text_command('Part No.: RYC-MOCK-532',30,538)]))",
      join(directory, "MOCK paged source.pdf"),
    ]);
    await writeFile(
      join(directory, "MOCK source.csv"),
      "Part No.,Product name\nRYC-MOCK-533,MOCK CSV product\n",
    );
    const pdf = await fixture("MOCK paged source.pdf", "application/pdf");
    assert.match(pdf.source.evidence_refs[0], /#pdf-page=3&record-line=/);
    async function preview() {
      const result = (await listProductEvidencePreviews(project, pdf.productId, viewer, db)).find(
        (item) => item.id === pdf.claimed.evidenceId,
      );
      assert.ok(result);
      return result;
    }
    const initial = await preview();
    const name = initial.fields.find((field) => field.path === "product.product_name");
    assert.ok(name, "claimed document source must bind the selected field");
    assert.deepEqual(name.location, { physicalPage: 3, recordLine: pdf.recordLine });
    assert.equal(name.excerpt, pdf.location.text);
    assert.equal(
      initial.fields.find((field) => field.path === "product.internal_sku")?.location,
      undefined,
    );
    assert.equal(
      initial.fields.find((field) => field.path === "commercial.moq")?.location,
      undefined,
    );
    const currentBytes = await readProductEvidence(
      project,
      pdf.productId,
      pdf.claimed.evidenceId,
      viewer,
      db,
      reader(pdf.bytes, "application/pdf"),
    );
    assert.deepEqual(currentBytes?.bytes, pdf.bytes);
    for (const changes of [
      { physicalPage: 4 },
      { recordLine: pdf.recordLine + 1 },
      { source: { ...pdf.source, source_ref: `source-${"0".repeat(64)}` } },
      {
        source: {
          ...pdf.source,
          evidence_refs: [`${randomUUID()}#pdf-page=3&record-line=${pdf.recordLine}`],
        },
      },
    ]) {
      await db
        .update(productCatalogCandidate)
        .set(changes)
        .where(eq(productCatalogCandidate.id, pdf.candidateId));
      assert.equal(
        (await preview()).fields.find((field) => field.path === "product.product_name")?.location,
        undefined,
      );
      await db
        .update(productCatalogCandidate)
        .set({ physicalPage: 3, recordLine: pdf.recordLine, source: pdf.source })
        .where(eq(productCatalogCandidate.id, pdf.candidateId));
    }
    const duplicate = await issueDocumentUploadReceipt(
      {
        receiptId: randomUUID(),
        projectId: project,
        purpose: "agent",
        originalFilename: "MOCK separate same-byte PDF.pdf",
        contentType: "application/pdf",
        sizeBytes: pdf.bytes.length,
      },
      uploadIdentity,
      db,
    );
    const alias = await claimDocumentUpload(
      { receiptId: duplicate.id, projectId: project, purpose: "agent" },
      uploadIdentity,
      db,
      reader(pdf.bytes, "application/pdf"),
    );
    assert.equal(alias.sha256, pdf.claimed.sha256);
    const aliasPreview = (
      await listProductEvidencePreviews(project, pdf.productId, viewer, db)
    ).find((item) => item.id === alias.evidenceId);
    assert.ok(aliasPreview);
    assert.ok(aliasPreview.fields.every((field) => !field.location && !field.excerpt));
    await db
      .update(productCatalogImport)
      .set({ evidenceId: alias.evidenceId })
      .where(eq(productCatalogImport.id, pdf.importId));
    assert.equal(
      (await preview()).fields.find((field) => field.path === "product.product_name")?.location,
      undefined,
    );
    await db
      .update(productCatalogImport)
      .set({ evidenceId: pdf.claimed.evidenceId })
      .where(eq(productCatalogImport.id, pdf.importId));
    const csv = await fixture("MOCK source.csv", "text/csv");
    const csvSource = (await listProductEvidencePreviews(project, csv.productId, viewer, db)).find(
      (item) => item.id === csv.claimed.evidenceId,
    );
    assert.ok(csvSource);
    assert.deepEqual(
      csvSource.fields.find((field) => field.path === "product.product_name")?.location,
      { recordLine: csv.recordLine },
    );
    const before = reads;
    assert.deepEqual(await listProductEvidencePreviews(project, pdf.productId, outsider, db), []);
    assert.equal(
      await readProductEvidence(
        project,
        pdf.productId,
        pdf.claimed.evidenceId,
        outsider,
        db,
        reader(pdf.bytes, "application/pdf"),
      ),
      null,
    );
    assert.equal(reads, before);
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, viewer));
    assert.deepEqual(await listProductEvidencePreviews(project, pdf.productId, viewer, db), []);
    console.log(
      "PASS actual three-page PDF (blank page 2) and CSV → native conversion → catalog candidates → claimed source → PostgreSQL field locations; exact source/hash/page/line/ref binding and authorization retained",
    );
  } finally {
    await closeDatabase();
    await rm(directory, { recursive: true, force: true });
  }
})();
