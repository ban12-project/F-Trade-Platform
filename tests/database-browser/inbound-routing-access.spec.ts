import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";
import { authSecret, databaseURL } from "../../playwright.database.config";
import { seedInboundRoutingFixture } from "../fixtures/inbound-routing";

const pool = new Pool({ connectionString: databaseURL }),
  db = drizzle(pool, { schema: s });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});
type Case = {
  mode: "create" | "link";
  role: "user" | "admin";
  change:
    | "unchanged"
    | "revoked"
    | "banned"
    | "denied-role"
    | "natural-expiry"
    | "viewer"
    | "removed"
    | "archived"
    | "kind";
};
const cases: Case[] = [];
for (const mode of ["create", "link"] as const) {
  for (const role of ["user", "admin"] as const) cases.push({ mode, role, change: "unchanged" });
  for (const change of ["revoked", "banned", "denied-role", "natural-expiry"] as const)
    cases.push({ mode, role: "user", change });
}
for (const change of ["viewer", "removed", "archived", "kind"] as const)
  cases.push({ mode: "link", role: "user", change });
for (const { mode, role, change } of cases)
  test(`Current inbound routing ${mode} ${role} ${change}: signed form commits one lead or retains selection`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw Error("Local browser base URL required");
    const f = await seedInboundRoutingFixture(db as unknown as Database, role);
    async function snapshot() {
      const r = await db.execute(sql`SELECT
        (SELECT count(*)::int FROM workspace_project WHERE created_by_id=${f.actorId}) AS projects,
        (SELECT count(*)::int FROM aggregate_record WHERE type='lead' AND created_by_id=${f.actorId}) AS leads,
        (SELECT count(*)::int FROM workspace_project_item i JOIN workspace_project p ON p.id=i.project_id WHERE p.created_by_id=${f.actorId}) AS items,
        (SELECT count(*)::int FROM audit_event WHERE actor_id=${f.actorId}) AS audits,
        (SELECT lead_id FROM social_conversation WHERE id=${f.conversationId}) AS lead_id`);
      return r.rows[0];
    }
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
    let held: PoolClient | undefined;
    try {
      await page.goto("/workspace");
      const card = page
        .getByRole("region", { name: "待分流入站消息" })
        .locator(":scope > div")
        .filter({ hasText: f.channelRef });
      await expect(card).toBeVisible();
      await card
        .getByRole("button", {
          name: mode === "create" ? "新建销售项目" : "关联现有项目",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      if (mode === "link") {
        await dialog.getByRole("combobox", { name: "销售项目", exact: true }).click();
        await page
          .getByRole("option", { name: `SYNTHETIC routing ${f.projectId}`, exact: true })
          .click();
      }
      const submit = dialog.locator('button[type="submit"]');
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
        await held.query("SELECT id FROM social_conversation WHERE id=$1 FOR UPDATE", [
          f.conversationId,
        ]);
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
        if (change === "denied-role")
          await db.update(s.user).set({ role: "synthetic-denied" }).where(eq(s.user.id, f.actorId));
        if (change === "natural-expiry") {
          await db
            .update(s.session)
            .set({ expiresAt: new Date(Date.now() + 100) })
            .where(eq(s.session.id, f.sessionId));
          await delay(150);
        }
        const membership = and(
          eq(s.workspaceProjectMember.projectId, f.projectId),
          eq(s.workspaceProjectMember.userId, f.actorId),
        );
        if (change === "viewer")
          await db.update(s.workspaceProjectMember).set({ role: "viewer" }).where(membership);
        if (change === "removed") await db.delete(s.workspaceProjectMember).where(membership);
        if (change === "archived")
          await db
            .update(s.workspaceProject)
            .set({ status: "archived" })
            .where(eq(s.workspaceProject.id, f.projectId));
        if (change === "kind")
          await db
            .update(s.workspaceProject)
            .set({ kind: "marketing" })
            .where(eq(s.workspaceProject.id, f.projectId));
        await held.query("COMMIT");
        held.release();
        held = undefined;
      } else await submit.click();
      const returned = await response;
      expect(returned.status()).toBe(200);
      if (change === "unchanged") {
        await expect(page).toHaveURL(/\/workspace\/[^/]+\/records\/lead\//);
        const after = await snapshot();
        expect(after.leads).toBe(1);
        expect(after.items).toBe(1);
        expect(after.projects).toBe(mode === "create" ? 2 : 1);
        expect(after.audits).toBe(mode === "create" ? 2 : 1);
        expect(after.lead_id).toBeTruthy();
        const [link] = await db
          .select()
          .from(s.workspaceProjectItem)
          .where(eq(s.workspaceProjectItem.aggregateId, String(after.lead_id)));
        expect(link.role).toBe("sales_lead");
        expect(link.relation).toBe("owned");
        if (mode === "link") expect(link.projectId).toBe(f.projectId);
      } else {
        await expect(dialog.locator('[aria-live="polite"]')).toContainText(
          /无法确认当前登录|编辑权限|项目已归档/,
        );
        await expect(dialog).toBeVisible();
        await expect(submit).toBeEnabled();
        if (mode === "link")
          await expect(
            dialog.getByRole("combobox", { name: "销售项目", exact: true }),
          ).toContainText(`SYNTHETIC routing ${f.projectId}`);
        expect(await snapshot()).toEqual(before);
      }
    } finally {
      if (held) {
        await held.query("ROLLBACK");
        held.release();
      }
    }
  });
