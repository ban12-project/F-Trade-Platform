import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import readyProduct from "../../data/fixtures/product-ready.synthetic.json";
import * as schema from "../../lib/db/schema";
import { videoProjectSchema } from "../../lib/video/contracts";
import { authSecret, databaseURL } from "../../playwright.database.config";

// This file never reads developer credentials or contacts media/model providers.
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
const actorId = randomUUID(),
  ownerId = randomUUID(),
  token = randomUUID();
const projectId = randomUUID(),
  copyProjectId = randomUUID(),
  hiddenProjectId = randomUUID();
const productIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const videoIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const recordIds: string[] = [...productIds, ...videoIds];
const names = [
  "SYNTHETIC primary kit",
  "SYNTHETIC secondary disc",
  "SYNTHETIC copy source",
  "SYNTHETIC private product",
];
const path = `/workspace/${projectId}/video`;
function payload(index: number) {
  return videoProjectSchema.parse({
    id: videoIds[index],
    productId: productIds[index],
    status: "draft",
    objective: `SYNTHETIC video objective ${index}`,
    targetAudience: "SYNTHETIC distributors",
    platforms: ["facebook"],
    factualClaims: [
      {
        field: "product.product_name",
        value: names[index],
        evidenceRef: "evidence-synthetic-fact",
      },
    ],
    sourceAssets: [
      {
        assetRef: "evidence-synthetic-image",
        mediaType: "image",
        rightsEvidenceRef: "evidence-synthetic-rights",
      },
    ],
    scenes: [
      {
        sceneId: "scene-synthetic",
        prompt: "SYNTHETIC",
        durationSeconds: 3,
        claimRefs: [],
        assetRefs: ["evidence-synthetic-image"],
      },
    ],
    editDraft: {
      version: 3,
      creativeFramework: "google_abcd",
      platform: "facebook",
      ctaText: "Contact us",
      clips: [
        {
          clipId: "clip-synthetic",
          assetRef: "evidence-synthetic-image",
          mediaType: "image",
          trimStartMs: 0,
          durationMs: 3000,
          fitMode: "contain",
          audioMode: "muted",
          caption: { kind: "none" },
          abcdRoles: ["attention", "branding", "connection", "direction"],
          motionPreset: "cta_hold",
        },
      ],
    },
  });
}
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values(
    [actorId, ownerId].map((id) => ({
      id,
      name: "SYNTHETIC video reviewer",
      email: `${id}@example.invalid`,
      emailVerified: true,
      role: "admin",
    })),
  );
  await db.insert(schema.session).values({
    id: randomUUID(),
    token,
    userId: actorId,
    expiresAt: new Date(Date.now() + 3600000),
  });
  for (const id of [projectId, copyProjectId, hiddenProjectId]) {
    const owner = id === hiddenProjectId ? ownerId : actorId;
    await db.insert(schema.workspaceProject).values({
      id,
      title: `SYNTHETIC video project ${id}`,
      kind: "marketing",
      createdById: owner,
    });
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId: id,
      userId: owner,
      role: "owner",
      createdById: owner,
    });
  }
  for (let i = 0; i < 4; i++) {
    const id = i < 2 ? projectId : i === 2 ? copyProjectId : hiddenProjectId;
    const owner = i === 3 ? ownerId : actorId;
    await db.insert(schema.aggregateRecord).values([
      {
        id: productIds[i],
        type: "product",
        state: "PRODUCT_READY",
        payload: {
          ...readyProduct,
          record_id: productIds[i],
          product: { ...readyProduct.product, product_name: names[i], internal_sku: `SYN-${i}` },
          evidence_refs: [...readyProduct.evidence_refs, "evidence-synthetic-fact"],
          field_evidence: {
            ...readyProduct.field_evidence,
            "product.product_name": "evidence-synthetic-fact",
          },
        },
        createdByType: "human",
        createdById: owner,
      },
      {
        id: videoIds[i],
        type: "video",
        state: "VIDEO_DRAFT",
        payload: payload(i),
        createdByType: "human",
        createdById: owner,
      },
    ]);
    await db.insert(schema.workspaceProjectItem).values([
      {
        id: randomUUID(),
        projectId: id,
        aggregateId: productIds[i],
        role: "product_source",
        relation: "owned",
      },
      {
        id: randomUUID(),
        projectId: id,
        aggregateId: videoIds[i],
        role: "marketing_video",
        relation: "owned",
      },
    ]);
  }
});
test.beforeEach(async ({ context, baseURL }) => {
  await db
    .update(schema.workspaceProject)
    .set({ status: "active" })
    .where(eq(schema.workspaceProject.id, projectId));
  await db
    .update(schema.workspaceProjectMember)
    .set({ role: "owner" })
    .where(
      and(
        eq(schema.workspaceProjectMember.projectId, projectId),
        eq(schema.workspaceProjectMember.userId, actorId),
      ),
    );
  await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, actorId));
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(
        `${token}.${createHmac("sha256", authSecret).update(token).digest("base64")}`,
      ),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
test.afterAll(async () => {
  const projects = [projectId, copyProjectId, hiddenProjectId];
  await db
    .delete(schema.workspaceProjectItem)
    .where(inArray(schema.workspaceProjectItem.projectId, projects));
  await db.delete(schema.workspaceProject).where(inArray(schema.workspaceProject.id, projects));
  await db.delete(schema.aggregateRecord).where(inArray(schema.aggregateRecord.id, recordIds));
  await db.delete(schema.user).where(inArray(schema.user.id, [actorId, ownerId]));
  await pool.end();
});

test("video collection, exact draft and sourced creation remain distinct with multiple records", async ({
  page,
}) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "营销视频", exact: true })).toBeVisible();
  await expect(page.getByLabel("成片时长（秒）")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "制作新视频" })).toHaveAttribute(
    "href",
    `${path}?new=1`,
  );
  await page
    .getByRole("link", { name: /SYNTHETIC secondary disc · SYNTHETIC video objective 1/ })
    .click();
  await expect(page).toHaveURL(`${path}?item=${videoIds[1]}`);
  await expect(page.getByRole("heading", { name: names[1], exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: names[0], exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回内容与发布" })).toHaveAttribute(
    "href",
    `/workspace/content?project=${projectId}`,
  );
  await page.goto(`${path}?new=1`);
  await expect(page.getByLabel("视频目标")).toBeVisible();
  await expect(page.getByLabel("成片时长（秒）")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "已核验产品", exact: true })).toContainText(
    "选择已核实产品",
  );
  // Both the old product link and the explicit new link bind the same source.
  for (const query of [`product=${productIds[1]}`, `new=1&product=${productIds[1]}`]) {
    await page.goto(`${path}?${query}`);
    await expect(page.getByRole("combobox", { name: "已核验产品", exact: true })).toContainText(
      names[1],
    );
    await expect(page.getByRole("combobox", { name: "已核验产品", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: names[1], exact: true })).toHaveAttribute(
      "href",
      `/workspace/${projectId}/records/product/${productIds[1]}`,
    );
    await expect(page.getByRole("button", { name: "复制为新剪辑稿" })).toHaveCount(0);
  }
});

test("invalid, conflicting and cross-project video links never select another record", async ({
  page,
}) => {
  for (const query of [
    "item=not-a-uuid",
    `item=${randomUUID()}`,
    `item=${videoIds[3]}`,
    `product=${productIds[3]}`,
    `item=${videoIds[0]}&item=${videoIds[1]}`,
    `item=${videoIds[0]}&new=1`,
    `item=${videoIds[0]}&product=${productIds[0]}`,
    "new=0",
  ]) {
    await page.goto(`${path}?${query}`);
    await expect(
      page.getByRole("main").getByText("无法打开指定工作", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("成片时长（秒）")).toHaveCount(0);
    await expect(page.getByLabel("视频目标")).toHaveCount(0);
    expect(await page.content()).not.toContain(names[3]);
  }
});

test("copy opens its returned draft, protects other input, and repeated saves clear dirty state", async ({
  page,
}) => {
  await page.goto(`${path}?new=1`);
  await expect(page.getByLabel("视频目标")).toHaveValue("展示已核实产品，引导客户咨询");
  await page.getByLabel("视频目标").fill("SYNTHETIC unsaved separate creation");
  await page.getByRole("button", { name: "复制为新剪辑稿" }).click();
  const open = page.getByRole("link", { name: "打开复制的剪辑稿" });
  await expect(open).toBeVisible();
  const href = await open.getAttribute("href");
  const copiedId = new URL(href!, "http://synthetic.invalid").searchParams.get("item")!;
  // Retain the actual copy and its append-only audit trail in the synthetic database.
  expect(videoIds).not.toContain(copiedId);
  const [copy] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.id, copiedId));
  expect(copy.state).toBe("VIDEO_DRAFT");
  expect(copy.payload).toMatchObject({ id: copiedId, productId: productIds[2] });
  await open.click();
  const dialog = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("视频目标")).toHaveValue("SYNTHETIC unsaved separate creation");
  await open.click();
  await dialog.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page).toHaveURL(`${path}?item=${copiedId}`);
  await expect(page.getByRole("heading", { name: names[2], exact: true })).toBeVisible();
  for (const ctaText of ["Ask our team", "Contact the team"]) {
    await page.getByLabel("最后两秒 CTA").fill(ctaText);
    await expect(page.getByRole("main").getByText("有未保存修改", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("main").getByText("已同步", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    const [saved] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, copiedId));
    expect(saved.payload).toMatchObject({ editDraft: { ctaText } });
  }
});

test("viewer and archived project show read-only controls even for an app administrator", async ({
  page,
}) => {
  for (const kind of ["viewer", "archived"] as const) {
    await db
      .update(schema.workspaceProjectMember)
      .set({ role: kind === "viewer" ? "viewer" : "owner" })
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, projectId),
          eq(schema.workspaceProjectMember.userId, actorId),
        ),
      );
    await db
      .update(schema.workspaceProject)
      .set({ status: kind === "archived" ? "archived" : "active" })
      .where(eq(schema.workspaceProject.id, projectId));
    await page.goto(`${path}?item=${videoIds[0]}`);
    await expect(page.getByRole("main").getByText("只读", { exact: true })).toBeVisible();
    await expect(page.getByLabel("成片时长（秒）")).toBeDisabled();
    await expect(page.getByRole("button", { name: "AI 初稿", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "合成预览", exact: true })).toBeDisabled();
    await page.goto(`${path}?new=1`);
    await expect(page.getByLabel("视频目标")).toBeDisabled();
    await expect(page.getByRole("button", { name: "复制为新剪辑稿" })).toHaveCount(0);
    await db
      .update(schema.aggregateRecord)
      .set({
        state: "VIDEO_REVIEW_REQUIRED",
        payload: {
          ...payload(1),
          status: "review_required",
          renderedAssetRef: "asset-synthetic-preview",
        },
      })
      .where(eq(schema.aggregateRecord.id, videoIds[1]));
    await page.goto(`${path}?item=${videoIds[1]}`);
    await expect(
      page.getByRole("main").getByText("私有预览", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByLabel("审核证据")).toHaveCount(0);
  }
});

test("narrow video creation protects source, return and global navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${path}?new=1&product=${productIds[0]}`);
  await expect(page.getByLabel("视频目标")).toHaveValue("展示已核实产品，引导客户咨询");
  await page.getByLabel("视频目标").fill("SYNTHETIC mobile unsaved draft");
  await expect(page.getByRole("main").getByText("有未保存修改", { exact: true })).toBeVisible();
  for (const link of [
    page.getByRole("link", { name: names[0], exact: true }),
    page.getByRole("link", { name: "返回内容与发布" }),
  ]) {
    await link.click();
    const dialog = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByLabel("视频目标")).toHaveValue("SYNTHETIC mobile unsaved draft");
  }
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "今日任务", exact: true }).click();
  const navigationDialog = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(navigationDialog).toBeVisible();
  await navigationDialog.getByRole("button", { name: "继续编辑" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("视频目标")).toHaveValue("SYNTHETIC mobile unsaved draft");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
