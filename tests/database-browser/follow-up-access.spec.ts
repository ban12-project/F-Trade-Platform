import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";
import { decryptSocialMessageBody } from "../../lib/social/message-crypto";
import { authSecret, databaseURL, socialMessageKey } from "../../playwright.database.config";
import { seedFollowUpFixture } from "../fixtures/follow-up-access";

process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = socialMessageKey;
const pool = new Pool({ connectionString: databaseURL }),
  db = drizzle(pool, { schema: s });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});
type Case = {
  role: "user" | "admin";
  context: "quote_sent_unread" | "asks_sample";
  change:
    | "unchanged"
    | "revoked"
    | "banned"
    | "role"
    | "natural-expiry"
    | "viewer"
    | "removed"
    | "archived"
    | "kind"
    | "window"
    | "retention"
    | "delivery";
};
const cases: Case[] = [];
for (const role of ["user", "admin"] as const)
  for (const context of ["quote_sent_unread", "asks_sample"] as const)
    cases.push({ role, context, change: "unchanged" });
for (const change of [
  "revoked",
  "banned",
  "role",
  "natural-expiry",
  "viewer",
  "removed",
  "archived",
  "kind",
  "window",
  "retention",
  "delivery",
] as const)
  cases.push({
    role: "user",
    context: change === "delivery" ? "asks_sample" : "quote_sent_unread",
    change,
  });
for (const { role, context: scenario, change } of cases)
  test(`Current human reply ${role} ${scenario} ${change}: signed form queues once or preserves draft without writes`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw Error("Local browser base URL required");
    const f = await seedFollowUpFixture(db as unknown as Database, role);
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
    async function snapshot() {
      const r = await db.execute(sql`SELECT
        (SELECT count(*)::int FROM social_browser_job WHERE channel_ref=${f.channelRef}) AS jobs,
        (SELECT count(*)::int FROM social_message WHERE conversation_id=${f.conversationId} AND direction='outbound') AS outbound,
        (SELECT count(*)::int FROM audit_event WHERE actor_id=${f.actorId} AND action='lead.follow_up_submitted') AS audits,
        (SELECT version FROM aggregate_record WHERE id=${f.leadId}) AS version,
        (SELECT payload FROM aggregate_record WHERE id=${f.leadId}) AS payload`);
      return r.rows[0];
    }
    let held: PoolClient | undefined;
    try {
      await page.goto(`/workspace/${f.projectId}/records/lead/${f.leadId}`);
      const form = page.locator(`form#follow-up-${f.leadId}`).filter({ visible: true });
      await expect(form).toBeVisible();
      if (scenario === "asks_sample") {
        await form.getByRole("combobox").click();
        await page.getByRole("option", { name: "询问样品", exact: true }).click();
      }
      const draft = "SYNTHETIC browser reply only";
      await form.getByLabel("待人工发送内容", { exact: true }).fill(draft);
      await form.getByLabel("本次人工确认凭据", { exact: true }).fill(f.confirmationRef);
      const submit = page.locator(`button[form="follow-up-${f.leadId}"]`).filter({ visible: true });
      await expect(submit).toBeEnabled();
      const before = await snapshot();
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (change !== "unchanged") {
        held = await pool.connect();
        await held.query("BEGIN");
        const {
          rows: [{ pid }],
        } = await held.query("SELECT pg_backend_pid() AS pid");
        if (change === "archived" || change === "kind")
          await held.query("SELECT id FROM workspace_project WHERE id=$1 FOR UPDATE", [
            f.projectId,
          ]);
        else
          await held.query("SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE", [
            change === "delivery" ? f.deliveryId : f.leadId,
          ]);
        const expiry = new Date(Date.now() + 1800);
        if (change === "window")
          await db
            .update(s.socialMessage)
            .set({ receivedAt: new Date(expiry.getTime() - 3_600_000) })
            .where(eq(s.socialMessage.id, f.inboundId));
        if (change === "retention")
          await db
            .update(s.socialMessage)
            .set({ expiresAt: expiry })
            .where(eq(s.socialMessage.id, f.inboundId));
        if (change === "delivery")
          await held.query(
            "UPDATE aggregate_record SET payload=jsonb_set(payload,'{result,valid_until}',to_jsonb($1::text)) WHERE id=$2",
            [expiry.toISOString(), f.deliveryId],
          );
        await submit.click();
        await expect(submit).toBeDisabled();
        await expect
          .poll(async () => {
            const {
              rows: [{ blocked }],
            } = await pool.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
              [pid],
            );
            return blocked;
          })
          .toBe(true);
        if (change === "revoked") await db.delete(s.session).where(eq(s.session.id, f.sessionId));
        if (change === "banned")
          await db.update(s.user).set({ banned: true }).where(eq(s.user.id, f.actorId));
        if (change === "role")
          await db.update(s.user).set({ role: "synthetic-denied" }).where(eq(s.user.id, f.actorId));
        if (change === "natural-expiry") {
          await db
            .update(s.session)
            .set({ expiresAt: new Date(Date.now() + 80) })
            .where(eq(s.session.id, f.sessionId));
          await delay(100);
        }
        const member = and(
          eq(s.workspaceProjectMember.projectId, f.projectId),
          eq(s.workspaceProjectMember.userId, f.actorId),
        );
        if (change === "viewer")
          await db.update(s.workspaceProjectMember).set({ role: "viewer" }).where(member);
        if (change === "removed") await db.delete(s.workspaceProjectMember).where(member);
        if (change === "archived")
          await held.query("UPDATE workspace_project SET status='archived' WHERE id=$1", [
            f.projectId,
          ]);
        if (change === "kind")
          await held.query("UPDATE workspace_project SET kind='marketing' WHERE id=$1", [
            f.projectId,
          ]);
        if (["window", "retention", "delivery"].includes(change))
          await delay(Math.max(0, expiry.getTime() - Date.now() + 20));
        await held.query("COMMIT");
        held.release();
        held = undefined;
      } else await submit.click();
      expect((await response).status()).toBe(200);
      if (change === "unchanged") {
        await expect(
          page
            .locator('[aria-live="polite"]')
            .filter({ visible: true, hasText: "人工确认的回复已安全提交" }),
        ).toBeVisible();
        const after = await snapshot();
        expect(after.jobs).toBe(1);
        expect(after.outbound).toBe(1);
        expect(after.audits).toBe(1);
        expect(after.version).toBe(2);
        const [message] = await db
          .select()
          .from(s.socialMessage)
          .where(
            and(
              eq(s.socialMessage.conversationId, f.conversationId),
              eq(s.socialMessage.direction, "outbound"),
            ),
          );
        const plaintext = decryptSocialMessageBody(message.bodyCiphertext);
        expect(plaintext).toContain(draft);
        expect(message.bodyCiphertext).not.toContain(draft);
        if (scenario === "asks_sample") expect(plaintext).toContain("Confirmed lead time: 21 days");
        else expect(plaintext).toBe(draft);
        await expect(form.getByLabel("待人工发送内容", { exact: true })).toHaveValue("");
      } else {
        await expect(page.locator('[aria-live="polite"]').filter({ visible: true })).toContainText(
          /无法确认当前登录|编辑权限|项目已归档|销售机会项目|保留期|回复窗口|Gate 03/,
        );
        await expect(form).toBeVisible();
        await expect(submit).toBeEnabled();
        await expect(form.getByLabel("待人工发送内容", { exact: true })).toHaveValue(draft);
        await expect(form.getByLabel("本次人工确认凭据", { exact: true })).toHaveValue(
          f.confirmationRef,
        );
        expect(await snapshot()).toEqual(before);
      }
    } finally {
      if (held) {
        await held.query("ROLLBACK");
        held.release();
      }
    }
  });
