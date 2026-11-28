import assert from "node:assert/strict";
import { mock } from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { z } from "zod";
import { parseActionInput, UserFacingError } from "../lib/user-facing-error";

const marker = "SYNTHETIC_PRIVATE_DIAGNOSTIC";
let failure: unknown;
mock.module(new URL("../lib/auth.ts", import.meta.url).href, { exports: { auth: {} } });
mock.module(new URL("../lib/invitations.ts", import.meta.url).href, {
  exports: {
    issueInvitation: async () => {},
    provisionInvitedUser: async () => {
      throw failure;
    },
  },
});
const { provisionInvitedUserAction } = await import("../lib/actions/invitations");
const run = () =>
  provisionInvitedUserAction({ email: "synthetic@example.invalid", token: "x".repeat(32) });
for (failure of [
  new Error(marker),
  new DrizzleQueryError("SYNTHETIC QUERY", [marker], new Error(marker)),
  new z.ZodError([{ code: "custom", path: ["internal"], message: marker }]),
  { message: marker },
]) {
  assert.deepEqual(await run(), { status: "error", message: "无法激活邀请。" });
}
const publicError = new UserFacingError("Invitation has already been activated");
publicError.message = marker;
failure = publicError;
assert.deepEqual(await run(), {
  status: "error",
  message: "Invitation has already been activated",
});
assert.throws(
  () => parseActionInput(z.uuid("项目标识无效。"), "invalid"),
  (error) => error instanceof UserFacingError && error.message === "项目标识无效。",
);
console.log("PASS shared Action fallback, controlled domain messages and submitted input feedback");
