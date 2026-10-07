import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { encryptStoredSecret } from "../../lib/security/encrypted-secret";
import { upsertWorkspaceProjectMember } from "../../lib/workspace/access";
import { authSecret, databaseURL, modelConfigKey } from "../../playwright.database.config";

// Actual browser, signed auth, Server Action, SDK, evidence guards, DB and audits.
// Only the provider is an isolated loopback JSON response; no commercial request.
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle(pool, { schema });
test.beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
test.afterAll(async () => {
  await pool.end();
});

for (const revoke of [false, true]) {
  test(
    revoke
      ? "single-product Action rejects actual in-flight membership demotion with intact source input"
      : "ordinary editor single-product Action creates only a pending sourced review draft",
    async ({ page, context, baseURL }) => {
      if (!baseURL) throw new Error("Browser base URL required");
      const actorId = randomUUID(),
        ownerId = randomUUID(),
        projectId = randomUUID(),
        sessionId = randomUUID(),
        configId = randomUUID(),
        token = randomUUID();
      const email = `${actorId}@example.invalid`;
      const evidenceId = `evidence-synthetic-action-${randomUUID()}`;
      const sourceText =
        "Product name: SYNTHETIC browser import product\nProduct type: clutch_kit\nInternal SKU: SYN-BROWSER-ACCESS";
      let modelCalls = 0,
        productId = "",
        providerFailure: unknown;
      const provider = createServer(async (request, response) => {
        try {
          modelCalls++;
          let body = "";
          for await (const chunk of request) body += chunk;
          const input = JSON.parse(body) as {
            messages: Array<{
              role: string;
              content: string | Array<{ type: string; text: string }>;
            }>;
          };
          const userMessage = input.messages.find((message) => message.role === "user");
          if (!userMessage) throw new Error("Missing model input");
          const text =
            typeof userMessage.content === "string"
              ? userMessage.content
              : userMessage.content.find((part) => part.type === "text")?.text;
          if (!text) throw new Error("Missing model text");
          const source = JSON.parse(text) as {
            record_id: string;
            source_ref: string;
            evidence_refs: string[];
            source_text: string;
          };
          productId = source.record_id;
          const ref = (label: string) => {
            const item = [
              ...source.source_text.matchAll(
                /<evidence-location ref="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/evidence-location>/g,
              ),
            ].find((match) => match[2]?.includes(label));
            if (!item?.[1]) throw new Error("Missing sourced location");
            return item[1];
          };
          if (revoke)
            await upsertWorkspaceProjectMember(
              { projectId, email, role: "viewer" },
              ownerId,
              db as unknown as Database,
            );
          const draft = {
            record_id: productId,
            source_ref: source.source_ref,
            evidence_refs: source.evidence_refs,
            verification_status: "review_required",
            blocking_missing_fields: [],
            optional_missing_fields: [],
            product: {
              product_name: "SYNTHETIC browser import product",
              product_type: "clutch_kit",
              internal_sku: "SYN-BROWSER-ACCESS",
            },
            field_evidence: {
              "product.product_name": ref("Product name:"),
              "product.product_type": ref("Product type:"),
              "product.internal_sku": ref("Internal SKU:"),
            },
          };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              id: "synthetic-write-guard",
              object: "chat.completion",
              created: 1,
              model: "synthetic-action-model",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: JSON.stringify(draft) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          );
        } catch (error) {
          providerFailure = error;
          response.writeHead(500);
          response.end("{}");
        }
      });
      await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
      try {
        const address = provider.address();
        if (!address || typeof address === "string") throw new Error("Provider port required");
        for (const id of [actorId, ownerId])
          await db.insert(schema.user).values({
            id,
            name: "SYNTHETIC browser import",
            email: `${id}@example.invalid`,
            emailVerified: true,
            role: "user",
          });
        await db.insert(schema.session).values({
          id: sessionId,
          token,
          userId: actorId,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        await db.insert(schema.workspaceProject).values({
          id: projectId,
          title: "SYNTHETIC browser import",
          kind: "marketing",
          createdById: ownerId,
        });
        for (const [userId, role] of [
          [ownerId, "owner"],
          [actorId, "editor"],
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
          sourceLabel: "SYNTHETIC action source",
          uploadedByType: "human",
          uploadedById: actorId,
        });
        await db
          .insert(schema.workspaceProjectEvidence)
          .values({ id: randomUUID(), projectId, evidenceId, linkedById: actorId });
        process.env.MODEL_CONFIG_ENCRYPTION_KEY = modelConfigKey;
        await db.insert(schema.productAgentModelConfig).values({
          id: configId,
          name: configId,
          provider: "openai-compatible",
          model: "synthetic-action-model",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeyCiphertext: encryptStoredSecret("SYNTHETIC-only-key"),
          updatedBy: ownerId,
        });
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
        await page.getByRole("button", { name: "高级设置：模型", exact: true }).click();
        await page.getByRole("combobox", { name: "模型", exact: true }).click();
        await page
          .getByRole("option", { name: `${configId} · synthetic-action-model`, exact: true })
          .click();
        await page.getByRole("button", { name: "改用已有证据中的文本", exact: true }).click();
        await page.getByLabel("来源引用", { exact: true }).fill("source-synthetic-browser-access");
        await page.getByRole("combobox", { name: "字段证据", exact: true }).click();
        await page.getByRole("option", { name: /SYNTHETIC action source/ }).click();
        await page.getByLabel("已授权资料文本", { exact: true }).fill(sourceText);
        await page.getByRole("button", { name: "生成待审核草稿", exact: true }).click();
        if (revoke) {
          await expect(
            page.getByText(
              "无法确认登录或项目编辑权限，产品草稿未创建。请重新登录并确认权限后重试。",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(page.getByLabel("已授权资料文本", { exact: true })).toHaveValue(sourceText);
          await expect(page.getByLabel("来源引用", { exact: true })).toHaveValue(
            "source-synthetic-browser-access",
          );
          await expect(
            page.getByRole("button", { name: "生成待审核草稿", exact: true }),
          ).toBeEnabled();
          expect(providerFailure).toBeUndefined();
          expect(modelCalls).toBe(1);
          expect(productId).not.toBe("");
          const writes = await Promise.all([
            db
              .select()
              .from(schema.aggregateRecord)
              .where(eq(schema.aggregateRecord.id, productId)),
            db.select().from(schema.approval).where(eq(schema.approval.aggregateId, productId)),
            db
              .select()
              .from(schema.workflowEvent)
              .where(eq(schema.workflowEvent.aggregateId, productId)),
            db.select().from(schema.auditEvent).where(eq(schema.auditEvent.aggregateId, productId)),
            db
              .select()
              .from(schema.workspaceProjectItem)
              .where(eq(schema.workspaceProjectItem.aggregateId, productId)),
            db
              .select()
              .from(schema.productSourceImage)
              .where(eq(schema.productSourceImage.productId, productId)),
          ]);
          expect(writes.map((records) => records.length)).toEqual([0, 0, 0, 0, 0, 0]);
          const memberAudits = await db
            .select()
            .from(schema.auditEvent)
            .where(
              and(
                eq(schema.auditEvent.subjectType, "workspace_project_member"),
                eq(schema.auditEvent.actorId, ownerId),
              ),
            );
          expect(memberAudits).toHaveLength(1);
        } else {
          await expect(page).toHaveURL(new RegExp(`/records/product/${productId || "[^/]+"}$`));
          expect(providerFailure).toBeUndefined();
          expect(modelCalls).toBe(1);
          expect(productId).not.toBe("");
          const [record] = await db
            .select()
            .from(schema.aggregateRecord)
            .where(eq(schema.aggregateRecord.id, productId));
          expect(record.state).toBe("PRODUCT_REVIEW_REQUIRED");
          expect(record.payload.verification_status).toBe("review_required");
          const [gate] = await db
            .select()
            .from(schema.approval)
            .where(eq(schema.approval.aggregateId, productId));
          expect(gate).toMatchObject({ gate: "gate_01_truth", status: "pending" });
          await expect(
            page.getByText("等待审核者核实产品", { exact: true }).filter({ visible: true }),
          ).toBeVisible();
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          provider.close((error) => (error ? reject(error) : resolve())),
        );
        await db.delete(schema.session).where(eq(schema.session.id, sessionId));
        await db
          .delete(schema.productAgentModelConfig)
          .where(eq(schema.productAgentModelConfig.id, configId));
        // Keep actual evidence, product and membership audit fixtures append-only.
      }
    },
  );
}
