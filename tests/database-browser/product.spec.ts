import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";

const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = `synthetic-browser-${randomUUID()}`;
const projectId = randomUUID();
const token = randomUUID();
const evidenceId = `evidence-mock-${randomUUID()}`;
const sku = `MOCK-BROWSER-${randomUUID()}`;
const productName = "MOCK browser product — not factory verified";

test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({
    id: actorId,
    name: "Synthetic browser reviewer",
    email: `${actorId}@example.invalid`,
    emailVerified: true,
    role: "admin",
  });
  await db.insert(schema.session).values({
    id: randomUUID(),
    token,
    userId: actorId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    title: "MOCK browser integration only",
    kind: "marketing",
    createdById: actorId,
  });
  await db.insert(schema.workspaceProjectMember).values({
    id: randomUUID(),
    projectId,
    userId: actorId,
    role: "owner",
    createdById: actorId,
  });
  // A synthetic persisted evidence record; file upload/storage is outside this test.
  await db.insert(schema.evidence).values({
    id: evidenceId,
    classification: "internal",
    blobKey: "synthetic/mock-browser-not-a-real-blob",
    contentType: "text/plain",
    sha256: "a".repeat(64),
    sizeBytes: 0,
    sourceLabel: "MOCK evidence — synthetic test only",
    uploadedByType: "human",
    uploadedById: actorId,
  });
});

test.afterAll(async () => {
  await pool.end();
});

test("authenticated browser reviews a mock product and its content through real Server Actions", async ({
  page,
  context,
  baseURL,
}) => {
  const path = `/workspace/${projectId}?panel=product`;
  // No auth bypass route: the application must verify the signed token against PostgreSQL.
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth/);
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
  await page.goto(path);
  await page.getByRole("tab", { name: "手动录入" }).click();
  const form = page.locator("form#create-product");
  await form.getByLabel("产品名称", { exact: true }).fill(productName);
  await form.getByLabel("内部编号", { exact: true }).fill(sku);
  await form.getByLabel("OE / OEM 编号", { exact: true }).fill("MOCK-OE-BROWSER");
  await form.getByLabel("来源引用", { exact: true }).fill("source-mock-browser");
  for (const label of ["产品名称证据", "产品类型证据", "内部编号证据", "OE / OEM 编号证据"]) {
    await form.getByLabel(label, { exact: true }).click();
    await page.getByRole("option", { name: /MOCK evidence/ }).click();
  }
  const creationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await page.getByRole("button", { name: "创建待审核草稿" }).click();
  expect((await creationResponse).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await db
            .select()
            .from(schema.aggregateRecord)
            .where(eq(schema.aggregateRecord.createdById, actorId))
        ).length,
    )
    .toBe(1);
  const [created] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.createdById, actorId));
  expect(created.state).toBe("PRODUCT_REVIEW_REQUIRED");
  expect(created.version).toBe(1);
  let [pending] = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.aggregateId, created.id));
  expect(pending.status).toBe("pending");
  // Navigate using the actual record link after the action refreshes the page.
  await page.getByRole("tab", { name: "记录 1", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(sku) }).click();
  await expect(page).toHaveURL(new RegExp(`item=${created.id}`));
  const review = page.locator("form#product-review");
  await review.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "退回产品事实", exact: true }).click();
  await review.getByLabel("审核证据", { exact: true }).click();
  await page.getByRole("option", { name: /MOCK evidence/ }).click();
  await review
    .locator("#product-review-notes")
    .fill("Synthetic source reference revision exercise.");
  await page.getByRole("button", { name: "退回产品事实", exact: true }).click();
  await expect(page.locator("form#revise-product")).toBeVisible();
  await page
    .locator("form#revise-product")
    .getByLabel("来源引用", { exact: true })
    .fill("source-mock-browser-revised");
  await page.getByRole("button", { name: "提交修订并送审", exact: true }).click();
  await expect(review).toBeVisible();
  const rejectedApprovalId = pending.id;
  [pending] = await db
    .select()
    .from(schema.approval)
    .where(and(eq(schema.approval.aggregateId, created.id), eq(schema.approval.status, "pending")));
  expect(pending.id).not.toBe(rejectedApprovalId);
  await review.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "批准产品事实", exact: true }).click();
  await review.getByLabel("审核证据", { exact: true }).click();
  await page.getByRole("option", { name: /MOCK evidence/ }).click();
  await review
    .locator("#product-review-notes")
    .fill("Synthetic approval only; no real factory or human approval.");
  const reviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await page.getByRole("button", { name: "批准产品事实", exact: true }).click();
  expect((await reviewResponse).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await db
            .select()
            .from(schema.aggregateRecord)
            .where(eq(schema.aggregateRecord.id, created.id))
        )[0].state,
    )
    .toBe("PRODUCT_READY");
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(sku) })).toContainText("已核验");
  await expect(page.locator("form#product-review")).toHaveCount(0);

  const [ready] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.id, created.id));
  expect(ready.version).toBe(4);
  expect(ready.payload).toMatchObject({
    source_ref: "source-mock-browser-revised",
    verification_status: "verified",
    approval_ref: pending.id,
    product: {
      product_name: productName,
      product_type: "clutch_disc",
      internal_sku: sku,
      oe_numbers: ["MOCK-OE-BROWSER"],
    },
    field_evidence: Object.fromEntries(
      ["product_name", "product_type", "internal_sku", "oe_numbers"].map((field) => [
        `product.${field}`,
        evidenceId,
      ]),
    ),
  });
  const [approved] = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.id, pending.id));
  expect(approved).toMatchObject({
    status: "approved",
    decidedById: actorId,
    evidenceRef: evidenceId,
  });
  const events = await db
    .select()
    .from(schema.workflowEvent)
    .where(eq(schema.workflowEvent.aggregateId, created.id));
  expect(events.map((event) => event.toState).sort()).toEqual([
    "PRODUCT_READY",
    "PRODUCT_REVIEW_REQUIRED",
    "PRODUCT_REVIEW_REQUIRED",
    "PRODUCT_REVISION_REQUIRED",
  ]);
  const audits = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.aggregateId, created.id));
  expect(audits.map((event) => event.action).sort()).toEqual([
    "product_draft_created",
    "product_draft_revised",
    "product_gate_01_decided",
    "product_gate_01_decided",
  ]);
  expect(audits.every((event) => event.actorId === actorId)).toBe(true);
  const [link] = await db
    .select()
    .from(schema.workspaceProjectItem)
    .where(eq(schema.workspaceProjectItem.aggregateId, created.id));
  expect(link.projectId).toBe(projectId);
  const [evidenceLink] = await db
    .select()
    .from(schema.workspaceProjectEvidence)
    .where(eq(schema.workspaceProjectEvidence.evidenceId, evidenceId));
  expect(evidenceLink.projectId).toBe(projectId);

  await page.goto(`/workspace/${projectId}?panel=content`);
  const contentForm = page.locator("form#create-content");
  await contentForm.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "product.oe_numbers", exact: true }).click();
  const contentBody =
    "MOCK test-only inquiry workflow. Reference MOCK-OE-BROWSER for this synthetic demonstration. No real offer.";
  await contentForm.getByLabel("开场句", { exact: true }).fill("MOCK browser content review");
  await contentForm.getByLabel("正文", { exact: true }).fill(contentBody);
  await contentForm.getByLabel("行动号召", { exact: true }).fill("Discuss the synthetic workflow");
  await contentForm.getByLabel("标签", { exact: true }).fill("#MockTest");
  await contentForm
    .getByLabel("视觉说明", { exact: true })
    .fill("Abstract background with a MOCK text card");
  const contentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await page.getByRole("button", { name: "创建待审内容", exact: true }).click();
  const savedContentResponse = await contentResponse;
  expect(savedContentResponse.ok()).toBe(true);
  expect(await savedContentResponse.text()).toContain('"status":"success"');
  const contentQuery = () =>
    db
      .select()
      .from(schema.aggregateRecord)
      .where(
        and(
          eq(schema.aggregateRecord.createdById, actorId),
          eq(schema.aggregateRecord.type, "content"),
        ),
      );
  await expect.poll(async () => (await contentQuery()).length).toBe(1);
  const [contentDraft] = await contentQuery();
  expect(contentDraft.state).toBe("CONTENT_REVIEW_REQUIRED");
  expect(contentDraft.version).toBe(1);
  expect(contentDraft.payload).toMatchObject({
    product_id: created.id,
    body: contentBody,
    status: "review_required",
    product_facts: [
      { field: "product.product_name", value: productName, evidence_ref: evidenceId },
      { field: "product.oe_numbers", value: "MOCK-OE-BROWSER", evidence_ref: evidenceId },
    ],
  });
  const [contentApproval] = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.aggregateId, contentDraft.id));
  expect(contentApproval.status).toBe("pending");
  await page.getByRole("tab", { name: "记录 1", exact: true }).click();
  await page.getByRole("button", { name: /MOCK browser content review/ }).click();
  const contentReview = page.locator("form#content-review");
  await contentReview.getByRole("combobox").click();
  await page.getByRole("option", { name: "退回营销内容", exact: true }).click();
  await contentReview.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await contentReview
    .locator("#content-review-notes")
    .fill("Synthetic revision exercise: check the wording.");
  await page.getByRole("button", { name: "退回营销内容", exact: true }).click();
  await expect.poll(async () => (await contentQuery())[0].state).toBe("CONTENT_REVISION_REQUIRED");
  const revisedBody = `${contentBody} Revision checked in the synthetic workflow.`;
  await page.locator("form#revise-content").getByLabel("正文", { exact: true }).fill(revisedBody);
  await page.getByRole("button", { name: "提交修订并送审", exact: true }).click();
  await expect.poll(async () => (await contentQuery())[0].state).toBe("CONTENT_REVIEW_REQUIRED");
  const [revisedContent] = await contentQuery();
  expect(revisedContent.version).toBe(3);
  expect(revisedContent.payload.body).toBe(revisedBody);
  expect(revisedContent.payload.product_facts).toEqual(contentDraft.payload.product_facts);
  const [revisionApproval] = await db
    .select()
    .from(schema.approval)
    .where(
      and(eq(schema.approval.aggregateId, contentDraft.id), eq(schema.approval.status, "pending")),
    );
  expect(revisionApproval.id).not.toBe(contentApproval.id);
  await contentReview.getByRole("combobox").click();
  await page.getByRole("option", { name: "批准营销内容", exact: true }).click();
  await contentReview.getByLabel("审核证据", { exact: true }).fill(evidenceId);
  await contentReview
    .locator("#content-review-notes")
    .fill("Synthetic test approval only; no real publication.");
  const contentReviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]),
  );
  await page.getByRole("button", { name: "批准营销内容", exact: true }).click();
  expect((await contentReviewResponse).ok()).toBe(true);
  await expect.poll(async () => (await contentQuery())[0].state).toBe("CONTENT_APPROVED");
  await page.reload();
  await expect(page.getByRole("button", { name: /MOCK browser content review/ })).toContainText(
    "已批准",
  );
  await expect(page.locator("form#content-review")).toHaveCount(0);
  const [approvedContent] = await contentQuery();
  expect(approvedContent.version).toBe(4);
  expect(approvedContent.payload).toEqual({
    ...revisedContent.payload,
    status: "approved",
    approval_ref: revisionApproval.id,
  });
  const [contentDecision] = await db
    .select()
    .from(schema.approval)
    .where(eq(schema.approval.id, revisionApproval.id));
  expect(contentDecision).toMatchObject({
    status: "approved",
    decidedById: actorId,
    evidenceRef: evidenceId,
  });
  const contentEvents = await db
    .select()
    .from(schema.workflowEvent)
    .where(eq(schema.workflowEvent.aggregateId, contentDraft.id));
  expect(contentEvents.map((event) => event.toState).sort()).toEqual([
    "CONTENT_APPROVED",
    "CONTENT_REVIEW_REQUIRED",
    "CONTENT_REVIEW_REQUIRED",
    "CONTENT_REVISION_REQUIRED",
  ]);
  expect(
    contentEvents.every(
      (event) => JSON.stringify(event.evidenceRefs) === JSON.stringify([evidenceId]),
    ),
  ).toBe(true);
  const contentAudits = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.aggregateId, contentDraft.id));
  expect(contentAudits.map((event) => event.action).sort()).toEqual([
    "content_draft_created",
    "content_draft_revised",
    "content_gate_01_decided",
    "content_gate_01_decided",
  ]);
  expect(contentAudits.every((event) => event.actorId === actorId)).toBe(true);
  const [contentLink] = await db
    .select()
    .from(schema.workspaceProjectItem)
    .where(eq(schema.workspaceProjectItem.aggregateId, contentDraft.id));
  expect(contentLink).toMatchObject({ projectId, role: "marketing_content" });
});
