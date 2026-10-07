import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import complete from "../../data/fixtures/product-draft-complete.synthetic.json";
import { CONTENT_REVIEW_ACCESS_MESSAGE } from "../../lib/content/review-write-access";
import { createContentDraft } from "../../lib/content/store";
import type { Database } from "../../lib/db/client";
import { closeDatabase } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { reviewProductDraft } from "../../lib/product/verification";
import { createProductAgentDraft, decideProductCatalogReview } from "../../lib/products";
import { authSecret, databaseURL } from "../../playwright.database.config";

// Real signed auth, review UI, Action, authorization locks and DB. Synthetic only;
// no model, Workflow, media processing, cloud storage or outbound business request.
process.env.DATABASE_URL = databaseURL;
process.env.DATABASE_TRANSPORT = "postgres";
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
test.afterAll(async () => {
  await pool.end();
  await closeDatabase();
});

for (const change of [
  "unchanged approve",
  "unchanged reject",
  "role removed",
  "session revoked",
  "banned",
  "expired",
  "missing evidence",
] as const) {
  test(`Content Gate 01 real browser ${change}: authorized decisions or intact pending content`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser base URL required");
    const actorId = randomUUID(),
      ownerId = randomUUID(),
      sessionId = randomUUID(),
      projectId = randomUUID(),
      productId = randomUUID(),
      token = randomUUID();
    const evidenceId = `evidence-synthetic-review-browser-${randomUUID()}`;
    const notes = "SYNTHETIC browser reviewer notes retained";
    const revoke = ["role removed", "session revoked", "banned", "expired"].includes(change);
    const missingEvidence = change === "missing evidence";
    const reviewEvidence = missingEvidence
      ? `evidence-synthetic-missing-${randomUUID()}`
      : evidenceId;
    const decision = change === "unchanged reject" ? "rejected" : "approved";
    const label = decision === "approved" ? "批准营销内容" : "退回营销内容";
    const selectErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /uncontrolled[\s\S]*Select|controlled[\s\S]*Select/.test(message.text())
      )
        selectErrors.push(message.text());
    });
    let blocker: PoolClient | undefined;
    let pending: Promise<void> | undefined;
    try {
      for (const [id, role] of [
        [actorId, "admin"],
        [ownerId, "user"],
      ])
        await db.insert(schema.user).values({
          id,
          name: "SYNTHETIC browser reviewer",
          email: `${id}@example.invalid`,
          emailVerified: true,
          role,
        });
      await db.insert(schema.session).values({
        id: sessionId,
        userId: actorId,
        token,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await db.insert(schema.workspaceProject).values({
        id: projectId,
        kind: "marketing",
        title: "SYNTHETIC browser review",
        createdById: ownerId,
      });
      for (const [userId, role] of [
        [actorId, "editor"],
        [ownerId, "owner"],
      ] as const)
        await db
          .insert(schema.workspaceProjectMember)
          .values({ id: randomUUID(), projectId, userId, role, createdById: ownerId });
      await db.insert(schema.evidence).values({
        id: evidenceId,
        classification: "internal",
        blobKey: `synthetic/${evidenceId}`,
        contentType: "text/plain",
        sha256: createHash("sha256").update(evidenceId).digest("hex"),
        sizeBytes: 1,
        sourceLabel: "SYNTHETIC browser review source",
        uploadedByType: "human",
        uploadedById: actorId,
      });
      await db
        .insert(schema.workspaceProjectEvidence)
        .values({ id: randomUUID(), projectId, evidenceId, linkedById: actorId });
      const draft = reviewProductDraft({
        ...complete,
        record_id: productId,
        source_ref: "source-synthetic-browser-review",
        evidence_refs: [evidenceId],
        field_evidence: Object.fromEntries(
          Object.keys(complete.field_evidence).map((key) => [key, evidenceId]),
        ),
        product: { ...complete.product, product_name: "SYNTHETIC browser review product" },
      });
      const savedProduct = await createProductAgentDraft(
        draft,
        { actorId, sessionId, projectId },
        { synthetic: true },
        [],
        db as unknown as Database,
      );
      const identity = { actorId, sessionId, projectId };
      await decideProductCatalogReview(
        {
          productId,
          approvalId: savedProduct.approvalId,
          reviewedVersion: "1",
          decision: "approved",
          evidenceRef: evidenceId,
          notes: "SYNTHETIC source verification",
        },
        identity,
        db as unknown as Database,
      );
      const savedContent = await createContentDraft(
        {
          productId,
          contentType: "product",
          factPath: "product.product_name",
          objective: "SYNTHETIC content review",
          targetCustomer: "SYNTHETIC test-only buyer",
          hook: "SYNTHETIC marketing copy",
          body: "SYNTHETIC browser body for review",
          callToAction: "SYNTHETIC workflow inquiry",
          hashtags: "#Synthetic",
          visualInstruction: "SYNTHETIC text card",
        },
        actorId,
        projectId,
      );
      const contentId = savedContent.id;
      const snapshot = async () => {
        const [contents, gates, workflows, audits, links] = await Promise.all([
          db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, contentId)),
          db.select().from(schema.approval).where(eq(schema.approval.aggregateId, contentId)),
          db
            .select()
            .from(schema.workflowEvent)
            .where(eq(schema.workflowEvent.aggregateId, contentId)),
          db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, contentId)),
          db
            .select()
            .from(schema.workspaceProjectEvidence)
            .where(eq(schema.workspaceProjectEvidence.projectId, projectId)),
        ]);
        return { contents, gates, workflows, audits, links };
      };
      const before = await snapshot();
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
      const path = `/workspace/${projectId}/records/content/${contentId}`;
      await page.goto(path);
      const form = page.locator("form#content-review").filter({ visible: true });
      await expect(form).toBeVisible();
      await expect(form.locator('#content-review-decision [data-slot="select-value"]')).toHaveText(
        "请选择审核决定",
      );
      await expect(
        page.getByRole("button", { name: "请先选择决定", exact: true }).filter({ visible: true }),
      ).toBeDisabled();
      await form.getByRole("combobox", { name: "决定", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await form.getByLabel("审核证据", { exact: true }).fill(reviewEvidence);
      await form.locator("#content-review-notes").fill(notes);
      const submit = page
        .getByRole("button", { name: label, exact: true })
        .filter({ visible: true });
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (revoke) {
        blocker = await pool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [contentId]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = submit.click();
        await pending;
        await expect(
          page
            .getByRole("button", { name: "正在加载… 批准营销内容", exact: true })
            .filter({ visible: true }),
        ).toBeDisabled();
        await expect
          .poll(
            async () => {
              const {
                rows: [row],
              } = await pool.query<{ blocked: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
                [backend.pid],
              );
              return row.blocked;
            },
            { message: "Observe the actual Server Action content-lock wait" },
          )
          .toBe(true);
        if (change === "role removed")
          await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, actorId));
        if (change === "session revoked")
          await db.delete(schema.session).where(eq(schema.session.id, sessionId));
        if (change === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, actorId));
        if (change === "expired")
          await db
            .update(schema.session)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(schema.session.id, sessionId));
        await blocker.query("COMMIT");
      } else await submit.click();
      expect((await response).ok()).toBe(true);
      expect(selectErrors).toEqual([]);
      if (revoke || missingEvidence) {
        await expect(
          page
            .getByText(
              missingEvidence
                ? "部分证据不存在或无权用于当前项目。"
                : CONTENT_REVIEW_ACCESS_MESSAGE,
              { exact: true },
            )
            .filter({ visible: true }),
        ).toBeVisible();
        await expect(form.locator("#content-review-notes")).toHaveValue(notes);
        await expect(
          form
            .getByRole("combobox", { name: "决定", exact: true })
            .locator('[data-slot="select-value"]'),
        ).toHaveText(label);
        await expect(form.getByLabel("审核证据", { exact: true })).toHaveValue(reviewEvidence);
        await expect(submit).toBeEnabled();
        expect(await snapshot()).toEqual(before);
      } else {
        await expect(
          page
            .getByRole("region", { name: "业务记录", exact: true })
            .getByText(decision === "approved" ? "可安排发布" : "待修订", { exact: true })
            .filter({ visible: true }),
        ).toBeVisible();
        const after = await snapshot();
        expect(after.contents[0].state).toBe(
          decision === "approved" ? "CONTENT_APPROVED" : "CONTENT_REVISION_REQUIRED",
        );
        expect(after.contents[0].version).toBe(2);
        expect(after.contents[0].payload.product_facts).toEqual(savedContent.content.product_facts);
        expect(after.contents[0].payload.body).toEqual(savedContent.content.body);
        expect(after.gates[0].status).toBe(decision);
        expect(after.workflows).toHaveLength(2);
        expect(after.audits.filter((row) => row.action === "content_gate_01_decided")).toHaveLength(
          1,
        );
        await page.reload();
        await expect(
          page
            .getByRole("region", { name: "业务记录", exact: true })
            .getByText(decision === "approved" ? "可安排发布" : "待修订", { exact: true })
            .filter({ visible: true }),
        ).toBeVisible();
      }
    } finally {
      if (blocker) {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      await pending;
      // Audit and review records are append-only; keep synthetic evidence intact.
      await db
        .delete(schema.session)
        .where(and(eq(schema.session.id, sessionId), eq(schema.session.userId, actorId)));
    }
  });
}
