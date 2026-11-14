import assert from "node:assert/strict";

/** Fail the test at a missing fixture value, before exercising dependent behavior. */
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, "Expected the test fixture value to exist");
  return value;
}
