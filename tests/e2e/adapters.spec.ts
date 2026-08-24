import { jsonSchema } from "ai";
import { expect, test } from "@playwright/test";

import { validateSyntheticOutput } from "../../lib/ai/structured-generator";
import { MemoryEvidenceStore } from "../../lib/evidence/memory-store";

test("validates synthetic structured model output at runtime", async () => {
  const schema = jsonSchema<{ message: string }>(
    {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    {
      validate: (value) =>
        value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string"
          ? { success: true, value: value as { message: string } }
          : { success: false, error: new Error("Invalid synthetic output") },
    },
  );

  await expect(validateSyntheticOutput(schema, { message: "synthetic" })).resolves.toEqual({
    message: "synthetic",
  });
  await expect(validateSyntheticOutput(schema, { message: 1 })).rejects.toThrow(
    "Invalid synthetic output",
  );
});

test("stores synthetic evidence behind an internal pathname", async () => {
  const store = new MemoryEvidenceStore();
  const stored = await store.put({
    evidenceId: "synthetic-evidence-001",
    filename: "factory sheet.txt",
    contentType: "text/plain",
    body: "synthetic-only",
  });

  expect(stored.pathname).toBe(
    "synthetic/synthetic-evidence-001/factory-sheet.txt",
  );
  expect(stored.pathname).not.toContain("http");
  const loaded = await store.get(stored.pathname);
  expect(loaded?.contentType).toBe("text/plain");
  expect(await new Response(loaded?.body).text()).toBe("synthetic-only");
});
