import assert from "node:assert/strict";

import { assertVideoGenerationEnabled } from "../lib/video/mvp-policy";

assert.throws(
  () => assertVideoGenerationEnabled({ ...process.env, VIDEO_GENERATION_ENABLED: undefined }),
  /MVP1/,
);
assert.doesNotThrow(() =>
  assertVideoGenerationEnabled({ ...process.env, VIDEO_GENERATION_ENABLED: "1" }),
);
console.log("PASS external video generation is fail-closed outside the MVP1 editor");
