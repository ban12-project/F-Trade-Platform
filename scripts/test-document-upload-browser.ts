/** Opt-in real private Blob test. All application records use a dedicated local synthetic database. */
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { del, get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  evidence,
  productDocumentUploadReceipt,
  session,
  user,
  workspaceProject,
  workspaceProjectEvidence,
  workspaceProjectMember,
} from "../lib/db/schema";

const baseURL = process.env.DOCUMENT_UPLOAD_BROWSER_URL;
const databaseURL = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
if (
  !baseURL ||
  !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) ||
  !databaseURL ||
  new URL(databaseURL).hostname !== "127.0.0.1" ||
  new URL(databaseURL).pathname !== "/f_trade_browser_test"
)
  throw new Error("Explicit local browser URL and dedicated synthetic database required");
process.env.DATABASE_URL = databaseURL;
process.env.DATABASE_TRANSPORT = "postgres";
const authSecret = process.env.DOCUMENT_UPLOAD_TEST_AUTH_SECRET;
if (!authSecret) throw new Error("Explicit synthetic auth secret required");

void (async () => {
  const db = getDatabase();
  const actorId = randomUUID(),
    projectId = randomUUID(),
    token = randomUUID();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  const actionBytes: number[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-action"])
      actionBytes.push(request.postDataBuffer()?.byteLength ?? 0);
  });
  try {
    await db.insert(user).values({
      id: actorId,
      name: "SYNTHETIC document tester",
      email: `${actorId}@example.invalid`,
      role: "admin",
      emailVerified: true,
    });
    await db.insert(session).values({
      id: randomUUID(),
      token,
      userId: actorId,
      expiresAt: new Date(Date.now() + 3600000),
    });
    await db.insert(workspaceProject).values({
      id: projectId,
      title: "SYNTHETIC private upload acceptance",
      kind: "marketing",
      createdById: actorId,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    const signature = createHmac("sha256", authSecret).update(token).digest("base64");
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(`${token}.${signature}`),
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${baseURL}/workspace/${projectId}`);
    const sizes = [1048577, 26214400];
    for (const size of sizes) {
      const buffer = Buffer.alloc(size, 65);
      await page
        .locator("#project-evidence-document")
        .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer });
      await page.getByRole("button", { name: "保存到项目证据库" }).click();
      await expect
        .poll(
          async () =>
            (await db.select().from(evidence).where(eq(evidence.uploadedById, actorId))).length,
          { timeout: 180000 },
        )
        .toBe(sizes.indexOf(size) + 1);
      await expect(page.getByText(`当前可用 ${sizes.indexOf(size) + 1} 项证据`)).toBeVisible();
      const rows = await db.select().from(evidence).where(eq(evidence.uploadedById, actorId));
      const row = rows.find((item) => item.sizeBytes === size);
      assert.ok(row);
      assert.equal(row.sha256, createHash("sha256").update(buffer).digest("hex"));
      const result = await get(row.blobKey, { access: "private", useCache: false });
      assert.ok(result?.statusCode === 200 && result.stream);
      const readback = Buffer.from(await new Response(result.stream).arrayBuffer());
      assert.equal(readback.length, size);
      assert.equal(createHash("sha256").update(readback).digest("hex"), row.sha256);
    }
    const before = (
      await db
        .select()
        .from(productDocumentUploadReceipt)
        .where(eq(productDocumentUploadReceipt.projectId, projectId))
    ).length;
    await page.locator("#project-evidence-document").setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.alloc(26214401, 65),
    });
    await page.getByRole("button", { name: "保存到项目证据库" }).click();
    await expect(page.getByText("文件不能超过 25 MiB。")).toBeVisible();
    assert.equal(
      (
        await db
          .select()
          .from(productDocumentUploadReceipt)
          .where(eq(productDocumentUploadReceipt.projectId, projectId))
      ).length,
      before,
    );
    assert.equal(actionBytes.length, 2);
    assert.ok(actionBytes.every((size) => size < 10000));
    console.log(
      JSON.stringify({
        status: "passed",
        synthetic: true,
        uploadBytes: sizes,
        privateReadback: true,
        oversizedRejectedBeforeSigning: true,
        serverActionBodyBytes: actionBytes,
      }),
    );
  } finally {
    await browser.close();
    const receipts = await db
      .select()
      .from(productDocumentUploadReceipt)
      .where(eq(productDocumentUploadReceipt.projectId, projectId));
    for (const row of receipts) await del(row.blobPath);
    await db
      .delete(workspaceProjectEvidence)
      .where(eq(workspaceProjectEvidence.projectId, projectId));
    await db
      .delete(productDocumentUploadReceipt)
      .where(eq(productDocumentUploadReceipt.projectId, projectId));
    await db.delete(evidence).where(eq(evidence.uploadedById, actorId));
    await db.delete(workspaceProject).where(eq(workspaceProject.id, projectId));
    await db.delete(user).where(eq(user.id, actorId));
    await closeDatabase();
  }
})();
