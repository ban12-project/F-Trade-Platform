import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";
import { SOCIAL_HUMAN_ACCESS_MESSAGE } from "../../lib/social/human-write-access";
import { authSecret, databaseURL } from "../../playwright.database.config";
import { seedPublicationAccessFixture } from "../fixtures/publication-access";

const pool = new Pool({ connectionString: databaseURL }),
  db = drizzle(pool, { schema: s });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});
const cases: Array<{
  op: "publish" | "control";
  role: "admin" | "user";
  change: "unchanged" | "revoked" | "banned" | "expired" | "viewer" | "demoted";
}> = [];
for (const role of ["admin", "user"] as const)
  for (const change of ["unchanged", "revoked", "banned", "expired", "viewer"] as const)
    cases.push({ op: "publish", role, change });
for (const change of ["unchanged", "revoked", "banned", "expired", "demoted"] as const)
  cases.push({ op: "control", role: "admin", change });
for (const { op, role, change } of cases)
  test(`Current publication ${op} ${role} ${change}: signed Action retains input or commits one authorized request`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw Error("Local browser base URL required");
    const f = await seedPublicationAccessFixture(db as unknown as Database);
    await db.update(s.user).set({ role }).where(eq(s.user.id, f.actorId));
    const before = async () => {
      const [publications, jobs, audits, controls, records] = await Promise.all([
        db.select().from(s.socialPublication).where(eq(s.socialPublication.projectId, f.projectId)),
        db.select().from(s.socialBrowserJob).where(eq(s.socialBrowserJob.accountRef, f.accountRef)),
        db.select().from(s.auditEvent).where(eq(s.auditEvent.actorId, f.actorId)),
        db
          .select()
          .from(s.socialChannelControl)
          .where(eq(s.socialChannelControl.accountRef, f.accountRef)),
        db.select().from(s.aggregateRecord).where(eq(s.aggregateRecord.id, f.contentId)),
      ]);
      return { publications, jobs, audits, controls, records };
    };
    const original = await before();
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
      await page.goto(
        op === "publish"
          ? `/workspace/${f.projectId}/records/content/${f.contentId}`
          : "/workspace/settings?section=channels",
      );
      const form = page.locator(
        op === "publish" ? "#publication-confirmation:visible" : "#channel-settings:visible",
      );
      await expect(form).toBeVisible();
      const input = form.getByLabel(op === "publish" ? "逐帖人工确认凭据" : "脱敏证据", {
        exact: true,
      });
      const value = "evidence-synthetic-browser-human-confirmation";
      await input.click();
      await input.clear();
      await input.fill(value);
      await expect(input).toHaveValue(value);
      if (op === "control") {
        await form.getByLabel("渠道引用", { exact: true }).fill(f.channelRef);
        await form.getByLabel("账户引用", { exact: true }).fill(f.accountRef);
      }
      const submit = page.locator(
        `button[form="${op === "publish" ? "publication-confirmation" : "channel-settings"}"]:visible`,
      );
      await expect(submit).toBeEnabled();
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]),
      );
      if (change !== "unchanged") {
        held = await pool.connect();
        await held.query("BEGIN");
        const {
          rows: [{ pid }],
        } = await held.query("SELECT pg_backend_pid() AS pid");
        await held.query(
          op === "publish"
            ? "SELECT id FROM aggregate_record WHERE id=$1 FOR UPDATE"
            : "SELECT id FROM social_channel_control WHERE account_ref=$1 FOR UPDATE",
          [op === "publish" ? f.contentId : f.accountRef],
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
        if (change === "demoted")
          await db.update(s.user).set({ role: "user" }).where(eq(s.user.id, f.actorId));
        if (change === "viewer")
          await db
            .update(s.workspaceProjectMember)
            .set({ role: "viewer" })
            .where(
              and(
                eq(s.workspaceProjectMember.projectId, f.projectId),
                eq(s.workspaceProjectMember.userId, f.actorId),
              ),
            );
        if (change === "expired") {
          const expires = new Date(Date.now() + 650);
          await db
            .update(s.session)
            .set({ expiresAt: expires })
            .where(eq(s.session.id, f.sessionId));
          await delay(Math.max(1, expires.getTime() - Date.now() + 30));
        }
        await held.query("COMMIT");
      } else await submit.click();
      await response;
      if (change !== "unchanged") {
        await expect(page.getByText(SOCIAL_HUMAN_ACCESS_MESSAGE, { exact: true })).toBeVisible();
        await expect(input).toHaveValue(value);
        await expect(submit).toBeEnabled();
        expect(await before()).toEqual(original);
      } else {
        await expect
          .poll(async () => {
            const v = await before();
            return op === "publish" ? v.publications.length : v.controls[0].circuitStatus;
          })
          .toBe(op === "publish" ? 1 : "paused");
        const saved = await before();
        expect(saved.audits).toHaveLength(1);
        if (op === "publish") {
          expect(saved.jobs).toHaveLength(1);
          expect(saved.publications[0].status).toBe("submitted");
          expect(saved.publications[0].textConfirmation?.contentVersion).toBe(1);
        }
      }
    } finally {
      if (held) {
        await held.query("ROLLBACK");
        held.release();
      }
    }
  });

test("Approved video directs to the complete media path and never offers a manifest-free generic confirmation", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw Error("Local browser URL required");
  const f = await seedPublicationAccessFixture(db as unknown as Database, "video");
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
  await page.goto(`/workspace/${f.projectId}/records/video/${f.contentId}`);
  await expect(page.getByText("视频请使用素材发布", { exact: true })).toBeVisible();
  await expect(page.locator("#publication-confirmation:visible")).toHaveCount(0);
  expect(
    await db
      .select()
      .from(s.socialPublication)
      .where(eq(s.socialPublication.projectId, f.projectId)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(s.socialBrowserJob)
      .where(eq(s.socialBrowserJob.accountRef, f.accountRef)),
  ).toHaveLength(0);
});
