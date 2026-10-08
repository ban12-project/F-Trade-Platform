import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { closeDatabase, type Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { VIDEO_REVIEW_ACCESS_MESSAGE } from "../../lib/video/review-write-access";
import { authSecret, databaseURL } from "../../playwright.database.config";
import { seedVideoReviewFixture } from "../fixtures/video-review";

// Real signed auth, UI, Action and DB. The synthetic export receipt represents
// contract data only. Preview requests are stopped: no real media/cloud/provider.
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
  "approve",
  "reject",
  "role removed",
  "session revoked",
  "banned",
  "expired",
  "missing evidence",
  "foreign evidence",
  "product wait expired",
] as const) {
  test(`Video Gate real browser ${change}: authorized decisions or intact pending video`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser base URL required");
    const f = await seedVideoReviewFixture(db as unknown as Database);
    const revoke = [
      "role removed",
      "session revoked",
      "banned",
      "expired",
      "product wait expired",
    ].includes(change);
    const decision = change === "reject" ? "rejected" : "approved";
    const evidenceRef =
      change === "missing evidence" ? `evidence-synthetic-missing-${randomUUID()}` : f.decisionRef;
    if (change === "foreign evidence")
      await db
        .update(schema.evidence)
        .set({ uploadedById: f.ownerId })
        .where(eq(schema.evidence.id, f.decisionRef));
    const snapshot = async () => {
      const [videos, gates, workflows, audits, links, projects] = await Promise.all([
        db.select().from(schema.aggregateRecord).where(eq(schema.aggregateRecord.id, f.videoId)),
        db.select().from(schema.approval).where(eq(schema.approval.aggregateId, f.videoId)),
        db
          .select()
          .from(schema.workflowEvent)
          .where(eq(schema.workflowEvent.aggregateId, f.videoId)),
        db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, f.videoId)),
        db
          .select()
          .from(schema.workspaceProjectEvidence)
          .where(eq(schema.workspaceProjectEvidence.projectId, f.projectId)),
        db
          .select({ updatedAt: schema.workspaceProject.updatedAt })
          .from(schema.workspaceProject)
          .where(eq(schema.workspaceProject.id, f.projectId)),
      ]);
      return { videos, gates, workflows, audits, links, projects };
    };
    const before = await snapshot();
    const signature = createHmac("sha256", authSecret).update(f.token).digest("base64");
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(`${f.token}.${signature}`),
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.route("**/api/video-preview/**", (route) =>
      route.fulfill({ status: 404, body: "SYNTHETIC no media" }),
    );
    let blocker: PoolClient | undefined;
    try {
      await page.goto(`/workspace/${f.projectId}/records/video/${f.videoId}`);
      const evidence = page.locator("#video-review-evidence").filter({ visible: true });
      await expect(evidence).toBeVisible();
      await evidence.click();
      await evidence.fill(evidenceRef);
      const label = decision === "approved" ? "通过成片" : "退回修改";
      const submit = page
        .getByRole("button", { name: label, exact: true })
        .filter({ visible: true });
      await expect(evidence).toHaveValue(evidenceRef);
      await expect(submit).toBeEnabled();
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (revoke) {
        blocker = await pool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
          change === "product wait expired" ? f.productId : f.videoId,
        ]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        await submit.click();
        await expect(submit).toBeDisabled();
        await expect
          .poll(async () => {
            const {
              rows: [r],
            } = await pool.query<{ blocked: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
              [backend.pid],
            );
            return r.blocked;
          })
          .toBe(true);
        if (change === "role removed")
          await db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, f.actorId));
        if (change === "session revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        if (change === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
        if (change === "expired")
          await db
            .update(schema.session)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(schema.session.id, f.sessionId));
        if (change === "product wait expired") {
          // Set after actual auth/request entry: Better Auth may renew a near-expiry session.
          const expires = new Date(Date.now() + 650);
          await db
            .update(schema.session)
            .set({ expiresAt: expires })
            .where(eq(schema.session.id, f.sessionId));
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
        }
        await blocker.query("COMMIT");
      } else await submit.click();
      expect((await response).status()).toBe(200);
      if (revoke || change.endsWith("evidence")) {
        const message = revoke ? VIDEO_REVIEW_ACCESS_MESSAGE : "部分证据不存在或无权用于当前项目。";
        await expect(
          page.getByText(message, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        await expect(evidence).toHaveValue(evidenceRef);
        expect(await snapshot()).toEqual(before);
      } else {
        const message =
          decision === "approved" ? "成片已通过人工审核；不会自动发布。" : "成片已退回修改。";
        await expect(
          page.getByText(message, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        const after = await snapshot();
        expect(after.videos[0].state).toBe(
          decision === "approved" ? "VIDEO_APPROVED" : "VIDEO_REVISION_REQUIRED",
        );
        expect(after.videos[0].version).toBe(2);
        expect(after.gates[0].status).toBe(decision);
        expect(after.gates[0].evidenceRef).toBe(evidenceRef);
        expect(after.audits.length).toBe(before.audits.length + 1);
        expect(after.workflows.length).toBe(before.workflows.length + 1);
        expect(after.links.filter((link) => link.evidenceId === evidenceRef)).toHaveLength(1);
      }
    } finally {
      if (blocker) {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
    }
  });
}
