import type { ZodType } from "zod";

// Only throw with a message intended for the person using the application.
export class UserFacingError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
  }
}

// Validation of submitted input may give feedback. Validation of provider responses,
// stored data and internal contracts must retain its private diagnostic boundary.
export function parseActionInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new UserFacingError(result.error.issues[0]?.message ?? "请检查表单内容。");
  return result.data;
}
