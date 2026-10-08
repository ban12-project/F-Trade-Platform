import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { type BrowserContext, expect, test } from "@playwright/test";
import { getCookies } from "better-auth/cookies";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { closeDatabase, type Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { VIDEO_DRAFT_ACCESS_MESSAGE } from "../../lib/video/draft-write-access";
import { authSecret, databaseURL } from "../../playwright.database.config";
import { seedVideoDraftFixture } from "../fixtures/video-draft";

process.env.DATABASE_URL = databaseURL;
process.env.DATABASE_TRANSPORT = "postgres";
const pool = new Pool({ connectionString: databaseURL }),
  db = drizzle(pool, { schema });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
test.afterAll(async () => {
  await pool.end();
  await closeDatabase();
});

async function preventFixtureSessionRenewal(context: BrowserContext, baseURL: string) {
  // Use Better Auth's non-persistent login cookie so background reads cannot
  // renew the deadline while the test waits for a genuinely expired session.
  const cookie = getCookies({ baseURL }).dontRememberToken;
  const signature = createHmac("sha256", authSecret).update("true").digest("base64");
  await context.addCookies([
    {
      name: cookie.name,
      value: encodeURIComponent(`true.${signature}`),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      secure: cookie.attributes.secure,
    },
  ]);
}

async function assertFixtureSessionExpired(sessionId: string) {
  const [current] = await db
    .select({ expiresAt: schema.session.expiresAt })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  // Better Auth may already have removed the expired session on a read.
  expect(current?.expiresAt.getTime() ?? 0).toBeLessThanOrEqual(Date.now());
}

const cases: Array<{
  op: "save" | "copy";
  role: "admin" | "user";
  change: "unchanged" | "revoked" | "banned" | "source removed" | "expired";
}> = [];
for (const op of ["save", "copy"] as const)
  for (const role of ["admin", "user"] as const)
    for (const change of ["unchanged", "revoked", "banned"] as const)
      cases.push({ op, role, change });
for (const role of ["admin", "user"] as const)
  cases.push({ op: "copy", role, change: "source removed" });
for (const op of ["save", "copy"] as const) cases.push({ op, role: "user", change: "expired" });

for (const { op, role, change } of cases)
  test(`Video draft ${op} ${role} ${change}: signed browser authorizes or retains all pending input`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw Error("Browser base URL required");
    const f = await seedVideoDraftFixture(db as unknown as Database, role);
    const text = "SYNTHETIC browser changed CTA";
    const snapshot = async () => {
      const [records, audits, links, projects] = await Promise.all([
        db
          .select()
          .from(schema.aggregateRecord)
          .where(eq(schema.aggregateRecord.createdById, f.actorId)),
        db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, f.actorId)),
        db
          .select()
          .from(schema.workspaceProjectItem)
          .where(inArray(schema.workspaceProjectItem.projectId, [f.projectId, f.targetProjectId])),
        db
          .select({ id: schema.workspaceProject.id, updatedAt: schema.workspaceProject.updatedAt })
          .from(schema.workspaceProject)
          .where(inArray(schema.workspaceProject.id, [f.projectId, f.targetProjectId])),
      ]);
      const ids = records.map((r) => r.id);
      const [gates, events, jobs] = await Promise.all([
        db.select().from(schema.approval).where(inArray(schema.approval.aggregateId, ids)),
        db
          .select()
          .from(schema.workflowEvent)
          .where(inArray(schema.workflowEvent.aggregateId, ids)),
        db
          .select()
          .from(schema.videoProcessingJob)
          .where(inArray(schema.videoProcessingJob.videoProjectId, ids)),
      ]);
      return { records, audits, links, projects, gates, events, jobs };
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
    if (change === "expired") await preventFixtureSessionRenewal(context, baseURL);
    let blocker: PoolClient | undefined;
    try {
      await page.goto(
        op === "save"
          ? `/workspace/${f.projectId}/records/video/${f.videoId}`
          : `/workspace/${f.targetProjectId}/new/video`,
      );
      const cta = page.getByLabel("最后两秒 CTA", { exact: true }).filter({ visible: true });
      if (op === "save") {
        await expect(cta).toBeVisible();
        await cta.click();
        await cta.clear();
        await cta.fill(text);
        await expect(cta).toHaveValue(text);
      }
      const label = op === "save" ? "保存" : "复制为新剪辑稿";
      const submit = page
        .getByRole("button", { name: label, exact: true })
        .filter({ visible: true });
      await expect(submit).toBeEnabled();
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (change !== "unchanged") {
        blocker = await pool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
          op === "save" ? f.videoId : f.productId,
        ]);
        const {
          rows: [backend],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        // The Action is deliberately blocked; wait for its response after unlocking.
        await submit.click({ noWaitAfter: true });
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
        if (change === "revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        if (change === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
        if (change === "source removed")
          await db
            .delete(schema.workspaceProjectMember)
            .where(
              and(
                eq(schema.workspaceProjectMember.projectId, f.projectId),
                eq(schema.workspaceProjectMember.userId, f.actorId),
              ),
            );
        if (change === "expired") {
          const expires = new Date(Date.now() + 650);
          await db
            .update(schema.session)
            .set({ expiresAt: expires })
            .where(eq(schema.session.id, f.sessionId));
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
          await assertFixtureSessionExpired(f.sessionId);
        }
        await blocker.query("COMMIT");
      } else await submit.click();
      expect((await response).status()).toBe(200);
      if (change !== "unchanged") {
        await expect(
          page.getByText(VIDEO_DRAFT_ACCESS_MESSAGE, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        if (op === "save") await expect(cta).toHaveValue(text);
        else await expect(submit).toBeEnabled();
        expect(await snapshot()).toEqual(before);
      } else {
        const after = await snapshot(),
          source = after.records.find((r) => r.id === f.videoId),
          product = after.records.find((r) => r.id === f.productId);
        expect(source).toBeDefined();
        expect(product?.payload).toEqual(f.product);
        expect(after.audits).toHaveLength(1);
        expect(after.gates).toEqual([]);
        expect(after.events).toEqual([]);
        expect(after.jobs).toEqual([]);
        if (op === "save") {
          await expect(
            page.getByText("剪辑稿已保存。", { exact: true }).filter({ visible: true }),
          ).toBeVisible();
          await expect(cta).toHaveValue(text);
          expect(source?.version).toBe(2);
          expect((source?.payload as typeof f.video | undefined)?.factualClaims).toEqual(
            f.video.factualClaims,
          );
        } else {
          const copy = after.records.find((r) => r.type === "video" && r.id !== f.videoId);
          expect(copy).toBeDefined();
          expect(copy?.state).toBe("VIDEO_DRAFT");
          expect(copy?.version).toBe(1);
          expect(source?.version).toBe(1);
          const payload = copy?.payload as typeof f.video;
          expect(payload.editDraft).toEqual(JSON.parse(JSON.stringify(f.draft)));
          expect(payload.factualClaims).toEqual(f.video.factualClaims);
          expect(payload.sourceAssets).toEqual(f.video.sourceAssets);
          expect(payload.approvalRefs).toEqual([]);
          expect(payload.exportArtifact).toBeUndefined();
          expect(payload.renderedAssetRef).toBeUndefined();
          await expect(page).toHaveURL(
            `/workspace/${f.targetProjectId}/video?item=${copy?.id}&returnTo=${encodeURIComponent(`/workspace/content?project=${f.targetProjectId}`)}`,
          );
        }
      }
    } finally {
      if (blocker) {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
    }
  });

for (const op of ["create", "generate", "render"] as const) {
  const cases: Array<{ role: "admin" | "user"; change: "revoked" | "banned" | "expired" }> = [];
  for (const role of ["admin", "user"] as const)
    for (const change of ["revoked", "banned"] as const) cases.push({ role, change });
  cases.push({ role: "user", change: "expired" });
  for (const { role, change } of cases)
    test(`Video ${op} ${role} ${change}: signed browser denies stale submission without business writes`, async ({
      page,
      context,
      baseURL,
    }) => {
      if (!baseURL) throw Error("Browser URL required");
      const { seedVideoCreationFixture } = await import("../fixtures/video-draft");
      const f =
        op === "create"
          ? await seedVideoCreationFixture(db as unknown as Database, role)
          : await seedVideoDraftFixture(db as unknown as Database, role);
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
      if (change === "expired") await preventFixtureSessionRenewal(context, baseURL);
      const snapshot = async () => {
        const [records, audits, links, project] = await Promise.all([
          db
            .select()
            .from(schema.aggregateRecord)
            .where(eq(schema.aggregateRecord.createdById, f.actorId)),
          db.select().from(schema.auditEvent).where(eq(schema.auditEvent.actorId, f.actorId)),
          db
            .select()
            .from(schema.workspaceProjectItem)
            .where(eq(schema.workspaceProjectItem.projectId, f.projectId)),
          db
            .select()
            .from(schema.workspaceProject)
            .where(eq(schema.workspaceProject.id, f.projectId)),
        ]);
        const jobs = await db
          .select()
          .from(schema.videoProcessingJob)
          .where(
            inArray(
              schema.videoProcessingJob.videoProjectId,
              records.map((r) => r.id),
            ),
          );
        return { records, audits, links, project, jobs };
      };
      const before = await snapshot();
      const blocker = await pool.connect();
      try {
        await page.goto(
          op === "create"
            ? `/workspace/${f.projectId}/new/video`
            : `/workspace/${f.projectId}/records/video/${f.videoId}`,
        );
        const cta = page.getByLabel("最后两秒 CTA", { exact: true }).filter({ visible: true });
        if (op === "create") {
          const objective = page.getByLabel("视频目标", { exact: true });
          await objective.click();
          await objective.clear();
          await objective.fill("SYNTHETIC browser creation");
          await expect(objective).toHaveValue("SYNTHETIC browser creation");
          await page.getByLabel("目标受众", { exact: true }).fill("SYNTHETIC browser buyers");
        }
        if (op === "render") {
          await expect(cta).toBeVisible();
          await cta.click();
          await cta.clear();
          await cta.fill("SYNTHETIC render changed CTA");
          await expect(cta).toHaveValue("SYNTHETIC render changed CTA");
        }
        const button = page
          .getByRole("button", {
            name:
              op === "create"
                ? "复用媒体并生成 AI 初稿"
                : op === "generate"
                  ? "AI 初稿"
                  : "合成预览",
            exact: true,
          })
          .filter({ visible: true });
        const pendingButton =
          op === "create" ? page.locator('button[form="create-marketing-video"]') : button;
        await expect(button).toBeEnabled();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
          op === "create" ? f.productId : f.videoId,
        ]);
        const {
          rows: [r],
        } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const response = page.waitForResponse(
          (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
        );
        // The Action is deliberately blocked; wait for its response after unlocking.
        await button.click({ noWaitAfter: true });
        await expect(pendingButton).toBeDisabled();
        await expect
          .poll(async () => {
            const {
              rows: [v],
            } = await pool.query<{ blocked: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
              [r.pid],
            );
            return v.blocked;
          })
          .toBe(true);
        if (change === "revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        else if (change === "banned")
          await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, f.actorId));
        else {
          const expires = new Date(Date.now() + 650);
          await db
            .update(schema.session)
            .set({ expiresAt: expires })
            .where(eq(schema.session.id, f.sessionId));
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
          await assertFixtureSessionExpired(f.sessionId);
        }
        await blocker.query("COMMIT");
        expect((await response).status()).toBe(200);
        await expect(
          page.getByText(VIDEO_DRAFT_ACCESS_MESSAGE, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        expect(await snapshot()).toEqual(before);
        if (op === "render") await expect(cta).toHaveValue("SYNTHETIC render changed CTA");
        if (op === "create") {
          await expect(page.getByLabel("视频目标", { exact: true })).toHaveValue(
            "SYNTHETIC browser creation",
          );
          await expect(page.getByLabel("目标受众", { exact: true })).toHaveValue(
            "SYNTHETIC browser buyers",
          );
        }
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
      }
    });
}

for (const change of ["unchanged", "revoked", "demoted", "banned"] as const)
  test(`ProductMedia review ${change}: signed browser enforces the current reviewer`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw Error("Browser URL required");
    const { seedVideoCreationFixture } = await import("../fixtures/video-draft");
    const { productMediaAsset } = await import("../../lib/db/product-media-schema");
    const f = await seedVideoCreationFixture(db as unknown as Database, "admin");
    await db
      .update(productMediaAsset)
      .set({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, reviewEvidenceRef: null })
      .where(eq(productMediaAsset.id, f.mediaId));
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
    const snapshot = async () => {
      const [media, audits, links] = await Promise.all([
        db.select().from(productMediaAsset).where(eq(productMediaAsset.productId, f.productId)),
        db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, f.productId)),
        db
          .select()
          .from(schema.workspaceProjectEvidence)
          .where(eq(schema.workspaceProjectEvidence.projectId, f.projectId)),
      ]);
      return { media, audits, links };
    };
    const before = await snapshot();
    const c = await pool.connect();
    try {
      await page.goto(`/workspace/${f.projectId}/records/product/${f.productId}`);
      const reviewForm = page
        .locator("form")
        .filter({ has: page.getByLabel("审核证据", { exact: true }) });
      const select = reviewForm.getByRole("combobox");
      await expect(select).toHaveCount(1);
      await select.click();
      await page.getByRole("option", { name: "批准素材", exact: true }).click();
      const evidence = page.getByLabel("审核证据", { exact: true }).filter({ visible: true }),
        notes = page.getByLabel("审核备注", { exact: true }).filter({ visible: true });
      await evidence.fill(f.decisionRef);
      await notes.fill("SYNTHETIC browser media approval");
      await expect(evidence).toHaveValue(f.decisionRef);
      const button = page
        .getByRole("button", { name: "批准产品素材", exact: true })
        .filter({ visible: true });
      await expect(button).toBeEnabled();
      if (change !== "unchanged") {
        await c.query("BEGIN");
        await c.query("SELECT id FROM product_media_asset WHERE id=$1 FOR UPDATE", [f.mediaId]);
      }
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      await button.click();
      if (change !== "unchanged") {
        const {
          rows: [r],
        } = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        await expect
          .poll(async () => {
            const {
              rows: [v],
            } = await pool.query<{ blocked: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
              [r.pid],
            );
            return v.blocked;
          })
          .toBe(true);
        if (change === "revoked")
          await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
        else
          await db
            .update(schema.user)
            .set(change === "banned" ? { banned: true } : { role: "user" })
            .where(eq(schema.user.id, f.actorId));
        await c.query("COMMIT");
      }
      expect((await response).status()).toBe(200);
      if (change === "unchanged") {
        await expect(
          page.getByText("产品媒体已批准，可按其授权范围进入营销视频。", { exact: true }),
        ).toBeVisible();
        const after = await snapshot();
        expect(after.media[0].reviewStatus).toBe("approved");
        expect(after.media[0].version).toBe(2);
        expect(after.audits).toHaveLength(1);
        expect(after.links.some((l) => l.evidenceId === f.decisionRef)).toBe(true);
      } else {
        await expect(
          page.getByText(
            "无法确认当前登录或产品媒体权限，本次请求未提交。请重新登录并确认项目权限后重试。",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(evidence).toHaveValue(f.decisionRef);
        await expect(notes).toHaveValue("SYNTHETIC browser media approval");
        expect(await snapshot()).toEqual(before);
      }
    } finally {
      await c.query("ROLLBACK");
      c.release();
      await db.delete(schema.session).where(eq(schema.session.id, f.sessionId));
    }
  });
