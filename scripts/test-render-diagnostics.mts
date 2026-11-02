import assert from "node:assert/strict";
import { renderFailureCategory, renderStage } from "../lib/video/render-diagnostics";

assert.equal(
  renderFailureCategory(new Error("ETIMEDOUT timeout https://private/token")),
  "timeout",
);
assert.equal(renderFailureCategory(new TypeError("terminated")), "transport_interrupted");
assert.equal(renderFailureCategory("ENOSPC private-input"), "storage_exhausted");
assert.equal(renderFailureCategory("secret https://private/token"), "unknown");
const logs: unknown[] = [];
const previous = console.error;
console.error = (...args) => {
  logs.push(args);
};
const failure = new Error("secret https://private/token");
try {
  await assert.rejects(
    renderStage("source_download", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
} finally {
  console.error = previous;
}
assert.equal(JSON.stringify(logs).includes("secret"), false);
assert.equal(JSON.stringify(logs).includes("source_download"), true);
console.log("render diagnostics privacy and error preservation passed");
