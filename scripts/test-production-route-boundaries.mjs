import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = "3119";
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", port],
  {
    env: { ...process.env, NEXT_ENABLE_TESTING_API: "0" },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
let startupError;
child.on("error", (error) => {
  startupError = error;
});
const exited = new Promise((resolve) => child.once("exit", resolve));
const request = (path) =>
  fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Next.js exited with ${child.exitCode}`);
    try {
      const response = await request("/testing/workspace-navigation");
      await response.arrayBuffer();
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready, "Production server must start");
  for (const path of [
    "/testing/workspace-navigation",
    "/testing/workspace-navigation/00000000-0000-4000-8000-000000000263",
    "/testing/project-workspace",
  ]) {
    const response = await request(path);
    await response.arrayBuffer();
    assert.equal(
      response.status,
      404,
      `Synthetic fixture must not be accessible in production: ${path}`,
    );
  }
  for (const path of ["/workspace", "/workspace/00000000-0000-4000-8000-000000000263"]) {
    const response = await request(path);
    await response.arrayBuffer();
    assert.equal(response.status, 307, "Anonymous workspace access must redirect");
    assert.equal(new URL(response.headers.get("location"), origin).pathname, "/auth");
  }
  console.log("PASS production fixture isolation and anonymous workspace authorization boundary");
} finally {
  if (child.exitCode === null && !startupError) {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
