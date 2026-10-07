import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import complete from "../../data/fixtures/product-draft-complete.synthetic.json";
import { CONTENT_DRAFT_ACCESS_MESSAGE } from "../../lib/content/draft-write-access";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { reviewProductDraft } from "../../lib/product/verification";
import { createProductAgentDraft, decideProductCatalogReview } from "../../lib/products";
import { authSecret, databaseURL } from "../../playwright.database.config";

// Real signed auth, review UI, Action, authorization locks and DB. Synthetic only;
// no model, Workflow, media processing, cloud storage or outbound business request.
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});

for (const change of [
  "unchanged admin",
  "unchanged user",
  "invalid role",
  "session revoked",
  "banned",
  "expired",
] as const) {
  test(`Manual content draft real browser ${change}: authorized creation or zero content writes`, async ({
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
    const values = {
      objective: "SYNTHETIC browser objective",
      targetCustomer: "SYNTHETIC browser buyer",
      hook: "SYNTHETIC browser hook",
      body: "SYNTHETIC browser body retained",
      callToAction: "SYNTHETIC contact",
      hashtags: "#Synthetic",
      visualInstruction: "SYNTHETIC text card",
    };
    const revoke = !change.startsWith("unchanged");
    const label = "创建待审内容";
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
      if (change === "unchanged user")
        await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, actorId));
      const snapshot = async () => {
        const [products, contents, gates, workflows, audits, items] = await Promise.all([
          db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, productId)),
          db
            .select()
            .from(schema.aggregateRecord)
            .where(
              and(
                eq(schema.aggregateRecord.type, "content"),
                eq(schema.aggregateRecord.createdById, actorId),
              ),
            ),
          db.select().from(schema.approval).where(eq(schema.approval.requestedById, actorId)),
          db.select().from(schema.workflowEvent).where(eq(schema.workflowEvent.actorId, actorId)),
          db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, actorId)),
          db
            .select()
            .from(schema.workspaceProjectItem)
            .where(eq(schema.workspaceProjectItem.projectId, projectId)),
        ]);
        return { products, contents, gates, workflows, audits, items };
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
      const path = `/workspace/${projectId}/new/content?product=${productId}`;
      await page.goto(path);
      const form = page.locator("form#create-content").filter({ visible: true });
      await expect(form).toBeVisible();
      await expect(form.locator("#content-source-product [data-slot='select-value']")).toHaveText(
        `${draft.product.internal_sku} · ${draft.product.product_name}`,
      );
      await form.getByRole("combobox", { name: "允许引用的产品事实", exact: true }).click();
      await page.getByRole("option", { name: /产品名称/ }).click();
      const fields = {
        objective: "#content-objective",
        targetCustomer: "#target-customer",
        hook: "#content-hook",
        body: "#content-body",
        callToAction: "#content-cta",
        hashtags: "#content-hashtags",
        visualInstruction: "#visual-instruction",
      };
      for (const [key, selector] of Object.entries(fields))
        await form.locator(selector).fill(values[key as keyof typeof values]);
      const submit = page
        .getByRole("button", { name: label, exact: true })
        .filter({ visible: true });
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (revoke) {
        blocker = await pool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [productId]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pending = submit.click();
        await pending;
        await expect(
          page
            .getByRole("button", { name: "正在加载… 创建待审内容", exact: true })
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
            { message: "Observe the actual Server Action source-product lock wait" },
          )
          .toBe(true);
        if (change === "invalid role")
          await db
            .update(schema.user)
            .set({ role: "unknown-synthetic-role" })
            .where(eq(schema.user.id, actorId));
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
      if (revoke) {
        await expect(
          page.getByText(CONTENT_DRAFT_ACCESS_MESSAGE, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        for (const [key, selector] of Object.entries(fields))
          await expect(form.locator(selector)).toHaveValue(values[key as keyof typeof values]);
        await expect(form.locator("#content-source-product [data-slot='select-value']")).toHaveText(
          `${draft.product.internal_sku} · ${draft.product.product_name}`,
        );
        await expect(form.locator("#content-source-fact [data-slot='select-value']")).toHaveText(
          "产品名称",
        );
        await expect(submit).toBeEnabled();
        expect(await snapshot()).toEqual(before);
      } else {
        await expect(page).toHaveURL(new RegExp(`/workspace/${projectId}/records/content/`));
        await expect(
          page
            .getByRole("region", { name: "业务记录", exact: true })
            .getByText("待审核", { exact: true })
            .filter({ visible: true }),
        ).toBeVisible();
        const after = await snapshot();
        expect(after.products).toEqual(before.products);
        expect(after.contents).toHaveLength(1);
        const content = after.contents[0];
        expect(content.state).toBe("CONTENT_REVIEW_REQUIRED");
        expect(content.version).toBe(1);
        expect(content.payload.product_facts).toEqual([
          {
            field: "product.product_name",
            value: draft.product.product_name,
            evidence_ref: evidenceId,
          },
        ]);
        expect(content.payload.body).toEqual(values.body);
        expect(after.gates.filter((r) => r.aggregateId === content.id)[0].status).toBe("pending");
        expect(after.workflows.filter((r) => r.aggregateId === content.id)).toHaveLength(1);
        expect(
          after.audits.filter(
            (r) => r.aggregateId === content.id && r.action === "content_draft_created",
          ),
        ).toHaveLength(1);
        expect(
          after.items.filter(
            (r) =>
              r.aggregateId === content.id &&
              r.role === "marketing_content" &&
              r.relation === "owned",
          ),
        ).toHaveLength(1);
        await page.reload();
        await expect(
          page
            .getByRole("region", { name: "业务记录", exact: true })
            .getByText(values.body, { exact: true })
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
