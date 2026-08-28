import assert from "node:assert/strict";

import { createAiSdkVideoAdapters } from "../lib/video/ai-sdk-adapters";

const adapters = createAiSdkVideoAdapters({ async putGeneratedVideo() { return "asset-video-401"; } }, { googleVertex: { project: "synthetic-project", location: "us-central1" } });
assert.deepEqual(adapters.map((adapter) => adapter.provider), ["alibaba", "bytedance", "fal", "google", "google-vertex", "kling", "replicate", "xai"]);
assert.equal(adapters.length, 8);
console.log("PASS AI SDK video adapters expose every configured provider without network calls");
