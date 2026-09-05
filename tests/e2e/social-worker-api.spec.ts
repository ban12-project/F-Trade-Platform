import { expect, test } from "@playwright/test";

test("social worker job claim rejects unauthenticated callers before database access", async ({
  request,
}) => {
  const response = await request.post("/api/social-worker/jobs/claim", {
    data: { workerId: "synthetic-worker-001" },
  });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
});

test("social worker result callbacks reject unsigned effects", async ({ request }) => {
  for (const path of [
    "/api/social-worker/publication-result",
    "/api/social-worker/reply-result",
  ] as const) {
    const response = await request.post(path, {
      data: { result: { jobId: "30000000-0000-4000-8000-000000000001" }, signature: "invalid" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  }
});
