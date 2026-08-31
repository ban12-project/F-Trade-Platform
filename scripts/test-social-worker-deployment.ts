import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const [compose, environment, readme] = await Promise.all([
    readFile(path.join(root, "ops/social-worker/docker-compose.yml"), "utf8"),
    readFile(path.join(root, "ops/social-worker/.env.example"), "utf8"),
    readFile(path.join(root, "ops/social-worker/README.md"), "utf8"),
  ]);
  assert.match(compose, /replicas: 1/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(environment, /SOCIAL_WORKER_TELEMETRY_ENABLED=false/);
  assert.match(environment, /SOCIAL_WORKER_TRACE_ENABLED=false/);
  assert.doesNotMatch(environment, /(sk-|ghp_|password=|token=)/i);
  assert.match(readme, /fixed US egress IP/);
  assert.match(readme, /Stop the container immediately/);
  console.log("PASS controlled social Worker deployment baseline");
}

void main();
