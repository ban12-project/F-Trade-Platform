import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  productCatalogAttempt,
  productCatalogCandidate,
  productCatalogImport,
} from "../../lib/db/product-catalog-schema";
import * as schema from "../../lib/db/schema";
import { encryptStoredSecret } from "../../lib/security/encrypted-secret";
import { authSecret, databaseURL, modelConfigKey } from "../../playwright.database.config";

const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = `synthetic-catalog-${randomUUID()}`;
const projectId = randomUUID();
const sessionId = randomUUID();
const token = randomUUID();
const evidenceId = `evidence-synthetic-${randomUUID()}`;
const receiptId = randomUUID();
const importId = randomUUID();
const configId = randomUUID();
const candidateIds = [randomUUID(), randomUUID()] as const;

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic catalog reviewer",
    email: `${actorId}@example.invalid`,
    emailVerified: true,
    role: "admin",
  });
  await db
    .insert(schema.session)
    .values({ id: sessionId, token, userId: actorId, expiresAt: new Date(Date.now() + 3_600_000) });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "SYNTHETIC catalog action test",
    kind: "marketing",
    createdById: actorId,
  });
  await db
    .insert(schema.workspaceProjectMember)
    .values({ id: randomUUID(), projectId, userId: actorId, role: "owner", createdById: actorId });
  // Pre-existing synthetic source, not a real Blob upload or parsed factory document.
  await db.insert(schema.evidence).values({
    id: evidenceId,
    classification: "internal",
    blobKey: `synthetic/${evidenceId}`,
    contentType: "text/csv",
    sha256: createHash("sha256").update("SYNTHETIC").digest("hex"),
    sizeBytes: 9,
    sourceLabel: "SYNTHETIC catalog",
    uploadedByType: "human",
    uploadedById: actorId,
  });
  await db.insert(schema.productDocumentUploadReceipt).values({
    id: receiptId,
    projectId,
    ownerId: actorId,
    purpose: "agent",
    blobPath: `synthetic/${receiptId}.csv`,
    originalFilename: "synthetic.csv",
    contentType: "text/csv",
    sizeBytes: 9,
    evidenceId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db
    .insert(productCatalogImport)
    .values({ id: importId, projectId, actorId, receiptId, evidenceId, status: "ready" });
  await db.insert(productCatalogCandidate).values(
    candidateIds.map((id, index) => ({
      id,
      importId,
      ordinal: index,
      identifier: `SYNTHETIC-${index}`,
      recordLine: index + 1,
      reviewStatus: "source_review_required" as const,
      status: "available" as const,
      source: {
        record_id: randomUUID(),
        source_ref: "synthetic-catalog",
        evidence_refs: [evidenceId],
        source_text: "SYNTHETIC source only",
        image_availability: "none" as const,
        image_refs: [],
      },
    })),
  );
  process.env.MODEL_CONFIG_ENCRYPTION_KEY = modelConfigKey;
  await db.insert(schema.productAgentModelConfig).values({
    id: configId,
    name: configId,
    provider: "openai-compatible",
    model: "synthetic-unused",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKeyCiphertext: encryptStoredSecret("synthetic-only"),
    updatedBy: actorId,
  });
});

test.afterAll(async () => {
  try {
    await db.delete(productCatalogImport).where(eq(productCatalogImport.id, importId));
    await db
      .delete(schema.productDocumentUploadReceipt)
      .where(eq(schema.productDocumentUploadReceipt.id, receiptId));
    await db.delete(schema.evidence).where(eq(schema.evidence.id, evidenceId));
    await db
      .delete(schema.productAgentModelConfig)
      .where(eq(schema.productAgentModelConfig.id, configId));
    await db
      .delete(schema.workspaceProjectMember)
      .where(eq(schema.workspaceProjectMember.projectId, projectId));
    await db.delete(schema.workspaceProject).where(eq(schema.workspaceProject.id, projectId));
    await db.delete(schema.session).where(eq(schema.session.userId, actorId));
    await db.delete(schema.user).where(eq(schema.user.id, actorId));
  } finally {
    await pool.end();
  }
});

test("real catalog Actions restore persisted progress, reconcile selection and reject expired-session writes", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing browser base URL");
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
  await page.goto(`/workspace/${projectId}/new/product`);
  await page.getByRole("tab", { name: "产品目录", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await page.getByRole("button", { name: "选择前 20 条可用记录", exact: true }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  const attemptId = randomUUID();
  await db.insert(productCatalogAttempt).values({
    id: attemptId,
    importId,
    candidateId: candidateIds[0],
    sessionId,
    status: "running",
    modelConfigId: configId,
    model: "synthetic-unused",
    leaseExpiresAt: new Date(Date.now() + 3_600_000),
  });
  await db
    .update(productCatalogCandidate)
    .set({ status: "running", activeAttemptId: attemptId })
    .where(eq(productCatalogCandidate.id, candidateIds[0]));
  const refresh = page.getByRole("button", { name: "刷新进度", exact: true });
  await refresh.click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
  await expect(
    page.getByText("目录状态已更新，已从选择中移除 1 条当前不可生成的记录。", { exact: true }),
  ).toBeVisible();
  await db
    .update(schema.session)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.session.id, sessionId));
  await page.getByRole("button", { name: "生成 1 条待审核草稿", exact: true }).click();
  await expect(
    page.getByText("无法提交候选，请确认选中 1–20 条记录、模型配置及项目权限。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox").last()).toBeChecked();
  await refresh.click();
  await expect(
    page.getByText("无法读取目录进度，请确认登录状态及项目权限。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("当前显示上次读取的目录进度，请刷新后再核对。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("无法提交候选，请确认选中 1–20 条记录、模型配置及项目权限。", { exact: true }),
  ).toBeVisible();
  const attempts = await db
    .select()
    .from(productCatalogAttempt)
    .where(eq(productCatalogAttempt.importId, importId));
  expect(attempts.map((row) => row.id)).toEqual([attemptId]);
  const candidates = await db
    .select()
    .from(productCatalogCandidate)
    .where(eq(productCatalogCandidate.importId, importId));
  expect(candidates.find((row) => row.id === candidateIds[1])?.status).toBe("available");
  expect(candidates.every((row) => row.productId === null)).toBe(true);
  expect(
    await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.createdById, actorId)),
  ).toHaveLength(0);
});
